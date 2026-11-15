import { describe, expect, it } from 'vitest';
import { inspect } from '../src/analyzer';

const examples = [
  'const glossary: Record<string, [string, string]> = { const: ["short", "long"] };',
  'const handlers: Readonly<Record<string, (value: number) => Promise<string[]>>> = {};',
  'const pair: readonly [label: string, count?: number] = ["hello", 3];',
  'const results: Array<Map<string, Set<number>>> = [new Map()];',
  'const result: string | number | null = lookup?.(values[0]) ?? null;',
  'const options: { [K in keyof Settings]?: Settings[K] } = {};',
  'const { name: label = "Untitled", ...rest } = record;',
  'class Board { #score: number = 0; [key]: Map<string, Set<number>> = new Map(); }',
  'const names = { constructor: "make", toString: "text", "a;=b": ["<img>", "💡"] };',
];

function checkRanges(code: string, offset: number) {
  const snippet = inspect(code, offset);
  let previous = snippet.start;
  for (const part of snippet.parts) {
    expect(part.start).toBeGreaterThanOrEqual(previous);
    expect(part.end).toBeGreaterThan(part.start!);
    expect(part.end).toBeLessThanOrEqual(snippet.end);
    if (part.token !== '{ … }') expect(code.slice(part.start, part.end)).toBe(part.token);
    expect(typeof part.brief).toBe('string');
    expect(typeof part.detail).toBe('string');
    expect(part.brief).toBeTruthy();
    expect(part.detail).toBeTruthy();
    previous = part.end!;
  }
  return snippet;
}

describe('complex and unfinished TypeScript declarations', () => {
  it.each([
    'type Record<K, V> = [K, V];',
    'interface Record<K, V> { key: K; value: V; }',
    'import { Custom as Record } from "./custom";',
    'import Record from "./custom";',
  ])('does not mistake a custom Record for the built-in utility: %s', (prefix) => {
    const code = prefix + '\nconst pair: Record<string, number> = value;';
    const snippet = inspect(code, code.indexOf('const pair'));
    expect(snippet.explanation).not.toContain('text keys');
    expect(snippet.parts.map((p) => p.detail).join(' ')).not.toContain('Each key is text');
    expect(snippet.parts.find((p) => p.token === 'Record')!.detail).toContain(
      'Record<string, number>',
    );
  });
  it('keeps a generic type parameter unknown instead of assuming built-in Array behavior', () => {
    const code = 'function use<Array>() { const item: Array<string> = value; }';
    expect(inspect(code, code.indexOf('const item')).explanation).not.toContain('a list');
  });
  it('unpacks the Record, tuple, and object values in the reported glossary declaration', () => {
    const code = examples[0];
    const { parts, explanation } = inspect(code, 0);
    expect(parts.map((p) => p.token)).toEqual([
      'const',
      'glossary',
      ':',
      'Record',
      '<',
      'string',
      ',',
      '[',
      'string',
      ',',
      'string',
      ']',
      '>',
      '=',
      '{',
      'const',
      ':',
      '[',
      '"short"',
      ',',
      '"long"',
      ']',
      '}',
      ';',
    ]);
    expect(explanation).toContain('an object whose text keys each hold a pair of text values');
    expect(parts.find((p) => p.token === 'Record')!.detail).toContain('a pair of text values');
    const strings = parts.filter((p) => p.token === 'string');
    expect(strings[0].brief).toContain('Text keys');
    expect(strings[1].detail).toContain('Entry 1 should be text');
    expect(strings[2].detail).toContain('Entry 2 should be text');
    expect(parts.find((p) => p.token === '[')!.detail).toContain('pair of text values');
  });

  it('keeps the same type pieces available for an unfinished opening line and at the end of the file', () => {
    const code = 'const glossary: Record<string, [string, string]> = {';
    for (let offset = 0; offset <= code.length; offset++) {
      const snippet = checkRanges(code, offset);
      expect(snippet.parts.map((p) => p.token)).toContain('Record');
      expect(snippet.explanation).toContain('incomplete');
    }
  });

  it.each(examples)('keeps valid source ranges and explanations at every position: %s', (code) => {
    const prefix = '// The declaration is not at the start of the file.\n';
    for (let offset = prefix.length; offset <= prefix.length + code.length; offset++)
      checkRanges(prefix + code, offset);
  });

  it.each(examples)(
    'does not throw or lose progress while this declaration is being typed: %s',
    (code) => {
      for (let end = 1; end <= code.length; end++) {
        const partial = code.slice(0, end);
        checkRanges(partial, 0);
        checkRanges(partial, end);
      }
    },
  );

  it('handles a declaration keyword before its name exists', () => {
    for (const code of ['const', 'const ', 'var', 'var '])
      expect(inspect(code, 0).explanation).toContain('declaration needs a name');
  });
});
