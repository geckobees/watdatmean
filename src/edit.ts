export interface EditPreview {
  replacement: string;
  revision: number;
}

export function validateReplacement(value: unknown, original: string): string {
  if (typeof value !== 'string' || value.length > 12000)
    throw new Error('Keep your replacement under 12,000 characters.');
  if (value === original)
    throw new Error('Change the replacement code before previewing its impact.');
  return value;
}

export function assertPreviewCurrent(
  preview: EditPreview | undefined,
  replacement: string,
  revision: number,
): asserts preview is EditPreview {
  if (!preview || preview.replacement !== replacement || preview.revision !== revision) {
    throw new Error('Preview this exact edit again before applying it.');
  }
}
