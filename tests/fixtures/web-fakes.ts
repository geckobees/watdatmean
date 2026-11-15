import type { Provider } from '../../src/types';
import type { retrieveSources } from '../../src/web-retrieval';
export const retrieved: Awaited<ReturnType<typeof retrieveSources>> = {
  requests: 1,
  provider: 'Bing',
  sources: [
    {
      url: 'https://docs.oracle.com/javase/8/docs/api/java/util/stream/Stream.html',
      title: 'Java streams',
      kind: 'Documentation',
      excerpt:
        'A stream processes a sequence of elements with intermediate and terminal operations.',
      versionMatch: 'matched document edition',
      evidence: 'search snippet',
    },
  ],
};
export const retrieve: typeof retrieveSources = async () => structuredClone(retrieved);
export function summaryPayload(provider: Provider = 'groq') {
  const text = JSON.stringify({
    text: 'A stream processes items. Use it to total orders. Example is illustrative.',
    code: 'int total = prices.stream().mapToInt(Integer::intValue).sum();',
    language: 'java',
    application: 'Use this to total prices in a shop; the price list must already exist.',
    sources: [1],
  });
  const usage = {
    prompt_tokens: 500,
    completion_tokens: 100,
    total_tokens: 600,
    input_tokens: 500,
    output_tokens: 100,
  };
  return provider === 'groq'
    ? { choices: [{ finish_reason: 'stop', message: { content: text } }], usage }
    : provider === 'openai'
      ? {
          status: 'completed',
          output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
          usage,
        }
      : { stop_reason: 'end_turn', content: [{ type: 'text', text }], usage };
}
