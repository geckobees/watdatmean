import { MAX_OUTPUT_TOKENS, prepareRequest } from './budget';
import type { LearningRequest, Lesson, Provider, TokenUsage } from './types';

export const defaults: Record<Provider, string> = {
  openai: 'gpt-4.1-mini',
  anthropic: 'claude-haiku-4-5',
  groq: 'qwen/qwen3.8-27b',
};
const endpoints: Record<Provider, string> = {
  openai: 'https://api.openai.com/v1/responses',
  anthropic: 'https://api.anthropic.com/v1/messages',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
};
export function makeRequest(
  provider: Provider,
  model: string,
  key: string,
  request: LearningRequest,
) {
  const prepared = prepareRequest(request);
  const { input, system: instructions } = prepared;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let body: unknown;
  if (provider === 'anthropic') {
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
    body = {
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: instructions,
      messages: [{ role: 'user', content: input }],
    };
  } else if (provider === 'openai') {
    headers.Authorization = `Bearer ${key}`;
    body = {
      model,
      store: false,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      instructions,
      input,
      text: { format: { type: 'json_object' } },
    };
  } else {
    headers.Authorization = `Bearer ${key}`;
    body = {
      model,
      max_completion_tokens: MAX_OUTPUT_TOKENS,
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: input },
      ],
      response_format: { type: 'json_object' },
      ...(model === 'qwen/qwen3.8-27b' ? { reasoning_effort: 'none' } : {}),
    };
  }
  return { url: endpoints[provider], headers, body: JSON.stringify(body), prepared };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('The AI returned an invalid response. Please try again.');
  return value as Record<string, unknown>;
}

function string(value: unknown, max = 8000): string {
  if (typeof value !== 'string')
    throw new Error('The AI response was incomplete. Please try again.');
  return value.slice(0, max);
}

function list(value: unknown): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('The AI response was incomplete. Please try again.');
  return value.slice(0, 8);
}

export function parseLesson(text: string, validIds: string[] = []): Lesson {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      text
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, ''),
    );
  } catch {
    throw new Error('The AI did not return valid JSON. Try again or choose a different model.');
  }
  const data = record(parsed);
  const example = data.example === undefined ? { code: '', explanation: '' } : record(data.example);
  return {
    title: data.title === undefined ? 'Explanation' : string(data.title, 180),
    summary: string(data.summary),
    steps: list(data.steps).map((v) => string(v)),
    concepts: list(data.concepts).map((v) => {
      if (typeof v === 'string') return { term: string(v, 150), explanation: '' };
      const c = record(v);
      return { term: string(c.term, 150), explanation: string(c.explanation) };
    }),
    example: { code: string(example.code), explanation: string(example.explanation) },
    predictions: list(data.predictions).map((v) => {
      const p = record(v);
      return {
        description: string(p.description),
        evidenceIds: list(p.evidenceIds)
          .map((v) => string(v))
          .filter((id) => validIds.includes(id)),
      };
    }),
    checks: list(data.checks).map((v) => string(v)),
  };
}

function tokenUsage(value: unknown, provider: Provider): TokenUsage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const usage = value as Record<string, unknown>;
  const count = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  let input = provider === 'groq' ? usage.prompt_tokens : usage.input_tokens;
  const output = provider === 'groq' ? usage.completion_tokens : usage.output_tokens;
  if (!count(input) || !count(output)) return;
  if (provider === 'anthropic') {
    for (const field of ['cache_creation_input_tokens', 'cache_read_input_tokens']) {
      if (count(usage[field])) input += usage[field];
    }
  }
  // Completion usage already includes reasoning; do not count it twice.
  const total = count(usage.total_tokens)
    ? Math.max(usage.total_tokens, input + output)
    : input + output;
  return { input, output, total };
}

export async function generate(
  provider: Provider,
  model: string,
  key: string,
  request: LearningRequest,
  signal?: AbortSignal,
  transport: typeof fetch = fetch,
): Promise<Lesson> {
  const config = makeRequest(provider, model, key, request);
  const timeout = AbortSignal.timeout(60000);
  let response: Response;
  try {
    response = await transport(config.url, {
      method: 'POST',
      headers: config.headers,
      body: config.body,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      redirect: 'error',
    });
  } catch {
    if (signal?.aborted) throw new Error('Request cancelled.');
    if (timeout.aborted) throw new Error('The provider took too long. Please retry.');
    throw new Error('Could not reach the AI provider. Check your connection and try again.');
  }
  if (!response.ok) {
    // Only classify known codes; raw messages and failed generations can contain private code.
    let code: unknown;
    try {
      const failure = await response.json();
      code = failure?.error?.code;
    } catch {
      // Some provider/proxy errors are HTML or plain text.
    }
    if ((response.status === 400 || response.status === 422) && code === 'json_validate_failed')
      throw new Error(
        'The provider could not produce valid JSON within the response budget. Try a simpler question or a different model. Your model ID may still be valid.',
      );
    if (response.status === 404 || code === 'model_not_found' || code === 'model_decommissioned')
      throw new Error(
        'The selected model is unavailable or your API account cannot access it. Run WatDatMean: Configure AI Provider / API Key and choose an available model.' +
          (provider === 'groq' ? ` The current Groq default is ${defaults.groq}.` : ''),
      );
    const message =
      response.status === 401 || response.status === 403
        ? 'API key rejected or model access denied. Configure your provider and key again.'
        : response.status === 429
          ? 'Provider quota or rate limit reached. Check billing or wait before retrying.'
          : response.status === 400
            ? 'The provider rejected the request format (HTTP 400). The model may not support these request options; try the current default model.'
            : `The AI provider returned HTTP ${response.status}. Please retry later.`;
    // Never display raw provider errors, which may echo request content or credentials.
    throw new Error(message);
  }
  const body = record(await response.json());
  let output = '';
  if (provider === 'anthropic') {
    if (body.stop_reason === 'max_tokens')
      throw new Error('The response was cut short. Try a smaller selection or a different model.');
    output = (Array.isArray(body.content) ? body.content : [])
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('\n');
  } else if (provider === 'openai') {
    if (body.status === 'incomplete')
      throw new Error('The response was cut short. Try a smaller selection or a different model.');
    output = (Array.isArray(body.output) ? body.output : [])
      .flatMap((p) => p.content ?? [])
      .filter((p) => p.type === 'output_text')
      .map((p) => p.text)
      .join('\n');
  } else {
    const choice = Array.isArray(body.choices) ? body.choices[0] : undefined;
    if (choice?.finish_reason === 'length')
      throw new Error('The response was cut short. Try a smaller selection or a different model.');
    output = choice?.message?.content ?? '';
  }
  if (!output) throw new Error('The provider returned no explanation. Try again.');
  const lesson = parseLesson(output, config.prepared.evidenceIds);
  const usage = tokenUsage(body.usage, provider);
  if (usage) lesson.usage = usage;
  return lesson;
}
