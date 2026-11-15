import type { Generation, LearningRequest, Lesson, Provider, TokenUsage } from './types';
import { readUsage } from './usage';
import { buildInstructions } from './prompts';
import { completeConcepts } from './concepts';

export class GenerationError extends Error {
  constructor(
    message: string,
    readonly model: string,
    readonly usage?: TokenUsage,
  ) {
    super(message);
  }
}

export const defaults: Record<Provider, string> = {
  openai: 'gpt-5.4-mini',
  anthropic: 'claude-haiku-4-5',
  groq: 'openai/gpt-oss-20b',
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
  const instructions = buildInstructions(request);
  const input = JSON.stringify(request);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let body: unknown;
  if (provider === 'anthropic') {
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
    body = {
      model,
      max_tokens: 2600,
      system: instructions,
      messages: [{ role: 'user', content: input }],
    };
  } else if (provider === 'openai') {
    headers.Authorization = `Bearer ${key}`;
    body = {
      model,
      store: false,
      max_output_tokens: 3200,
      instructions,
      input,
      text: { format: { type: 'json_object' } },
    };
  } else {
    headers.Authorization = `Bearer ${key}`;
    body = {
      model,
      max_completion_tokens: 3200,
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: input },
      ],
      response_format: { type: 'json_object' },
    };
  }
  return { url: endpoints[provider], headers, body: JSON.stringify(body) };
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
  const example = record(data.example);
  const lesson: Lesson = {
    title: string(data.title, 180),
    summary: string(data.summary),
    steps: list(data.steps).map((v) => string(v)),
    concepts: list(data.concepts ?? []).map((v) => {
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
  lesson.concepts = completeConcepts(lesson);
  return lesson;
}

export async function generate(
  provider: Provider,
  model: string,
  key: string,
  request: LearningRequest,
  signal?: AbortSignal,
  transport: typeof fetch = fetch,
): Promise<Generation> {
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
    const message =
      response.status === 401 || response.status === 403
        ? 'API key rejected or model access denied. Configure your provider and key again.'
        : response.status === 429
          ? 'Provider quota or rate limit reached. Check billing or wait before retrying.'
          : response.status === 400 || response.status === 404
            ? 'The provider rejected the request. Check the model ID in WatDatMean settings.'
            : `The AI provider returned HTTP ${response.status}. Please retry later.`;
    // Never display raw provider errors, which may echo request content or credentials.
    throw new Error(message);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('The AI returned an invalid response. Please try again.');
  }
  const body = record(payload);
  const usage = readUsage(provider, body.usage);
  const responseModel =
    typeof body.model === 'string' && body.model.trim() ? body.model.slice(0, 200) : model;
  try {
    let output = '';
    if (provider === 'anthropic') {
      if (body.stop_reason === 'max_tokens')
        throw new Error(
          'The response was cut short. Try a smaller selection or a different model.',
        );
      output = (Array.isArray(body.content) ? body.content : [])
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('\n');
    } else if (provider === 'openai') {
      if (body.status === 'incomplete')
        throw new Error(
          'The response was cut short. Try a smaller selection or a different model.',
        );
      output = (Array.isArray(body.output) ? body.output : [])
        .flatMap((p) => p.content ?? [])
        .filter((p) => p.type === 'output_text')
        .map((p) => p.text)
        .join('\n');
    } else {
      const choice = Array.isArray(body.choices) ? body.choices[0] : undefined;
      if (choice?.finish_reason === 'length')
        throw new Error(
          'The response was cut short. Try a smaller selection or a different model.',
        );
      output = choice?.message?.content ?? '';
    }
    if (!output) throw new Error('The provider returned no explanation. Try again.');
    return {
      lesson: parseLesson(
        output,
        request.evidence?.map((e) => e.id),
      ),
      model: responseModel,
      usage,
    };
  } catch (error) {
    // An unusable explanation can still consume tokens. Preserve reported usage.
    throw new GenerationError(
      error instanceof Error && !(error instanceof TypeError)
        ? error.message
        : 'The AI returned an invalid response. Please try again.',
      responseModel,
      usage,
    );
  }
}
