import type { Provider, TokenUsage } from './types';

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function sum(...values: (number | undefined)[]): number | undefined {
  if (values.some((value) => value === undefined)) return undefined;
  return count((values as number[]).reduce((total, value) => total + value, 0));
}

// Read only the API envelope, never token counts written by the model in a lesson.
export function readUsage(provider: Provider, value: unknown): TokenUsage | undefined {
  const usage = object(value);
  const inputDetails = object(usage.input_tokens_details ?? usage.prompt_tokens_details);
  const outputDetails = object(usage.output_tokens_details ?? usage.completion_tokens_details);
  const cachedInputTokens = count(
    provider === 'anthropic' ? usage.cache_read_input_tokens : inputDetails.cached_tokens,
  );
  const cacheWriteTokens = count(
    provider === 'anthropic' ? usage.cache_creation_input_tokens : inputDetails.cache_write_tokens,
  );
  const inputTokens =
    provider === 'anthropic'
      ? sum(
          count(usage.input_tokens),
          count(usage.cache_read_input_tokens ?? 0),
          count(usage.cache_creation_input_tokens ?? 0),
        )
      : count(provider === 'groq' ? usage.prompt_tokens : usage.input_tokens);
  const outputTokens = count(provider === 'groq' ? usage.completion_tokens : usage.output_tokens);
  const totalTokens = count(usage.total_tokens) ?? sum(inputTokens, outputTokens);
  const reasoningTokens = count(outputDetails.reasoning_tokens);
  const result: TokenUsage = { inputTokens, outputTokens, totalTokens };
  // Cache and reasoning counters are subsets, never additional tokens in the total.
  if (
    cachedInputTokens !== undefined &&
    inputTokens !== undefined &&
    cachedInputTokens <= inputTokens
  )
    result.cachedInputTokens = cachedInputTokens;
  if (
    cacheWriteTokens !== undefined &&
    inputTokens !== undefined &&
    cacheWriteTokens <= inputTokens
  )
    result.cacheWriteTokens = cacheWriteTokens;
  if (
    reasoningTokens !== undefined &&
    outputTokens !== undefined &&
    reasoningTokens <= outputTokens
  )
    result.reasoningTokens = reasoningTokens;
  return Object.values(result).some((value) => value !== undefined) ? result : undefined;
}
