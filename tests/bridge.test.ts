import { describe, expect, it, vi } from 'vitest';
import { BridgeCore } from '../src/bridge/core';
import { makeRequest } from '../src/provider';

const lesson = {
  title: 'A loop',
  summary: 'Prints each item.',
  steps: [],
  concepts: [],
  example: { code: 'for x in [1, 2]: print(x)', explanation: 'Prints 1 then 2.' },
  predictions: [],
  checks: [],
};
const params = (language = 'Python', extra = {}) => ({
  provider: 'openai',
  model: 'test-model',
  key: 'test-secret',
  request: {
    task: 'explain',
    audience: 'beginner',
    mode: 'standalone',
    code: 'for x in items: print(x)',
    language,
    ...extra,
  },
});
const response = () =>
  new Response(
    JSON.stringify({
      output: [{ content: [{ type: 'output_text', text: JSON.stringify(lesson) }] }],
    }),
  );

describe('IDE-neutral learning bridge', () => {
  it('reuses the TypeScript analyzer and checks selection bounds', async () => {
    const core = new BridgeCore();
    const result = await core.dispatch(1, 'inspect', {
      code: 'const score: number = 0;',
      start: 8,
      end: 8,
    });
    expect(result).toMatchObject({ code: 'const score: number = 0;', symbol: 'score' });
    await expect(core.dispatch(2, 'inspect', { code: 'abc', start: -1, end: 3 })).rejects.toThrow(
      'range',
    );
    expect(await core.dispatch(3, 'syntax', { code: 'const x = ;' })).not.toEqual([]);
  });
  it('sends the actual language and drops project context in standalone mode', async () => {
    const transport = vi.fn().mockImplementation(async () => response());
    const core = new BridgeCore(transport);
    await core.dispatch(
      1,
      'request',
      params('Python', { context: 'PRIVATE PROJECT', evidence: [{ code: 'PRIVATE EVIDENCE' }] }),
    );
    const body = JSON.parse(transport.mock.calls[0][1].body);
    const sent = JSON.parse(body.input);
    expect(sent.language).toBe('Python');
    expect(sent).not.toHaveProperty('context');
    expect(sent).not.toHaveProperty('evidence');
    expect(body.instructions).toContain('request language');
    expect(body.instructions).not.toContain('Teach TypeScript');
    expect(body.max_output_tokens).toBe(200);
  });
  it('separates cache entries by language, guidance, and context, and clears them', async () => {
    const transport = vi.fn().mockImplementation(async () => response());
    const core = new BridgeCore(transport);
    await core.dispatch(1, 'request', params());
    expect(await core.dispatch(2, 'request', params())).toMatchObject({ cached: true });
    await core.dispatch(3, 'request', params('Java'));
    await core.dispatch(4, 'request', params('Python', { audience: 'experienced' }));
    await core.dispatch(
      5,
      'request',
      params('Python', { mode: 'project', context: 'different', evidence: [] }),
    );
    expect(transport).toHaveBeenCalledTimes(4);
    await core.dispatch(6, 'clearCache', {});
    expect(await core.dispatch(7, 'request', params())).toMatchObject({ cached: false });
  });
  it('validates bounded inputs before contacting a provider', async () => {
    const transport = vi.fn();
    const core = new BridgeCore(transport);
    await expect(
      core.dispatch(1, 'request', params('Java', { code: 'x'.repeat(12001) })),
    ).rejects.toThrow('12,000');
    await expect(
      core.dispatch(
        2,
        'request',
        params('Java', { mode: 'project', context: '', evidence: new Array(13).fill({}) }),
      ),
    ).rejects.toThrow('evidence');
    await expect(
      core.dispatch(3, 'request', { ...params(), provider: 'constructor' }),
    ).rejects.toThrow('Unsupported');
    expect(transport).not.toHaveBeenCalled();
  });
  it('cancels an in-flight provider call without caching its result', async () => {
    const transport = vi.fn().mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error('abort')));
        }),
    );
    const core = new BridgeCore(transport);
    const pending = core.dispatch(1, 'request', params());
    await core.dispatch(2, 'cancel', {});
    await expect(pending).rejects.toThrow('cancelled');
    transport.mockImplementation(async () => response());
    expect(await core.dispatch(3, 'request', params())).toMatchObject({ cached: false });
  });
  it('preserves the VS Code TypeScript default when no language is supplied', () => {
    const request = makeRequest('openai', 'test', 'key', {
      task: 'example',
      mode: 'standalone',
      audience: 'beginner',
      code: 'const count = 1;',
    });
    expect(JSON.parse(request.body).instructions).toContain('default TypeScript');
  });
  it.each(['Java', 'Python', 'unknown'])(
    'keeps the compact example request language-aware for %s',
    async (language) => {
      const transport = vi.fn().mockImplementation(async () => response());
      await new BridgeCore(transport).dispatch(1, 'request', params(language, { task: 'example' }));
      const body = JSON.parse(transport.mock.calls[0][1].body);
      expect(JSON.parse(body.input)).toMatchObject({ language, task: 'example' });
      expect(body.instructions).toContain('example in the requested language');
      expect(body.instructions).toContain('if unknown, infer cautiously');
      expect(body.max_output_tokens).toBe(200);
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it('returns reported usage to IntelliJ and reuses the compact lesson without another request', async () => {
    const transport = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            output: [
              {
                content: [
                  {
                    type: 'output_text',
                    text: JSON.stringify({ summary: 'Returns twice the input.' }),
                  },
                ],
              },
            ],
            usage: { input_tokens: 210, output_tokens: 30, total_tokens: 240 },
          }),
        ),
    );
    const core = new BridgeCore(transport);
    const request = params('Java', { code: 'int twice(int value) { return value * 2; }' });
    const result = await core.dispatch(1, 'request', request);
    expect(result).toMatchObject({
      cached: false,
      lesson: {
        summary: 'Returns twice the input.',
        usage: { input: 210, output: 30, total: 240 },
      },
    });
    expect(await core.dispatch(2, 'request', request)).toMatchObject({ cached: true });
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
