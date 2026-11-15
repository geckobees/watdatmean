import { retrieve, summaryPayload } from './fixtures/web-fakes';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WebResearchService,
  parseResearch,
  publicWebUrl,
  researchModels,
  researchRequest,
  researchTopic,
  researchOptions,
} from '../src/web-research';
import { BridgeCore } from '../src/bridge/core';
import type { Provider } from '../src/types';

export const webSource = {
  title: 'Java streams',
  url: 'https://docs.oracle.com/javase/8/docs/api/java/util/stream/Stream.html',
};
export function webPayload(provider: Provider) {
  const text =
    'A stream processes a sequence. Use it to total prices in a shop.\n```java\nint total = prices.stream().mapToInt(Integer::intValue).sum();\n```\nIllustrative example, not executed.';
  if (provider === 'groq')
    return {
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: text,
            executed_tools: [{ type: 'browser_search', search_results: { results: [webSource] } }],
          },
        },
      ],
      usage: { prompt_tokens: 400, completion_tokens: 100, total_tokens: 500 },
    };
  if (provider === 'openai')
    return {
      status: 'completed',
      output: [
        { type: 'web_search_call', status: 'completed', action: { sources: [webSource] } },
        {
          type: 'message',
          content: [
            { type: 'output_text', text, annotations: [{ type: 'url_citation', ...webSource }] },
          ],
        },
      ],
      usage: { input_tokens: 400, output_tokens: 100, total_tokens: 500 },
    };
  return {
    stop_reason: 'end_turn',
    content: [
      { type: 'server_tool_use', name: 'web_search' },
      { type: 'web_search_tool_result', content: [{ type: 'web_search_result', ...webSource }] },
      { type: 'text', text, citations: [{ type: 'web_search_result_location', ...webSource }] },
    ],
    usage: { input_tokens: 400, output_tokens: 100 },
  };
}
const signal = () => new AbortController().signal;
afterEach(() => vi.useRealTimers());
describe('optional web research', () => {
  it('recognizes real HTML books as well as PDF downloads without treating the requested filter as evidence', () => {
    const body = webPayload('groq') as any;
    body.choices[0].message.executed_tools[0].search_results.results = [
      { url: 'https://python.swaroopch.com/', title: 'Introduction · A Byte of Python' },
      {
        url: 'https://greenteapress.com/wp/think-python-3rd-edition/',
        title: 'Think Python – Green Tea Press',
      },
      { url: 'https://author.example.com/learn-python/', title: 'A free Python ebook' },
      {
        url: 'https://inventwithpython.com/',
        title: 'Invent with Python: Learn to program. For free.',
      },
      { url: 'https://root-11.github.io/intro-book-python/', title: 'Introduction' },
      { url: 'https://example.com/article', title: 'Python list comprehension' },
    ];
    expect(parseResearch('groq', 'free books', body).sources.map((s) => s.kind)).toEqual([
      'Book / PDF',
      'Book / PDF',
      'Book / PDF',
      'Book / PDF',
      'Book / PDF',
      'Website',
    ]);
  });
  it('keeps useful search titles when Groq opens the same page and excludes its search wrapper', () => {
    const body = webPayload('groq') as any;
    body.choices[0].message.executed_tools.push({
      type: 'browser.open',
      search_results: {
        results: [
          { ...webSource, title: 'docs.oracle.com - viewing lines [0 - 2388] of 2388' },
          { url: 'https://exa.ai/search?q=Java', title: 'Java search' },
          { url: 'https://exa.ai/docs/reference/search', title: 'Actual Exa API docs' },
        ],
      },
    });
    const result = parseResearch('groq', 'Java streams', body);
    expect(result.sources).toEqual([
      { ...webSource, kind: 'Documentation' },
      {
        url: 'https://exa.ai/docs/reference/search',
        title: 'Actual Exa API docs',
        kind: 'Documentation',
      },
    ]);
  });
  it('keeps Java contracts and Java 8 constraints in the bounded summary prompt', () => {
    const request = researchRequest('groq', 'key', 'collecting a stream into a list', 'beginner', {
      version: 'Java 8',
      filter: 'docs',
    });
    const body = JSON.parse(request.body);
    expect(body.messages[0].content).toContain('NO guarantees about list type, mutability');
    expect(body.messages[0].content).toContain('Stream.toList() (16+)');
    expect(body.messages[0].content).toContain('no var, List.of, Path.of or Stream.toList');
    expect(researchRequest('groq', 'key', 'Python lists', 'beginner').body).not.toContain(
      'Collectors.toList',
    );
  });
  it.each<Provider>(['groq', 'openai', 'anthropic'])(
    'bounds a plain summary without search tools: %s',
    (provider) => {
      const config = researchRequest(
        provider,
        'fixture-private-key-123',
        'Java streams',
        'beginner',
      );
      const body = JSON.parse(config.body);
      expect(body.model).toBe(researchModels[provider]);
      expect(body.tools).toBeUndefined();
      expect(body.tool_choice).toBeUndefined();
      expect(config.body).not.toContain('fixture-private-key-123');
      expect(config.inputBytes).toBeLessThanOrEqual(3500);
      expect(body.max_tokens ?? body.max_output_tokens ?? body.max_completion_tokens).toBe(900);
      expect(config.body).toContain('sixth grader');
      expect(config.body).toContain('Never invent links');
      if (provider === 'groq')
        expect(body).toMatchObject({ reasoning_effort: 'low', include_reasoning: false });
    },
  );
  it.each<Provider>(['groq', 'openai', 'anthropic'])(
    'retains provider source metadata and usage: %s',
    (provider) => {
      const result = parseResearch(provider, 'Java streams', webPayload(provider));
      expect(result.sources).toEqual([{ ...webSource, kind: 'Documentation' }]);
      expect(result.blocks[0].text).toContain('prices.stream()');
      expect(result.usage?.total).toBe(500);
      expect(result.searches).toBe(1);
    },
  );
  it.each([
    'javascript:alert(1)',
    'command:run',
    'file:///C:/secret',
    'data:text/html,evil',
    'https://localhost/x',
    'http://127.0.0.1/a',
    'http://0x7f000001/a',
    'http://[::1]/',
    'https://user:pw@example.com',
    'https://docs.example.com:444/x',
    'https://box.internal/x',
    'https://docs.example.com\n/',
    'https://docs.example.com./',
  ])('rejects unsafe source destinations: %s', (url) => expect(publicWebUrl(url)).toBeUndefined());
  it('allows normal public docs, videos and author PDFs', () => {
    for (const url of [
      webSource.url,
      'https://www.youtube.com/watch?v=abcdef',
      'https://author.example.com/book.pdf',
      'https://github.com/example/tutorial',
    ])
      expect(publicWebUrl(url)).toBe(url);
  });
  it('rejects model-invented URLs and uncompleted searches', () => {
    expect(() =>
      parseResearch('groq', 'test', {
        choices: [
          { finish_reason: 'stop', message: { content: 'See https://invented.example.com' } },
        ],
      }),
    ).toThrow('no verifiable');
    expect(() => parseResearch('openai', 'test', { status: 'incomplete' })).toThrow(
      'did not finish',
    );
    expect(() => parseResearch('anthropic', 'test', { stop_reason: 'pause_turn' })).toThrow(
      'did not finish',
    );
    const body = webPayload('groq') as any;
    body.choices[0].message.executed_tools[0].search_results.results = [{ url: 'file:///secret' }];
    expect(() => parseResearch('groq', 'test', body)).toThrow('no verifiable');
  });
  it('deduplicates retrieved pages and prioritizes actual citations when results overflow', () => {
    const body = webPayload('openai') as any;
    body.output[0].action.sources = Array.from({ length: 30 }, (_, i) => ({
      url: `https://example.com/${i}`,
      title: 'Other',
    }));
    const result = parseResearch('openai', 'test', body);
    expect(result.sources).toHaveLength(12);
    expect(result.sources[0].url).toBe(webSource.url);
    expect(result.blocks[0].sourceUrls).toEqual([webSource.url]);
  });
  it('preserves valid inline citation positions and rejects invalid offsets', () => {
    const body = webPayload('openai') as any;
    const part = body.output[1].content[0];
    part.annotations[0].start_index = 0;
    part.annotations[0].end_index = 20;
    part.annotations.push({ ...part.annotations[0], end_index: 900000 });
    const result = parseResearch('openai', 'Java', body);
    expect(result.blocks[0].citations).toEqual([{ end: 20, url: webSource.url }]);
    expect(result.blocks[0].text).toBe(part.text);
  });
  it('caches repeated queries for 24 hours, reports zero new requests, and can clear the cache', async () => {
    const transport = vi.fn(async () => new Response(JSON.stringify(summaryPayload('groq'))));
    const service = new WebResearchService(transport, retrieve);
    await service.search('groq', 'key', 'Java streams', 'beginner', signal());
    expect((await service.search('groq', 'key', 'Java streams', 'beginner', signal())).cached).toBe(
      true,
    );
    expect(transport).toHaveBeenCalledTimes(1);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 25 * 60 * 60 * 1000);
    await service.search('groq', 'key', 'Java streams', 'beginner', signal());
    expect(transport).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
    service.clear();
    await service.search('groq', 'key', 'Java streams', 'beginner', signal());
    expect(transport).toHaveBeenCalledTimes(3);
  });
  it('does not retry rate limits, disclose raw errors, or follow redirects', async () => {
    const transport = vi.fn(async () => new Response('secret raw body', { status: 429 }));
    const service = new WebResearchService(transport, retrieve);
    await expect(service.search('groq', 'key', 'Java', 'beginner', signal())).rejects.toThrow(
      'provider limit',
    );
    expect(transport).toHaveBeenCalledTimes(1);
    expect((transport.mock.calls[0] as any)[1].redirect).toBe('error');
  });
  it('distinguishes a temporary server failure from account access without retrying or exposing its body', async () => {
    const transport = vi.fn(async () => new Response('secret internal error', { status: 500 }));
    await expect(
      new WebResearchService(transport, retrieve).search(
        'groq',
        'key',
        'Java',
        'beginner',
        signal(),
      ),
    ).rejects.toThrow('temporarily unavailable');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('bounds response bytes and does not silently truncate a long supplement', async () => {
    const service = new WebResearchService(async () => new Response('x'.repeat(64001)), retrieve);
    await expect(service.search('groq', 'key', 'Java', 'beginner', signal())).rejects.toThrow(
      'size limit',
    );
    const body = webPayload('groq') as any;
    body.choices[0].message.content = 'x'.repeat(12001);
    expect(() => parseResearch('groq', 'Java', body)).toThrow('did not finish');
  });
  it('guards the native bridge when off and sends only the explicit topic when on', async () => {
    const transport = vi.fn(async () => new Response(JSON.stringify(summaryPayload('groq'))));
    const bridge = new BridgeCore(transport, retrieve);
    const params = {
      provider: 'groq',
      key: 'key',
      topic: 'Java streams',
      audience: 'beginner',
      code: 'PRIVATE_PROJECT_SECRET',
      context: 'PRIVATE_FILE',
    };
    await expect(bridge.dispatch(1, 'research', params)).rejects.toThrow('Turn on');
    expect(transport).not.toHaveBeenCalled();
    await bridge.dispatch(2, 'research', { ...params, enabled: true });
    const sent = JSON.stringify(transport.mock.calls[0]);
    expect(sent).not.toContain('PRIVATE_');
    expect(sent).toContain('Java streams');
  });
  it.each(['incomplete', 'contract'])(
    'passes %s recovery through the native bridge with its version, filter and usage',
    async (reason) => {
      const payload = summaryPayload('groq') as any;
      if (reason === 'incomplete') payload.choices[0].finish_reason = 'length';
      else
        payload.choices[0].message.content = JSON.stringify({
          ...JSON.parse(payload.choices[0].message.content),
          text: 'Collectors.toList() returns a mutable list.',
        });
      const transport = vi.fn(async () => Response.json(payload));
      const bridge = new BridgeCore(transport, retrieve);
      const options = { version: 'Java 8', filter: 'docs' };
      const params = {
        provider: 'groq',
        key: 'key',
        enabled: true,
        topic: 'Java streams',
        audience: 'beginner',
        options,
      };
      const result = await bridge.dispatch(1, 'research', params);
      expect(result).toMatchObject({
        summaryUnavailable: reason,
        blocks: [],
        options,
        usage: { total: 600 },
      });
      expect((result as any).sources[0].url).toBe(webSource.url);
      expect(await bridge.dispatch(2, 'research', params)).toMatchObject({ cached: true });
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it('cancels a native bridge search without caching a late response', async () => {
    let finish!: (r: Response) => void;
    const transport = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const bridge = new BridgeCore(transport, retrieve);
    const params = {
      provider: 'groq',
      key: 'key',
      enabled: true,
      topic: 'Java',
      audience: 'beginner',
    };
    const pending = bridge.dispatch(1, 'research', params);
    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
    bridge.cancel();
    finish(new Response(JSON.stringify(summaryPayload('groq'))));
    await expect(pending).rejects.toThrow('cancelled');
    transport.mockImplementation(async () => new Response(JSON.stringify(summaryPayload('groq'))));
    await bridge.dispatch(2, 'research', params);
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it('accepts concise topics and rejects code blocks and empty/oversized input', () => {
    expect(researchTopic(' Java   streams ')).toBe('Java streams');
    for (const value of ['', '  ', 'x'.repeat(201), 'class X {\n}', 'Java\u0000'])
      expect(() => researchTopic(value)).toThrow('short public search topic');
  });
});
