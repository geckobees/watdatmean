import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { panelHtml } from '../../src/panel';
import { inspect } from '../../src/analyzer';

const snippet = inspect('class Game { private score: number = 0; }', 21);
const weeklyLesson = {
  title: 'Calling weeklySummary',
  summary:
    'The script calls a function named weeklySummary with the number 3 as its argument and prints the returned value to the console.',
  steps: ['The argument 3 enters weeklySummary.'],
  concepts: [
    {
      term: 'argument',
      explanation:
        'An argument is a value passed into a function when you call it. Here, that value is 3.',
    },
    {
      term: 'function',
      explanation:
        'A function is a reusable block of code that can take inputs and return a result.',
    },
  ],
  example: { code: 'log(3);', explanation: '3 is the argument passed to log.' },
  predictions: [],
  checks: [],
};
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

test('opens and reopens underlined definitions with clicks and keyboard without AI requests', async ({
  page,
}) => {
  await send(page, {
    type: 'lesson',
    task: 'explain',
    provider: 'groq',
    model: 'test',
    lesson: weeklyLesson,
  });
  const summary = page.locator('#explanation > .lesson > .concept-copy').first();
  const argument = summary.getByRole('button', { name: 'Define argument', exact: true });
  const definition = summary.getByRole('region', {
    name: 'Definition of argument',
    includeHidden: true,
  });
  await expect(definition).toBeHidden();
  await argument.click();
  await expect(argument).toHaveAttribute('aria-expanded', 'true');
  await expect(definition).toContainText('Here, that value is 3');
  await definition.getByRole('button', { name: 'Close definition' }).click();
  await expect(definition).toBeHidden();
  await expect(argument).toBeFocused();
  await argument.press('Enter');
  await expect(definition).toBeVisible();
  await argument.press('Escape');
  await expect(definition).toBeHidden();
  await argument.press('Space');
  await expect(definition).toBeVisible();
  await summary.getByRole('button', { name: 'Define function', exact: true }).click();
  await expect(definition).toBeHidden();
  await expect(argument).toHaveAttribute('aria-expanded', 'false');
  await expect(summary.getByRole('region', { name: 'Definition of function' })).toContainText(
    'reusable block',
  );
  await argument.click();
  await argument.click();
  await expect(definition).toBeHidden();
  for (const section of [
    page.locator('#explanation li').first(),
    page.locator('#explanation > .lesson > .concept-copy').last(),
  ]) {
    await section.getByRole('button', { name: 'Define argument', exact: true }).click();
    await expect(section.getByRole('region', { name: 'Definition of argument' })).toBeVisible();
  }
  expect(
    await page.evaluate(() =>
      (window as unknown as { messages: { type: string }[] }).messages.filter(
        (m) => m.type === 'request',
      ),
    ),
  ).toEqual([]);
});

test('requests a deeper concept explanation only explicitly and keeps its terms clickable', async ({
  page,
}) => {
  await send(page, {
    type: 'lesson',
    task: 'explain',
    provider: 'groq',
    model: 'test',
    lesson: weeklyLesson,
  });
  const summary = page.locator('#explanation > .lesson > .concept-copy').first();
  await summary.getByRole('button', { name: 'Define argument', exact: true }).click();
  const definition = summary.getByRole('region', { name: 'Definition of argument' });
  await definition.getByRole('button', { name: 'Explain further · AI' }).click();
  expect(
    await page.evaluate(() => (window as unknown as { messages: unknown[] }).messages.at(-1)),
  ).toMatchObject({ type: 'request', task: 'concept', concept: 'argument' });
  await send(page, {
    type: 'lesson',
    task: 'concept',
    concept: 'argument',
    provider: 'groq',
    model: 'test',
    lesson: {
      ...weeklyLesson,
      title: 'An input for the function',
      summary: 'An argument supplies the value received by a parameter.',
      steps: [],
      concepts: [
        {
          term: 'parameter',
          explanation: 'A parameter is the name that receives an input inside the function.',
        },
      ],
      example: { code: '', explanation: '' },
    },
  });
  await expect(definition).toContainText('An input for the function');
  await definition.getByRole('button', { name: 'Define parameter', exact: true }).click();
  const nested = definition.getByRole('region', { name: 'Definition of parameter' });
  await expect(nested).toContainText('name that receives an input');
  await expect(nested.getByRole('button', { name: 'Explain further · AI' })).toHaveCount(0);
  await send(page, { type: 'busy', value: true });
  await expect(definition.getByRole('button', { name: 'Explain further · AI' })).toBeDisabled();
  await send(page, { type: 'busy', value: false });
  await send(page, { type: 'stale' });
  await expect(definition.getByRole('button', { name: 'Explain further · AI' })).toBeDisabled();
});

test('renders definitions as text and fits them into a narrow panel', async ({ page }) => {
  await send(page, {
    type: 'lesson',
    task: 'explain',
    provider: 'groq',
    model: 'test',
    lesson: weeklyLesson,
  });
  await page.setViewportSize({ width: 360, height: 900 });
  const summary = page.locator('#explanation > .lesson > .concept-copy').first();
  await summary.getByRole('button', { name: 'Define argument', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'work/panel-clickable-definition.png', fullPage: true });
  await send(page, {
    type: 'lesson',
    task: 'explain',
    provider: 'groq',
    model: 'test',
    lesson: {
      ...weeklyLesson,
      concepts: [{ term: 'argument', explanation: '<img src=x onerror=alert(1)>' }],
    },
  });
  await summary.getByRole('button', { name: 'Define argument', exact: true }).click();
  await expect(summary.getByRole('region', { name: 'Definition of argument' })).toContainText(
    '<img src=x onerror=alert(1)>',
  );
  await expect(page.locator('#explanation img')).toHaveCount(0);
  await send(page, { type: 'selection', ...snippet, file: 'score.ts', line: 4 });
  await expect(page.locator('.concept-definition')).toHaveCount(0);
});
