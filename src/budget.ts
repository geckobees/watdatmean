import type { LearningRequest } from './types';
import { buildInstructions } from './prompts';

export const MAX_OUTPUT_TOKENS = 200;

export function prepareRequest(request: LearningRequest) {
  const system = buildInstructions(request);
  // Preserve the existing selection, nearby code, evidence metadata and replacement.
  // Only instructions and requested output are reduced; input is never budget-trimmed.
  return {
    system,
    input: JSON.stringify(request),
    evidenceIds: request.evidence?.map((entry) => entry.id) ?? [],
  };
}
