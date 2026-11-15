import { describe, expect, it, vi } from 'vitest';
import { defaults, generate, makeRequest, parseLesson } from '../src/provider';
import { lessonSchema, lessonSchemaForTask } from '../src/lesson-schema';
import { outputLimit, prepareRequest } from '../src/budget';
import { definitionTerms } from '../src/teaching';
import type { LearningRequest, Provider } from '../src/types';

const request: LearningRequest = {
  task: 'explain',
  audience: 'beginner',
  mode: 'standalone',
  code: 'const score = readScore();',
};
const lesson = {
  title: 'A starting score',
  summary: 'This code calls readScore. The result is unknown because the helper is not shown.',
  steps: ['Call the helper.'],
  concepts: [{ term: 'binding', explanation: 'A name referring to a value.' }],
  example: { code: 'const age = 20;', explanation: 'age is 20.' },
  predictions: [],
  checks: [],
};
describe('provider protocols', () => {
  it.each(['openai/gpt-oss-20b', 'openai/gpt-oss-120b'])(
    'requests a strict lesson schema from Groq for %s',
    (model) => {
      const body = JSON.parse(makeRequest('groq', model, 'test-secret', request).body);
      expect(body.response_format).toEqual({
        type: 'json_schema',
        json_schema: {
          name: 'code_lesson',
          strict: true,
          schema: lessonSchemaForTask('explain', definitionTerms('typescript')),
        },
      });
      expect(body.reasoning_effort).toBe('low');
      expect(body.max_completion_tokens).toBe(900);
    },
  );

  it('keeps JSON object mode for Groq models without known strict-schema support', () => {
    const body = JSON.parse(makeRequest('groq', 'llama-3.3-70b-versatile', 'key', request).body);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  it.each([
    ['explain', ['summary', 'steps', 'note', 'concepts', 'output']],
    ['walkthrough', ['summary', 'steps', 'note', 'concepts', 'output']],
    ['concept', ['summary', 'steps']],
    ['example', ['summary', 'example']],
    ['impact', ['summary', 'predictions', 'checks']],
  ] as const)('keeps strict %s responses limited to the requested sections', (task, fields) => {
    const body = JSON.parse(makeRequest('groq', defaults.groq, 'key', { ...request, task }).body);
    const schema = body.response_format.json_schema.schema;
    expect(Object.keys(schema.properties)).toEqual(fields);
    expect(schema.required).toEqual(fields);
    if (task === 'explain') {
      expect(schema.properties.concepts.items.anyOf[0].enum).toEqual(definitionTerms('typescript'));
      expect(schema.properties.concepts.items.anyOf[1].required).toEqual(['term', 'explanation']);
      expect(body.messages[0].content).toContain('Return a term string');
      const [complete, unknown] = schema.properties.output.anyOf;
      expect(complete.properties.complete.enum).toEqual([true]);
      expect(complete.properties.explanation.enum).toEqual(['']);
      expect(unknown.properties.complete.enum).toEqual([false]);
      expect(unknown.properties.explanation).toEqual({ type: 'string' });
    }
    expect(body.max_completion_tokens).toBe(outputLimit(task) + (task === 'example' ? 0 : 2048));
  });

  it('marks every nested schema property required and forbids extra properties', () => {
    function checkSchema(schema: Record<string, unknown>) {
      if (Array.isArray(schema.anyOf)) schema.anyOf.forEach(checkSchema);
      if (schema.type === 'object') {
        const properties = schema.properties as Record<string, Record<string, unknown>>;
        expect(schema.additionalProperties).toBe(false);
        expect(schema.required).toEqual(Object.keys(properties));
        Object.values(properties).forEach(checkSchema);
      } else if (schema.type === 'array') checkSchema(schema.items as Record<string, unknown>);
    }
    checkSchema(lessonSchema);
    for (const task of ['explain', 'example', 'concept', 'impact'] as const)
      checkSchema(lessonSchemaForTask(task, definitionTerms('java')));
  });

  it('accepts a successful Groq response with omitted optional sections without retrying', async () => {
    const transport = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: JSON.stringify({ title: lesson.title, summary: lesson.summary }),
              },
            },
          ],
        }),
      ),
    );
    const result = await generate('groq', defaults.groq, 'key', request, undefined, transport);
    expect(result).toEqual({
      title: lesson.title,
      summary: lesson.summary,
      steps: [],
      concepts: [],
      example: { code: '', explanation: '' },
      predictions: [],
      checks: [],
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('allows bounded reasoning on the Groq default and keeps hidden reasoning out of the lesson', () => {
    const body = JSON.parse(makeRequest('groq', defaults.groq, 'key', request).body);
    expect(body.model).toBe('qwen/qwen3.8-27b');
    expect(body.reasoning_effort).toBe('low');
    expect(body.reasoning_format).toBe('hidden');
    expect(body.temperature).toBe(0.6);
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'code_lesson',
        strict: true,
        schema: lessonSchemaForTask('explain', definitionTerms('typescript')),
      },
    });
    expect(body.max_completion_tokens).toBe(2948);
    expect(JSON.parse(makeRequest('groq', 'custom-model', 'key', request).body)).not.toHaveProperty(
      'reasoning_effort',
    );
  });
  it.each(['openai', 'anthropic', 'groq'] as const)(
    'uses a fixed HTTPS endpoint and the %s authentication protocol',
    (provider) => {
      const result = makeRequest(provider, 'custom-model', 'test-secret', request);
      expect(result.url.startsWith('https://')).toBe(true);
      expect(result.headers[provider === 'anthropic' ? 'x-api-key' : 'Authorization']).toContain(
        'test-secret',
      );
      expect(result.body).not.toContain('test-secret');
      const body = JSON.parse(result.body);
      expect(body.model).toBe('custom-model');
      expect(body.max_tokens ?? body.max_output_tokens ?? body.max_completion_tokens).toBe(900);
      if (provider === 'openai') expect(body.store).toBe(false);
      if (provider === 'anthropic') expect(result.headers['anthropic-version']).toBe('2023-06-01');
    },
  );
  it.each(['openai', 'anthropic', 'groq'] as const)(
    'keeps the complete selection, project context and evidence for %s',
    (provider) => {
      const fullRequest: LearningRequest = {
        ...request,
        task: 'impact',
        mode: 'project',
        code: 'const score = 0;\n'.repeat(600),
        replacement: 'const score = 1;\n'.repeat(600),
        context: 'const nearby = "keep me";\n'.repeat(200),
        evidence: Array.from({ length: 12 }, (_, i) => ({
          id: `E${i + 1}`,
          file: `caller${i}.ts`,
          line: i + 1,
          code: `readScore(${i});`.repeat(30),
          kind: 'reference',
          test: i === 0,
        })),
      };
      const body = JSON.parse(makeRequest(provider, 'custom-model', 'key', fullRequest).body);
      const input = provider === 'openai' ? body.input : body.messages.at(-1).content;
      expect(JSON.parse(input)).toEqual(fullRequest);
    },
  );
  it('sends only instructions for the chosen action and keeps the requested guidance', () => {
    const explain = prepareRequest(request).system;
    expect(explain).not.toContain('predictions');
    expect(explain).not.toContain('"example"');
    expect(explain).toContain('untrusted data');
    expect(explain).toContain('Teach a sixth grader');
    const concept = prepareRequest({ ...request, task: 'concept', concept: 'scope' });
    expect(concept.system).toContain('requested concept');
    expect(concept.system).not.toContain('"concepts"');
    expect(JSON.parse(concept.input).concept).toBe('scope');
    expect(prepareRequest({ ...request, task: 'example' }).system).toContain('"example"');
    expect(prepareRequest({ ...request, audience: 'experienced' }).system).toContain('contracts');
  });
  it.each(['openai', 'anthropic', 'groq'] as const)(
    'normalizes the %s response',
    async (provider) => {
      const text = JSON.stringify(lesson);
      const bodies: Record<Provider, unknown> = {
        openai: { output: [{ content: [{ type: 'output_text', text }] }] },
        anthropic: { content: [{ type: 'text', text }] },
        groq: { choices: [{ message: { content: text } }] },
      };
      const transport = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(bodies[provider]), { status: 200 }));
      expect(await generate(provider, 'test', 'secret', request, undefined, transport)).toEqual(
        lesson,
      );
      expect(transport.mock.calls[0][1].redirect).toBe('error');
    },
  );
  it.each([400, 401, 403, 404, 429, 500])(
    'does not leak raw errors or secrets for HTTP %s',
    async (status) => {
      const transport = vi
        .fn()
        .mockResolvedValue(new Response('secret-and-private-code', { status }));
      await expect(
        generate('groq', 'test', 'secret', request, undefined, transport),
      ).rejects.toThrow();
      try {
        await generate('groq', 'test', 'secret', request, undefined, transport);
      } catch (error) {
        expect(String(error)).not.toContain('secret-and-private-code');
      }
    },
  );
  it.each([
    [{ param: 'reasoning_effort' }, 'reasoning setting'],
    [{ message: 'reasoning_effort must be low, medium, or high' }, 'reasoning setting'],
    [{ code: 'model_not_found' }, 'model is unavailable'],
    [{ param: 'response_format' }, 'structured response format'],
    [{ code: 'context_length_exceeded' }, 'context limit'],
    [{ code: 'json_validate_failed' }, 'could not produce valid JSON'],
    [{ message: 'private source and key' }, 'request format (HTTP 400)'],
  ])(
    'distinguishes request rejections without echoing provider content: %j',
    async (error, expected) => {
      const transport = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ error }), { status: 400 }));
      await expect(
        generate('groq', defaults.groq, 'key', request, undefined, transport),
      ).rejects.toThrow(expected);
    },
  );
  it('handles non-JSON rejection bodies safely', async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(new Response('private proxy diagnostic', { status: 400 }));
    await expect(
      generate('groq', defaults.groq, 'key', request, undefined, transport),
    ).rejects.toThrow('request format (HTTP 400)');
  });

  it.each([
    [400, 'json_validate_failed', 'could not produce valid JSON'],
    [422, 'json_validate_failed', 'could not produce valid JSON'],
    [404, 'model_not_found', 'model is unavailable'],
    [400, 'model_decommissioned', 'model is unavailable'],
    [400, 'unknown-private-code', 'request format'],
  ] as const)(
    'classifies HTTP %s / %s without exposing the response body',
    async (status, code, expected) => {
      const transport = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code,
              message: 'secret-and-private-code',
              failed_generation: 'private source',
            },
          }),
          { status },
        ),
      );
      const error = await generate('groq', 'test', 'key', request, undefined, transport).catch(
        (error) => error as Error,
      );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(expected);
      expect((error as Error).message).not.toContain('secret-and-private-code');
      expect((error as Error).message).not.toContain('private source');
      expect((error as Error).message).not.toContain('unknown-private-code');
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it('handles request cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const transport = vi.fn().mockRejectedValue(new Error('aborted'));
    await expect(
      generate('openai', 'test', 'key', request, controller.signal, transport),
    ).rejects.toThrow('cancelled');
  });
  it('uses local facts for a truncated response without retrying', async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'length' }] })));
    const result = await generate('groq', 'test', 'key', request, undefined, transport);
    expect(result.local).toBe(true);
    expect(result.notice).toContain('no extra AI request');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each(['{"summary":""}', '{"summary":', ''])(
    'replaces a malformed lesson with local facts while retaining actual usage: %s',
    async (content) => {
      const transport = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ finish_reason: 'stop', message: { content } }],
            usage: { prompt_tokens: 90, completion_tokens: 10, total_tokens: 100 },
          }),
        ),
      );
      const result = await generate(
        'groq',
        defaults.groq,
        'key',
        {
          ...request,
          task: 'walkthrough',
          language: 'Java',
          code: 'import java.util.ArrayList; class Basket { ArrayList<String> items = new ArrayList<>(); }',
        },
        undefined,
        transport,
      );
      expect(result.local).toBe(true);
      expect(result.summary).toContain('list');
      expect(result.notice).toContain('no extra AI request');
      expect(result.usage).toEqual({ input: 90, output: 10, total: 100 });
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it('reports a malformed response when there are no local facts to explain it', async () => {
    const transport = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content: '{"summary":""}' } }],
        }),
      ),
    );
    await expect(
      generate(
        'groq',
        defaults.groq,
        'key',
        {
          ...request,
          language: 'SQL',
          code: 'SELECT mystery(value) FROM data',
        },
        undefined,
        transport,
      ),
    ).rejects.toThrow('nonempty text');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each(['openai', 'anthropic', 'groq'] as const)(
    'reports real %s usage, including cached input and without double-counting reasoning',
    async (provider) => {
      const text = JSON.stringify({ summary: lesson.summary });
      const bodies = {
        openai: {
          output: [{ content: [{ type: 'output_text', text }] }],
          usage: {
            input_tokens: 420,
            output_tokens: 100,
            total_tokens: 520,
            output_tokens_details: { reasoning_tokens: 40 },
          },
        },
        anthropic: {
          content: [{ type: 'text', text }],
          usage: {
            input_tokens: 20,
            cache_creation_input_tokens: 100,
            cache_read_input_tokens: 300,
            output_tokens: 100,
          },
        },
        groq: {
          choices: [{ message: { content: text } }],
          usage: { prompt_tokens: 420, completion_tokens: 100, total_tokens: 520 },
        },
      };
      const transport = vi.fn().mockResolvedValue(new Response(JSON.stringify(bodies[provider])));
      const result = await generate(provider, 'test', 'key', request, undefined, transport);
      expect(result.usage).toEqual({ input: 420, output: 100, total: 520 });
      expect(result.summary).toBe(lesson.summary);
    },
  );
  it('does not trust token counts supplied inside generated lesson text', async () => {
    const transport = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            { message: { content: JSON.stringify({ summary: 'Hello', usage: { total: 0 } }) } },
          ],
          usage: { prompt_tokens: -1, completion_tokens: '100' },
        }),
      ),
    );
    const result = await generate('groq', 'test', 'key', request, undefined, transport);
    expect(result.usage).toBeUndefined();
  });
});
describe('untrusted response validation', () => {
  it.each(['steps', 'concepts', 'predictions', 'checks'])(
    'treats an absent or null %s section as an empty list',
    (field) => {
      for (const value of [undefined, null]) {
        expect(parseLesson(JSON.stringify({ ...lesson, [field]: value }))).toEqual({
          ...lesson,
          [field]: [],
        });
      }
    },
  );

  it('handles missing examples and unused example fields', () => {
    expect(parseLesson(JSON.stringify({ ...lesson, example: null })).example).toEqual({
      code: '',
      explanation: '',
    });
    expect(
      parseLesson(JSON.stringify({ ...lesson, example: { code: 'const x = 1;' } })).example,
    ).toEqual({ code: 'const x = 1;', explanation: '' });
  });

  it('does not invent evidence when a prediction omits its links', () => {
    const result = parseLesson(
      JSON.stringify({
        ...lesson,
        predictions: [{ description: 'The result may change.' }],
      }),
    );
    expect(result.predictions[0].evidenceIds).toEqual([]);
  });

  it('identifies invalid fields without exposing response content', () => {
    expect(() => parseLesson(JSON.stringify({ ...lesson, steps: 'private-source-code' }))).toThrow(
      '"steps" field (expected an array)',
    );
    expect(() => parseLesson(JSON.stringify({ ...lesson, concepts: [{ term: 'scope' }] }))).toThrow(
      '"concepts[].explanation" field',
    );
    expect(() => parseLesson(JSON.stringify({ ...lesson, summary: '   ' }))).toThrow(
      '"summary" field (expected nonempty text)',
    );
    try {
      parseLesson(JSON.stringify({ ...lesson, steps: 'private-source-code' }));
    } catch (error) {
      expect(String(error)).not.toContain('private-source-code');
    }
  });

  it('accepts a concise summary and normalizes on-demand concept names', () => {
    expect(
      parseLesson(JSON.stringify({ summary: 'Starts at zero.', concepts: ['binding'] })),
    ).toEqual({
      title: 'Explanation',
      summary: 'Starts at zero.',
      concepts: [{ term: 'binding', explanation: '' }],
      steps: [],
      example: { code: '', explanation: '' },
      predictions: [],
      checks: [],
    });
    expect(parseLesson('{"summary":"Only a summary."}').concepts).toEqual([]);
    expect(parseLesson('{"summary":"Hi","concepts":null}').concepts).toEqual([]);
    expect(parseLesson('{"summary":"Hi","example":null}').example).toEqual({
      code: '',
      explanation: '',
    });
    expect(() => parseLesson('{"summary":null}')).toThrow();
  });
  it('filters invented evidence IDs', () => {
    const result = parseLesson(
      JSON.stringify({
        ...lesson,
        predictions: [
          { description: 'Could affect callers.', evidenceIds: ['E1', 'E99', 'command:evil'] },
        ],
      }),
      ['E1'],
    );
    expect(result.predictions[0].evidenceIds).toEqual(['E1']);
  });
  it('accepts a JSON fence but rejects incomplete schemas and invalid JSON', () => {
    expect(parseLesson('```json\n' + JSON.stringify(lesson) + '\n```')).toEqual(lesson);
    expect(() => parseLesson('{"title":"only"}')).toThrow();
    expect(() => parseLesson('not json')).toThrow('valid JSON');
    expect(() => parseLesson('null')).toThrow();
  });
});
