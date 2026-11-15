import { expect, it } from 'vitest';
import { SemanticPalette, semanticRanges, overlaySemantic } from '../src/semantic-colors';

it('uses language, modifier and subtype specificity per property, with later ties winning', () => {
  const palette = new SemanticPalette(
    [],
    [
      ['*', { foreground: '#111', italic: true }],
      ['variable', '#222222'],
      ['variable.readonly', { foreground: '#333333', italic: false }],
      ['variable.readonly:typescript', '#444444'],
      ['variable.readonly:typescript', '#555555'],
      ['custom', { bold: true }],
    ],
    [],
    new Map([['custom', 'variable']]),
  );
  expect(palette.resolve('variable', ['readonly'], 'typescript')).toEqual({
    color: '#555555',
    italic: false,
  });
  expect(palette.resolve('custom', [], 'typescript')).toEqual({
    color: '#222222',
    italic: true,
    bold: true,
  });
  expect(palette.resolve('variable', ['readonly'], 'python').color).toBe('#333333');
});
it('uses scoped TextMate fallback including exclusions and language contributions', () => {
  const palette = new SemanticPalette(
    [
      { scope: 'variable - variable.other.constant', settings: { foreground: '#112233' } },
      { scope: 'variable.other.constant', settings: { foreground: '#445566', fontStyle: 'bold' } },
      { scope: 'source.ts entity.name.function', settings: { foreground: '#778899' } },
    ],
    [['variable.readonly', { bold: false }]],
    [
      {
        selector: 'method',
        language: 'typescript',
        scopes: [['source.ts', 'entity.name.function.ts']],
      },
    ],
  );
  expect(palette.resolve('variable', [], 'typescript').color).toBe('#112233');
  expect(palette.resolve('variable', ['readonly'], 'typescript')).toEqual({
    color: '#445566',
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
  });
  expect(palette.resolve('method', [], 'typescript').color).toBe('#778899');
  expect(palette.resolve('method', [], 'python')).toEqual({});
});
it('preserves more specific theme rules over less specific user rules and honors fontStyle resets', () => {
  const palette = new SemanticPalette(
    [],
    [
      ['variable.readonly', { foreground: '#abcdef', italic: true }],
      ['*', { foreground: '#112233', fontStyle: '', bold: true }],
    ],
  );
  expect(palette.resolve('variable', ['readonly'], 'typescript')).toEqual({
    color: '#ABCDEF',
    italic: true,
    bold: false,
    underline: false,
    strikethrough: false,
  });
});
it('does not let default foreground or unsafe values replace lexical colors', () => {
  const palette = new SemanticPalette(
    [{ settings: { foreground: '#112233' } }],
    [['class', 'red;display:none']],
  );
  expect(palette.resolve('class', [], 'typescript')).toEqual({});
});
it('decodes relative positions with UTF-16, CRLF and partial selections', () => {
  const text = '// 😀\r\nconst n = 2;\r\nn';
  const ranges = semanticRanges(text, new Uint32Array([1, 6, 1, 0, 1, 1, 0, 1, 0, 0]), {
    tokenTypes: ['variable'],
    tokenModifiers: ['declaration'],
  });
  expect(ranges).toEqual([
    {
      start: text.indexOf('n ='),
      end: text.indexOf('n =') + 1,
      type: 'variable',
      modifiers: ['declaration'],
    },
    { start: text.length - 1, end: text.length, type: 'variable', modifiers: [] },
  ]);
});
it.each([
  [0, 0, 1],
  [0, 0, 0, 0, 0],
  [0, 0, 99, 0, 0],
  [0, 0, 1, 8, 0],
  [9, 0, 1, 0, 0],
  [0, -1, 1, 0, 0],
  [0, 0, 3, 0, 0, 0, 2, 1, 0, 0],
])('rejects malformed, overlapping or out-of-document token batches: %j', (...data) => {
  expect(semanticRanges('name', data, { tokenTypes: ['variable'], tokenModifiers: [] })).toEqual(
    [],
  );
});
it('overlays only supplied semantic properties and keeps punctuation and exact clipped offsets', () => {
  const base = {
    runs: [
      [0, 3, 0],
      [3, 7, 1],
    ] as [number, number, number][],
    styles: [
      { color: '#aaaaaa', font: 3 },
      { color: '#bbbbbb', font: 1 },
    ],
  };
  const palette = new SemanticPalette([], [['variable', { foreground: '#123456', bold: false }]]);
  const result = overlaySemantic(
    base,
    [{ start: 12, end: 16, type: 'variable', modifiers: [] }],
    10,
    17,
    palette,
    'typescript',
  );
  const at = (offset: number) =>
    result.styles[result.runs.find(([a, b]) => a <= offset && b > offset)![2]];
  expect(at(0)).toEqual({ color: '#aaaaaa', font: 3 });
  expect(at(2)).toEqual({ color: '#123456', font: 1 });
  expect(at(6)).toEqual({ color: '#bbbbbb', font: 1 });
  expect(base.styles[0].font).toBe(3);
});
