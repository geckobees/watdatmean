import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { panelHtml } from '../../src/panel';
import { inspect } from '../../src/analyzer';
import { parseLesson } from '../../src/provider';

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
test('renders concise results, loads concepts on click, and reports actual or cached usage', async ({
  page,
}) => {
  const lesson = parseLesson(
    JSON.stringify({ summary: 'The score starts at zero.', concepts: ['binding'] }),
  );
  const message = {
    type: 'lesson',
    task: 'explain',
    cached: false,
    provider: 'groq',
    model: 'test',
    lesson: { ...lesson, usage: { input: 420, output: 100, total: 520 } },
  };
  await send(page, message);
  await expect(page.locator('#explanation')).toContainText('520 tokens (420 input + 100 output)');
  await expect(page.locator('#explanation')).toContainText('Your full context was kept');
  await expect(page.locator('#explanation')).not.toContainText('Put it into practice');
  await expect(page.locator('#explanation')).not.toContainText('Walk through it');
  expect(
    await page.evaluate(() =>
      (window as unknown as { messages: { type: string }[] }).messages.filter(
        (m) => m.type === 'request',
      ),
    ),
  ).toEqual([]);
  await page.getByText('binding', { exact: true }).click();
  await page.getByRole('button', { name: 'Explain this concept' }).click();
  expect(
    await page.evaluate(() => (window as unknown as { messages: unknown[] }).messages.at(-1)),
  ).toMatchObject({ task: 'concept', concept: 'binding' });
  await send(page, {
    type: 'lesson',
    task: 'concept',
    concept: 'binding',
    cached: false,
    provider: 'groq',
    model: 'test',
    lesson: parseLesson('{"summary":"A binding connects a name to a value."}'),
  });
  await expect(page.locator('.concept-result')).toContainText(
    'A binding connects a name to a value.',
  );
  await send(page, { ...message, cached: true });
  await expect(page.locator('#explanation')).toContainText('0 new tokens');
  await expect(page.locator('#explanation')).not.toContainText('520 tokens');
  await expect(page.locator('#explanation')).not.toContainText('Above the 500-token target');
  await send(page, { ...message, lesson });
  await expect(page.locator('#explanation')).toContainText('Token usage not reported');
});

