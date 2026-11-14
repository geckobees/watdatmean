export interface EditPreview {
  replacement: string;
  revision: number;
}

export interface OffsetRange {
  start: number;
  end: number;
}

// VS Code reports every change against the document before the event. Apply
// them from right to left so earlier offsets remain valid. Edits at either
// boundary stay in the selected region, including a region emptied by deletion.
export function trackRange(
  range: OffsetRange,
  changes: readonly { rangeOffset: number; rangeLength: number; text: string }[],
): OffsetRange {
  let { start, end } = range;
  for (const change of [...changes].sort((a, b) => b.rangeOffset - a.rangeOffset)) {
    const changeEnd = change.rangeOffset + change.rangeLength;
    const delta = change.text.length - change.rangeLength;
    if (changeEnd <= start && change.rangeOffset < start) {
      start += delta;
      end += delta;
    } else if (change.rangeOffset <= end) {
      start = Math.min(start, change.rangeOffset);
      end = Math.max(change.rangeOffset + change.text.length, end + delta);
    }
  }
  return { start, end };
}

export function validateReplacement(value: unknown, original: string): string {
  if (typeof value !== 'string' || value.length > 12000)
    throw new Error('Keep your replacement under 12,000 characters.');
  if (value === original)
    throw new Error('Change your version first, then choose “See what changes”.');
  return value;
}

export function assertPreviewCurrent(
  preview: EditPreview | undefined,
  replacement: string,
  revision: number,
): asserts preview is EditPreview {
  if (!preview || preview.replacement !== replacement || preview.revision !== revision) {
    throw new Error('Choose “See what changes” for this version before using it in your file.');
  }
}
