import { fingerprint } from './cache';
import type { Audience, Lesson, Mode, Task } from './types';
import type { WebResearch } from './web-research';

export const HISTORY_KEY = 'recentLessons.v1';
export const HISTORY_LIMIT = 30;
const MAX_BYTES = 2_000_000;
const MAX_ENTRY_BYTES = 256_000;
const tasks = ['explain', 'walkthrough', 'example', 'impact'];
export interface HistoryResult {
  mode: Mode;
  audience: Audience;
  lesson: Lesson;
  provider: string;
  model: string;
  replacement?: string;
  research?: WebResearch;
}
export interface HistoryEntry {
  id: string;
  file: string;
  line: number;
  code: string;
  language: string;
  audience: Audience;
  mode: Mode;
  updatedAt: number;
  results: Partial<Record<Task, HistoryResult>>;
}
export interface HistoryState {
  version: 1;
  enabled: boolean;
  entries: HistoryEntry[];
}
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
function validEntry(value: unknown): value is HistoryEntry {
  const e = value as HistoryEntry | undefined;
  return (
    !!e &&
    typeof e.id === 'string' &&
    typeof e.file === 'string' &&
    typeof e.code === 'string' &&
    e.code.length <= 12000 &&
    typeof e.language === 'string' &&
    Number.isInteger(e.line) &&
    e.line > 0 &&
    Number.isFinite(e.updatedAt) &&
    ['beginner', 'experienced'].includes(e.audience) &&
    ['standalone', 'project'].includes(e.mode) &&
    !!e.results &&
    Object.keys(e.results).length > 0 &&
    Object.entries(e.results).every(
      ([task, r]) =>
        tasks.includes(task) &&
        !!r?.lesson &&
        typeof r.lesson.title === 'string' &&
        typeof r.lesson.summary === 'string' &&
        Array.isArray(r.lesson.steps) &&
        Array.isArray(r.lesson.concepts) &&
        !!r.lesson.example &&
        Array.isArray(r.lesson.predictions) &&
        Array.isArray(r.lesson.checks),
    ) &&
    bytes(e) <= MAX_ENTRY_BYTES
  );
}
export class RecentHistory {
  private state: HistoryState;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    saved: unknown,
    private readonly write: (state: HistoryState) => PromiseLike<void>,
  ) {
    const input = saved as HistoryState | undefined;
    this.state = { version: 1, enabled: input?.enabled !== false, entries: [] };
    if (input?.version === 1 && Array.isArray(input.entries)) {
      const seen = new Set<string>();
      this.state.entries = input.entries
        .filter(validEntry)
        .filter((e) => {
          if (seen.has(e.id)) return false;
          seen.add(e.id);
          return true;
        })
        .slice(0, HISTORY_LIMIT);
      this.trim(this.state);
    }
  }
  snapshot(): HistoryState {
    return structuredClone(this.state);
  }
  private trim(state: HistoryState) {
    state.entries = state.entries.slice(0, HISTORY_LIMIT);
    while (bytes(state) > MAX_BYTES && state.entries.length) state.entries.pop();
  }
  private change(update: (state: HistoryState) => void | false) {
    const work = this.pending.then(async () => {
      const next = this.snapshot();
      if (update(next) === false) return;
      this.trim(next);
      await this.write(next);
      this.state = next;
    });
    this.pending = work.catch(() => {});
    return work;
  }
  add(
    source: Omit<HistoryEntry, 'id' | 'updatedAt' | 'results'>,
    task: Task,
    result: HistoryResult,
  ) {
    if (!tasks.includes(task)) return Promise.resolve();
    return this.change((state) => {
      if (!state.enabled) return false;
      // Locations may move; identical selected text in the same file stays one entry.
      const id = fingerprint([source.file, source.language, source.code]);
      const previous = state.entries.find((e) => e.id === id);
      const entry: HistoryEntry = {
        ...source,
        id,
        updatedAt: Date.now(),
        results: { ...previous?.results, [task]: structuredClone(result) },
      };
      if (!validEntry(entry)) throw new Error('This entry is too large or incomplete to save.');
      state.entries = [entry, ...state.entries.filter((e) => e.id !== id)];
    });
  }
  remove(id: string) {
    return this.change((s) => {
      s.entries = s.entries.filter((e) => e.id !== id);
    });
  }
  attachResearch(
    source: Pick<HistoryEntry, 'file' | 'language' | 'code'>,
    task: Task,
    lesson: Lesson,
    research: WebResearch,
  ) {
    return this.change((state) => {
      if (!state.enabled) return false;
      const id = fingerprint([source.file, source.language, source.code]);
      const entry = state.entries.find((e) => e.id === id),
        result = entry?.results[task];
      // A cleared/replaced lesson must not reappear when a slower web request finishes.
      if (!entry || !result || fingerprint(result.lesson) !== fingerprint(lesson)) return false;
      result.research = structuredClone(research);
      if (bytes(entry) > MAX_ENTRY_BYTES) throw new Error('This entry is too large to save.');
    });
  }
  clear() {
    return this.change((s) => {
      s.entries = [];
    });
  }
  enable(enabled: boolean) {
    return this.change((s) => {
      s.enabled = enabled;
    });
  }
}
