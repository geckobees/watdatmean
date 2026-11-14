import { describe, expect, it } from 'vitest';
import { inspect, syntaxErrors } from '../src/analyzer';

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
