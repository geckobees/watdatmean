import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { compactContext, type SourceText } from '../src/request-context';
import { definition, definitionTerms, reviewLesson } from '../src/teaching';
import { generate, makeRequest, parseLesson } from '../src/provider';
import { BridgeCore } from '../src/bridge/core';
import type { LearningRequest } from '../src/types';
import { optimizationCases } from './quality/optimization-cases';

// Independent round-trip check: references must point backward, never drop source or metadata.
function expand(input: ReturnType<typeof compactContext>['input']) {
  const sources = new Map<string, string>([['code', input.code]]);
  function read(value: SourceText, path: string): string {
    const text = (Array.isArray(value) ? value : [value])
      .map((part) => {
        if (typeof part === 'string') return part;
        if (!sources.has(part.ref)) throw new Error('Forward or missing reference: ' + part.ref);
        return sources.get(part.ref)!;
      })
      .join('');
    sources.set(path, text);
    return text;
  }
  const { context, evidence, learningContext, ...rest } = input;
  return {
    ...rest,
    ...(context === undefined ? {} : { context: read(context, 'context') }),
    ...(evidence === undefined
      ? {}
      : {
          evidence: evidence.map((e, i) => ({ ...e, code: read(e.code, `evidence[${i}].code`) })),
        }),
    ...(learningContext === undefined
      ? {}
      : { learningContext: read(learningContext, 'learningContext') }),
  };
}
const before: { id: string; request: LearningRequest; body: Record<string, any> }[] = JSON.parse(
  readFileSync('tests/quality/optimization-before-requests.json', 'utf8'),
);
const base = optimizationCases[0].request;
const answer = {
  summary: 'The result depends on the supplied definition.',
  steps: [],
  concepts: [
    'parameter',
    { term: 'closure', explanation: 'A function that can use names from its enclosing scope.' },
  ],
};
const transportFor = (response = answer) =>
  vi.fn().mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(response) } }],
          usage: { prompt_tokens: 300, completion_tokens: 100, total_tokens: 400 },
        }),
      ),
  );

describe('lossless request optimization', () => {
  it.each(optimizationCases)('preserves every character and location for $id', ({ request }) => {
    const original = structuredClone(request);
    const compact = compactContext(request);
    expect(compact.referenced).toBe(true);
    expect(expand(compact.input)).toEqual(original);
    expect(compact.input.code).toBe(request.code);
    expect(request).toEqual(original);
    expect(JSON.stringify(compact.input).length).toBeLessThan(JSON.stringify(request).length);
  });
  it('preserves Unicode, CRLF, literal reference-looking text, indentation, and repeated occurrences', () => {
    const code = '// "ref":"context" 😀\r\n' + '    value = "keep spaces"\r\n'.repeat(8);
    const request: LearningRequest = {
      ...base,
      code,
      replacement: code + '\r\nchanged()',
      learningContext: code,
      context: 'prefix\r\n' + code + '\r\nmiddle\r\n' + code + '\r\nsuffix',
      evidence: [{ id: 'E1', file: 'a.py', line: 8, kind: 'definition', test: true, code }],
    };
    const compact = compactContext(request);
    expect(compact.input.context).toEqual([
      'prefix\r\n',
      { ref: 'code' },
      '\r\nmiddle\r\n',
      { ref: 'code' },
      '\r\nsuffix',
    ]);
    expect(expand(compact.input)).toEqual(request);
    expect(compact.input.replacement).toBe(request.replacement);
    expect(Object.keys(compact.input).indexOf('context')).toBeLessThan(
      Object.keys(compact.input).indexOf('learningContext'),
    );
  });
  it('retains separate evidence IDs/files/lines for identical text and supports chained references', () => {
    const request = optimizationCases[2].request;
    const compact = compactContext(request);
    expect(compact.input.evidence![1].code).toEqual({ ref: 'evidence[0].code' });
    expect(expand(compact.input)).toEqual(request);
    const context = 'prefix\n' + request.code;
    const chained = compactContext({ ...request, context, learningContext: context });
    expect(chained.input.learningContext).toEqual({ ref: 'context' });
    expect(expand(chained.input).learningContext).toBe(context);
  });
  it('does not transform unique, empty, or short context', () => {
    for (const code of ['', 'x = 1', 'literal'.repeat(20)]) {
      const request = {
        ...base,
        code,
        context: '  unique text\r\n',
        learningContext: '',
        evidence: [],
      };
      const compact = compactContext(request);
      expect(compact.referenced).toBe(false);
      expect(compact.input).toEqual(request);
    }
    expect(compactContext({ ...base, code: 'x=1', context: 'x=1' }).referenced).toBe(false);
  });
  it('round-trips varied overlapping strings without deleting unique suffixes', () => {
    for (let i = 0; i < 120; i++) {
      const code = 'ab'.repeat(40 + i) + i;
      const context = `${i}\n${code}\n${'abc'.repeat(i)}\n${code}`;
      const request = {
        ...base,
        code,
        context,
        learningContext: context + '\n' + code,
        evidence: [
          {
            id: 'E1',
            file: 'file.ts',
            line: i + 1,
            kind: 'reference' as const,
            test: false,
            code: context,
          },
        ],
      };
      expect(expand(compactContext(request).input)).toEqual(request);
    }
  });
  it.each(before)(
    'reduces request size for $id without lowering reasoning/output limits',
    ({ request, body }: any) => {
      const after = JSON.parse(makeRequest('groq', 'qwen/qwen3.8-27b', 'fixture', request).body);
      expect(JSON.stringify(after).length).toBeLessThan(JSON.stringify(body).length);
      for (const property of [
        'model',
        'temperature',
        'reasoning_effort',
        'reasoning_format',
        'max_completion_tokens',
      ])
        expect(after[property]).toEqual(body[property]);
      expect(after.response_format.type).toBe(body.response_format.type);
      expect(after.response_format.json_schema.strict).toBe(true);
      expect(after.response_format.json_schema.schema.required).toEqual(
        body.response_format.json_schema.schema.required,
      );
      const { codeFacts, localTerms, ...input } = JSON.parse(after.messages[1].content);
      expect(expand(input)).toEqual(request);
      expect(localTerms).toBeUndefined();
      expect(
        after.response_format.json_schema.schema.properties.concepts.items.anyOf[0].enum.length,
      ).toBeGreaterThan(0);
      expect(after.messages[0].content).toContain('Use the response schema');
      expect(after.messages[0].content).not.toContain('JSON: {');
    },
  );
  it.each(['openai', 'anthropic', 'groq'] as const)(
    'keeps explicit JSON instructions for %s custom models',
    (provider) => {
      const body = JSON.parse(makeRequest(provider, 'custom', 'fixture', base).body);
      const instructions = body.instructions ?? body.system ?? body.messages[0].content;
      expect(instructions).toContain('JSON: {');
    },
  );
});

