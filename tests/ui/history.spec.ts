import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { panelHtml } from '../../src/panel';

const lesson = {
  title: 'Keep the count',
  summary: 'The variable stores a count.',
  steps: ['Read the variable.'],
  concepts: [{ term: 'variable', explanation: 'A name for a value.' }],
  example: { code: 'const extra = 3;', explanation: 'Another count.' },
  predictions: [{ description: 'The count changes.', evidenceIds: ['old-file'] }],
  checks: [],
  syntax: {
    partial: false,
    issues: ['Missing a semicolon.'],
    explanation: 'End the statement.',
    corrected: 'int count = 2;',
  },
};
const entry = {
  id: 'saved-one',
  file: 'src/Demo.java',
  line: 23,
  code: 'int count = 2;\n// <img src=x onerror=alert(1)>',
  language: 'Java',
  mode: 'standalone',
  audience: 'beginner',
  updatedAt: Date.now(),
  results: {
    explain: {
      lesson,
      provider: 'fixture',
      model: 'test',
      mode: 'standalone',
      audience: 'beginner',
    },
    impact: {
      lesson,
      provider: 'fixture',
      model: 'test',
      mode: 'project',
      audience: 'experienced',
      replacement: 'int count = 9;',
    },
  },
};
async function send(page: Page, data: unknown) {
  await page.evaluate((data) => window.dispatchEvent(new MessageEvent('message', { data })), data);
}
async function messages(page: Page) {
  return page.evaluate(() => (window as any).messages);
}
for (const editor of ['VS Code', 'IntelliJ'])
  test.describe(`${editor} local history`, () => {
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
      await page.route('https://history.test/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (/\.(js|css)$/.test(path)) {
          await route.fulfill({
            body: readFileSync(`media${path}`),
            contentType: path.endsWith('.js') ? 'application/javascript' : 'text/css',
          });
        } else {
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
                      cspSource: 'https://history.test',
                      css: 'https://history.test/panel.css',
                      script: 'https://history.test/panel.js',
                    },
                    'test-nonce',
                  ),
          });
        }
      });
      await page.goto('https://history.test/');
      await expect.poll(() => messages(page)).toContainEqual({ type: 'ready' });
      await send(page, {
        type: 'selection',
        code: 'const current = 1;',
        language: 'TypeScript',
        file: 'now.ts',
        line: 1,
        start: 0,
        parts: [],
      });
      await send(page, { type: 'history', version: 1, enabled: true, entries: [entry] });
    });
    test('reviews grouped results without changing the current draft or requesting AI', async ({
      page,
    }) => {
      await page.locator('[data-tab=impact]').click();
      await page.locator('#replacement').fill('const current = 42;');
      await page.locator('#history-toggle').click();
      await expect(page.locator('#learning-panel')).toBeHidden();
      await page.locator('.history-entry').click();
      await expect(page.locator('.history-source code')).toHaveText(entry.code);
      await expect(page.locator('#history-detail img')).toHaveCount(0);
      await expect(page.locator('#history-detail .result-meta')).toContainText('0 new tokens');
      await expect(page.locator('#history-detail')).toContainText('src/Demo.java:23');
      await expect(
        page
          .locator('#history-detail')
          .getByRole('button', { name: /Explain this concept|Try corrected version/ }),
      ).toHaveCount(0);
      await expect(page.locator('#history-detail a')).toHaveCount(0);
      await page.locator('#history-view').selectOption('impact');
      await expect(page.locator('#history-detail')).toContainText('int count = 9;');
      await expect(page.locator('#history-detail')).toContainText(
        'In this project · Getting up to speed',
      );
      await page.locator('#history-close').click();
      await expect(page.locator('#replacement')).toHaveValue('const current = 42;');
      await expect(page.locator('#source')).toHaveText('const current = 1;');
      expect(
        (await messages(page)).filter((m: any) =>
          ['request', 'apply', 'openEvidence', 'preview'].includes(m.type),
        ),
      ).toEqual([]);
    });
    test('searches code, file and saved drafts; offers deliberate cleanup and pause controls', async ({
      page,
    }) => {
      await page.locator('#history-toggle').click();
      await expect(page.locator('.history-entry')).toHaveCount(1);
      await page.locator('#history-search').fill('not-found');
      await expect(page.locator('.history-entry')).toHaveCount(0);
      await expect(page.locator('#history-empty')).toHaveText('No matching entries.');
      for (const search of ['DEMO.java', 'count = 9', 'stores a count']) {
        await page.locator('#history-search').fill(search);
        await expect(page.locator('.history-entry')).toHaveCount(1);
      }
      await page.locator('#history-enabled').uncheck();
      expect(await messages(page)).toContainEqual({ type: 'historyEnabled', enabled: false });
      await send(page, { type: 'history', enabled: false, entries: [entry] });
      await expect(page.locator('#history-status')).toContainText('paused');
      await page.locator('#history-clear').click();
      await page.locator('#history-keep').click();
      expect(await messages(page)).not.toContainEqual({ type: 'historyClear' });
      await page.locator('#history-clear').click();
      await page.locator('#history-confirm-clear').click();
      expect(await messages(page)).toContainEqual({ type: 'historyClear' });
      await send(page, { type: 'history', enabled: false, entries: [] });
      await page.locator('#history-search').fill('');
      await expect(page.locator('#history-empty')).toContainText('paused');
      await expect(page.locator('#history-enabled')).not.toBeChecked();
    });
    test('removes a selected entry, restores focus and fits a narrow panel', async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 800 });
      await page.locator('#history-toggle').click();
      await page.locator('.history-entry').click();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await page.getByRole('button', { name: 'Remove entry', exact: true }).click();
      expect(await messages(page)).toContainEqual({ type: 'historyRemove', id: entry.id });
      await send(page, { type: 'history', enabled: true, entries: [] });
      await expect(page.locator('#history-search')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.locator('#history-panel')).toBeHidden();
      await expect(page.locator('#history-toggle')).toBeFocused();
    });
    test('shows storage failures without replacing a lesson and allows a corrupt store to be cleared', async ({
      page,
    }) => {
      await send(page, { type: 'history', enabled: true, entries: [null, { results: null }] });
      await send(page, {
        type: 'historyError',
        message: 'History could not be saved. Your current lesson is still available.',
      });
      await page.locator('#history-toggle').click();
      await expect(page.locator('#history-status')).toContainText('could not be saved');
      await expect(page.locator('#history-clear')).toBeEnabled();
      await page.locator('#history-close').click();
      await expect(page.locator('#source')).toHaveText('const current = 1;');
    });
  });