test('unpacks method and nested call pieces locally', async ({ page }) => {
  const source = 'const board = new Scoreboard();\nboard.addCompletedTasks(3);';
  await send(page, {
    type: 'selection',
    ...inspect(source, source.lastIndexOf('board')),
    file: 'dashboard.ts',
    line: 9,
  });
  await expect(page.locator('#syntax-section')).toBeVisible();
  await page.getByRole('button', { name: 'board', exact: true }).click();
  await expect(page.locator('#part-detail')).toContainText('new Scoreboard instance');
  await page.getByRole('button', { name: '.', exact: true }).click();
  await expect(page.locator('#part-detail')).toContainText('dot itself does not run it');
  await page.getByRole('button', { name: '3', exact: true }).click();
  await expect(page.locator('#part-detail')).toContainText('argument 1 to board.addCompletedTasks');
  await send(page, {
    type: 'selection',
    ...inspect('console.log(weeklySummary(3));', 0),
    file: 'dashboard.ts',
    line: 10,
  });
  await page.getByRole('button', { name: 'weeklySummary', exact: true }).click();
  await expect(page.locator('#part-detail')).toContainText(
    'result is passed as argument 1 to console.log',
  );
  await page.setViewportSize({ width: 360, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(
    await page.evaluate(() =>
      (window as unknown as { messages: { type: string }[] }).messages.filter(
        (m) => m.type === 'request',
      ),
    ),
  ).toEqual([]);
  await page.screenshot({ path: 'work/panel-nested-call.png', fullPage: true });
});
test('only enables applying the exact preview and disables it after edits or stale code', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Try it yourself', exact: true }).click();
  await expect(page.locator('#apply')).toBeDisabled();
  await page.locator('#replacement').fill('private score: number = 10;');
  await page.locator('#preview').click();
  expect(
    await page.evaluate(() => (window as unknown as { messages: unknown[] }).messages.at(-1)),
  ).toMatchObject({ type: 'preview', replacement: 'private score: number = 10;' });
  await send(page, { type: 'preview', errors: [], replacement: 'private score: number = 10;' });
  await expect(page.locator('#apply')).toBeEnabled();
  await page.locator('#replacement').fill('private score: number = 20;');
  await expect(page.locator('#apply')).toBeDisabled();
  await send(page, {
    type: 'preview',
    errors: ['Expression expected.'],
    replacement: 'private score: number = 20;',
  });
  await expect(page.locator('#preview-status')).toContainText('Expression expected');
  await send(page, { type: 'stale' });
  await expect(page.locator('#analyze')).toBeDisabled();
  await expect(page.locator('#stale')).toBeVisible();
  await expect(page.locator('#refresh')).toBeEnabled();
});
test('displays confirmed evidence separately and manages loading and errors', async ({ page }) => {
  await page.getByRole('button', { name: 'Try it yourself', exact: true }).click();
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
  await page.locator('#replacement').fill('private score: number = 30;');
  await send(page, { type: 'busy', value: true });
  await expect(page.locator('#progress')).toBeVisible();
  await expect(page.locator('#replacement')).toBeDisabled();
  await page.locator('#cancel').click();
  await send(page, { type: 'busy', value: false });
  await send(page, { type: 'error', message: 'API key rejected.' });
  await expect(page.getByRole('alert')).toHaveText('API key rejected.');
  await expect(page.locator('#analyze')).toBeEnabled();
});

test('supports repeated comparisons, syntax fixes, and starting over', async ({ page }) => {
  await page.getByRole('button', { name: 'Try it yourself', exact: true }).click();
  await expect(
    page.getByText('Comparing checks syntax and shows the difference. It does not run your code.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'See what changes', exact: true })).toBeDisabled();
  for (const replacement of [
    'private score: number = 10;',
    'private score: number = ;',
    'private score: number = 20;',
  ]) {
    await page.getByRole('textbox', { name: 'Your version of the code' }).fill(replacement);
    await page.getByRole('button', { name: 'See what changes', exact: true }).click();
    expect(
      await page.evaluate(() => (window as unknown as { messages: unknown[] }).messages.at(-1)),
    ).toMatchObject({ type: 'preview', replacement });
    await send(page, { type: 'busy', value: true });
    const errors = replacement.includes('= ;') ? ['Expression expected.'] : [];
    await send(page, { type: 'preview', errors, replacement });
    await send(page, { type: 'busy', value: false });
    await expect(page.locator('#replacement')).toBeEnabled();
    await expect(page.locator('#preview')).toBeEnabled();
    if (errors.length) await expect(page.locator('#apply')).toBeDisabled();
    else await expect(page.locator('#apply')).toBeEnabled();
  }
  await page.getByRole('button', { name: 'Start over', exact: true }).click();
  await expect(page.locator('#replacement')).toHaveValue(snippet.code);
  await expect(page.locator('#apply')).toBeDisabled();
  await expect(page.locator('#preview-status')).toContainText('Try another change');
  expect(
    await page.evaluate(() =>
      (window as unknown as { messages: { type: string }[] }).messages.filter(
        (m) => m.type === 'apply',
      ),
    ),
  ).toEqual([]);
});

test('continues in Try it yourself after applying a change or loading the latest code', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Try it yourself', exact: true }).click();
  let current = snippet.code;
  for (const replacement of ['private score: number = 10;', 'private score: number = 200;']) {
    await page.locator('#replacement').fill(replacement);
    await page.locator('#preview').click();
    await send(page, { type: 'preview', errors: [], replacement });
    await page.getByRole('button', { name: 'Use this code', exact: true }).click();
    expect(
      await page.evaluate(() => (window as unknown as { messages: unknown[] }).messages.at(-1)),
    ).toMatchObject({ type: 'apply', replacement });
    await send(page, { type: 'busy', value: true });
    await send(page, { type: 'stale' });
    await send(page, {
      type: 'selection',
      code: replacement,
      parts: [],
      file: 'score.ts',
      line: 4,
      keepTab: true,
    });
    await send(page, { type: 'applied' });
    await send(page, { type: 'busy', value: false });
    await expect(
      page.getByRole('button', { name: 'Try it yourself', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#stale')).toBeHidden();
    await expect(page.locator('#replacement')).toBeEnabled();
    await expect(page.locator('#replacement')).toHaveValue(replacement);
    await expect(page.locator('#source')).toHaveText(replacement);
    await expect(page.locator('#preview-status')).toContainText('Keep tinkering');
    current = replacement;
  }
  await page.locator('#replacement').fill('private score = 999;');
  await page.locator('#reset').click();
  await expect(page.locator('#replacement')).toHaveValue(current);
  await send(page, { type: 'stale' });
  await page.getByRole('button', { name: 'Use latest code' }).click();
  expect(
    await page.evaluate(() => (window as unknown as { messages: unknown[] }).messages.at(-1)),
  ).toMatchObject({ type: 'refresh' });
  await send(page, {
    type: 'selection',
    code: 'private score = 5;',
    parts: [],
    file: 'score.ts',
    line: 4,
    keepTab: true,
  });
  await page.locator('#replacement').fill('private score = 6;');
  await expect(page.locator('#preview')).toBeEnabled();
  await expect(page.locator('#impact')).toBeVisible();
  await page.setViewportSize({ width: 360, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'work/panel-try-it-yourself.png', fullPage: true });
});
