import type { LearningRequest, Lesson, Provider, TokenUsage } from './types';
import { outputLimit, prepareRequest } from './budget';
import { groqResponseFormat } from './lesson-schema';
import { rejectionMessage } from './provider-errors';
import {
  contextualConcept,
  definition,
  definitionTerms,
  fragmentLesson,
  localLesson,
  reviewLesson,
} from './teaching';
import { languageId } from './languages';
import { reasoningEffort } from './reasoning';
import { literalLesson } from './literal-lesson';
import { javaTraceLesson } from './java-trace';
import { conceptTerm, uniqueConcepts } from './concepts';
import { syntaxHelp } from './syntax-help';

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
  const responseFormat =
    provider === 'groq'
      ? groqResponseFormat(
          model,
          request.task,
          definitionTerms(languageId(request.language ?? 'TypeScript')),
        )
      : undefined;
  const prepared = prepareRequest(request, responseFormat?.type === 'json_schema');
  const { input, system: instructions } = prepared;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let body: unknown;
  if (provider === 'anthropic') {
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
    body = {
      model,
      max_tokens: outputLimit(request.task),
      system: instructions,
      messages: [{ role: 'user', content: input }],
    };
  } else if (provider === 'openai') {
    headers.Authorization = `Bearer ${key}`;
    body = {
      model,
      store: false,
      max_output_tokens: outputLimit(request.task),
      instructions,
      input,
      text: { format: { type: 'json_object' } },
    };
  } else {
    headers.Authorization = `Bearer ${key}`;
    const qwenCompletionRoom = model === 'qwen/qwen3.8-27b' && request.task !== 'example';
    body = {
      model,
      // Keep the same ceiling even when reasoning is off. Savings come from effort selection,
      // not truncating a lesson or reducing the space available to a difficult explanation.
      max_completion_tokens: outputLimit(request.task) + (qwenCompletionRoom ? 2048 : 0),
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: input },
      ],
      response_format: responseFormat,
      ...(model === 'qwen/qwen3.8-27b'
        ? {
            reasoning_effort: reasoningEffort(request),
            reasoning_format: 'hidden',
            temperature: 0.6,
          }
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

function optionalList(value: unknown, path: string, max = 8): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) invalidField(path, 'an array');
  return value.slice(0, max);
}

