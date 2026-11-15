import { publicWebUrl, type WebResearch, type WebSource } from './web-research';

export const BOOKMARKS_KEY = 'resourceBookmarks.v1';
export const BOOKMARK_LIMIT = 100;
export interface ResourceBookmark extends WebSource {
  topic: string;
  version: string;
  checkedAt: number;
  savedAt: number;
}
export interface BookmarkState {
  version: 1;
  entries: ResourceBookmark[];
}
const short = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
function clean(value: unknown): ResourceBookmark | undefined {
  if (!value || typeof value !== 'object') return;
  const b = value as ResourceBookmark,
    url = publicWebUrl(b.url);
  if (!url || !Number.isFinite(b.savedAt) || !Number.isFinite(b.checkedAt)) return;
  return {
    url,
    title: short(b.title, 200) || new URL(url).hostname,
    kind: short(b.kind, 40),
    topic: short(b.topic, 200),
    version: short(b.version, 120),
    checkedAt: b.checkedAt,
    savedAt: b.savedAt,
  };
}
/** Explicit saves only. No expiry or eviction when history/cache is cleared. */
export class ResourceBookmarks {
  private state: BookmarkState = { version: 1, entries: [] };
  private queue = Promise.resolve();
  constructor(
    value: unknown,
    private readonly persist: (state: BookmarkState) => PromiseLike<void>,
  ) {
    const state = value as BookmarkState | undefined;
    if (state?.version === 1 && Array.isArray(state.entries)) {
      const seen = new Set<string>();
      this.state.entries = state.entries
        .slice(0, 1000)
        .map(clean)
        .filter((b): b is ResourceBookmark => {
          if (!b || seen.has(b.url)) return false;
          seen.add(b.url);
          return true;
        })
        .slice(0, BOOKMARK_LIMIT);
    }
  }
  snapshot(): BookmarkState {
    return structuredClone(this.state);
  }
  private change(update: (state: BookmarkState) => void) {
    const work = this.queue.then(async () => {
      const next = this.snapshot();
      update(next);
      await this.persist(next);
      this.state = next;
    });
    this.queue = work.catch(() => {});
    return work;
  }
  add(source: WebSource, research: Pick<WebResearch, 'topic' | 'checkedAt' | 'options'>) {
    return this.change((state) => {
      const entry = clean({
        ...source,
        topic: research.topic,
        version: research.options?.version ?? '',
        checkedAt: research.checkedAt,
        savedAt: Date.now(),
      });
      if (!entry) throw new Error('This source cannot be bookmarked.');
      if (state.entries.some((e) => e.url === entry.url)) return;
      if (state.entries.length >= BOOKMARK_LIMIT)
        throw new Error('Your 100 bookmarks are full. Remove one before saving another.');
      state.entries.unshift(entry);
    });
  }
  remove(url: string) {
    return this.change((state) => {
      state.entries = state.entries.filter((e) => e.url !== url);
    });
  }
}
