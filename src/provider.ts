import type { LearningRequest, Lesson, Provider, TokenUsage } from './types';
import { MAX_OUTPUT_TOKENS, prepareRequest } from './budget';
import { groqResponseFormat } from './lesson-schema';
import { rejectionMessage } from './provider-errors';

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
      response_format: groqResponseFormat(model, request.task),
      ...(model === 'qwen/qwen3.8-27b'
        ? { reasoning_effort: 'none' }
        : ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'].includes(model)
          ? { reasoning_effort: 'low' }
          : {}),
    };
  }
  return { url: endpoints[provider], headers, body: JSON.stringify(body), prepared };
}

function invalidField(path: string, expected: string): never {
  // Report only our own field names, never provider content or private source code.
  throw new Error(
    `The AI response has an invalid "${path}" field (expected ${expected}). Try again or choose a different model.`,
  );
}

function record(value: unknown, path = 'response'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidField(path, 'an object');
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string, max = 8000): string {
  if (typeof value !== 'string') invalidField(path, 'text');
  return value.slice(0, max);
}

function requiredText(value: unknown, path: string, max = 8000): string {
  const result = string(value, path, max);
  if (!result.trim()) invalidField(path, 'nonempty text');
  return result;
}

function optionalList(value: unknown, path: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) invalidField(path, 'an array');
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
  const example = data.example == null ? {} : record(data.example, 'example');
  return {
    title: data.title === undefined ? 'Explanation' : requiredText(data.title, 'title', 180),
    summary: requiredText(data.summary, 'summary'),
    steps: optionalList(data.steps, 'steps').map((v) => string(v, 'steps[]')),
    concepts: optionalList(data.concepts, 'concepts').map((v) => {
      if (typeof v === 'string')
        return { term: requiredText(v, 'concepts[].term', 150), explanation: '' };
      const c = record(v, 'concepts[]');
      return {
        term: requiredText(c.term, 'concepts[].term', 150),
        explanation: requiredText(c.explanation, 'concepts[].explanation'),
      };
    }),
    example: {
      code: string(example.code ?? '', 'example.code'),
      explanation: string(example.explanation ?? '', 'example.explanation'),
    },
    predictions: optionalList(data.predictions, 'predictions').map((v) => {
      const p = record(v, 'predictions[]');
      return {
        description: requiredText(p.description, 'predictions[].description'),
        evidenceIds: optionalList(p.evidenceIds, 'predictions[].evidenceIds')
          .map((v) => string(v, 'predictions[].evidenceIds[]'))
          .filter((id) => validIds.includes(id)),
      };
    }),
    checks: optionalList(data.checks, 'checks').map((v) => string(v, 'checks[]')),
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
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  if (signal?.aborted) throw new Error('Request cancelled.');
  let response: Response;
  try {
    response = await transport(config.url, {
      method: 'POST',
      headers: config.headers,
      body: config.body,
      signal: requestSignal,
      redirect: 'error',
    });
  } catch {
    if (signal?.aborted) throw new Error('Request cancelled.');
    if (timeout.aborted) throw new Error('The provider took too long. Please retry.');
    throw new Error('Could not reach the AI provider. Check your connection and try again.');
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    if (signal?.aborted) throw new Error('Request cancelled.');
    if (timeout.aborted) throw new Error('The provider took too long. Please retry.');
    if (!response.ok)
      throw new Error(
        rejectionMessage(
          response.status,
          undefined,
          provider === 'groq' ? defaults.groq : undefined,
        ),
      );
    throw new Error('The provider returned an unreadable response. Please try again.');
  }
  if (signal?.aborted) throw new Error('Request cancelled.');
  if (timeout.aborted) throw new Error('The provider took too long. Please retry.');
  if (!response.ok)
    throw new Error(
      rejectionMessage(response.status, payload, provider === 'groq' ? defaults.groq : undefined),
    );
  const body = record(payload);
  let output = '';
  if (provider === 'anthropic') {
    if (body.stop_reason === 'max_tokens')
      throw new Error('The response was cut short. Try a smaller selection or a different model.');
    output = responseParts(body.content)
      .filter((p) => p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text as string)
      .join('\n');
  } else if (provider === 'openai') {
    if (body.status === 'incomplete')
      throw new Error('The response was cut short. Try a smaller selection or a different model.');
    output = responseParts(body.output)
      .flatMap((p) => responseParts(p.content))
      .filter((p) => p.type === 'output_text' && typeof p.text === 'string')
      .map((p) => p.text as string)
      .join('\n');
  } else {
    const choice = responseParts(body.choices)[0];
    if (choice?.finish_reason === 'length')
      throw new Error('The response was cut short. Try a smaller selection or a different model.');
    const message = choice?.message;
    if (message && typeof message === 'object' && !Array.isArray(message)) {
      const content = (message as Record<string, unknown>).content;
      if (typeof content === 'string') output = content;
    }
  }
  if (!output) throw new Error('The provider returned no explanation. Try again.');
  const lesson = parseLesson(output, config.prepared.evidenceIds);
  const usage = tokenUsage(body.usage, provider);
  if (usage) lesson.usage = usage;
  return lesson;
}

function responseParts(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
}
