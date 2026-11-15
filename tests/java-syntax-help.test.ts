import { describe, expect, it, vi } from 'vitest';
import { javaSyntaxHelp } from '../src/java-syntax-help';
import { generate, makeRequest } from '../src/provider';
import { BridgeCore } from '../src/bridge/core';
import type { LearningRequest, Lesson } from '../src/types';
import { javaSyntaxFixes, javaSyntaxAmbiguous, javaSyntaxValid } from './quality/java-syntax-cases';

const request = (code: string): LearningRequest => ({
  code,
  language: 'Java',
  task: 'explain',
  audience: 'beginner',
  mode: 'standalone',
});
const noAI = vi.fn(async () => {
  throw new Error('No AI request expected');
});
describe('shared Java syntax warnings and conservative fixes', () => {
  it.each(javaSyntaxFixes)(
    '$id: rechecks the fix and explains the punctuation',
    ({ code, corrected, why, partial }) => {
      const help = javaSyntaxHelp(code)!;
      expect(help.corrected).toBe(corrected);
      expect(help.partial).toBe(partial ?? false);
      expect(help.explanation).toContain(why);
      expect(javaSyntaxHelp(corrected)).toBeUndefined();
    },
  );
  it.each(javaSyntaxValid)('accepts valid code or a valid selection: %s', (code) => {
    expect(javaSyntaxHelp(code)).toBeUndefined();
  });
  it.each(javaSyntaxAmbiguous)('flags the issue without inventing code: %s', async (code) => {
    const help = javaSyntaxHelp(code)!;
    expect(help).toBeDefined();
    expect(help.corrected).toBeUndefined();
    const lesson = await generate('groq', 'test', 'unused', request(code), undefined, noAI);
    expect(lesson.syntax).toEqual(help);
    expect(lesson.usage?.total).toBe(0);
    expect(lesson.output).toBeUndefined();
    expect(lesson.checks).toEqual([]);
  });
  it('explains a corrected print locally through the VS Code and IntelliJ adapters', async () => {
    const input = request('int n = 2\nSystem.out.println(n);');
    const direct = await generate('groq', 'test', 'unused', input, undefined, noAI);
    const bridge = new BridgeCore(noAI);
    const params = { provider: 'groq', model: 'test', key: 'unused', request: input };
    const native = (await bridge.dispatch(1, 'request', params)) as { lesson: Lesson };
    expect(native.lesson).toEqual(direct);
    expect(direct.output?.text).toBe('2\n');
    expect(direct.syntax?.corrected).toBe('int n = 2;\nSystem.out.println(n);');
    expect(direct.usage?.total).toBe(0);
    expect(noAI).not.toHaveBeenCalled();
    expect(await bridge.dispatch(2, 'request', params)).toMatchObject({ cached: true });
  });
  it('labels a missing closing block as a completion and makes just the usual explanation request', async () => {
    const code = 'if (ready) { work();';
    const transport = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: 'Conditional work',
                    summary: 'If ready is true, work() is called. Its behavior is not shown.',
                    steps: [],
                    concepts: [],
                    example: { code: '', explanation: '' },
                    checks: [],
                    predictions: [],
                    output: { text: 'guessed output', explanation: 'guess' },
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 400, completion_tokens: 60, total_tokens: 460 },
          }),
        ),
    );
    const lesson = await generate('groq', 'test', 'unused', request(code), undefined, transport);
    expect(lesson.syntax).toMatchObject({ partial: true, corrected: code + '\n}' });
    expect(lesson.summary).toContain('ready');
    expect(lesson.output?.text).toBe('');
    expect(transport).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(
      JSON.parse(transport.mock.calls[0][1]!.body as string).messages.at(-1).content,
    );
    expect(sent.code).toBe(code);
    expect(sent.codeFacts).toContain('do not');
    expect(lesson.usage?.total).toBe(460);
    expect(makeRequest('groq', 'test', 'unused', request(code)).body.length).toBeLessThan(7000);
  });
  it('uses original selection positions after multiple insertions', () => {
    const help = javaSyntaxHelp('int n = 2\r\nSystem.out.println(n;')!;
    expect(help.issues).toEqual([
      'Selection line 1, column 10: Missing ;.',
      'Selection line 2, column 21: Missing ).',
    ]);
  });
  it('leaves Unicode-escaped and oversized sources to the native checker', () => {
    expect(javaSyntaxHelp('int n = \\u0032;')).toBeUndefined();
    expect(javaSyntaxHelp('('.repeat(50001))).toBeUndefined();
  });
});
