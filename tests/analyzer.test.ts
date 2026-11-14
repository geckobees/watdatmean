import { describe, expect, it } from 'vitest';
import { inspect, syntaxErrors } from '../src/analyzer';
import { readFileSync } from 'node:fs';

describe('TypeScript declaration breakdowns', () => {
  it('breaks down a private number property using TypeScript semantics', () => {
    const source = 'class Game { private score: number = 0; }';
    const result = inspect(source, source.indexOf('score'));
    expect(result.code).toBe('private score: number = 0;');
    expect(result.parts.map((p) => p.token)).toEqual([
      'private',
      'score',
      ':',
      'number',
      '=',
      '0',
      ';',
    ]);
    expect(result.parts[0].detail).toContain('does not enforce runtime privacy');
    expect(result.symbol).toBe('score');
  });
  it('explains var as JavaScript function scope, not type inference', () => {
    const result = inspect('var count = 3;', 2);
    expect(result.parts[0].brief).toContain('function-scoped');
    expect(result.parts[0].detail).toContain('undefined');
  });
  it('does not claim const makes objects immutable', () => {
    const result = inspect('const player = { score: 0 };', 7);
    expect(result.parts[0].detail).toContain('can still be changed');
    expect(result.parts.map((p) => p.token)).toEqual(['const', 'player', '=', '{ score: 0 }', ';']);
  });
  it('handles strings containing punctuation and comments without splitting the initializer', () => {
    const result = inspect('const /* count */ text: string = "a;=b";', 20);
    expect(result.parts.map((p) => p.token)).toEqual([
      'const',
      'text',
      ':',
      'string',
      '=',
      '"a;=b"',
      ';',
    ]);
  });
  it('groups destructuring and generic type annotations', () => {
    expect(inspect('const { name, age } = user;', 10).parts[1].brief).toContain('Unpacks');
    expect(inspect('let names: Array<string> = [];', 5).parts.map((p) => p.token)).toContain(
      'Array<string>',
    );
  });
  it('supports multiple declarations with separate initializers', () => {
    const result = inspect('let a = 1, b = 2;', 12);
    expect(result.symbol).toBe('b');
    expect(result.parts.map((p) => p.token)).toEqual([
      'let',
      'a',
      '=',
      '1',
      ',',
      'b',
      '=',
      '2',
      ';',
    ]);
  });
  it('selects a full function when inspecting its name', () => {
    const source = 'export function double(x: number) { return x * 2; }';
    expect(inspect(source, source.indexOf('double')).code).toBe(source);
  });
  it('respects explicit selection rather than broadening transmitted code', () => {
    const source = 'const x = secret + 1;';
    const result = inspect(source, 10, 16);
    expect(result.code).toBe('secret');
    expect(result.parts).toEqual([]);
  });
  it('rejects invalid proposed syntax', () => {
    expect(syntaxErrors('const x = ;').length).toBeGreaterThan(0);
    expect(syntaxErrors('const x: number = 1;')).toEqual([]);
  });
});

