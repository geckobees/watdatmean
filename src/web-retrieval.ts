import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { publicWebUrl, sourceKind, type ResearchOptions, type WebSource } from './web-research';

export interface RetrievedSource extends WebSource {
  excerpt: string;
  evidence: 'search snippet' | 'reference excerpt';
  versionMatch: 'matched document edition' | 'unknown';
}
export const SEARCH_ENDPOINT = 'https://www.bing.com/search';
export const FALLBACK_ENDPOINT = 'https://html.duckduckgo.com/html/';
export const retrievalLimits = {
  searchBytes: 160_000,
  referenceBytes: 500_000,
  sources: 3,
  references: 2,
  searches: 2,
} as const;
type Node = DefaultTreeAdapterMap['node'];
const children = (node: Node): Node[] => ('childNodes' in node ? node.childNodes : []);
const attr = (node: Node, name: string) =>
  'attrs' in node ? node.attrs.find((a) => a.name === name)?.value || '' : '';
const hasClass = (node: Node, name: string) => attr(node, 'class').split(/\s+/).includes(name);
function walk(root: Node, max = 40_000): Node[] {
  const result: Node[] = [],
    stack = [root];
  while (stack.length && result.length < max) {
    const node = stack.pop()!;
    result.push(node);
    if (!['script', 'style', 'noscript', 'template', 'svg'].includes(node.nodeName)) {
      const nested = children(node);
      for (let i = nested.length - 1; i >= 0; i--) stack.push(nested[i]);
    }
  }
  return result;
}
function content(node: Node): string {
  return walk(node, 2000)
    .filter((n) => n.nodeName === '#text')
    .map((n) => ('value' in n ? n.value : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
export function byteSlice(value: string, max: number): string {
  // Never split a Unicode code point, including supplementary characters.
  let bytes = 0,
    end = 0;
  for (const point of value) {
    const size = Buffer.byteLength(point);
    if (bytes + size > max) break;
    bytes += size;
    end += point.length;
  }
  return value.slice(0, end);
}
export function officialScope(version: string): string | undefined {
  const java = /^Java\s+(?:1\.)?(\d{1,2})(?:\.\d+)*$/i.exec(version)?.[1];
  if (java && +java >= 6)
    return `docs.oracle.com/${+java <= 10 ? `javase/${java}` : `en/java/javase/${java}`}/docs/api/`;
  const python = /^Python\s+(3\.\d{1,2})(?:\.\d+)?$/i.exec(version)?.[1];
  if (python) return `docs.python.org/${python}/`;
}
export function searchQuery(topic: string, options: ResearchOptions): string {
  // The topic is text, not a place to inject search-engine operators or !bang redirects.
  const words = (s: string) =>
    s
      .replace(/[^\p{L}\p{N}\s.+#_-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const scope = officialScope(options.version);
  const filter =
    options.filter === 'docs'
      ? scope
        ? ` site:${scope.split('/')[0]}`
        : ' official documentation'
      : options.filter === 'code'
        ? ' (site:github.com OR site:gitlab.com OR site:bitbucket.org)'
        : options.filter === 'videos'
          ? ' (site:youtube.com/watch OR site:youtu.be)'
          : options.filter === 'books'
            ? ' free programming book author publisher'
            : '';
  return `${words(topic)} ${words(options.version)}${filter}`.trim();
}
function edition(
  url: string,
  options: ResearchOptions,
): RetrievedSource['versionMatch'] | 'mismatch' {
  const u = new URL(url),
    scope = officialScope(options.version);
  if (!scope) return 'unknown';
  if (`${u.hostname}${u.pathname}`.startsWith(scope)) return 'matched document edition';
  if (
    (scope.startsWith('docs.oracle.com/') &&
      u.hostname === 'docs.oracle.com' &&
      /\/(?:javase|javafx)\/\d+\//.test(u.pathname)) ||
    (scope.startsWith('docs.python.org/') &&
      u.hostname === 'docs.python.org' &&
      /^\/3\.\d+\//.test(u.pathname))
  )
    return 'mismatch';
  return 'unknown';
}
export function parseSearch(html: string, options: ResearchOptions): RetrievedSource[] {
  if (Buffer.byteLength(html) > retrievalLimits.searchBytes)
    throw new Error('Web search page exceeded its size limit.');
  const nodes = walk(parse(html)),
    result: RetrievedSource[] = [],
    seen = new Set<string>();
  for (const node of nodes) {
    if (!hasClass(node, 'result__a')) continue;
    let raw = attr(node, 'href');
    try {
      const link = new URL(raw, FALLBACK_ENDPOINT);
      if (
        ['duckduckgo.com', 'html.duckduckgo.com'].includes(link.hostname) &&
        link.pathname === '/l/'
      )
        raw = link.searchParams.get('uddg') || '';
      const url = publicWebUrl(raw);
      if (!url || seen.has(url)) continue;
      // Exclude search/navigation/ad links, never follow search-engine redirects.
      if (/(^|\.)duckduckgo\.com$/.test(new URL(url).hostname)) continue;
      const versionMatch = edition(url, options);
      if (versionMatch === 'mismatch') continue;
      let container: Node = node;
      for (let depth = 0; depth < 6 && 'parentNode' in container && container.parentNode; depth++) {
        container = container.parentNode;
        if (hasClass(container, 'result')) break;
      }
      if (
        hasClass(container, 'result--ad') ||
        walk(container).some((n) => hasClass(n, 'result__badge'))
      )
        continue;
      const title = byteSlice(content(node), 200) || new URL(url).hostname;
      const snippet = walk(container).find((n) => hasClass(n, 'result__snippet'));
      result.push({
        url,
        title,
        kind: sourceKind(url, title),
        excerpt: byteSlice(snippet ? content(snippet) : '', 1800),
        evidence: 'search snippet',
        versionMatch,
      });
      seen.add(url);
      if (result.length === 12) break;
    } catch {
      /* Malformed search destinations are not sources. */
    }
  }
  return rankSources(result, options);
}
function rankSources(result: RetrievedSource[], options: ResearchOptions): RetrievedSource[] {
  if (!result.length)
    throw new Error(
      'Web search returned no usable results or requires a browser check. No AI request was sent. Try later or use a narrower topic.',
    );
  const kind = {
    all: '',
    docs: 'Documentation',
    videos: 'Video',
    code: 'Source code',
    books: 'Book / PDF',
  }[options.filter];
  return result
    .sort(
      (a, b) =>
        Number(b.kind === kind) * 2 +
        Number(b.versionMatch === 'matched document edition') -
        (Number(a.kind === kind) * 2 + Number(a.versionMatch === 'matched document edition')),
    )
    .slice(0, 12);
}
/** Read only bounded RSS item fields. No DTD/entity resolver or executable XML. */
export function parseRss(xml: string, options: ResearchOptions): RetrievedSource[] {
  if (Buffer.byteLength(xml) > retrievalLimits.searchBytes)
    throw new Error('Web search page exceeded its size limit.');
  if (!/<rss\b/i.test(xml) || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error('Web search returned an unsupported feed.');
  const result: RetrievedSource[] = [],
    seen = new Set<string>();
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const field = (name: string) => {
      const value =
        new RegExp('<' + name + '\\b[^>]*>([\\s\\S]*?)<\\/' + name + '>', 'i').exec(
          match[1],
        )?.[1] || '';
      return content(parse(value.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')));
    };
    const url = publicWebUrl(field('link'));
    if (!url || seen.has(url)) continue;
    const versionMatch = edition(url, options);
    if (versionMatch === 'mismatch') continue;
    const title = byteSlice(field('title'), 200) || new URL(url).hostname;
    result.push({
      url,
      title,
      kind: sourceKind(url, title),
      excerpt: byteSlice(field('description'), 1800),
      versionMatch,
      evidence: 'search snippet',
    });
    seen.add(url);
    if (result.length === 12) break;
  }
  return rankSources(result, options);
}

// Only these public reference hosts may be fetched automatically. Other resources
// keep their search snippets and are opened only on the user's existing link action.
const referenceHosts = new Set([
  'docs.oracle.com',
  'docs.python.org',
  'www.typescriptlang.org',
  'typescriptlang.org',
  'developer.mozilla.org',
  'learn.microsoft.com',
  'go.dev',
  'doc.rust-lang.org',
  'kotlinlang.org',
  'react.dev',
  'vuejs.org',
  'www.php.net',
  'www.ruby-lang.org',
]);
export function referenceUrl(source: WebSource): string | undefined {
  if (!publicWebUrl(source.url)) return;
  const u = new URL(source.url);
  return u.protocol === 'https:' &&
    referenceHosts.has(u.hostname) &&
    source.kind === 'Documentation' &&
    !/\.(?:pdf|epub|zip)$/i.test(u.pathname)
    ? u.href
    : undefined;
}
export async function readBounded(response: Response, max: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The web service returned an empty response.');
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > max) {
        await reader.cancel();
        throw new Error('Web response exceeded its size limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}
export function referenceExcerpt(html: string, topic: string): string {
  if (Buffer.byteLength(html) > retrievalLimits.referenceBytes)
    throw new Error('Web reference exceeded its size limit.');
  const nodes = walk(parse(html));
  const terms = [
    ...new Set(
      (topic.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) || [])
        .filter(
          (t) =>
            ![
              'java',
              'python',
              'typescript',
              'with',
              'into',
              'from',
              'elements',
              'example',
              'code',
              'the',
              'and',
            ].includes(t),
        )
        .map((t) => t.replace(/(?:ing|s)$/, '')),
    ),
  ];
  const methods = [
    ...new Set([
      ...(topic.match(/\b\w+(?=\s*\()/g) || []),
      ...(/\b(?:list|collect\w*)\b/i.test(topic) ? ['toList', 'toCollection'] : []),
    ]),
  ];
  const sections = nodes.filter(
    (n) =>
      hasClass(n, 'detail') ||
      (n.nodeName === 'li' && hasClass(n, 'blockList')) ||
      n.nodeName === 'dd' ||
      n.nodeName === 'p',
  );
  const candidates = sections
    .slice(0, 1500)
    .map((n) => {
      const text = content(n),
        lower = text.toLowerCase(),
        id = attr(n, 'id');
      return {
        text,
        score:
          methods.reduce(
            (s, m) =>
              s + (id.startsWith(m + '(') ? 20 : lower.includes(m.toLowerCase() + '(') ? 8 : 0),
            0,
          ) + terms.reduce((s, t) => s + Number(lower.includes(t)), 0),
      };
    })
    .filter((c) => c.text.length > 60 && c.score > 0)
    .sort((a, b) => b.score - a.score || a.text.length - b.text.length);
  const excerpts: string[] = [];
  for (const c of candidates) {
    if (excerpts.some((e) => e.includes(c.text) || c.text.includes(e))) continue;
    excerpts.push(byteSlice(c.text, 1200));
    if (excerpts.length === 2) break;
  }
  return byteSlice(excerpts.join('\n'), 2000);
}
/** Do not spend AI tokens summarizing an unrelated search landing page. */
export function relevantSources(
  sources: RetrievedSource[],
  topic: string,
  options: ResearchOptions,
): RetrievedSource[] {
  const generic = new Set([
    'java',
    'python',
    'typescript',
    'javascript',
    'rust',
    'code',
    'example',
    'examples',
    'beginner',
    'tutorial',
    'from',
    'with',
    'into',
    'the',
    'and',
    'for',
    'free',
    'book',
    'author',
    'publisher',
    'source',
    'elements',
  ]);
  const terms = [
    ...new Set(
      (topic.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) || [])
        .filter((t) => !generic.has(t))
        .map((t) => t.replace(/(?:ing|s)$/, '')),
    ),
  ];
  const kind = {
    all: '',
    docs: 'Documentation',
    code: 'Source code',
    videos: 'Video',
    books: 'Book / PDF',
  }[options.filter];
  const relevant = sources.filter(
    (s) =>
      !terms.length ||
      terms.some((t) => (s.title + ' ' + s.excerpt + ' ' + s.url).toLowerCase().includes(t)),
  );
  if (!relevant.some((s) => !kind || s.kind === kind))
    throw new Error('Web search returned no relevant resources of the requested type.');
  // A known, fixed documentation target must have actual evidence of its edition.
  if (
    kind === 'Documentation' &&
    officialScope(options.version) &&
    !relevant.some((s) => s.versionMatch === 'matched document edition')
  )
    throw new Error('Web search returned no documentation for the target edition.');
  return relevant;
}
export async function retrieveSources(
  topic: string,
  options: ResearchOptions,
  signal: AbortSignal,
  transport: typeof fetch = fetch,
): Promise<{ sources: RetrievedSource[]; requests: number; provider: string }> {
  let sources: RetrievedSource[] = [],
    requests = 0,
    provider = 'Bing';
  // A fallback is a separate public search engine, never an attempt to solve or
  // bypass a browser challenge. At most two search requests; neither uses AI.
  for (const endpoint of [SEARCH_ENDPOINT, FALLBACK_ENDPOINT]) {
    if (signal.aborted) throw new Error('Web research cancelled.');
    const url = new URL(endpoint);
    url.searchParams.set('q', searchQuery(topic, options));
    const rss = endpoint === SEARCH_ENDPOINT;
    if (rss) url.searchParams.set('format', 'rss');
    provider = rss ? 'Bing' : 'DuckDuckGo';
    requests++;
    try {
      const response = await transport(url.href, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
        redirect: 'error',
        headers: { Accept: rss ? 'application/rss+xml, application/xml, text/xml' : 'text/html' },
      });
      if (response.status !== 200) {
        await response.body?.cancel();
        continue;
      }
      if (!(rss ? /xml/i : /text\/html/i).test(response.headers.get('content-type') || '')) {
        await response.body?.cancel();
        continue;
      }
      const page = await readBounded(response, retrievalLimits.searchBytes);
      sources = relevantSources(
        rss ? parseRss(page, options) : parseSearch(page, options),
        topic,
        options,
      ).slice(0, retrievalLimits.sources);
      break;
    } catch {
      if (signal.aborted) throw new Error('Web research cancelled.');
    }
  }
  if (!sources.length)
    throw new Error(
      'Web search is unavailable or returned no usable results. No AI request was sent; your explanation is unchanged. Try later or use a narrower topic.',
    );
  const fetched = new Set<string>();
  for (const source of sources) {
    const target = referenceUrl(source);
    if (!target || fetched.size >= retrievalLimits.references) continue;
    const pageUrl = new URL(target);
    pageUrl.hash = '';
    if (fetched.has(pageUrl.href)) continue;
    if (signal.aborted) throw new Error('Web research cancelled.');
    fetched.add(pageUrl.href);
    requests++;
    try {
      const page = await transport(pageUrl.href, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
        redirect: 'error',
        headers: { Accept: 'text/html' },
      });
      if (!page.ok || !/text\/html/i.test(page.headers.get('content-type') || '')) {
        await page.body?.cancel();
        continue;
      }
      const excerpt = referenceExcerpt(
        await readBounded(page, retrievalLimits.referenceBytes),
        topic,
      );
      if (excerpt) {
        source.excerpt = excerpt;
        source.evidence = 'reference excerpt';
      }
    } catch {
      if (signal.aborted)
        throw new Error('Web research cancelled.'); /* Keep the search snippet; no retry. */
    }
  }
  if (signal.aborted) throw new Error('Web research cancelled.');
  return { sources, requests, provider };
}
