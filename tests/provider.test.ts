import { describe, expect, it, vi } from 'vitest';
import { generate, GenerationError, makeRequest, parseLesson } from '../src/provider';
import { readUsage } from '../src/usage';
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
      expect(await generate(provider, 'test', 'secret', request, undefined, transport)).toEqual({
        lesson,
        model: 'test',
        usage: undefined,
      });
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
  it.each([
    [
      'openai',
      { input_tokens: 1200, output_tokens: 300, total_tokens: 1500 },
      { output: [{ content: [{ type: 'output_text', text: JSON.stringify(lesson) }] }] },
    ],
    [
      'groq',
      { prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500 },
      { choices: [{ message: { content: JSON.stringify(lesson) } }] },
    ],
    [
      'anthropic',
      {
        input_tokens: 200,
        cache_read_input_tokens: 900,
        cache_creation_input_tokens: 100,
        output_tokens: 300,
      },
      { content: [{ type: 'text', text: JSON.stringify(lesson) }] },
    ],
  ] as const)('retains actual %s usage and the returned model', async (provider, usage, body) => {
    const transport = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ...body, usage, model: 'resolved-model' })));
    const result = await generate(provider, 'alias', 'secret', request, undefined, transport);
    expect(result).toMatchObject({
      lesson,
      model: 'resolved-model',
      usage: { inputTokens: 1200, outputTokens: 300, totalTokens: 1500 },
    });
  });
  it.each([
    { choices: [{ finish_reason: 'length' }] },
    { choices: [{ message: { content: 'invalid JSON' } }] },
    { choices: [{ message: { content: '{"title":"missing fields"}' } }] },
  ])('keeps usage when the explanation is unusable: %j', async (body) => {
    const transport = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ...body,
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
          model: 'actual',
        }),
      ),
    );
    const error = await generate('groq', 'alias', 'secret', request, undefined, transport).catch(
      (error) => error,
    );
    expect(error).toBeInstanceOf(GenerationError);
    expect(error).toMatchObject({
      model: 'actual',
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    });
  });
  it('does not expose raw bodies when a provider returns invalid JSON', async () => {
    const transport = vi.fn().mockResolvedValue(new Response('secret-and-private-code'));
    await expect(generate('groq', 'test', 'secret', request, undefined, transport)).rejects.toThrow(
      'invalid response',
    );
  });
});
describe('reported token accounting', () => {
  it('includes cached input and reasoning in totals exactly once', () => {
    expect(
      readUsage('openai', {
        input_tokens: 1200,
        input_tokens_details: { cached_tokens: 1000 },
        output_tokens: 300,
        output_tokens_details: { reasoning_tokens: 200 },
        total_tokens: 1500,
      }),
    ).toEqual({
      inputTokens: 1200,
      outputTokens: 300,
      totalTokens: 1500,
      cachedInputTokens: 1000,
      reasoningTokens: 200,
    });
    expect(
      readUsage('groq', {
        prompt_tokens: 1200,
        prompt_tokens_details: { cached_tokens: 1000 },
        completion_tokens: 300,
        completion_tokens_details: { reasoning_tokens: 200 },
        total_tokens: 1500,
      }),
    ).toEqual({
      inputTokens: 1200,
      outputTokens: 300,
      totalTokens: 1500,
      cachedInputTokens: 1000,
      reasoningTokens: 200,
    });
    expect(
      readUsage('anthropic', {
        input_tokens: 200,
        cache_read_input_tokens: 900,
        cache_creation_input_tokens: 100,
        output_tokens: 300,
      }),
    ).toEqual({
      inputTokens: 1200,
      outputTokens: 300,
      totalTokens: 1500,
      cachedInputTokens: 900,
      cacheWriteTokens: 100,
    });
  });
  it('adds reported input and output when the API has no total field', () => {
    expect(readUsage('anthropic', { input_tokens: 15, output_tokens: 5 })).toEqual({
      inputTokens: 15,
      outputTokens: 5,
      totalTokens: 20,
    });
  });
  it('preserves zeros and partial counts without inventing missing counts', () => {
    expect(
      readUsage('groq', { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }),
    ).toMatchObject({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    expect(readUsage('openai', { output_tokens: 50 })).toEqual({
      inputTokens: undefined,
      outputTokens: 50,
      totalTokens: undefined,
    });
    expect(readUsage('openai', { total_tokens: 40 })).toEqual({
      inputTokens: undefined,
      outputTokens: undefined,
      totalTokens: 40,
    });
  });
  it.each([
    undefined,
    null,
    {},
    [],
    '100',
    { input_tokens: '100', output_tokens: -1 },
    { input_tokens: 1.5, output_tokens: Infinity },
    { total_tokens: Number.MAX_SAFE_INTEGER + 1 },
  ])('does not treat malformed or missing usage as zero: %j', (usage) => {
    expect(readUsage('openai', usage)).toBeUndefined();
  });
  it('does not undercount malformed Anthropic cache usage or overflow totals', () => {
    expect(
      readUsage('anthropic', {
        input_tokens: 100,
        cache_read_input_tokens: '500',
        output_tokens: 50,
      }),
    ).toEqual({ inputTokens: undefined, outputTokens: 50, totalTokens: undefined });
    expect(
      readUsage('openai', { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 1 })?.totalTokens,
    ).toBeUndefined();
  });
});
describe('untrusted response validation', () => {
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
