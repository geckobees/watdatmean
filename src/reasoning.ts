import type { LearningRequest } from './types';
import { literalLesson } from './literal-lesson';

// Fully understood literal snippets use a reviewed local walkthrough in generate().
// Other explanations keep reasoning; code length alone never decides complexity.
export function reasoningEffort(request: LearningRequest): 'none' | 'low' {
  return request.task === 'example' || literalLesson(request) ? 'none' : 'low';
}
