import { expect, it } from 'vitest';
import { assertPreviewCurrent, trackRange, validateReplacement } from '../src/edit';

it('requires a matching preview, replacement and workspace revision', () => {
  const preview = { replacement: 'const x = 2;', revision: 3 };
  expect(() => assertPreviewCurrent(preview, preview.replacement, 3)).not.toThrow();
  expect(() => assertPreviewCurrent(undefined, preview.replacement, 3)).toThrow('See what changes');
  expect(() => assertPreviewCurrent(preview, 'const x = 9;', 3)).toThrow('See what changes');
  expect(() => assertPreviewCurrent(preview, preview.replacement, 4)).toThrow('See what changes');
});

it('tracks edits before, inside, across, and after the selected region', () => {
  const range = { start: 10, end: 20 };
  const change = (rangeOffset: number, rangeLength: number, text: string) => ({
    rangeOffset,
    rangeLength,
    text,
  });
  expect(trackRange(range, [change(0, 0, 'abc')])).toEqual({ start: 13, end: 23 });
  expect(trackRange(range, [change(12, 3, 'a')])).toEqual({ start: 10, end: 18 });
  expect(trackRange(range, [change(25, 0, 'abc')])).toEqual(range);
  expect(trackRange(range, [change(5, 20, 'new')])).toEqual({ start: 5, end: 8 });
  expect(trackRange(range, [change(10, 10, '')])).toEqual({ start: 10, end: 10 });
  expect(trackRange({ start: 10, end: 10 }, [change(10, 0, 'new')])).toEqual({
    start: 10,
    end: 13,
  });
  expect(trackRange(range, [change(0, 0, 'abc'), change(12, 2, '')])).toEqual({
    start: 13,
    end: 21,
  });
});
it('permits explicit deletion but rejects unchanged, oversized and malformed edits', () => {
  expect(validateReplacement('', 'const x = 1;')).toBe('');
  expect(() => validateReplacement('same', 'same')).toThrow('Change');
  expect(() => validateReplacement('x'.repeat(12001), 'old')).toThrow('12,000');
  expect(() => validateReplacement({ code: 'new' }, 'old')).toThrow();
});