describe('reviewed definitions without regenerated prose', () => {
  it.each(
    optimizationCases.flatMap((item) => [
      { ...item, variant: item.id === 'java-construction' ? 'after-final' : 'after-format' },
      { ...item, variant: 'after-output' },
    ]),
  )(
    'replays the valid $id $variant reply under the optimized parser',
    async ({ id, request, expectedOutput, variant }) => {
      const results = JSON.parse(
        readFileSync('tests/quality/groq-optimization-2026-11-14.json', 'utf8'),
      ).results;
      const record = results.find(
        (r: any) => r.id === id && r.variant === variant && r.status === 'complete',
      );
      expect(record).toBeDefined();
      // Preserve parser coverage of the historical model response even though this complete
      // Java form now bypasses the provider. Transport/zero-token parity has separate tests.
      if (id === 'java-construction') {
        const lesson = reviewLesson(request, parseLesson(record.raw, [], request.language));
        expect(lesson.output).toEqual({ text: expectedOutput, explanation: '' });
        expect(lesson.steps.length).toBeGreaterThanOrEqual(3);
        expect(lesson.local).not.toBe(true);
        expect(lesson.concepts.every((concept) => concept.explanation.trim())).toBe(true);
        if (variant === 'after-output')
          expect(JSON.parse(record.raw).output).toEqual({ complete: true, explanation: '' });
        return;
      }
      const transport = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: record.raw } }],
            usage: record.usage,
          }),
        ),
      );
      const lesson = await generate(
        'groq',
        'qwen/qwen3.8-27b',
        'fixture',
        request,
        undefined,
        transport,
      );
      if (variant === 'after-output') {
        expect(JSON.parse(transport.mock.calls[0][1].body)).toEqual(record.requestBody);
        expect(JSON.parse(record.raw).output).toEqual({ complete: true, explanation: '' });
      }
      expect(lesson.output?.text).toBe(expectedOutput);
      expect(lesson.output?.explanation).toBe('');
      expect(lesson.steps.length).toBeGreaterThanOrEqual(3);
      expect(lesson.local).not.toBe(true);
      expect(lesson.concepts.every((concept) => concept.explanation.trim())).toBe(true);
      expect(lesson.usage).toEqual(record.lesson.usage);
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it('displays only assembled known output, while retaining reasons for unknown output', () => {
    const response = {
      summary: 'Display the result.',
      steps: [{ explanation: 'Print the calculated total.', printed: '80\n' }],
      output: { complete: true, explanation: 'A contradictory second guess: 90.' },
    };
    expect(parseLesson(JSON.stringify(response)).output).toEqual({ text: '80\n', explanation: '' });
    expect(
      parseLesson(
        JSON.stringify({
          ...response,
          output: { complete: false, explanation: 'The input is missing.' },
        }),
      ).output,
    ).toEqual({ text: '', explanation: 'The input is missing.' });
  });
  it('does not mistake the reviewed import warning for a claim that a file is installed', () => {
    const request = optimizationCases[2].request;
    const lesson = parseLesson(
      JSON.stringify({
        summary: 'The supplied helper calculates a discounted price.',
        steps: [
          'Call applyDiscount with 100 and 0.2.',
          'The supplied definition computes 100 * (1 - 0.2), which is 80.',
        ],
        concepts: [{ term: 'import', explanation: '' }],
      }),
    );
    const result = reviewLesson(request, lesson);
    expect(result.local).not.toBe(true);
    expect(result.summary).toBe(lesson.summary);
    expect(result.steps).toEqual(lesson.steps);
    expect(result.concepts[0].explanation).toContain('does not prove');
    const unsupported = reviewLesson(request, {
      ...lesson,
      summary: 'The import proves the file is installed.',
    });
    expect(unsupported.local).toBe(true);
  });
  it.each([
    ['Java', 'constructor', 'java'],
    ['TypeScript', 'const', 'typescript'],
    ['Python', 'return', 'python'],
  ])('supplies %s %s locally', (language, term, canonical) => {
    const lesson = parseLesson(
      JSON.stringify({ summary: 'Read the selected code.', concepts: [{ term, explanation: '' }] }),
      [],
      language,
    );
    expect(lesson.concepts[0].explanation).toBe(definition(term, canonical));
    expect(lesson.concepts[0].explanation.length).toBeGreaterThan(20);
    const byName = parseLesson(
      JSON.stringify({
        summary: 'Read the selected code.',
        concepts: [
          term,
          { term: 'custom operation', explanation: 'A helper provided by this project.' },
        ],
      }),
      [],
      language,
    );
    expect(byName.concepts[0]).toEqual(lesson.concepts[0]);
    expect(byName.concepts[1].explanation).toBe('A helper provided by this project.');
  });
  it('preserves unfamiliar definitions and rejects empty or malformed ones', () => {
    expect(parseLesson(JSON.stringify(answer)).concepts[1].explanation).toContain(
      'enclosing scope',
    );
    for (const term of ['unknown concept', '__proto__', 'constructor'])
      expect(() =>
        parseLesson(
          JSON.stringify({ summary: 'Read code.', concepts: [{ term, explanation: '' }] }),
          [],
          'Python',
        ),
      ).toThrow('concepts[].explanation');
    expect(() =>
      parseLesson(
        JSON.stringify({ summary: 'Read code.', concepts: [{ term: 'return', explanation: 7 }] }),
      ),
    ).toThrow('concepts[].explanation');
  });
  it('advertises only definitions available for the language', () => {
    expect(definitionTerms('java')).toContain('constructor');
    expect(definitionTerms('python')).not.toContain('constructor');
    expect(definitionTerms('python')).not.toContain('const');
    for (const lang of ['java', 'python', 'typescript'])
      for (const term of definitionTerms(lang)) expect(definition(term, lang)).toBeTruthy();
  });
  it('hydrates definitions identically in direct VS Code generation and IntelliJ bridge', async () => {
    const request = optimizationCases[2].request;
    const directTransport = transportFor();
    const direct = await generate(
      'groq',
      'qwen/qwen3.8-27b',
      'fixture',
      request,
      undefined,
      directTransport,
    );
    const bridgeTransport = transportFor();
    const core = new BridgeCore(bridgeTransport);
    const input = { provider: 'groq', model: 'qwen/qwen3.8-27b', key: 'fixture', request };
    const bridge = (await core.dispatch(1, 'request', input)) as any;
    expect(bridge.lesson).toEqual(direct);
    expect(bridge.lesson.concepts[0].explanation).toBe(definition('parameter', 'typescript'));
    expect(await core.dispatch(2, 'request', input)).toMatchObject({ cached: true });
    expect(directTransport).toHaveBeenCalledTimes(1);
    expect(bridgeTransport).toHaveBeenCalledTimes(1);
    const bodies = [bridgeTransport, directTransport].map((transport) => {
      const body = JSON.parse(transport.mock.calls[0][1].body);
      body.messages[1].content = JSON.parse(body.messages[1].content);
      return body;
    });
    expect(bodies[0]).toEqual(bodies[1]);
  });
  it('still requests deeper concept help instead of returning only the dictionary entry', async () => {
    const transport = transportFor({
      ...answer,
      summary: 'return transfers the computed price back to the caller.',
    });
    const lesson = await generate(
      'groq',
      'qwen/qwen3.8-27b',
      'fixture',
      { ...optimizationCases[2].request, task: 'concept', concept: 'return' },
      undefined,
      transport,
    );
    expect(transport).toHaveBeenCalledTimes(1);
    expect(lesson.summary).toContain('computed price');
    const input = JSON.parse(JSON.parse(transport.mock.calls[0][1].body).messages[1].content);
    expect(input.conceptDefinition).toBe(definition('return', 'typescript'));
    expect(input.localTerms).toBeUndefined();
  });
});
