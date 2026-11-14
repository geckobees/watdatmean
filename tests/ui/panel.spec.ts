import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { panelHtml } from '../../src/panel';
import { inspect } from '../../src/analyzer';
import { parseLesson } from '../../src/provider';

const snippet = inspect('class Game { private score: number = 0; }', 21);
// Exercise installed assets as well as workspace assets, without recording the screen.
const assetRoot = process.env.WATDATMEAN_UI_ASSET_ROOT ?? process.cwd();
const captureScreenshots = process.env.WATDATMEAN_UI_SCREENSHOTS === '1';
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
        body: readFileSync(resolve(assetRoot, `media${path}`)),
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
  if (captureScreenshots) await page.screenshot({ path: 'work/panel-wide.png', fullPage: true });
  await page.setViewportSize({ width: 360, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  if (captureScreenshots) await page.screenshot({ path: 'work/panel-narrow.png', fullPage: true });
});
test('lets beginners unpack new and the constructor independently without changing the code layout', async ({
  page,
}) => {
  const code = 'const board = new Scoreboard();';
  await send(page, { type: 'selection', ...inspect(code, 0), file: 'dashboard.ts', line: 1 });
  const parts = page.locator('#parts');
  expect(await parts.textContent()).toBe(code);
  await parts.getByRole('button', { name: 'new', exact: true }).click();
  await expect(page.locator('#part-detail')).toContainText('new creates a Scoreboard object');
  await parts.getByRole('button', { name: 'Scoreboard', exact: true }).click();
  await expect(page.locator('#part-detail')).toContainText('A constructor is the setup code');
  await expect(parts.getByRole('button', { name: 'new', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await parts.getByRole('button', { name: '(', exact: true }).click();
  await expect(page.locator('#part-detail')).toContainText(
    'Empty () means Scoreboard receives no inputs',
  );
  await parts.getByRole('button', { name: 'board', exact: true }).click();
  await expect(page.locator('#part-detail')).toContainText(
    'board holds a reference to the new object',
  );
  expect(
    await page.evaluate(() =>
      (window as unknown as { messages: { type: string }[] }).messages.filter(
        (m) => m.type === 'request',
      ),
    ),
  ).toEqual([]);
});
test('lays out clickable interface pieces like the source and selects repeated pieces independently', async ({
  page,
}) => {
  const code = `export interface Part {
  token: string;
  brief: string;
  detail: string;
  start?: number;
  end?: number;
}`;
  const prefix = 'const note = "token: string";\n\n';
  await send(page, {
    type: 'selection',
    ...inspect(prefix + code, prefix.length),
    file: 'types.ts',
    line: 3,
  });
  const parts = page.locator('#parts');
  expect(await parts.textContent()).toBe(code);
  const first = await parts.getByRole('button', { name: 'export', exact: true }).boundingBox();
  const token = await parts.getByRole('button', { name: 'token', exact: true }).boundingBox();
  const brief = await parts.getByRole('button', { name: 'brief', exact: true }).boundingBox();
  const close = await parts.getByRole('button', { name: '}', exact: true }).boundingBox();
  expect(token!.x - first!.x).toBeCloseTo((2 * first!.width) / 'export'.length, 0);
  expect(brief!.x).toBeCloseTo(token!.x, 1);
  expect(brief!.y).toBeGreaterThan(token!.y);
  expect(close!.x).toBeCloseTo(first!.x, 1);
  expect(close!.y).toBeGreaterThan(brief!.y);

  const strings = parts.getByRole('button', { name: 'string', exact: true });
  await strings.nth(1).click();
  await expect(strings.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(strings.nth(0)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#part-detail')).toContainText('Stores text');
  await parts.getByRole('button', { name: 'interface', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#part-detail')).toContainText('creates no runtime object');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  await expect(parts.getByRole('button', { name: 'Part', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(parts.locator('.selected')).toHaveCount(1);
  expect(
    await page.evaluate(() =>
      (window as unknown as { messages: { type: string }[] }).messages.filter(
        (m) => m.type === 'request',
      ),
    ),
  ).toEqual([]);
  await parts.getByRole('button', { name: 'token', exact: true }).click();
  if (captureScreenshots)
    await page.locator('#syntax-section').screenshot({ path: 'work/panel-indented-pieces.png' });
});

test('preserves tabs, blank lines, comments, and multiline pieces as safe source text', async ({
  page,
}) => {
  const code =
    'export interface Part {\r\n\t// Keep this comment and spacing.\r\n\ttoken: string;\r\n\r\n\tdetail: {\r\n\t\tlabel: "<img src=x onerror=alert(1)>";\r\n\t};\r\n}';
  await send(page, { type: 'selection', ...inspect(code, 0), file: 'types.ts', line: 1 });
  expect(await page.locator('#parts').textContent()).toBe(code);
  await expect(page.locator('#parts img')).toHaveCount(0);
  const multiline = page.locator('#parts .part').filter({ hasText: 'label:' });
  await multiline.focus();
  await page.keyboard.press('Enter');
  await expect(multiline).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#part-detail')).toBeVisible();
  const aligned = await page.evaluate(() => {
    const source = document.getElementById('source')!.firstChild!;
    const parts = document.getElementById('parts')!;
    const origin = parts.querySelector('.part')!.getBoundingClientRect();
    const start = document.createRange();
    start.setStart(source, 0);
    start.setEnd(source, 1);
    const sourceOrigin = start.getBoundingClientRect();
    return ['token', 'detail'].map((name) => {
      const index = source.textContent!.indexOf(name + ':');
      const range = document.createRange();
      range.setStart(source, index);
      range.setEnd(source, index + name.length);
      const original = range.getBoundingClientRect();
      const piece = parts.querySelector(`[aria-label="${name}"]`)!.getBoundingClientRect();
      return {
        x: piece.x - origin.x,
        y: piece.y - origin.y,
        expectedX: original.x - sourceOrigin.x,
        expectedY: original.y - sourceOrigin.y,
      };
    });
  });
  for (const position of aligned) {
    expect(position.x).toBeCloseTo(position.expectedX, 1);
    expect(position.y).toBeCloseTo(position.expectedY, 1);
  }
});

test('opens only the selected interface member and keeps its pieces clickable', async ({
  page,
}) => {
  const source = 'export interface Part {\n  token: string;\n  start?: number;\n}';
  await send(page, {
    type: 'selection',
    ...inspect(source, source.indexOf('start?')),
    file: 'types.ts',
    line: 3,
  });
  expect(await page.locator('#source').textContent()).toBe('start?: number;');
  expect(await page.locator('#parts').textContent()).toBe('start?: number;');
  await expect(
    page.locator('#parts').getByRole('button', { name: 'token', exact: true }),
  ).toHaveCount(0);
  await page.locator('#parts').getByRole('button', { name: '?', exact: true }).click();
  await expect(page.locator('#part-detail')).toContainText('optional');
  await page.locator('#parts').getByRole('button', { name: ':', exact: true }).click();
  await expect(page.locator('#part-detail')).toContainText('start should hold a number');
});

test('keeps long lines intact within a narrow panel and resets the selected piece on refresh', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 900 });
  const code = `const message = \`First line\n\t${'A long line of text. '.repeat(10)}\nLast line\`;`;
  await send(page, { type: 'selection', ...inspect(code, 0), file: 'message.ts', line: 1 });
  expect(await page.locator('#parts').textContent()).toBe(code);
  const scrolling = await page.locator('.parts-code').evaluate((el) => ({
    width: el.clientWidth,
    content: el.scrollWidth,
    whiteSpace: getComputedStyle(el).whiteSpace,
  }));
  expect(scrolling.content).toBeGreaterThan(scrolling.width);
  expect(scrolling.whiteSpace).toBe('pre');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#parts').getByRole('button', { name: 'message', exact: true }).click();
  await expect(page.locator('#part-detail')).toBeVisible();
  if (captureScreenshots)
    await page.locator('#syntax-section').screenshot({ path: 'work/panel-pieces-narrow.png' });
  await send(page, { type: 'selection', ...snippet, file: 'score.ts', line: 4 });
  expect(await page.locator('#parts').textContent()).toBe(snippet.code);
  await expect(page.locator('#parts .selected')).toHaveCount(0);
  await expect(page.locator('#part-detail')).toBeHidden();
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

test('preserves clickable definitions in a compact response with token usage', async ({ page }) => {
  const lesson = parseLesson(
    JSON.stringify({
      summary: 'A binding gives the value zero the name score.',
      concepts: [{ term: 'binding', explanation: 'A name connected to a value.' }],
    }),
  );
  await send(page, {
    type: 'lesson',
    task: 'explain',
    cached: false,
    provider: 'groq',
    model: 'test',
    lesson: { ...lesson, usage: { input: 200, output: 70, total: 270 } },
  });
  await expect(page.locator('#explanation')).toContainText('270 tokens');
  await page.getByRole('button', { name: 'Define binding', exact: true }).click();
  const definition = page.getByRole('region', { name: 'Definition of binding' });
  await expect(definition).toContainText('A name connected to a value.');
  expect(
    await page.evaluate(() =>
      (window as unknown as { messages: { type: string }[] }).messages.filter(
        (m) => m.type === 'request',
      ),
    ),
  ).toEqual([]);
  await definition.getByRole('button', { name: 'Explain further' }).click();
  expect(
    await page.evaluate(() => (window as unknown as { messages: unknown[] }).messages.at(-1)),
  ).toMatchObject({ task: 'concept', concept: 'binding' });
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
  if (captureScreenshots)
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
  if (captureScreenshots)
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
  if (captureScreenshots)
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
