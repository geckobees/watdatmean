import { describe, expect, it, vi } from 'vitest';
import { defaults, generate, makeRequest, parseLesson } from '../src/provider';
import { lessonSchema } from '../src/lesson-schema';
import type { LearningRequest, Provider } from '../src/types';

const request: LearningRequest = {
  task: 'explain',
  audience: 'beginner',
  mode: 'standalone',
  code: 'const score = 0;',
};
const lesson = {
  title: 'A starting score',
  summary: 'The score starts at zero.',
  steps: ['Assign zero.'],
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
        json_schema: { name: 'code_lesson', strict: true, schema: lessonSchema },
      });
      expect(body.reasoning_effort).toBe('low');
      expect(body.max_completion_tokens).toBe(700);
    },
  );

  it('keeps JSON object mode for Groq models without known strict-schema support', () => {
    const body = JSON.parse(makeRequest('groq', 'llama-3.3-70b-versatile', 'key', request).body);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  it('marks every nested schema property required and forbids extra properties', () => {
    function checkSchema(schema: Record<string, unknown>) {
      if (schema.type === 'object') {
        const properties = schema.properties as Record<string, Record<string, unknown>>;
        expect(schema.additionalProperties).toBe(false);
        expect(schema.required).toEqual(Object.keys(properties));
        Object.values(properties).forEach(checkSchema);
      } else if (schema.type === 'array') checkSchema(schema.items as Record<string, unknown>);
    }
    checkSchema(lessonSchema);
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
      if (provider === 'openai') expect(body.store).toBe(false);
      if (provider === 'anthropic') expect(result.headers['anthropic-version']).toBe('2023-06-01');
    },
  );
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
  it.each([401, 403, 429, 500])(
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
    [{ code: 'model_not_found' }, 'model was not found'],
    [{ param: 'response_format' }, 'structured response format'],
    [{ code: 'context_length_exceeded' }, 'context limit'],
    [{ code: 'json_validate_failed' }, 'required JSON response'],
    [{ message: 'private source and key' }, 'request setting (HTTP 400)'],
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
    ).rejects.toThrow('request setting (HTTP 400)');
  });

  it('handles request cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const transport = vi.fn().mockRejectedValue(new Error('aborted'));
    await expect(
      generate('openai', 'test', 'key', request, controller.signal, transport),
    ).rejects.toThrow('cancelled');
  });
  it('rejects a truncated response', async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'length' }] })));
    await expect(generate('groq', 'test', 'key', request, undefined, transport)).rejects.toThrow(
      'cut short',
    );
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
