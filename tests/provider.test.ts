import { describe, expect, it, vi } from 'vitest';
import { defaults, generate, makeRequest, parseLesson } from '../src/provider';
import { prepareRequest } from '../src/budget';
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
  it('disables reasoning on the supported Groq default without sending that option to other models', () => {
    const body = JSON.parse(makeRequest('groq', defaults.groq, 'key', request).body);
    expect(body.model).toBe('qwen/qwen3.8-27b');
    expect(body.reasoning_effort).toBe('none');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.max_completion_tokens).toBe(200);
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
      expect(body.max_tokens ?? body.max_output_tokens ?? body.max_completion_tokens).toBe(200);
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
    expect(explain).toContain('Use plain language');
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
    [400, 'json_validate_failed', 'could not produce valid JSON'],
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
  it('rejects a truncated response', async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'length' }] })));
    await expect(generate('groq', 'test', 'key', request, undefined, transport)).rejects.toThrow(
      'cut short',
    );
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each(['openai', 'anthropic', 'groq'] as const)(
    'reports real %s usage, including cached input and without double-counting reasoning',
    async (provider) => {
      const text = JSON.stringify({ summary: 'A short explanation.' });
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
      expect(result.summary).toBe('A short explanation.');
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
    expect(() => parseLesson('{"summary":"Hi","concepts":null}')).toThrow();
    expect(() => parseLesson('{"summary":"Hi","example":null}')).toThrow();
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
