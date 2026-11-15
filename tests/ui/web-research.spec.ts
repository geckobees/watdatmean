import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { panelHtml } from '../../src/panel';
const lesson = {
  title: 'Your code',
  summary: 'The loop prints the next item.',
  steps: [],
  concepts: [],
  example: { code: '', explanation: '' },
  predictions: [],
  checks: [],
  local: true,
  usage: { input: 0, output: 0, total: 0 },
};
const research = {
  topic: 'Java loops',
  provider: 'groq',
  model: 'openai/gpt-oss-20b',
  checkedAt: 1790000000000,
  searches: 1,
  cached: false,
  usage: { input: 200, output: 100, total: 300 },
  blocks: [
    {
      text: 'A loop visits each item. <img src=x onerror=alert(1)>\n```java\nfor (int n : numbers) System.out.println(n);\n```\nUse it to total orders. Not executed.',
      sourceUrls: ['https://docs.oracle.com/javase/'],
      citations: [{ end: 25, url: 'https://docs.oracle.com/javase/' }],
    },
  ],
  sources: [
    { title: 'Java docs', url: 'https://docs.oracle.com/javase/', kind: 'Documentation' },
    { title: 'A lesson', url: 'https://www.youtube.com/watch?v=fixture', kind: 'Video' },
    { title: 'Author book', url: 'https://author.example.com/book.pdf', kind: 'Book / PDF' },
  ],
};
// Public synthetic-topic results from the explicitly authorized Groq live test.
const liveResults = JSON.parse(readFileSync('tests/fixtures/web-research-live.json', 'utf8'));
async function send(page: Page, data: unknown) {
  await page.evaluate((data) => window.dispatchEvent(new MessageEvent('message', { data })), data);
}
async function messages(page: Page) {
  return page.evaluate(() => (window as any).messages);
}
for (const editor of ['VS Code', 'IntelliJ'])
  test.describe(`${editor} optional web research`, () => {
    test('shows the bounded lookup separately and keeps cache/history free to review', async ({
      page,
    }) => {
      await page.locator('#web-research').check();
      await expect(page.locator('#web-options')).toContainText('Bing (DuckDuckGo fallback)');
      await expect(page.locator('#web-options')).toContainText('900 output tokens');
      const result = {
        ...research,
        budget: { inputBytes: 3400, maxInputBytes: 3500, maxOutputTokens: 900, aiRequests: 1 },
        retrieval: { provider: 'Bing', requests: 3 },
      };
      await send(page, { type: 'research', result });
      await page.locator('#web-result > details > summary').click();
      await expect(page.locator('#web-result')).toContainText(
        'Bounded lookup · 1 AI request · up to 900 output tokens. Search: Bing.',
      );
      await expect(page.locator('#web-result')).not.toContainText('Search fees may also apply');
      await send(page, { type: 'research', result: { ...result, cached: true } });
      await page.locator('#web-result > details > summary').click();
      await expect(page.locator('#web-result')).toContainText('0 new tokens');
    });
    for (const fixture of liveResults)
      test(`real results: ${fixture.id}, filters and bookmark round trip`, async ({ page }) => {
        const result = fixture.result;
        await page.locator('#web-research').check();
        await send(page, { type: 'research', result });
        await page.locator('#web-result > details > summary').click();
        await expect(page.locator('#web-result')).toContainText(
          `Target: ${result.options.version}`,
        );
        for (const [filter, kind] of Object.entries({
          all: '',
          docs: 'Documentation',
          videos: 'Video',
          code: 'Source code',
          books: 'Book / PDF',
        })) {
          await page.locator('#web-filter').selectOption(filter);
          await expect(page.locator('.web-source-list .web-source')).toHaveCount(
            result.sources.filter((s: any) => !kind || s.kind === kind).length,
          );
        }
        const kind = {
          docs: 'Documentation',
          videos: 'Video',
          code: 'Source code',
          books: 'Book / PDF',
        }[result.options.filter as 'docs'];
        expect(result.sources.some((s: any) => s.kind === kind)).toBe(true);
        await page.locator('#web-filter').selectOption('all');
        const source = result.sources[0];
        await page.locator('.bookmark-save').first().click();
        expect(await messages(page)).toContainEqual({ type: 'bookmarkAdd', url: source.url });
        await send(page, {
          type: 'bookmarks',
          entries: [
            {
              ...source,
              topic: result.topic,
              version: result.options.version,
              checkedAt: result.checkedAt,
              savedAt: result.checkedAt,
            },
          ],
        });
        await page.locator('#bookmarks-toggle').click();
        await expect(page.locator('#bookmarks-list')).toContainText(source.title);
        await expect(page.locator('#bookmarks-list')).toContainText(result.options.version);
        await page.locator('#bookmarks-list button').click();
        expect(await messages(page)).toContainEqual({ type: 'bookmarkRemove', url: source.url });
        expect(
          (await messages(page)).filter((m: any) =>
            ['research', 'request', 'apply'].includes(m.type),
          ),
        ).toEqual([]);
      });
    test('cleans opaque Groq citations without guessing links or changing code examples', async ({
      page,
    }) => {
      await page.locator('#web-research').check();
      await send(page, {
        type: 'research',
        result: {
          ...research,
          blocks: [
            {
              text: 'Verified nuance【1†L2-L10】 and more〖0†L5-L8〗. Keep ordinary 【brackets】.\n```java\nString example = "【1†L2-L10】";\n```',
              sourceUrls: [],
            },
          ],
        },
      });
      await page.locator('#web-result > details > summary').click();
      await expect(page.locator('.web-text')).toHaveText(
        'Verified nuance and more. Keep ordinary 【brackets】.',
      );
      await expect(page.locator('.web-text a')).toHaveCount(0);
      await expect(page.locator('#web-result pre')).toContainText('"【1†L2-L10】"');
      await expect(page.locator('.web-source-list .web-source')).toHaveCount(3);
    });
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        (window as any).messages = [];
        (window as any).watdatmeanHost = {
          postMessage: (m: any) => {
            if (m.type !== 'highlight') (window as any).messages.push(m);
          },
          getState: () => ({}),
          setState: () => {},
        };
      });
      await page.route('https://web.test/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (/\.(js|css)$/.test(path))
          await route.fulfill({
            body: readFileSync(`media${path}`),
            contentType: path.endsWith('.js') ? 'application/javascript' : 'text/css',
          });
        else
          await route.fulfill({
            contentType: 'text/html',
            body:
              editor === 'IntelliJ'
                ? readFileSync('intellij/build/generated/web/panel.html', 'utf8').replaceAll(
                    '__WDM_NONCE__',
                    'test-nonce',
                  )
                : panelHtml(
                    {
                      cspSource: 'https://web.test',
                      css: 'https://web.test/panel.css',
                      script: 'https://web.test/panel.js',
                    },
                    'test-nonce',
                  ),
          });
      });
      await page.goto('https://web.test/');
      await expect.poll(() => messages(page)).toContainEqual({ type: 'ready' });
      await send(page, {
        type: 'selection',
        code: 'for (var privateCustomerId : privateOrders) { save(privateCustomerId); }',
        language: 'Java',
        file: 'Private.java',
        line: 8,
        start: 0,
        parts: [],
      });
      await send(page, {
        type: 'config',
        provider: 'groq',
        model: 'qwen/qwen3.8-27b',
        audience: 'beginner',
        hasKey: true,
        webResearch: false,
        webResearchModel: 'openai/gpt-oss-20b',
      });
    });
    test('uses declared versions without overriding edits, and filters locally until explicit search', async ({
      page,
    }) => {
      await page.locator('#web-research').check();
      await send(page, {
        type: 'researchHints',
        hints: [{ version: 'Java 17', source: 'pom.xml' }],
      });
      await expect(page.locator('#web-version')).toHaveValue('Java 17');
      await expect(page.locator('#web-version-note')).toContainText('Declared in pom.xml');
      await page.locator('#web-version').fill('Java 21');
      await send(page, {
        type: 'researchHints',
        hints: [{ version: 'Java 8', source: 'pom.xml' }],
      });
      await expect(page.locator('#web-version')).toHaveValue('Java 21');
      await send(page, { type: 'research', result: research });
      await page.locator('#web-result > details > summary').click();
      await page.locator('#web-filter').selectOption('videos');
      await expect(page.locator('.web-source-list .web-source')).toHaveCount(1);
      await expect(page.locator('.web-source-list')).toContainText('A lesson');
      await expect(page.locator('.web-text a')).toHaveCount(1); // citations remain with claims
      expect((await messages(page)).filter((m: any) => m.type === 'research')).toHaveLength(0);
      await page.locator('#web-find').click();
      expect(await messages(page)).toContainEqual({
        type: 'research',
        topic: 'Java loops',
        audience: 'beginner',
        options: { version: 'Java 21', filter: 'videos' },
      });
    });
    test('bookmarks are searchable, survive history updates, and preserve the current draft without AI', async ({
      page,
    }) => {
      await page.locator('[data-tab=impact]').click();
      await page.locator('#replacement').fill('int draft = 7;');
      await page.locator('[data-tab=understand]').click();
      await page.locator('#web-research').check();
      await send(page, { type: 'bookmarks', entries: [] });
      await send(page, { type: 'research', result: research });
      await page.locator('#web-result > details > summary').click();
      await page.getByRole('button', { name: 'Bookmark Java docs', exact: true }).click();
      expect(await messages(page)).toContainEqual({
        type: 'bookmarkAdd',
        url: research.sources[0].url,
      });
      const bookmark = {
        ...research.sources[0],
        topic: 'Java loops',
        version: 'Java 17',
        checkedAt: research.checkedAt,
        savedAt: research.checkedAt,
      };
      await send(page, { type: 'bookmarks', entries: [bookmark] });
      await expect(
        page.getByRole('button', { name: 'Remove bookmark for Java docs', exact: true }),
      ).toHaveAttribute('aria-pressed', 'true');
      await send(page, { type: 'history', version: 1, enabled: true, entries: [] });
      await page.locator('#bookmarks-toggle').click();
      await expect(page.locator('#bookmarks-list')).toContainText('Java 17');
      await page.locator('#bookmarks-search').fill('no match');
      await expect(page.locator('#bookmarks-list li')).toHaveCount(0);
      await page.locator('#bookmarks-search').fill('oracle.com');
      await expect(page.locator('#bookmarks-list li')).toHaveCount(1);
      await page.locator('#bookmarks-filter').selectOption('videos');
      await expect(page.locator('#bookmarks-list li')).toHaveCount(0);
      await page.locator('#bookmarks-filter').selectOption('docs');
      await page.setViewportSize({ width: 360, height: 780 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.locator('#bookmarks-list a').click();
      expect(await messages(page)).toContainEqual({
        type: 'openWebSource',
        url: research.sources[0].url,
      });
      await page.locator('#bookmarks-list button').click();
      expect(await messages(page)).toContainEqual({
        type: 'bookmarkRemove',
        url: research.sources[0].url,
      });
      await send(page, { type: 'bookmarks', entries: [] });
      await expect(page.locator('#bookmarks-status')).toContainText('No bookmarks');
      await page.locator('#bookmarks-close').click();
      await page.locator('[data-tab=impact]').click();
      await expect(page.locator('#replacement')).toHaveValue('int draft = 7;');
      expect(
        (await messages(page)).filter((m: any) =>
          ['research', 'request', 'apply'].includes(m.type),
        ),
      ).toEqual([]);
    });
    test('ignores stale version hints and keeps bookmark errors visible while viewing history', async ({
      page,
    }) => {
      await page.locator('#web-research').check();
      await send(page, {
        type: 'researchHints',
        selectionId: 999,
        hints: [{ version: 'Java 99', source: 'pom.xml' }],
      });
      await expect(page.locator('#web-version')).toHaveValue('');
      await send(page, { type: 'research', result: research });
      await page.locator('#web-result > details > summary').click();
      await page.getByRole('button', { name: 'Bookmark Java docs', exact: true }).click();
      await page.locator('#history-toggle').click();
      await send(page, { type: 'bookmarkError', message: 'Bookmarks could not be saved.' });
      await expect(page.locator('#bookmark-feedback')).toBeVisible();
      await expect(page.locator('#bookmark-feedback')).toContainText('could not be saved');
      await page.locator('#history-close').click();
      await expect(
        page.getByRole('button', { name: 'Bookmark Java docs', exact: true }),
      ).toBeEnabled();
      await send(page, { type: 'bookmarks', entries: [] });
      await expect(page.locator('#bookmark-feedback')).toBeHidden();
    });
    test('starts off, searches only after an enabled explanation completes, and renders sources safely', async ({
      page,
    }) => {
      await expect(page.getByRole('switch', { name: 'Add web resources' })).not.toBeChecked();
      await page.locator('#explain').click();
      await send(page, { type: 'busy', value: true });
      await send(page, { type: 'lesson', task: 'explain', lesson });
      await send(page, { type: 'busy', value: false });
      expect((await messages(page)).filter((m: any) => m.type === 'research')).toEqual([]);
      await page.locator('#web-research').check();
      await expect(page.locator('#web-topic')).toHaveValue('Java loops');
      await page.locator('#explain').click();
      await send(page, { type: 'busy', value: true });
      await send(page, { type: 'lesson', task: 'explain', lesson });
      await expect(page.locator('#explanation')).toContainText('Your code');
      expect((await messages(page)).filter((m: any) => m.type === 'research')).toHaveLength(0);
      await send(page, { type: 'busy', value: false });
      const calls = (await messages(page)).filter((m: any) => m.type === 'research');
      expect(calls).toEqual([{ type: 'research', topic: 'Java loops', audience: 'beginner' }]);
      expect(JSON.stringify(calls)).not.toMatch(/privateCustomerId|privateOrders/);
      await send(page, { type: 'busy', value: true });
      await send(page, { type: 'research', result: research });
      await send(page, { type: 'busy', value: false });
      await expect(page.locator('#web-result > details')).not.toHaveAttribute('open');
      await page.locator('#web-result > details > summary').click();
      await expect(page.locator('#web-result')).toContainText('300 tokens');
      await expect(page.locator('#explanation')).toContainText('0 tokens');
      await expect(page.locator('#web-result img')).toHaveCount(0);
      await expect(page.locator('#web-result .web-text a')).toHaveCount(1);
      await expect(page.locator('#web-result pre')).toContainText('for (int n');
      await expect(page.locator('#web-result')).toContainText('Book / PDF');
      await page.locator('#web-result a').first().click();
      expect(await messages(page)).toContainEqual({
        type: 'openWebSource',
        url: research.sources[0].url,
      });
    });
    test('turning off stops queued searches and hides late results', async ({ page }) => {
      await page.locator('#web-research').check();
      await page.locator('#explain').click();
      await send(page, { type: 'busy', value: true });
      await page.locator('#web-research').uncheck();
      await send(page, { type: 'lesson', task: 'explain', lesson });
      await send(page, { type: 'busy', value: false });
      expect((await messages(page)).filter((m: any) => m.type === 'research')).toEqual([]);
      await send(page, { type: 'research', result: research });
      await expect(page.locator('#web-result')).toBeEmpty();
      await expect(page.locator('#explanation')).toContainText('Your code');
      await page.locator('#web-research').check();
      await page.locator('#web-topic').fill('Python generators');
      await page.locator('#web-find').click();
      expect(await messages(page)).toContainEqual({
        type: 'research',
        topic: 'Python generators',
        audience: 'beginner',
      });
      await send(page, { type: 'busy', value: true });
      await page.locator('#web-research').uncheck();
      expect(await messages(page)).toContainEqual({ type: 'researchToggle', enabled: false });
    });
    test('failures leave the explanation and draft alone; cached results show zero new tokens', async ({
      page,
    }) => {
      await page.locator('[data-tab=impact]').click();
      await page.locator('#replacement').fill('myCurrentDraft();');
      await page.locator('[data-tab=understand]').click();
      await page.locator('#web-research').check();
      await send(page, { type: 'lesson', task: 'explain', lesson });
      await page.locator('#web-find').click();
      await send(page, {
        type: 'researchError',
        message: 'Web search unavailable. Your explanation is unchanged.',
      });
      await expect(page.locator('#web-status')).toContainText('unavailable');
      await expect(page.locator('#explanation')).toContainText('Your code');
      await send(page, { type: 'research', result: { ...research, cached: true } });
      await page.locator('#web-result > details > summary').click();
      await expect(page.locator('#web-result .result-meta')).toContainText('0 new tokens');
      await page.locator('[data-tab=impact]').click();
      await expect(page.locator('#replacement')).toHaveValue('myCurrentDraft();');
    });
    test('saved web supplements stay available in history without new requests and fit a narrow panel', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 360, height: 850 });
      await send(page, {
        type: 'history',
        enabled: true,
        entries: [
          {
            id: 'saved',
            file: 'Demo.java',
            line: 8,
            language: 'Java',
            code: 'for (;;) {}',
            mode: 'standalone',
            audience: 'beginner',
            updatedAt: 1,
            results: { explain: { lesson, provider: 'groq', model: 'qwen', research } },
          },
        ],
      });
      await page.locator('#history-toggle').click();
      await page.locator('.history-entry').click();
      await page.locator('#history-detail .web-supplement > summary').click();
      await expect(page.locator('#history-detail .web-supplement')).toContainText('0 new tokens');
      expect(
        (await messages(page)).filter((m: any) =>
          ['research', 'request', 'apply'].includes(m.type),
        ),
      ).toEqual([]);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await page.locator('#history-detail .web-source').first().click();
      expect(await messages(page)).toContainEqual({
        type: 'openWebSource',
        url: research.sources[0].url,
      });
    });
    test('restores the switch without fetching and clears pending lookup when the selection changes', async ({
      page,
    }) => {
      await send(page, {
        type: 'config',
        provider: 'groq',
        model: 'qwen',
        audience: 'beginner',
        hasKey: true,
        webResearch: true,
        webResearchModel: 'openai/gpt-oss-20b',
      });
      await expect(page.locator('#web-research')).toBeChecked();
      await expect(page.locator('#web-find')).toBeEnabled();
      expect((await messages(page)).filter((m: any) => m.type === 'research')).toEqual([]);
      await page.locator('#explain').click();
      await send(page, { type: 'busy', value: true });
      await send(page, {
        type: 'selection',
        code: 'const name = 2;',
        language: 'TypeScript',
        file: 'new.ts',
        line: 1,
        start: 0,
        parts: [],
      });
      await send(page, { type: 'busy', value: false });
      expect((await messages(page)).filter((m: any) => m.type === 'research')).toEqual([]);
      await expect(page.locator('#web-topic')).toHaveValue('TypeScript code examples');
    });
  });
