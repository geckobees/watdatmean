import { describe, expect, it, vi } from 'vitest';
import {
  RecentHistory,
  HISTORY_LIMIT,
  type HistoryState,
  type HistoryResult,
} from '../src/history';
import type { Lesson } from '../src/types';
import type { WebResearch } from '../src/web-research';

const lesson: Lesson = {
  title: 'Count items',
  summary: 'Stores the count.',
  steps: [],
  concepts: [],
  example: { code: '', explanation: '' },
  predictions: [],
  checks: [],
};
const source = {
  file: 'src/example.ts',
  line: 8,
  code: 'const count = 2;',
  language: 'TypeScript',
  audience: 'beginner' as const,
  mode: 'standalone' as const,
};
const result: HistoryResult = {
  lesson,
  provider: 'test',
  model: 'fixture',
  mode: 'standalone',
  audience: 'beginner',
};
describe('recent completed lessons', () => {
  it('groups web research with a completed lesson and does not resurrect cleared history', async () => {
    const history = new RecentHistory(undefined, async () => {});
    const research: WebResearch = {
      topic: 'variables',
      provider: 'groq',
      model: 'fixture',
      checkedAt: 1,
      blocks: [],
      sources: [],
      searches: 1,
      cached: false,
    };
    await history.add(source, 'explain', result);
    await history.attachResearch(source, 'explain', lesson, research);
    expect(history.snapshot().entries[0].results.explain?.research).toEqual(research);
    await history.clear();
    await history.attachResearch(source, 'explain', lesson, research);
    expect(history.snapshot().entries).toEqual([]);
    await history.add(source, 'explain', result);
    await history.enable(false);
    await history.attachResearch(source, 'explain', lesson, research);
    expect(history.snapshot().entries[0].results.explain?.research).toBeUndefined();
  });
  it('groups repeated code and different actions, while retaining request-specific settings and drafts', async () => {
    let saved: HistoryState | undefined;
    const history = new RecentHistory(undefined, async (s) => {
      saved = s;
    });
    await history.add(source, 'explain', result);
    await history.add({ ...source, line: 15 }, 'explain', result);
    await history.add({ ...source, mode: 'project' }, 'impact', {
      ...result,
      mode: 'project',
      replacement: 'const count = 3;',
    });
    expect(history.snapshot().entries).toHaveLength(1);
    expect(history.snapshot().entries[0].results).toMatchObject({
      explain: { mode: 'standalone' },
      impact: { mode: 'project', replacement: 'const count = 3;' },
    });
    expect(new RecentHistory(saved, async () => {}).snapshot()).toEqual(history.snapshot());
    expect(JSON.stringify(saved)).not.toMatch(/apiKey|learningContext|evidence/);
  });
  it('keeps distinct files and exact code separate, caps recents and moves revisits to the front', async () => {
    const history = new RecentHistory(undefined, async () => {});
    for (let n = 0; n < 35; n++)
      await history.add({ ...source, code: `const count = ${n};` }, 'explain', result);
    expect(history.snapshot().entries).toHaveLength(HISTORY_LIMIT);
    expect(history.snapshot().entries.at(-1)?.code).toContain('5');
    await history.add({ ...source, code: 'const count = 8;' }, 'example', result);
    expect(history.snapshot().entries[0].code).toContain('8');
    await history.add({ ...source, file: 'other.ts', code: 'const count = 8;' }, 'explain', result);
    expect(
      history
        .snapshot()
        .entries.slice(0, 2)
        .map((e) => e.file),
    ).toEqual(['other.ts', source.file]);
  });
  it('does not create concept spam and honors paused saving across reloads', async () => {
    const write = vi.fn(async () => {});
    const history = new RecentHistory(undefined, write);
    await history.add(source, 'concept', result);
    expect(write).not.toHaveBeenCalled();
    await history.add(source, 'explain', result);
    await history.enable(false);
    const reloaded = new RecentHistory(history.snapshot(), write);
    await reloaded.add({ ...source, code: 'another();' }, 'example', result);
    expect(reloaded.snapshot().entries).toHaveLength(1);
    await reloaded.clear();
    expect(reloaded.snapshot()).toMatchObject({ enabled: false, entries: [] });
  });
  it('serializes save/remove/clear and never resurrects a deleted entry', async () => {
    const history = new RecentHistory(undefined, async () => {});
    await history.add(source, 'explain', result);
    const id = history.snapshot().entries[0].id;
    await Promise.all([history.add(source, 'example', result), history.remove(id)]);
    expect(history.snapshot().entries).toEqual([]);
    await Promise.all([history.add(source, 'explain', result), history.clear()]);
    expect(history.snapshot().entries).toEqual([]);
  });
  it('does not report a failed write as saved and can recover on a later operation', async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValue(undefined);
    const history = new RecentHistory(undefined, write);
    await expect(history.add(source, 'explain', result)).rejects.toThrow('disk full');
    expect(history.snapshot().entries).toEqual([]);
    await history.add(source, 'explain', result);
    expect(history.snapshot().entries).toHaveLength(1);
  });
  it('bounds UTF-8 storage without truncating a lesson, and rejects oversized entries', async () => {
    const history = new RecentHistory(undefined, async () => {});
    for (let n = 0; n < 30; n++)
      await history.add({ ...source, file: `${n}.ts` }, 'explain', {
        ...result,
        lesson: { ...lesson, summary: '語'.repeat(50000) },
      });
    expect(Buffer.byteLength(JSON.stringify(history.snapshot()))).toBeLessThanOrEqual(2_000_000);
    expect(history.snapshot().entries[0].results.explain?.lesson.summary).toHaveLength(50000);
    await expect(
      history.add(source, 'explain', {
        ...result,
        lesson: { ...lesson, summary: '語'.repeat(90000) },
      }),
    ).rejects.toThrow('too large');
  });
  it('tolerates malformed or duplicate persisted records', async () => {
    const history = new RecentHistory(undefined, async () => {});
    await history.add(source, 'explain', result);
    const state = history.snapshot();
    state.entries.push(state.entries[0], null as never, {} as never);
    expect(new RecentHistory(state, async () => {}).snapshot().entries).toHaveLength(1);
    expect(
      new RecentHistory({ version: 99, entries: state.entries }, async () => {}).snapshot().entries,
    ).toEqual([]);
  });
});