describe('instant explanations throughout TypeScript', () => {
  const dashboard = readFileSync('demo/dashboard.ts', 'utf8');
  const part = (code: string, token: string, offset = 0) =>
    inspect(code, offset).parts.find((p) => p.token === token)!;

  it('explains the demo method call from every character, including punctuation', () => {
    const call = 'board.addCompletedTasks(3);';
    const start = dashboard.indexOf(call);
    for (let offset = start; offset < start + call.length; offset++) {
      const snippet = inspect(dashboard, offset);
      expect(snippet.code).toBe(call);
      expect(snippet.parts.map((p) => p.token)).toEqual([
        'board',
        '.',
        'addCompletedTasks',
        '(',
        '3',
        ')',
        ';',
      ]);
      expect(snippet.parts[0].brief).toContain('new Scoreboard instance');
      expect(snippet.parts[1].detail).toContain('dot itself does not run it');
      expect(snippet.parts[2].brief).toContain('method being called on board');
      expect(snippet.parts[4].brief).toContain('argument 1 to board.addCompletedTasks');
      expect(snippet.parts[4].detail).toContain('parameter receives it');
      expect(snippet.parts[6].brief).toBe('Ends the statement.');
      for (const p of snippet.parts) expect(dashboard.slice(p.start, p.end)).toBe(p.token);
    }
    expect(inspect(dashboard, start + 7).symbol).toBe('addCompletedTasks');
  });

  it('explains which call receives the literal and which receives the nested result', () => {
    const code = 'console.log(weeklySummary(3));';
    expect(inspect(code, 0).parts.map((p) => p.token)).toEqual([
      'console',
      '.',
      'log',
      '(',
      'weeklySummary',
      '(',
      '3',
      ')',
      ')',
      ';',
    ]);
    expect(part(code, 'console').brief).toContain('console object');
    expect(part(code, 'weeklySummary').brief).toContain(
      'result is passed as argument 1 to console.log',
    );
    expect(part(code, '3').brief).toContain('argument 1 to weeklySummary');
    expect(part(code, ')').brief).toContain('result is passed as argument 1 to console.log');
  });

  it('distinguishes member access from a call and handles chained, optional, and indexed calls', () => {
    expect(part('board.score;', 'score').brief).toContain('property accessed');
    expect(part('board.getLevel();', '(').brief).toContain('no arguments');
    expect(part('board?.getLevel?.();', '?.').detail).toContain('null or undefined');
    expect(part('handlers[0](3);', '[').brief).toContain('property key or array index');
    expect(part('makeBoard().addCompletedTasks(3);', 'addCompletedTasks').brief).toContain(
      'makeBoard()',
    );
  });

  it('keeps literals intact and skips comments, including in multiline calls', () => {
    const code = 'console.log(\n /* input */ "a;=b", /a[;.)]+/g, -3\n);';
    const parts = inspect(code, code.indexOf('input')).parts;
    expect(parts.map((p) => p.token)).toEqual([
      'console',
      '.',
      'log',
      '(',
      '"a;=b"',
      ',',
      '/a[;.)]+/g',
      ',',
      '-',
      '3',
      ')',
      ';',
    ]);
    expect(parts.find((p) => p.token === '"a;=b"')?.brief).toContain('argument 1');
    expect(parts.find((p) => p.token === '/a[;.)]+/g')?.brief).toContain('argument 2');
  });

  it('uses the nearest binding instead of guessing from a matching name elsewhere', () => {
    const source = `const board = new Scoreboard();
      function use(board: OtherBoard) { board.run(); }
      { const board = new OtherBoard(); board.run(); }
      board.run();`;
    expect(part(source, 'board', source.indexOf('board.run')).brief).toContain('parameter');
    expect(
      part(source, 'board', source.indexOf('board.run', source.indexOf('OtherBoard();'))).brief,
    ).toContain('new OtherBoard');
    expect(part(source, 'board', source.lastIndexOf('board.run')).brief).toContain(
      'new Scoreboard',
    );
    const unrelated = 'function hidden() { const board = new Hidden(); } board.run();';
    expect(part(unrelated, 'board', unrelated.lastIndexOf('board.run')).brief).not.toContain(
      'Hidden',
    );
    const shadow = 'function use(console: Logger) { console.log(3); }';
    expect(part(shadow, 'console', shadow.indexOf('console.log')).brief).toContain('parameter');
    const destructured = 'const { board } = state; board.run();';
    expect(part(destructured, 'board', destructured.lastIndexOf('board.run')).brief).toContain(
      'destructuring',
    );
  });

  it('explains expressions inside declarations without losing the declaration pieces', () => {
    const code = 'const points = calculatePoints(3);';
    expect(inspect(code, 0).parts.map((p) => p.token)).toEqual([
      'const',
      'points',
      '=',
      'calculatePoints',
      '(',
      '3',
      ')',
      ';',
    ]);
    expect(part(code, '3').brief).toContain('argument 1 to calculatePoints');
  });

  it.each([
    ['return tasks * POINTS_PER_TASK;', '*', 'Multiplies'],
    ['this.score += tasks * 10;', '+=', 'stores the result'],
    ['count = 3;', '=', 'Stores'],
    ['return score >= 30 ? "Explorer" : "Starter";', '?', 'truthy'],
    ['if (ready) { run(); }', 'if', 'truthy'],
    ['for (const item of items) { log(item); }', 'of', 'each value'],
    ['while (ready) { run(); }', 'while', 'Repeats'],
    ['import { Scoreboard } from "./score";', 'import', 'another module'],
    ['export function add(tasks: number) { return tasks; }', 'tasks', 'parameter'],
    ['class Scoreboard { run() {} }', 'class', 'blueprint'],
    ['interface Board { score: number; }', 'interface', 'shape'],
    ['type Level = "Starter" | "Explorer";', 'type', 'type alias'],
    ['throw new Error("bad");', 'new', 'constructor'],
    ['await fetch(url);', 'await', 'settles'],
    ['items.map(item => item * 2);', '=>', 'arrow function'],
    ['console.log({ score: 3 });', ':', 'property name'],
    ['console.log(`Score: ${board.score}`);', '`Score: ${', 'template text'],
  ])('breaks down %s', (code, token, meaning) => {
    expect(part(code, token)?.brief).toContain(meaning);
    expect(inspect(code, 0).parts.every((p) => p.brief && p.detail)).toBe(true);
  });

  it('keeps function bodies compact while inspecting statements inside them', () => {
    const code = 'function run() { board.addCompletedTasks(3); }';
    expect(inspect(code, 9).parts.map((p) => p.token)).toEqual([
      'function',
      'run',
      '(',
      ')',
      '{ … }',
    ]);
    expect(inspect(code, code.indexOf('board')).code).toBe('board.addCompletedTasks(3);');
  });

  it('accounts for spreads, assignments, shorthand properties, and bare returns', () => {
    expect(part('log(...values, 3);', '(').brief).toContain('spread values');
    expect(part('log(...values, 3);', '3').brief).not.toContain('argument 2');
    expect(part('count = 3;', 'count').brief).toContain('being updated');
    expect(part('log({ count });', 'count').detail).toContain('count: count');
    expect(part('return;', 'return').brief).toContain('undefined');
    expect(part('new widgets.Board();', 'Board').brief).toContain('constructor');
  });

  it('still respects explicit selections inside calls', () => {
    const code = 'console.log(weeklySummary(3));';
    const start = code.indexOf('weeklySummary');
    expect(inspect(code, start, start + 13)).toMatchObject({ code: 'weeklySummary', parts: [] });
  });

  it('tolerates incomplete expressions while typing', () => {
    for (const code of ['board.', 'console.log(', 'if (', 'return value?.', ''])
      expect(() => inspect(code, Math.max(0, code.length - 1))).not.toThrow();
  });
});
