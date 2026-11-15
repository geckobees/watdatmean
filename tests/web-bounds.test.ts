import { describe, it, expect, vi } from 'vitest';
import {
  WebResearchService,
  researchRequest,
  researchLimits,
  parseSummary,
} from '../src/web-research';
import {
  byteSlice,
  parseSearch,
  parseRss,
  referenceExcerpt,
  referenceUrl,
  readBounded,
  retrieveSources,
  searchQuery,
  officialScope,
  retrievalLimits,
  relevantSources,
} from '../src/web-retrieval';
import { retrieved, retrieve, summaryPayload } from './fixtures/web-fakes';
const options = { version: 'Java 17', filter: 'docs' as const };
const signal = () => new AbortController().signal;
const hit = (
  url: string,
  title = 'Collectors',
  snippet = 'Collect elements from a stream into a list.',
) =>
  `<div class="result"><h2><a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(url)}&amp;rut=ignored">${title}</a></h2><a class="result__snippet">${snippet}</a></div>`;
const oracle =
  'https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/stream/Collectors.html';
describe('bounded web retrieval and summaries', () => {
  it('does not display a cut-off sentence just because the provider reports a completed JSON response', () => {
    const body = summaryPayload('groq') as any;
    const data = JSON.parse(body.choices[0].message.content);
    data.text = 'This means you cannot add, remove, or re';
    body.choices[0].message.content = JSON.stringify(data);
    expect(() => parseSummary('groq', 'Java', body, retrieved.sources)).toThrow(
      'incomplete content',
    );
  });
  it('reports a provider formatting limit without blaming the key or automatically retrying', async () => {
    const ai = vi.fn(async () =>
      Response.json(
        { error: { code: 'json_validate_failed', message: 'secret raw provider text' } },
        { status: 400 },
      ),
    );
    const service = new WebResearchService(ai, retrieve);
    await expect(service.search('groq', 'key', 'Java', 'beginner', signal())).rejects.toThrow(
      'valid JSON within the response budget',
    );
    expect(ai).toHaveBeenCalledTimes(1);
  });
  it('rejects irrelevant pages and absent editions before spending AI tokens', async () => {
    expect(() =>
      relevantSources(
        [
          {
            ...retrieved.sources[0],
            title: 'Download Java',
            excerpt: 'Get the Java runtime',
            url: 'https://www.java.com/',
            versionMatch: 'unknown',
          },
        ],
        'Java streams',
        options,
      ),
    ).toThrow('no relevant');
    expect(() =>
      relevantSources(
        [{ ...retrieved.sources[0], versionMatch: 'unknown' }],
        'Java streams',
        options,
      ),
    ).toThrow('target edition');
    expect(() =>
      relevantSources(retrieved.sources, 'Java streams', { version: 'Java 8', filter: 'videos' }),
    ).toThrow('requested type');
    const ai = vi.fn();
    const transport = vi.fn(
      async () =>
        new Response(
          '<rss><channel><item><title>Download Java</title><link>https://www.java.com/</link><description>Install Java</description></item></channel></rss>',
          { headers: { 'content-type': 'text/xml' } },
        ),
    );
    const service = new WebResearchService(ai, (t, o, s) => retrieveSources(t, o, s, transport));
    await expect(
      service.search('groq', 'key', 'Java streams', 'beginner', signal(), options),
    ).rejects.toThrow('No AI request');
    expect(ai).not.toHaveBeenCalled();
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it('decodes RSS text without resolving entities or trusting fabricated source links', () => {
    const xml =
      '<rss><channel><item><title>Java &amp; streams</title><link>' +
      oracle +
      '</link><description><![CDATA[Collect <b>items</b> into a list.]]></description></item><item><title>Unsafe</title><link>file:///secret</link></item></channel></rss>';
    expect(parseRss(xml, options)[0]).toMatchObject({
      title: 'Java & streams',
      url: oracle,
      excerpt: 'Collect items into a list.',
      versionMatch: 'matched document edition',
    });
    expect(() => parseRss('<!DOCTYPE rss SYSTEM "file:///secret">' + xml, options)).toThrow(
      'unsupported',
    );
    expect(() => parseRss('x'.repeat(retrievalLimits.searchBytes + 1), options)).toThrow(
      'size limit',
    );
  });
  it('uses one independent public fallback after unavailable RSS, without forwarding credentials', async () => {
    const transport = vi.fn(
      async () =>
        new Response(hit('https://github.com/example/code', 'Examples'), {
          headers: { 'content-type': 'text/html' },
        }),
    );
    transport.mockResolvedValueOnce(new Response('Unavailable', { status: 503 }));
    const result = await retrieveSources(
      'TypeScript',
      { version: 'TypeScript 5.9', filter: 'code' },
      signal(),
      transport,
    );
    expect(result).toMatchObject({ provider: 'DuckDuckGo', requests: 2 });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(result.sources[0].kind).toBe('Source code');
  });
  it('fetches a reference only once when multiple result anchors point to the same page', async () => {
    const transport = vi.fn(
      async () =>
        new Response(
          '<p>Collectors collect stream elements into a list with documented contracts about mutability.</p>',
          { headers: { 'content-type': 'text/html' } },
        ),
    );
    transport.mockResolvedValueOnce(
      new Response(
        '<rss><channel>' +
          [oracle + '#toList()', oracle + '#toSet()']
            .map(
              (url) =>
                '<item><title>Collectors</title><link>' +
                url +
                '</link><description>Collect stream elements into a list</description></item>',
            )
            .join('') +
          '</channel></rss>',
        { headers: { 'content-type': 'text/xml' } },
      ),
    );
    const result = await retrieveSources('Collectors list', options, signal(), transport);
    expect(result.requests).toBe(2);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(result.sources[0].evidence).toBe('reference excerpt');
    expect((transport.mock.calls as unknown as [string, RequestInit][])[1][0]).toBe(oracle);
  });
  it('keeps actual decoded source URLs, rejects unsafe destinations, duplicates and wrong editions', () => {
    const result = parseSearch(
      hit(oracle) +
        hit(oracle) +
        hit('file:///private') +
        hit('https://localhost/secret') +
        hit(oracle.replace('/17/', '/21/')) +
        hit('https://example.com/article'),
      options,
    );
    expect(result.map((s) => s.url)).toEqual([oracle, 'https://example.com/article']);
    expect(result[0]).toMatchObject({
      versionMatch: 'matched document edition',
      evidence: 'search snippet',
    });
    expect(result[1].versionMatch).toBe('unknown');
  });
  it.each([
    ['videos', 'https://www.youtube.com/watch?v=real', 'A video', 'Video'],
    ['code', 'https://github.com/example/guide', 'Guide', 'Source code'],
    ['books', 'https://python.swaroopch.com/', 'A Byte of Python', 'Book / PDF'],
  ] as const)(
    'keeps the %s category from the destination, not the query',
    (filter, url, title, kind) => {
      const sources = parseSearch(hit('https://example.com/article') + hit(url, title), {
        version: 'Python 3.11',
        filter,
      });
      expect(sources[0]).toMatchObject({ url, kind, versionMatch: 'unknown' });
      expect(sources[1].kind).toBe('Website');
    },
  );
  it('uses exact known editions without pretending a version range is a fixed release', () => {
    for (const v of [8, 9, 10, 17, 21])
      expect(officialScope(`Java ${v}`)).toBe(
        `docs.oracle.com/${v <= 10 ? 'javase/' : 'en/java/javase/'}${v}/docs/api/`,
      );
    expect(searchQuery('Lists', { version: 'Python 3.11', filter: 'docs' })).toContain(
      'site:docs.python.org',
    );
    expect(
      searchQuery('streams !g site:evil.example', { version: 'Java >=17', filter: 'docs' }),
    ).not.toMatch(/!g|site:/);
  });
  it('extracts focused contract text, never executes scripts, and restricts automatic page fetches', () => {
    const html =
      '<script>steal secrets</script><p>Unrelated reference introduction.</p><section class="detail" id="toList()"><h3>toList</h3><p>Collects items into a List. There are no guarantees about mutability or thread safety.</p></section>';
    expect(referenceExcerpt(html, 'Collectors.toList()')).toContain(
      'no guarantees about mutability',
    );
    expect(referenceExcerpt(html, 'Collectors.toList()')).not.toContain('steal secrets');
    for (const url of [
      'https://evil.example/',
      'http://docs.oracle.com/',
      'https://docs.oracle.com:444/',
      'https://user@docs.oracle.com/',
      'https://docs.oracle.com/guide.pdf',
    ])
      expect(referenceUrl({ url, title: 'Docs', kind: 'Documentation' })).toBeUndefined();
  });
  it('caps retrieval requests and bytes, sends no AI key to search, and preserves snippets after a page failure', async () => {
    const transport = vi.fn(async () => new Response('blocked', { status: 503 }));
    transport.mockResolvedValueOnce(
      new Response(
        '<rss><channel>' +
          [
            oracle,
            oracle.replace('Collectors', 'Stream'),
            oracle.replace('Collectors', 'Collector'),
          ]
            .map(
              (url) =>
                '<item><title>Reference</title><link>' +
                url +
                '</link><description>Collect values from a stream</description></item>',
            )
            .join('') +
          '</channel></rss>',
        { headers: { 'content-type': 'text/xml' } },
      ),
    );
    const result = await retrieveSources('Collectors', options, signal(), transport);
    expect(result.requests).toBe(3);
    expect(transport).toHaveBeenCalledTimes(3);
    expect(result.sources.every((s) => s.evidence === 'search snippet')).toBe(true);
    for (const [, init] of transport.mock.calls as unknown as [string, RequestInit][]) {
      expect(init.redirect).toBe('error');
      expect(Object.keys(init.headers!)).toEqual(['Accept']);
    }
    await expect(readBounded(new Response('x'.repeat(33)), 32)).rejects.toThrow('size limit');
    expect(() => parseSearch('x'.repeat(retrievalLimits.searchBytes + 1), options)).toThrow(
      'size limit',
    );
  });
  it('sends no AI request for empty search results, browser checks, or cancelled retrieval', async () => {
    const ai = vi.fn();
    const fetcher = vi.fn(
      async () =>
        new Response('<html>Browser check</html>', { headers: { 'content-type': 'text/html' } }),
    );
    const service = new WebResearchService(ai, (t, o, s) => retrieveSources(t, o, s, fetcher));
    await expect(
      service.search('groq', 'key', 'Java', 'beginner', signal(), options),
    ).rejects.toThrow('No AI request');
    expect(ai).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(2);
    const controller = new AbortController();
    const cancelled = new WebResearchService(ai, async () => {
      controller.abort();
      return retrieved;
    });
    await expect(
      cancelled.search('groq', 'key', 'Java', 'beginner', controller.signal),
    ).rejects.toThrow('cancelled');
    expect(ai).not.toHaveBeenCalled();
  });
  it.each(['groq', 'openai', 'anthropic'] as const)(
    'enforces actual UTF-8 input bytes and output limits even with giant Unicode evidence: %s',
    (provider) => {
      const sources = Array.from({ length: 5 }, (_, i) => ({
        ...retrieved.sources[0],
        title: 'title ' + i,
        excerpt: '🐍漢字\\"\n'.repeat(9000),
      }));
      const request = researchRequest(
        provider,
        'secret',
        'Collections',
        'beginner',
        options,
        sources,
      );
      const body = JSON.parse(request.body);
      const texts =
        provider === 'openai'
          ? body.instructions + body.input
          : provider === 'anthropic'
            ? body.system + body.messages[0].content
            : body.messages.map((m: any) => m.content).join('');
      expect(
        Buffer.byteLength(
          texts + (provider === 'groq' ? JSON.stringify(body.response_format) : ''),
        ),
      ).toBe(request.inputBytes);
      expect(request.inputBytes).toBeLessThanOrEqual(researchLimits.inputBytes);
      expect(body.tools).toBeUndefined();
      expect(body.max_tokens ?? body.max_output_tokens ?? body.max_completion_tokens).toBe(900);
      expect(byteSlice('a🐍b', 4)).toBe('a');
      expect(byteSlice('a🐍b', 5)).toBe('a🐍');
      expect(request.body).not.toContain('secret');
    },
  );
  it.each(['groq', 'openai', 'anthropic'] as const)(
    'maps plain summary IDs to real sources and usage: %s',
    (provider) => {
      const parsed = parseSummary(provider, 'Java', summaryPayload(provider), retrieved.sources);
      expect(parsed.usage?.total).toBe(600);
      expect(parsed.blocks[0].sourceUrls).toEqual([retrieved.sources[0].url]);
    },
  );
  it('rejects invented IDs, tool calls, truncated responses and malformed JSON without retries', async () => {
    for (const message of [
      { content: 'not json' },
      { content: JSON.stringify({ text: 'Claims', sources: [55] }) },
      {
        content: JSON.stringify({ text: 'Claims', sources: [1] }),
        tool_calls: [{ id: 'browser' }],
      },
    ]) {
      const ai = vi.fn(async () =>
        Response.json({ choices: [{ finish_reason: 'stop', message }] }),
      );
      await expect(
        new WebResearchService(ai, retrieve).search('groq', 'key', 'Java', 'beginner', signal()),
      ).rejects.toThrow('No automatic retry');
      expect(ai).toHaveBeenCalledTimes(1);
    }
    const body = summaryPayload('groq') as any;
    body.choices[0].finish_reason = 'length';
    expect(() => parseSummary('groq', 'Java', body, retrieved.sources)).toThrow('within its limit');
  });
  it('prevents overlapping paid requests and reuses the finished result', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const ai = vi.fn(async () => {
      await gate;
      return Response.json(summaryPayload());
    });
    const service = new WebResearchService(ai, retrieve);
    const pending = service.search('groq', 'key', 'Java', 'beginner', signal());
    await vi.waitFor(() => expect(ai).toHaveBeenCalledTimes(1));
    await expect(service.search('groq', 'key', 'Java', 'beginner', signal())).rejects.toThrow(
      'already running',
    );
    finish();
    const result = await pending;
    expect(result.budget).toMatchObject({
      maxInputBytes: 3500,
      maxOutputTokens: 900,
      aiRequests: 1,
    });
    expect((await service.search('groq', 'key', 'Java', 'beginner', signal())).cached).toBe(true);
    expect(ai).toHaveBeenCalledTimes(1);
  });
});
