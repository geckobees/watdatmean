import { describe, expect, it } from 'vitest';
import { inspect } from '../src/analyzer';

const explanation = (code: string, at = 0) => inspect(code, at).explanation!;
const expectParagraph = (text: string) => {
  expect(text).toBeTruthy();
  expect(text).not.toMatch(/\n|^\s*(?:[-*]|\d+\.)\s| — /);
};

describe('concise hover explanations', () => {
  it.each(['const', 'let', 'for (const of list) {}', 'for (let in object) {}'])(
    'handles unfinished declarations while typing: %s',
    (code) => {
      for (let offset = 0; offset <= code.length; offset++) {
        expect(() => inspect(code, offset)).not.toThrow();
      }
    },
  );
  it('explains the function signature together, wherever its header is hovered', () => {
    const code = 'export function weeklySummary(completedTasks: number): string { return "done"; }';
    for (const piece of [
      'export',
      'function',
      'weeklySummary',
      '(',
      'completedTasks',
      ':',
      'number',
      ')',
      'string',
    ]) {
      const result = explanation(code, code.indexOf(piece));
      expectParagraph(result);
      expect(result).toContain('`weeklySummary`');
      expect(result).toContain('`completedTasks` (a number)');
      expect(result).toContain('return text (`string`)');
      expect(result).toContain('`export` lets other files import it');
      expect(result.split(/\s+/).length).toBeLessThan(45);
    }
  });

  it('connects new, the constructor, and the object reference without saying const freezes objects', () => {
    const result = explanation('const board = new Scoreboard();');
    expectParagraph(result);
    expect(result).toContain('`new` creates a `Scoreboard` object');
    expect(result).toContain('constructor, `Scoreboard()`');
    expect(result).toContain('`board` holds a reference to that object');
    expect(result).toContain('`const` prevents assigning a different value to `board`');
    expect(result).toContain('contents can still change');
    expect(explanation('let board = new Scoreboard(3);')).toContain('constructor, `Scoreboard(3)`');
    expect(explanation('let board = new Scoreboard(3);')).toContain(
      'different value to `board` later',
    );
  });

  it('distinguishes unpacking an object from holding a reference to the whole object', () => {
    const result = explanation('const { score } = new Scoreboard();');
    expect(result).toContain('picks out properties or items');
    expect(result).toContain('`const` prevents reassigning these variable names');
    expect(result).not.toContain('holds a reference');
  });

  it('explains typed values and arrow functions without treating declarations as calls', () => {
    const result = explanation('const points: number = calculatePoints(completedTasks);');
    expect(result).toContain(
      '`points` starts with the result of `calculatePoints(completedTasks)`',
    );
    expect(result).toContain('`: number` means TypeScript expects a number');
    const arrow = explanation('const double = (value: number): number => value * 2;');
    expect(arrow).toContain('`double` holds a function');
    expect(arrow).toContain('runs when you call `double`');
    expect(arrow).not.toContain('runs first');
  });

  it('keeps inner and outer calls in prose and retains individual pieces for the panel', () => {
    const code = 'console.log(board.getLevel());';
    for (let offset = 0; offset < code.length; offset++) {
      const snippet = inspect(code, offset);
      expectParagraph(snippet.explanation!);
      expect(snippet.explanation).toContain('The inner call, `board.getLevel()`');
      expect(snippet.explanation).toContain(
        'runs `getLevel`, a function on `board`, with no inputs',
      );
      expect(snippet.explanation).toContain('The outer call, `console.log(…)`');
      expect(snippet.explanation).toContain(
        "built-in `console` object's `log` method to display that result",
      );
      expect(snippet.explanation!.indexOf('inner call')).toBeLessThan(
        snippet.explanation!.indexOf('outer call'),
      );
      expect(snippet.parts.map((part) => part.token)).toContain('getLevel');
      const parentheses = snippet.parts.filter((part) => part.token === '(' || part.token === ')');
      expect(parentheses.map((part) => part.brief.split(' ')[0])).toEqual([
        'Outer',
        'Inner',
        'Inner',
        'Outer',
      ]);
    }
  });

  it('references inputs and the object declaration using beginner vocabulary', () => {
    const code = 'const board = new Scoreboard();\nboard.addCompletedTasks(3);';
    const result = explanation(code, code.indexOf('board.add'));
    expect(result).toContain('`board` (initially a `Scoreboard` object)');
    expect(result).toContain('`3` as its input');
    expect(result).not.toContain('argument');
    const nested = explanation('console.log(weeklySummary(3));');
    expect(nested).toContain('runs `weeklySummary` with `3` as its input');
    expect(nested).toContain('display that result');
  });

  it('orders sibling calls without inventing results or executing callbacks', () => {
    const result = explanation('show(first(), wrap(second(3)));');
    expect(result.indexOf('First, `first()`')).toBeLessThan(result.indexOf('Then, `second(3)`'));
    expect(result.indexOf('Then, `second(3)`')).toBeLessThan(result.indexOf('Then, `wrap(…)`'));
    expect(result).toContain('Finally, `show(…)`');
    expect(result).toContain('the result of `first()` and the result of `wrap(second(3))`');
    expect(explanation('(console.log((board.getLevel())));')).toContain('The inner call');
    const callback = explanation('items.map(item => calculate(item));');
    expect(callback).toContain('with a function as its input');
    expect(callback).not.toContain('inner call');
  });

  it('does not call a locally shadowed console a built-in display tool', () => {
    const source = 'function custom(console: Logger) { console.log(board.getLevel()); }';
    const result = explanation(source, source.indexOf('console.log'));
    expect(result).toContain('runs `log`, a function on `console`');
    expect(result).not.toMatch(/built-in|display/);
  });

  it.each([
    'console?.log(board.getLevel());',
    'console.log(board?.getLevel());',
    'console.log(ready && board.getLevel());',
    'console.log(ready ? first() : second());',
    'console.log(await load());',
    'makeBoard().getLevel();',
    'console.log(...values);',
  ])('keeps %s in prose without unconditional execution-order claims', (code) => {
    const result = explanation(code);
    expectParagraph(result);
    expect(result).not.toMatch(/inner call|runs first|First, /);
    expect(inspect(code, 0).parts.length).toBeGreaterThan(0);
  });

  it('explains optional calls and spread inputs', () => {
    expect(explanation('console?.log(board.getLevel());')).toContain(
      'the rest of that chain is skipped',
    );
    expect(explanation('console.log(...values);')).toContain(
      'passes the items from its value as separate inputs',
    );
  });

  it('keeps long calls compact while describing the hovered input', () => {
    const code = `log(${Array.from({ length: 30 }, (_, i) => i).join(', ')});`;
    const result = explanation(code, code.indexOf('29'));
    expect(result).toContain('30 inputs');
    expect(result).toContain('`29` is input 30 to `log`');
    expect(result.length).toBeLessThan(200);
  });

  it.each([
    ['export class Scoreboard { score = 0; }', 'blueprint for objects'],
    ['class Advanced extends Scoreboard {}', 'inheriting its members'],
    ['interface Player { score: number }', 'does not create an object'],
    ['type Level = "Starter" | "Explorer";', 'reuse this type description'],
    ['import { Scoreboard } from "./score";', 'from `"./score"` into this file'],
    ['import type { Player } from "./score";', 'only used for TypeScript checking'],
    ['return weeklySummary(3);', 'sends the result of `weeklySummary(3)` back'],
    ['score = calculatePoints(3);', 'assigns the result of `calculatePoints(3)` to `score`'],
    ['score += 3;', 'stores the result back in `score`'],
    ['score ??= calculatePoints(3);', 'without evaluating the right side'],
    ['if (ready) start(); else stop();', '`else` branch runs'],
    ['for (const item of items) show(item);', 'assigning each value to `item`'],
    ['while (ready) work();', 'checks before each repetition'],
    ['try { work(); } catch (error) {} finally {}', '`catch` handles an error'],
  ])('uses prose for %s', (code, meaning) => {
    const result = explanation(code);
    expectParagraph(result);
    expect(result).toContain(meaning);
  });

  it('explains class members when hovering their own headers', () => {
    const source =
      'class Board { private score: number = 0; constructor(points: number) {} get level(): string { return "Starter"; } add(tasks: number): number { return tasks; } }';
    expect(explanation(source, source.indexOf('private'))).toContain('property on each object');
    expect(explanation(source, source.indexOf('constructor'))).toContain('sets up a new object');
    expect(explanation(source, source.indexOf('get level'))).toContain(
      'function runs when you read this property',
    );
    expect(explanation(source, source.indexOf('add('))).toContain('`tasks` (a number)');
  });

  it('keeps source text inside safe code spans, including backticks and Markdown-looking names', () => {
    const source = 'type Link = "`[Open](command:watdatmean.inspect)`";';
    expect(explanation(source)).toContain('``"`[Open](command:watdatmean.inspect)`"``');
    const multiline = 'const message = `hello\nworld`;';
    expectParagraph(explanation(multiline));
    expect(explanation(multiline)).toContain('`` `hello world` ``');
  });

  it.each(['console.log(', 'const score = ;', 'export function unfinished('])(
    'handles unfinished code: %s',
    (code) => {
      expect(explanation(code)).toContain('incomplete or has a syntax error');
    },
  );

  it('does not broaden an explicit selection', () => {
    expect(inspect('console.log(weeklySummary(3));', 12, 25).explanation).toBeUndefined();
  });
});