export function parseLesson(
  text: string,
  validIds: string[] = [],
  language = 'TypeScript',
): Lesson {
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
  const rawSteps = optionalList(data.steps, 'steps', 40);
  if (Array.isArray(data.steps) && data.steps.length > 40)
    invalidField('steps', 'at most 40 steps');
  const printed: (string | null)[] = [];
  let structuredSteps = false;
  const steps = rawSteps.map((value) => {
    if (typeof value === 'string') {
      printed.push(null);
      return string(value, 'steps[]');
    }
    structuredSteps = true;
    const step = record(value, 'steps[]');
    if (typeof step.printed === 'string' && step.printed.length > 8000)
      invalidField('steps[].printed', 'at most 8000 characters');
    printed.push(step.printed === null ? null : string(step.printed, 'steps[].printed'));
    return requiredText(step.explanation, 'steps[].explanation');
  });
  let output: Lesson['output'];
  if (data.output != null) {
    const item = record(data.output, 'output');
    if (item.complete !== undefined || structuredSteps) {
      if (typeof item.complete !== 'boolean') invalidField('output.complete', 'true or false');
      if (rawSteps.some((step) => typeof step === 'string'))
        invalidField('steps', 'structured steps for complete output');
      // The same fragments that accompany the execution steps form the output. Never ask
      // the model to independently re-invent a final output that can disagree with its trace.
      const joined = printed.join('');
      if (joined.length > 8000) invalidField('output', 'at most 8000 output characters');
      const explanation = string(item.explanation ?? '', 'output.explanation');
      output = {
        text: item.complete ? joined : '',
        // In this format the explanation is only an unknown-output reason. Models sometimes
        // put a second, conflicting output guess here despite the contract; never display it.
        explanation: item.complete ? '' : explanation,
      };
      if (!item.complete && !output.explanation)
        output.explanation = 'The complete output is unknown from this code.';
    } else
      output = {
        text: string(item.text ?? '', 'output.text'),
        explanation: string(item.explanation ?? '', 'output.explanation'),
      };
  }
  return {
    title: data.title === undefined ? 'Explanation' : requiredText(data.title, 'title', 180),
    summary: requiredText(data.summary, 'summary'),
    ...(data.note == null ? {} : { note: string(data.note, 'note', 1200) }),
    steps,
    ...(structuredSteps ? { stepOutput: printed } : {}),
    ...(data.connections == null
      ? {}
      : {
          connections: optionalList(data.connections, 'connections').map((v) =>
            string(v, 'connections[]'),
          ),
        }),
    ...(data.pitfalls == null
      ? {}
      : { pitfalls: optionalList(data.pitfalls, 'pitfalls').map((v) => string(v, 'pitfalls[]')) }),
    ...(output ? { output } : {}),
    concepts: uniqueConcepts(
      optionalList(data.concepts, 'concepts').map((v) => {
        if (typeof v === 'string') {
          const term = conceptTerm(requiredText(v, 'concepts[].term', 150));
          return { term, explanation: definition(term, languageId(language)) ?? '' };
        }
        const c = record(v, 'concepts[]');
        const term = conceptTerm(requiredText(c.term, 'concepts[].term', 150));
        const local = definition(term, languageId(language));
        const supplied = string(c.explanation, 'concepts[].explanation');
        return {
          term,
          explanation: local ?? requiredText(supplied, 'concepts[].explanation'),
        };
      }),
    ),
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

export function tokenUsage(value: unknown, provider: Provider): TokenUsage | undefined {
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
  if (signal?.aborted) throw new Error('Request cancelled.');
  if (request.task === 'explain' || request.task === 'walkthrough') {
    const syntax = syntaxHelp(request.code, request.language ?? 'TypeScript');
    if (syntax?.corrected && !syntax.partial) {
      const lesson = await generate(
        provider,
        model,
        key,
        { ...request, code: syntax.corrected },
        signal,
        transport,
      );
      return { ...lesson, syntax };
    }
    // Attach local diagnostics after generation; metadata never comes from the model.
    if (syntax) {
      if (languageId(request.language ?? '') === 'java' && !syntax.partial) {
        return {
          title: 'Check this Java selection',
          summary:
            'The selected code cannot be explained as a complete, valid Java program yet. The syntax notice identifies what needs attention.',
          syntax,
          local: true,
          usage: { input: 0, output: 0, total: 0 },
          steps: [],
          concepts: [],
          example: { code: '', explanation: '' },
          predictions: [],
          checks: [],
        };
      }
      const lesson = await generateUnchecked(
        provider,
        model,
        key,
        request,
        signal,
        transport,
        syntax.partial,
      );
      return { ...lesson, syntax };
    }
  }
  return generateUnchecked(provider, model, key, request, signal, transport);
}

async function generateUnchecked(
  provider: Provider,
  model: string,
  key: string,
  request: LearningRequest,
  signal?: AbortSignal,
  transport: typeof fetch = fetch,
  partial = false,
): Promise<Lesson> {
  if (signal?.aborted) throw new Error('Request cancelled.');
  const fragment = partial ? undefined : fragmentLesson(request);
  if (fragment) return { ...fragment, usage: { input: 0, output: 0, total: 0 } };
  const java = partial ? undefined : javaTraceLesson(request);
  if (java) return java;
  const contextual = contextualConcept(request);
  if (contextual)
    return {
      ...contextual,
      notice: contextual.notice + ' No AI request was needed.',
      usage: { input: 0, output: 0, total: 0 },
    };
  const config = makeRequest(provider, model, key, request);
  const notes = config.prepared.notes;
  if (notes?.trace.length && !notes.unknownCall && request.task === 'explain') {
    const grounded = reviewLesson(
      request,
      localLesson(request, notes, 'Calculated from the selected code. No AI request was needed.'),
      notes,
    );
    return { ...grounded, local: true, usage: { input: 0, output: 0, total: 0 } };
  }
  if (
    notes?.incomplete &&
    !notes.explainableFragment &&
    (request.task === 'explain' || request.task === 'walkthrough')
  ) {
    return {
      ...localLesson(request, notes, 'Local syntax check: no AI request was needed.'),
      local: true,
      usage: { input: 0, output: 0, total: 0 },
    };
  }
  if (notes && request.task === 'example' && notes.practice) {
    return {
      ...localLesson(request, notes, 'A reviewed practice example. No AI request was needed.'),
      title: 'Try a separate example',
      summary: notes.practice.explanation,
      example: { code: notes.practice.code, explanation: notes.practice.explanation },
      local: true,
      usage: { input: 0, output: 0, total: 0 },
    };
  }
  const literal = partial ? undefined : literalLesson(request);
  if (literal) return literal;
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
  let cutShort = false;
  if (provider === 'anthropic') {
    cutShort = body.stop_reason === 'max_tokens';
    output = responseParts(body.content)
      .filter((p) => p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text as string)
      .join('\n');
  } else if (provider === 'openai') {
    cutShort = body.status === 'incomplete';
    output = responseParts(body.output)
      .flatMap((p) => responseParts(p.content))
      .filter((p) => p.type === 'output_text' && typeof p.text === 'string')
      .map((p) => p.text as string)
      .join('\n');
  } else {
    const choice = responseParts(body.choices)[0];
    cutShort = choice?.finish_reason === 'length';
    const message = choice?.message;
    if (message && typeof message === 'object' && !Array.isArray(message)) {
      const content = (message as Record<string, unknown>).content;
      if (typeof content === 'string') output = content;
    }
  }
  let lesson: Lesson;
  try {
    if (cutShort)
      throw new Error('The response was cut short. Try a smaller selection or a different model.');
    if (!output) throw new Error('The provider returned no explanation. Try again.');
    const parsed = parseLesson(output, config.prepared.evidenceIds, request.language);
    lesson = notes ? reviewLesson(request, parsed, notes) : parsed;
  } catch (error) {
    if (!notes?.facts.length) throw error;
    lesson = {
      ...localLesson(
        request,
        notes,
        'The AI reply was incomplete or invalid. Here are local code facts; no extra AI request was made.',
      ),
      local: true,
    };
  }
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
