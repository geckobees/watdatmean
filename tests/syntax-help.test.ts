import { describe, expect, it, vi } from 'vitest';
import { syntaxHelp } from '../src/syntax-help';
import { explainableFragment } from '../src/selection-fragment';
import { generate, makeRequest } from '../src/provider';
import { checkSyntax } from '../src/languages';
import type { LearningRequest } from '../src/types';
import { BridgeCore } from '../src/bridge/core';

const code = [
  'for (const declaration of declarations) {',
  '  const name = declaration.name;',
  '  const destructured = ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name);',
  '  const createsObject = declaration.initializer && ts.isNewExpression(declaration.initializer);',
  '  special.set(name.getStart(source), {',
  '    token: name.getText(source),',
  "    brief: destructured ? 'Unpacks values into these names.' : 'The variable or property’s name.',",
  '    detail: destructured',
  "      ? 'Destructuring extracts selected properties or items into separate variables.'",
  '      : ts.isPrivateIdentifier(name)',
  "        ? 'A #private field is accessible only inside its declaring class.'",
  '        : createsObject',
  '          ? `${name.getText(source)} holds a reference to the new object.`',
  "          : 'Use this name to read the stored value elsewhere in its scope.',",
  '  });',
].join('\n');
const request = (code: string, language = 'TypeScript'): LearningRequest => ({
  code,
  language,
  task: 'explain',
  mode: 'standalone',
  audience: 'beginner',
});
describe('selection syntax help shared by both editors', () => {
  it('explains the reported loop and offers only its missing closing brace', async () => {
    expect(explainableFragment(code, 'typescript')).toBe(true);
    const help = syntaxHelp(code, 'TypeScript')!;
    expect(help.partial).toBe(true);
    expect(help.corrected).toBe(code + '}');
    expect(checkSyntax(help.corrected!, 'typescript').errors).toEqual([]);
    const fetcher = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: 'Build a description for each name',
                    summary:
                      'The loop visits each declaration and records a description in special.',
                    steps: [
                      'It checks whether the name is a destructuring pattern and whether its initializer is a new expression.',
                      'The nested choices select one detail message; special.set stores it using the source position as the key.',
                    ],
                    concepts: [],
                    example: { code: '', explanation: '' },
                    predictions: [],
                    checks: [],
                    output: { text: 'invented output', explanation: 'Not verified' },
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 500, completion_tokens: 100, total_tokens: 600 },
          }),
        ),
    );
    const lesson = await generate('groq', 'test', 'key', request(code), undefined, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(lesson.summary).toContain('loop visits');
    expect(lesson.steps.join(' ')).toContain('special.set');
    expect(lesson.syntax).toEqual(help);
    expect(lesson.output?.text).toBe('');
    expect(lesson.output?.explanation).toBe('');
    expect(lesson.note).toBeUndefined();
    expect(lesson.checks).toEqual([]);
    expect(lesson.usage?.total).toBe(600);
    expect(
      JSON.parse(JSON.parse(fetcher.mock.calls[0][1]!.body as string).messages.at(-1).content).code,
    ).toBe(code);
    // One short conditional note; no second repair/review AI request or expanded context.
    expect(makeRequest('groq', 'test', 'key', request(code)).body.length).toBeLessThan(8000);
    const bridge = new BridgeCore(fetcher);
    const params = { provider: 'groq', model: 'test', key: 'key', request: request(code) };
    const native = (await bridge.dispatch(1, 'request', params)) as { lesson: typeof lesson };
    expect(native.lesson).toEqual(lesson);
    const cached = (await bridge.dispatch(2, 'request', params)) as { cached: boolean };
    expect(cached.cached).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(['const data = [1 2];', 'const data = { a: 1 b: 2 };', 'const total = (1 + 2;'])(
    'repairs punctuation and checks it again: %s',
    (code) => {
      const help = syntaxHelp(code, 'TypeScript')!;
      expect(help.corrected).toBeDefined();
      expect(checkSyntax(help.corrected!, 'typescript').errors).toEqual([]);
    },
  );
  it('explains a corrected Python header without running user code or a repair AI request', async () => {
    const input = 'if ready\n    notify()';
    const help = syntaxHelp(input, 'Python')!;
    expect(help.corrected).toBe('if ready:\n    notify()');
    expect(help.explanation).toContain('colon');
  });
  it.each([
    'const value = ;',
    'const s = "unfinished',
    'run(unknown +',
    'for (const item of items) {',
  ])('does not invent missing expressions: %s', (code) => {
    expect(explainableFragment(code, 'typescript')).toBe(false);
    if (code !== 'for (const item of items) {')
      expect(syntaxHelp(code, 'TypeScript')?.corrected).toBeUndefined();
  });
  it.each(['private score: number = 3;', 'return value;', 'const value = 3;'])(
    'preserves valid selections: %s',
    (code) => {
      expect(syntaxHelp(code, 'TypeScript')).toBeUndefined();
    },
  );
  it('does not pretend unsupported languages have a local repair parser', () => {
    expect(syntaxHelp('let value = ;', 'Rust')).toBeUndefined();
  });
  it.each(['return value', 'break', 'await task()'])(
    'does not flag a valid Python body selection: %s',
    (code) => {
      expect(syntaxHelp(code, 'Python')).toBeUndefined();
    },
  );
});
