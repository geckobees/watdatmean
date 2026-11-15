import type { Lesson } from './types';

export const conceptTerm = (term: string) =>
  term
    .normalize('NFKC')
    .trim()
    .replace(/^`([^`]+)`$/, '$1')
    .trim()
    .replace(/\s+/g, ' ');
export function uniqueConcepts(concepts: Lesson['concepts']): Lesson['concepts'] {
  const unique = new Map<string, Lesson['concepts'][number]>();
  for (const concept of concepts) {
    const term = conceptTerm(concept.term),
      key = term.toLowerCase();
    if (!key) continue;
    const previous = unique.get(key);
    if (!previous) unique.set(key, { ...concept, term });
    else if (!previous.explanation.trim() && concept.explanation.trim())
      unique.set(key, { ...previous, explanation: concept.explanation });
  }
  return [...unique.values()];
}
