import { expect, it } from 'vitest';
import { assertPreviewCurrent, validateReplacement } from '../src/edit';

it('requires a matching preview, replacement and workspace revision', () => {
  const preview = { replacement: 'const x = 2;', revision: 3 };
  expect(() => assertPreviewCurrent(preview, preview.replacement, 3)).not.toThrow();
  expect(() => assertPreviewCurrent(undefined, preview.replacement, 3)).toThrow('Preview');
  expect(() => assertPreviewCurrent(preview, 'const x = 9;', 3)).toThrow('Preview');
  expect(() => assertPreviewCurrent(preview, preview.replacement, 4)).toThrow('Preview');
});
it('permits explicit deletion but rejects unchanged, oversized and malformed edits', () => {
  expect(validateReplacement('', 'const x = 1;')).toBe('');
  expect(() => validateReplacement('same', 'same')).toThrow('Change');
  expect(() => validateReplacement('x'.repeat(12001), 'old')).toThrow('12,000');
  expect(() => validateReplacement({ code: 'new' }, 'old')).toThrow();
});
