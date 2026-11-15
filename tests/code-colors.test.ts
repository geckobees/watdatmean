import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { INITIAL, Registry, type IGrammar } from 'vscode-textmate';
import { CodeColorizer } from '../src/code-colors';

const grammar = JSON.stringify({
  scopeName: 'source.test',
  patterns: [
    { name: 'comment.block', begin: '/\\*', end: '\\*/' },
    {
      name: 'string.quoted',
      begin: '"',
      end: '"',
      patterns: [{ match: '\\\\.', name: 'constant.character.escape' }],
    },
    { name: 'keyword.control', match: '\\b(return|class|const|int)\\b' },
    { name: 'constant.numeric', match: '\\b[0-9]+\\b' },
  ],
});
let engine: CodeColorizer;
function create(color = '#ff5555') {
  engine = new CodeColorizer({
    wasm: () => readFile('node_modules/vscode-oniguruma/release/onig.wasm'),
    grammar: async (scope) =>
      scope === 'source.test' ? { text: grammar, file: 'test.json' } : undefined,
    injections: () => [],
    theme: {
      settings: [
        { settings: { foreground: '#dddddd', background: '#111111' } },
        { scope: 'keyword', settings: { foreground: color, fontStyle: 'bold' } },
        { scope: 'comment', settings: { foreground: '#777777', fontStyle: 'italic' } },
        { scope: 'string', settings: { foreground: '#88cc88' } },
        { scope: 'constant.numeric', settings: { foreground: '#7799ff' } },
      ],
    },
  });
  return engine;
}
afterEach(() => {
  engine?.dispose();
  vi.restoreAllMocks();
});

// Model lazy regex compilation without depending on the test machine's speed.
function coldGrammar(firstLineCost: number, laterLineCost: number) {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const tokenize = vi.fn((line: string, _state: unknown, budget = 0) => {
    const cost = line === 'prefix' ? firstLineCost : laterLineCost;
    now += Math.min(cost, budget);
    return {
      tokens: new Uint32Array([0, 2 << 15, 5, 1 << 15]),
      ruleStack: cost > budget ? { partial: true } : INITIAL,
      stoppedEarly: cost > budget,
    };
  });
  vi.spyOn(Registry.prototype, 'loadGrammar').mockResolvedValue({
    tokenizeLine2: tokenize,
  } as unknown as IGrammar);
  vi.spyOn(Registry.prototype, 'getColorMap').mockReturnValue(['', '#DDDDDD', '#FF5555']);
  return tokenize;
}
describe('local native grammar colors', () => {
  it('colors a later selection when new syntax needs more than a short line slice', async () => {
    const tokenize = coldGrammar(5, 40);
    const code = 'prefix\nconst pad = /x/.test(short);';
    const result = await create().colorize(code, 'source.test', 7, code.length);
    expect(result.runs).toEqual([
      [0, 5, 0],
      [5, code.length - 7, 1],
    ]);
    expect(result.styles[0].color).toBe('#FF5555');
    expect(tokenize.mock.calls[1][1]).toBe(INITIAL);
  });
  it('retries cold syntax on a later line with the original lexical state', async () => {
    const tokenize = coldGrammar(740, 40);
    const code = 'prefix\nconst value = 1;';
    const result = await create().colorize(code, 'source.test', 7, code.length);
    expect(result.runs).toHaveLength(2);
    expect(tokenize).toHaveBeenCalledTimes(3);
    expect(tokenize.mock.calls[2][1]).toBe(tokenize.mock.calls[1][1]);
  });
  it('bounds repeated slow syntax and discards incomplete lexical context', async () => {
    const tokenize = coldGrammar(740, 300);
    const code = 'prefix\nconst value = 1;';
    expect(await create().colorize(code, 'source.test', 7, code.length)).toEqual({
      runs: [],
      styles: [],
    });
    expect(tokenize).toHaveBeenCalledTimes(3);
  });
  it('uses separate native keyword, string and number rules with exact offsets', async () => {
    const code = 'const text = "hi"; return 42;';
    const result = await create().colorize(code, 'source.test', 0, code.length);
    const at = (token: string) =>
      result.styles[
        result.runs.find(([a, b]) => a <= code.indexOf(token) && b > code.indexOf(token))![2]
      ];
    expect(at('const')).toEqual({ color: '#FF5555', font: 2 });
    expect(at('hi').color).toBe('#88CC88');
    expect(at('42').color).toBe('#7799FF');
    expect(result.runs.every(([a, b]) => a >= 0 && b <= code.length)).toBe(true);
  });
  it('keeps lexical state from before a selection inside a multiline comment', async () => {
    const code = '/* start\nreturn 42\n*/\nreturn 1;';
    const start = code.indexOf('return'),
      end = start + 9;
    const result = await create().colorize(code, 'source.test', start, end);
    expect(result.runs).toEqual([[0, 9, 0]]);
    expect(result.styles[0]).toEqual({ color: '#777777', font: 1 });
  });
  it('preserves CRLF, tabs and Unicode offsets', async () => {
    const code = '/* 😀 */\r\n\treturn "雪";';
    const start = code.indexOf('return');
    const result = await create().colorize(code, 'source.test', start, code.length);
    expect(result.runs[0].slice(0, 2)).toEqual([0, 6]);
    expect(result.styles[result.runs[0][2]].color).toBe('#FF5555');
  });
  it('changes colors with the theme without changing token ranges', async () => {
    const code = 'return 1;';
    const before = await create().colorize(code, 'source.test', 0, code.length);
    engine.dispose();
    const after = await create('#112233').colorize(code, 'source.test', 0, code.length);
    expect(after.runs).toEqual(before.runs);
    expect(after.styles[0].color).toBe('#112233');
  });
  it('renders unknown languages and oversized selections as plain code', async () => {
    const e = create();
    expect(await e.colorize('text', 'unknown', 0, 4)).toEqual({ runs: [], styles: [] });
    expect(await e.colorize('x'.repeat(50001), 'source.test', 0, 50001)).toEqual({
      runs: [],
      styles: [],
    });
  });
  it('bounds pathological long lines without claiming partial context is correct', async () => {
    const code = 'x'.repeat(21000) + '\nreturn 1;';
    expect(await create().colorize(code, 'source.test', 21001, code.length)).toEqual({
      runs: [],
      styles: [],
    });
  });
  it('treats HTML-looking source as text data', async () => {
    const code = '"</style><script>alert(1)</script>"';
    const result = await create().colorize(code, 'source.test', 0, code.length);
    expect(result.styles.every((s) => /^#[\dA-F]{6}$/.test(s.color))).toBe(true);
    expect(result).not.toHaveProperty('html');
  });
});
