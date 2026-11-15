import type { LearningRequest } from './types';

export type SourceText = string | { ref: string } | (string | { ref: string })[];

/** Encode exact repeated source only. The original request still feeds local analysis, cache
 * keys and editor links. No whitespace, comments, unique text or location metadata is removed. */
export function compactContext(request: LearningRequest) {
  const sources = new Map<string, string>([['code', request.code]]);
  let referenced = false;
  function encode(text: string, path: string): SourceText {
    const candidates = [...sources].filter(([, value]) => value.length >= 80);
    const parts: (string | { ref: string })[] = [];
    let position = 0;
    while (position < text.length) {
      let best: { start: number; path: string; text: string } | undefined;
      for (const [sourcePath, value] of candidates) {
        const start = text.indexOf(value, position);
        if (
          start >= 0 &&
          (!best || start < best.start || (start === best.start && value.length > best.text.length))
        )
          best = { start, path: sourcePath, text: value };
      }
      if (!best) {
        parts.push(text.slice(position));
        break;
      }
      if (position < best.start) parts.push(text.slice(position, best.start));
      parts.push({ ref: best.path });
      position = best.start + best.text.length;
    }
    sources.set(path, text);
    const encoded = parts.length === 1 ? parts[0] : parts;
    if (
      parts.some((part) => typeof part !== 'string') &&
      JSON.stringify(encoded).length + 32 < JSON.stringify(text).length
    ) {
      referenced = true;
      return encoded;
    }
    return text;
  }
  const { context, evidence, learningContext, ...rest } = request;
  const input = {
    ...rest,
    ...(context === undefined ? {} : { context: encode(context, 'context') }),
    ...(evidence === undefined
      ? {}
      : {
          evidence: evidence.map((entry, index) => ({
            ...entry,
            code: encode(entry.code, `evidence[${index}].code`),
          })),
        }),
    ...(learningContext === undefined
      ? {}
      : { learningContext: encode(learningContext, 'learningContext') }),
  };
  return { input, referenced };
}
