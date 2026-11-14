import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { panelHtml } from '../../src/panel';
import { inspect } from '../../src/analyzer';

const snippet = inspect('class Game { private score: number = 0; }', 21);
async function send(page: Page, data: unknown) {
  await page.evaluate((data) => window.dispatchEvent(new MessageEvent('message', { data })), data);
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const host = window as unknown as { acquireVsCodeApi: () => unknown; messages: unknown[] };
    host.messages = [];
    host.acquireVsCodeApi = () => ({
      postMessage: (m: unknown) => host.messages.push(m),
      getState: () => ({}),
      setState: () => {},
    });
  });
  await page.route('https://panel.test/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('.js') || path.endsWith('.css')) {
      await route.fulfill({
        body: readFileSync(`media${path}`),
        contentType: path.endsWith('.js') ? 'application/javascript' : 'text/css',
      });
    } else
      await route.fulfill({
        body: panelHtml(
          {
            cspSource: 'https://panel.test',
            css: 'https://panel.test/panel.css',
            script: 'https://panel.test/panel.js',
          },
          'test-nonce',
        ),
        contentType: 'text/html',
      });
  });
  await page.goto('https://panel.test/');
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { messages: { type: string }[] }).messages.some(
          (m) => m.type === 'ready',
        ),
      ),
    )
    .toBe(true);
  await send(page, { type: 'selection', ...snippet, file: 'score.ts', line: 4 });
});
test('shows instant explanations without requesting AI, and fits a narrow panel', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'private', exact: true }).click();
  await expect(page.locator('#part-detail')).toContainText('compile time');
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { messages: { type: string }[] }).messages.filter(
          (m) => m.type === 'request',
        ).length,
    ),
  ).toBe(0);
  await page.screenshot({ path: 'work/panel-wide.png', fullPage: true });
  await page.setViewportSize({ width: 360, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'work/panel-narrow.png', fullPage: true });
});
test('sends explicit explanation, example and concept requests; safely renders hostile content', async ({
  page,
}) => {
  await page.locator('#explain').click();
  expect(
    await page.evaluate(() => (window as unknown as { messages: unknown[] }).messages.at(-1)),
  ).toMatchObject({ type: 'request', task: 'explain', mode: 'standalone' });
  await send(page, {
    type: 'lesson',
    task: 'explain',
    cached: true,
    provider: 'groq',
    model: 'test',
    lesson: {
      title: 'A starting score',
      summary: '<img src=x onerror=alert(1)>',
      steps: ['Start at zero.'],
      concepts: [{ term: 'Scope', explanation: 'Where a name is available.' }],
      example: { code: 'const x = "<script>";', explanation: 'A string.' },
      predictions: [],
      checks: [],
    },
  });
  await expect(page.locator('#explanation')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#explanation img')).toHaveCount(0);
  await expect(page.locator('#explanation')).toContainText('REUSED FROM CACHE');
  await page.getByText('Scope', { exact: true }).click();
  await page.getByRole('button', { name: 'Explain this concept' }).click();
  expect(
    await page.evaluate(() => (window as unknown as { messages: unknown[] }).messages.at(-1)),
  ).toMatchObject({ task: 'concept', concept: 'Scope' });
  await page.getByRole('button', { name: 'Another example', exact: true }).click();
  await page.locator('#example').click();
  expect(
    await page.evaluate(() => (window as unknown as { messages: unknown[] }).messages.at(-1)),
  ).toMatchObject({ task: 'example' });
});
test('only enables applying the exact preview and disables it after edits or stale code', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Preview an edit', exact: true }).click();
  await expect(page.locator('#apply')).toBeDisabled();
  await page.locator('#replacement').fill('private score: number = 10;');
  await page.locator('#preview').click();
  expect(
    await page.evaluate(() => (window as unknown as { messages: unknown[] }).messages.at(-1)),
  ).toMatchObject({ type: 'preview', replacement: 'private score: number = 10;' });
  await send(page, { type: 'preview', errors: [] });
  await expect(page.locator('#apply')).toBeEnabled();
  await page.locator('#replacement').fill('private score: number = 20;');
  await expect(page.locator('#apply')).toBeDisabled();
  await send(page, { type: 'preview', errors: ['Expression expected.'] });
  await expect(page.locator('#preview-status')).toContainText('Expression expected');
  await send(page, { type: 'stale' });
  await expect(page.locator('#analyze')).toBeDisabled();
  await expect(page.locator('#stale')).toBeVisible();
  await expect(page.locator('#refresh')).toBeEnabled();
});
test('displays confirmed evidence separately and manages loading and errors', async ({ page }) => {
  await page.getByRole('button', { name: 'Preview an edit', exact: true }).click();
  await send(page, {
    type: 'evidence',
    note: 'References are confirmed; behavior is predicted.',
    items: [
      {
        id: 'E1',
        kind: 'reference',
        test: true,
        file: 'score.test.ts',
        line: 3,
        code: 'calculatePoints(3)',
      },
    ],
  });
  await expect(page.locator('#evidence')).toContainText('Confirmed reference · Test file');
  await page.getByRole('button', { name: 'score.test.ts:3' }).click();
  expect(
    await page.evaluate(() => (window as unknown as { messages: unknown[] }).messages.at(-1)),
  ).toMatchObject({ type: 'openEvidence', id: 'E1' });
  await send(page, { type: 'busy', value: true });
  await expect(page.locator('#progress')).toBeVisible();
  await expect(page.locator('#replacement')).toBeDisabled();
  await page.locator('#cancel').click();
  await send(page, { type: 'busy', value: false });
  await send(page, { type: 'error', message: 'API key rejected.' });
  await expect(page.getByRole('alert')).toHaveText('API key rejected.');
  await expect(page.locator('#analyze')).toBeEnabled();
});
