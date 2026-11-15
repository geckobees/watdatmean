import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { panelHtml } from '../../src/panel';
import { inspect } from '../../src/analyzer';
import { parseLesson } from '../../src/provider';
import { objectCreationLesson } from '../fixtures/object-creation';

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
    const host = window as unknown as {
      acquireVsCodeApi: () => unknown;
      messages: unknown[];
      savedState: unknown;
    };
    host.messages = [];
    host.acquireVsCodeApi = () => ({
      postMessage: (m: unknown) => host.messages.push(m),
      getState: () => JSON.parse(sessionStorage.getItem('panel-state') || '{}'),
      setState: (state: unknown) => {
        host.savedState = state;
        sessionStorage.setItem('panel-state', JSON.stringify(state));
      },
    });
  });
  await page.route('https://panel.test/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('.js') || path.endsWith('.css') || path.endsWith('.ttf')) {
      await route.fulfill({
        body: readFileSync(resolve(assetRoot, `media${path}`)),
        contentType: path.endsWith('.js')
          ? 'application/javascript'
          : path.endsWith('.ttf')
            ? 'font/ttf'
            : 'text/css',
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
test('unpacks a long Record and tuple declaration, including when its object is unfinished', async ({
  page,
}) => {
  const header = 'const glossary: Record<string, [string, string]> = {';
  for (const code of [header, header + '\n  const: ["brief", "detail"],\n};']) {
    await send(page, { type: 'selection', ...inspect(code, 0), file: 'analyzer.ts', line: 6 });
    const parts = page.locator('#parts');
    expect(await parts.textContent()).toBe(code);
    await parts.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(page.locator('#part-detail')).toContainText(
      'text keys each hold a pair of text values',
    );
    const strings = parts.getByRole('button', { name: 'string', exact: true });
    await strings.nth(0).click();
    await expect(page.locator('#part-detail')).toContainText('Each key is text');
    await strings.nth(1).click();
    await expect(page.locator('#part-detail')).toContainText('Entry 1 should be text');
    await strings.nth(2).click();
    await expect(page.locator('#part-detail')).toContainText('Entry 2 should be text');
    await page.setViewportSize({ width: 360, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
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
  const characterWidth = await parts
    .locator('.part')
    .first()
    .evaluate((element) => {
      const character = document.createRange();
      character.setStart(element.firstChild!, 0);
      character.setEnd(element.firstChild!, 1);
      return character.getBoundingClientRect().width;
    });
  expect(token!.x - first!.x).toBeCloseTo(2 * characterWidth, 0);
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
  await page.getByText('Original code', { exact: true }).click();
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
        expectedY:
          ((original.y - sourceOrigin.y) /
            parseFloat(getComputedStyle(document.getElementById('source')!).lineHeight)) *
          parseFloat(getComputedStyle(parts).lineHeight),
      };
    });
  });
  for (const position of aligned) {
    expect(position.x).toBeCloseTo(position.expectedX, 1);
    expect(position.y).toBeCloseTo(position.expectedY, 0);
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
  await page.getByRole('button', { name: 'Example', exact: true }).click();
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
    lesson,
    usage: { inputTokens: 420, outputTokens: 100, totalTokens: 520 },
  };
  await send(page, message);
  await expect(page.locator('#explanation .token-usage')).toContainText('520 tokens');
  await expect(page.locator('#explanation .token-usage')).toContainText('420 input');
  await expect(page.locator('#explanation .token-usage')).toContainText('100 output');
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
  await send(page, { ...message, lesson, usage: undefined });
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
    lesson,
    usage: { inputTokens: 200, outputTokens: 70, totalTokens: 270 },
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
  const call = 'board.addCompletedTasks(3);';
  expect(await page.locator('#parts').textContent()).toBe(call);
  const blocks = await page.locator('#parts .part').evaluateAll((pieces) =>
    pieces.map((piece) => {
      const box = piece.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, height: box.height };
    }),
  );
  expect(blocks).toHaveLength(7);
  for (let index = 0; index < blocks.length; index++) {
    expect(blocks[index].height).toBeGreaterThanOrEqual(22);
    expect(blocks[index].top).toBeCloseTo(blocks[0].top, 1);
    if (index) expect(blocks[index].left - blocks[index - 1].right).toBeGreaterThanOrEqual(4);
  }
  const copied = await page.locator('#parts').evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const text = selection.toString();
    selection.removeAllRanges();
    return text;
  });
  expect(copied).toBe(call);
  await page.getByRole('button', { name: 'board', exact: true }).click();
  await expect(page.locator('#part-detail')).toContainText('new Scoreboard instance');
  await page.getByRole('button', { name: '.', exact: true }).click();
  await expect(page.locator('#part-detail')).toContainText('dot itself does not run it');
  await page.getByRole('button', { name: '3', exact: true }).click();
  await expect(page.locator('#part-detail')).toContainText('argument 1 to board.addCompletedTasks');
  if (captureScreenshots)
    await page
      .locator('.workbench')
      .screenshot({ path: 'work/method-blocks-preview.png', animations: 'disabled' });
  const multilineCall = 'board.addCompletedTasks(\n\t3\n);';
  await send(page, {
    type: 'selection',
    ...inspect(multilineCall, 0),
    file: 'dashboard.ts',
    line: 9,
  });
  expect(await page.locator('#parts').textContent()).toBe(multilineCall);
  const indentation = await page.locator('#parts').evaluate((element) => {
    const first = element.querySelector('[aria-label="board"]')!;
    const argument = element.querySelector('[aria-label="3"]')!;
    const close = element.querySelector('[aria-label=")"]')!;
    const character = document.createRange();
    character.setStart(first.firstChild!, 0);
    character.setEnd(first.firstChild!, 1);
    return {
      first: first.getBoundingClientRect().x,
      argument: argument.getBoundingClientRect().x,
      close: close.getBoundingClientRect().x,
      indent: character.getBoundingClientRect().width * 2,
    };
  });
  expect(indentation.argument - indentation.first).toBeCloseTo(indentation.indent, 0);
  expect(indentation.close).toBeCloseTo(indentation.first, 1);
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
  await page.getByRole('button', { name: 'Edit code', exact: true }).click();
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
  await page.getByRole('button', { name: 'Edit code', exact: true }).click();
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
  await page.getByRole('button', { name: 'Edit code', exact: true }).click();
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
  await expect(page.locator('#preview-status')).toHaveText(
    'Restored the current code from your file.',
  );
  expect(
    await page.evaluate(() =>
      (window as unknown as { messages: { type: string }[] }).messages.filter(
        (m) => m.type === 'apply',
      ),
    ),
  ).toEqual([]);
});

test('continues in Edit code after applying a change or loading the latest code', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Edit code', exact: true }).click();
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
    await expect(page.getByRole('button', { name: 'Edit code', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('#stale')).toBeHidden();
    await expect(page.locator('#replacement')).toBeEnabled();
    await expect(page.locator('#replacement')).toHaveValue(replacement);
    await expect(page.locator('#source')).toHaveText(replacement);
    await expect(page.locator('#preview-status')).toContainText(
      'Compare again after further edits',
    );
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

test('highlights each term once per answer, including local fallback definitions', async ({
  page,
}) => {
  const summaryText =
    'This line creates a new scoreboard object using the Scoreboard class. The new keyword tells JavaScript to allocate memory for it and initialize its properties. The resulting object is stored in a constant variable named board for later use.';
  const lesson = parseLesson(
    JSON.stringify({
      ...objectCreationLesson,
      summary: summaryText,
      steps: [...objectCreationLesson.steps, 'An Object keeps its properties.'],
    }),
  );
  await send(page, { type: 'lesson', task: 'explain', provider: 'groq', model: 'test', lesson });
  const summary = page.locator('#explanation > .lesson > .concept-copy').first();
  await expect(summary).toContainText(summaryText);
  for (const name of ['new', 'object', 'class', 'variable']) {
    await expect(
      page
        .locator('#explanation')
        .getByRole('button', { name: new RegExp(`^Define ${name}$`, 'i') }),
    ).toHaveCount(1);
    const term = summary.getByRole('button', { name: `Define ${name}`, exact: true });
    await term.hover();
    await expect(term).toHaveAttribute(
      'title',
      lesson.concepts.find((concept) => concept.term === name)!.explanation,
    );
    await term.click();
    await expect(
      summary.getByRole('region', { name: `Definition of ${name}`, exact: true }),
    ).toBeVisible();
    await term.press('Escape');
    await expect(term).toBeFocused();
  }
  const compiler = page
    .locator('#explanation li')
    .getByRole('button', { name: 'Define compiler', exact: true });
  await compiler.focus();
  await compiler.press('Enter');
  await expect(
    page.getByRole('region', { name: 'Definition of compiler', exact: true }),
  ).toContainText('JavaScript');
  await compiler.press('Escape');
  const example = page.locator('#explanation > .lesson > .concept-copy').last();
  await expect(example.locator('.concept-term')).toHaveCount(0);
  await expect(example).toHaveText(lesson.example.explanation);
  expect(
    await page.evaluate(() =>
      (window as unknown as { messages: { type: string }[] }).messages.filter(
        (message) => message.type === 'request',
      ),
    ),
  ).toEqual([]);
  await send(page, {
    type: 'lesson',
    task: 'explain',
    provider: 'groq',
    model: 'test',
    lesson,
    cached: true,
  });
  await summary.getByRole('button', { name: 'Define new', exact: true }).first().click();
  await expect(
    summary.getByRole('region', { name: 'Definition of new', exact: true }),
  ).toBeVisible();
  await expect(page.locator('#explanation .token-usage')).toHaveText(
    '0 new tokens · Reused locally',
  );
});

test('opens and reopens highlighted definitions with clicks and keyboard without AI requests', async ({
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
    await expect(section.getByRole('button', { name: 'Define argument', exact: true })).toHaveCount(
      0,
    );
    await expect(section).toContainText(/argument/i);
  }
  expect(
    await page.evaluate(() =>
      (window as unknown as { messages: { type: string }[] }).messages.filter(
        (m) => m.type === 'request',
      ),
    ),
  ).toEqual([]);
});

test('shows exact response counts and separates included cache and reasoning tokens', async ({
  page,
}) => {
  await send(page, {
    type: 'lesson',
    task: 'explain',
    provider: 'groq',
    model: 'test',
    lesson: weeklyLesson,
    usage: {
      inputTokens: 12345,
      outputTokens: 678,
      totalTokens: 13023,
      cachedInputTokens: 10000,
      reasoningTokens: 400,
    },
  });
  const usage = page.locator('#explanation .token-usage');
  await expect(usage).toContainText('13,023 tokens');
  await expect(usage).toContainText('12,345 input');
  await expect(usage).toContainText('678 output');
  await expect(usage).toContainText('Includes 10,000 cached input · 400 reasoning output');
  await send(page, {
    type: 'lesson',
    task: 'explain',
    provider: 'groq',
    model: 'test',
    lesson: weeklyLesson,
    cached: true,
    usage: { inputTokens: 12345, outputTokens: 678, totalTokens: 13023 },
  });
  await expect(usage).toHaveText('0 new tokens · Reused locally');
  await expect(usage).not.toContainText('13,023');
});

test('distinguishes unknown usage from zero and shows usage on failed responses', async ({
  page,
}) => {
  const result = {
    type: 'lesson',
    task: 'explain',
    provider: 'groq',
    model: 'test',
    lesson: weeklyLesson,
  };
  await send(page, result);
  const usage = page.locator('#explanation .token-usage');
  await expect(usage).toHaveText('Token usage not reported');
  await send(page, { ...result, usage: { outputTokens: 50 } });
  await expect(usage).toContainText('Total unavailable');
  await expect(usage).toContainText('Input unavailable');
  await expect(usage).toContainText('50 output');
  await send(page, { ...result, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } });
  await expect(usage).toContainText('0 tokens');
  await send(page, {
    type: 'error',
    message: 'The response was cut short.',
    showUsage: true,
    usage: { inputTokens: 1000, outputTokens: 3200, totalTokens: 4200 },
  });
  await expect(page.locator('#error')).toContainText('4,200 tokens');
  await send(page, { type: 'error', message: 'Request cancelled.', showUsage: true });
  await expect(page.locator('#error .token-usage')).toHaveText(
    'Token usage unavailable · Check provider billing',
  );
});

test('highlights new subtly, offers hover feedback, and fits token counts in a narrow panel', async ({
  page,
}) => {
  await send(page, {
    type: 'lesson',
    task: 'explain',
    provider: 'groq',
    model: 'qwen/qwen3.8-27b',
    usage: { inputTokens: 1248, outputTokens: 286, totalTokens: 1534, reasoningTokens: 112 },
    lesson: {
      title: 'Creating a New Object Instance',
      summary:
        'The code uses the new keyword to create a specific copy of the Scoreboard template. It assigns this fresh, empty scoreboard object to the permanent name board.',
      steps: [],
      concepts: [
        {
          term: 'new',
          explanation:
            'The new keyword creates an object and calls its constructor to set its starting state.',
        },
      ],
      example: { code: '', explanation: '' },
      predictions: [],
      checks: [],
    },
  });
  const term = page.getByRole('button', { name: 'Define new', exact: true });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document.getAnimations().map((animation) => animation.finished.catch(() => {})),
    );
  });
  await term.scrollIntoViewIfNeeded();
  await expect(term).toHaveCSS('text-decoration-line', 'none');
  await expect(term).toHaveCSS('cursor', 'pointer');
  const resting = await term.evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    shadow: getComputedStyle(element).boxShadow,
    top: element.getBoundingClientRect().top,
  }));
  expect(resting.background).not.toBe('rgba(0, 0, 0, 0)');
  await term.hover();
  await expect
    .poll(() => term.evaluate((element) => getComputedStyle(element).boxShadow))
    .not.toBe(resting.shadow);
  expect(await term.evaluate((element) => element.getBoundingClientRect().top)).toBe(resting.top);
  await term.click();
  await expect(page.getByRole('region', { name: 'Definition of new' })).toBeVisible();
  await term.press('Escape');
  await expect(term).toBeFocused();
  await page.mouse.move(0, 0);
  await term.blur();
  if (captureScreenshots)
    await page.locator('#explanation').screenshot({ path: 'work/usage-highlight-preview.png' });
  for (const theme of ['light', 'dark', 'high-contrast', 'high-contrast-light']) {
    await page.evaluate((theme) => {
      document.body.className = `vscode-${theme}`;
    }, theme);
    await page.setViewportSize({ width: 360, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expect(term).toHaveCSS('text-decoration-line', 'none');
    if (captureScreenshots)
      await page
        .locator('#explanation')
        .screenshot({ path: `work/usage-highlight-${theme}-narrow.png` });
  }
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

test('explores neighboring pieces with the keyboard and resets the reading area for new code', async ({
  page,
}) => {
  await expect(page.locator('#source')).toBeHidden();
  await expect(page.locator('#piece-placeholder')).toBeVisible();
  const pieces = page.locator('#parts .part');
  await pieces.first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#previous-piece')).toBeDisabled();
  await expect(page.locator('#piece-position')).toHaveText(`Piece 1 of ${await pieces.count()}`);
  await page.locator('#next-piece').focus();
  await page.keyboard.press('Enter');
  await expect(pieces.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#part-detail .part-token')).toHaveText(
    (await pieces.nth(1).getAttribute('aria-label')) || '',
  );
  await page.locator('#previous-piece').click();
  await expect(pieces.first()).toHaveAttribute('aria-pressed', 'true');
  await pieces.last().click();
  await expect(page.locator('#next-piece')).toBeDisabled();
  await send(page, {
    type: 'selection',
    ...inspect('const total = 5;', 0),
    file: 'total.ts',
    line: 1,
  });
  await expect(page.locator('#piece-placeholder')).toBeVisible();
  await expect(page.locator('#piece-navigation')).toBeHidden();
  await expect(page.locator('#part-detail')).toBeHidden();
  await send(page, {
    type: 'selection',
    code: '// A note',
    start: 0,
    parts: [],
    file: 'total.ts',
    line: 1,
  });
  await expect(page.locator('#source')).toBeVisible();
  await expect(page.locator('#source')).toHaveText('// A note');
  expect(
    await page.evaluate(() =>
      (window as unknown as { messages: { type: string }[] }).messages.filter(
        (m) => m.type === 'request',
      ),
    ),
  ).toEqual([]);
});

test('keeps sounds opt-in and remembers them independently of guidance and context', async ({
  page,
}) => {
  const sound = page.getByRole('button', { name: 'Sound off', exact: true });
  await expect(sound).toHaveAttribute('aria-pressed', 'false');
  await sound.click();
  await expect(page.locator('#sound-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Explanation settings', { exact: true }).click();
  await page.locator('#mode').selectOption('project');
  await page.locator('#audience').selectOption('experienced');
  expect(
    await page.evaluate(() => (window as unknown as { savedState: unknown }).savedState),
  ).toEqual({ sound: true, motionEnabled: true, mode: 'project', audience: 'experienced' });
  await page.reload();
  await send(page, { type: 'config', hasKey: false, audience: 'beginner' });
  await expect(page.locator('#sound-toggle')).toHaveText('Sound on');
  await expect(page.locator('#mode')).toHaveValue('project');
  await expect(page.locator('#audience')).toHaveValue('experienced');
  await page.locator('#sound-toggle').click();
  await expect(page.locator('#sound-toggle')).toHaveAttribute('aria-pressed', 'false');
});

test('honors reduced motion for pieces and view changes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#parts .part').first().click();
  await page.getByRole('button', { name: 'Edit code', exact: true }).click();
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  await expect(page.locator('#impact')).toBeVisible();
  await expect(page.locator('#piece-navigation')).toBeVisible();
});

for (const theme of ['light', 'dark', 'high-contrast', 'high-contrast-light']) {
  test(`keeps the ${theme} panel readable and contained at narrow widths`, async ({ page }) => {
    await page.evaluate((theme) => {
      document.body.className = `vscode-${theme}`;
      if (theme === 'high-contrast-light') {
        document.body.style.setProperty('--vscode-editor-background', '#fff');
        document.body.style.setProperty('--vscode-editor-foreground', '#000');
        document.body.style.setProperty('--vscode-textLink-foreground', '#0000b0');
      }
    }, theme);
    await send(page, {
      type: 'selection',
      ...inspect('const board = new Scoreboard();', 0),
      file: 'dashboard.ts',
      line: 1,
    });
    await page.getByRole('button', { name: 'new', exact: true }).click();
    // Let motion settle before measuring or capturing the final reading layout.
    await page.evaluate(() =>
      Promise.allSettled(
        document
          .getAnimations()
          .filter((a) => a.effect?.getTiming().iterations !== Infinity)
          .map((a) => a.finished),
      ),
    );
    const contrast = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d')!;
      const luminance = (color: string) => {
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const rgb = Array.from(context.getImageData(0, 0, 1, 1).data)
          .slice(0, 3)
          .map((value) => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      };
      return ['.part.selected', '.part-token', '.primary'].map((selector) => {
        const style = getComputedStyle(document.querySelector(selector)!);
        const foreground = luminance(style.color);
        const background = luminance(style.backgroundColor);
        return (
          (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
        );
      });
    });
    for (const ratio of contrast) expect(ratio).toBeGreaterThanOrEqual(4.5);
    if (captureScreenshots)
      await page.screenshot({
        path: `work/design-${theme}-wide.png`,
        fullPage: true,
        animations: 'disabled',
      });
    for (const width of [360, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const navigation = await page.locator('#piece-navigation').boundingBox();
      const reading = await page.locator('.piece-reading').boundingBox();
      expect(navigation!.y + navigation!.height).toBeLessThanOrEqual(reading!.y + reading!.height);
      await page.locator('#next-piece').click();
      await page.evaluate(() =>
        Promise.allSettled(
          document
            .getAnimations()
            .filter((a) => a.effect?.getTiming().iterations !== Infinity)
            .map((a) => a.finished),
        ),
      );
      await expect(page.locator('#part-detail')).toBeVisible();
    }
    if (captureScreenshots)
      await page.screenshot({
        path: `work/design-${theme}-narrow.png`,
        fullPage: true,
        animations: 'disabled',
      });
  });
}

test('summarizes guidance and the effective context without expanding the settings', async ({
  page,
}) => {
  await expect(page.locator('.explanation-settings')).not.toHaveAttribute('open');
  await expect(page.locator('#settings-summary')).toHaveText(
    'Learning the basics · Just this code',
  );
  await page.getByLabel('Explanation settings', { exact: true }).click();
  await page.locator('#audience').selectOption('experienced');
  await page.getByLabel('Explanation settings', { exact: true }).click();
  await expect(page.locator('#settings-summary')).toHaveText(
    'Getting up to speed · Just this code',
  );
  await page.getByRole('button', { name: 'Edit code', exact: true }).click();
  await expect(page.locator('#settings-summary')).toHaveText(
    'Getting up to speed · In this project',
  );
  await page.getByRole('button', { name: 'Explanation', exact: true }).click();
  await expect(page.locator('#settings-summary')).toHaveText(
    'Getting up to speed · Just this code',
  );
});

test('pauses interface motion, remembers it, and yields to the system preference', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Motion on' }).click();
  await expect(page.locator('#motion-toggle')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#parts .part').first().click();
  await page.getByRole('button', { name: 'Example', exact: true }).click();
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  await page.reload();
  await expect(page.locator('#motion-toggle')).toHaveText('Motion off');
  await page.locator('#motion-toggle').click();
  await expect(page.locator('#motion-toggle')).toHaveText('Motion on');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('#motion-toggle')).toHaveText('Motion reduced');
  await expect(page.locator('#motion-toggle')).toBeDisabled();
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

type TouchSample = {
  peak: number;
  duration: number;
  first: number;
  last: number;
  finite: boolean;
  dominantTone: number;
};

test('gives controls distinct short sounds, activates once by keyboard, and respects mute', async ({
  page,
}) => {
  await page.evaluate(() => {
    const host = window as unknown as { audioContexts: number; audioEvents: TouchSample[] };
    host.audioContexts = 0;
    host.audioEvents = [];
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor() {
        super();
        host.audioContexts++;
      }
      createBufferSource() {
        const source = super.createBufferSource();
        const start = source.start.bind(source);
        source.start = () => {
          const buffer = source.buffer!;
          const samples = buffer.getChannelData(0);
          // Measure the actual PCM spectrum, so variety cannot be just a volume change.
          let dominantTone = 0;
          let strongest = 0;
          const length = Math.min(samples.length, 1024);
          for (let frequency = 100; frequency <= 1000; frequency += 25) {
            let real = 0;
            let imaginary = 0;
            for (let i = 0; i < length; i++) {
              const windowed =
                samples[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (length - 1)));
              const angle = (2 * Math.PI * frequency * i) / buffer.sampleRate;
              real += windowed * Math.cos(angle);
              imaginary += windowed * Math.sin(angle);
            }
            const power = real * real + imaginary * imaginary;
            if (power > strongest) {
              strongest = power;
              dominantTone = frequency;
            }
          }
          host.audioEvents.push({
            peak: samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0),
            duration: buffer.duration,
            first: samples[0],
            last: samples[samples.length - 1],
            finite: samples.every(Number.isFinite),
            dominantTone,
          });
          start();
        };
        return source;
      }
    };
  });
  const events = () =>
    page.evaluate(() => (window as unknown as { audioEvents: TouchSample[] }).audioEvents.length);
  await page.locator('#parts .part').first().click();
  expect(
    await page.evaluate(() => (window as unknown as { audioContexts: number }).audioContexts),
  ).toBe(0);
  await page.locator('#sound-toggle').click();
  await expect.poll(events).toBe(1);
  await page.locator('#parts .part').first().click();
  await expect.poll(events).toBe(2);
  await page.locator('#next-piece').focus();
  await page.keyboard.press('Enter');
  await expect.poll(events).toBe(3);
  for (const [index, name] of ['Example', 'Edit code', 'Explanation'].entries()) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect.poll(events).toBe(4 + index);
  }
  await page.getByLabel('Explanation settings', { exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(events).toBe(7);
  await page.locator('#mode').selectOption('project');
  await expect.poll(events).toBe(8);
  await page.getByLabel('Explanation settings', { exact: true }).click();
  await expect.poll(events).toBe(9);
  await page.locator('#explain').click();
  await expect.poll(events).toBe(10);
  const samples = await page.evaluate(
    () => (window as unknown as { audioEvents: TouchSample[] }).audioEvents,
  );
  for (const sample of samples) {
    expect(sample.duration).toBeGreaterThanOrEqual(0.04);
    expect(sample.duration).toBeLessThanOrEqual(0.17);
    expect(sample.peak).toBeGreaterThan(0.09);
    expect(sample.peak).toBeLessThanOrEqual(0.181);
    expect(Math.abs(sample.first)).toBe(0);
    expect(Math.abs(sample.last)).toBe(0);
    expect(sample.finite).toBe(true);
  }
  expect(new Set(samples.map((sample) => sample.duration.toFixed(3))).size).toBeGreaterThanOrEqual(
    7,
  );
  const tones = samples.map((sample) => sample.dominantTone);
  expect(Math.max(...tones) / Math.min(...tones)).toBeGreaterThan(2);
  await page.locator('#apply').evaluate((button: HTMLButtonElement) => button.click());
  expect(await events()).toBe(10);
  await page.locator('#sound-toggle').click();
  await page.locator('#parts .part').first().click();
  await page.getByRole('button', { name: 'Explanation', exact: true }).click();
  expect(await events()).toBe(10);
});

test('follows live IDE colors while preserving the green, orange, and yellow accents', async ({
  page,
}) => {
  const settle = () =>
    page.evaluate(() =>
      Promise.allSettled(
        document
          .getAnimations()
          .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
          .map((animation) => animation.finished),
      ),
    );
  await page.locator('#parts .part').first().click();
  const palettes = [
    {
      name: 'light',
      background: '#ffffff',
      paper: '#f3f3f3',
      foreground: '#333333',
      muted: '#616161',
      focus: '#005fb8',
      link: '#005fb8',
    },
    {
      name: 'dark',
      background: '#1f1f1f',
      paper: '#252526',
      foreground: '#cccccc',
      muted: '#a5a5a5',
      focus: '#0078d4',
      link: '#4daafc',
    },
    {
      name: 'custom-dark',
      background: '#232a2e',
      paper: '#2d353b',
      foreground: '#d3c6aa',
      muted: '#a0aa96',
      focus: '#a7c080',
      link: '#a7c080',
    },
  ];
  const backgrounds = [];
  for (const palette of palettes) {
    await page.evaluate((palette) => {
      document.body.className = palette.name === 'light' ? 'vscode-light' : 'vscode-dark';
      for (const [token, color] of Object.entries({
        'editor-background': palette.background,
        'editorWidget-background': palette.paper,
        'editor-foreground': palette.foreground,
        descriptionForeground: palette.muted,
        focusBorder: palette.focus,
        'textLink-foreground': palette.link,
      }))
        document.body.style.setProperty(`--vscode-${token}`, color);
    }, palette);
    await page.getByRole('button', { name: 'Explanation', exact: true }).click();
    await settle();
    const actual = await page.evaluate(() => {
      const style = (selector: string) => getComputedStyle(document.querySelector(selector)!);
      const context = document.createElement('canvas').getContext('2d')!;
      const luminance = (color: string) => {
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const rgb = Array.from(context.getImageData(0, 0, 1, 1).data)
          .slice(0, 3)
          .map((value) => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      };
      const selectors = ['.source-heading', '.brand-mark', '.tab.active', '.part.selected'];
      return {
        background: style('body').backgroundColor,
        main: selectors.map((selector) => style(selector).backgroundColor),
        yellow: style('.primary').backgroundColor,
        contrast: selectors.map((selector) => {
          const s = style(selector),
            fg = luminance(s.color),
            bg = luminance(s.backgroundColor);
          return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
        }),
      };
    });
    const rgb = palette.background
      .slice(1)
      .match(/../g)!
      .map((hex) => parseInt(hex, 16));
    expect(actual.background).toBe(`rgb(${rgb.join(', ')})`);
    expect(new Set(actual.main).size).toBe(1);
    backgrounds.push(actual.main[0]);
    for (const ratio of actual.contrast) expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(actual.yellow).toBe('rgb(247, 217, 105)');
    if (captureScreenshots)
      await page.screenshot({
        path: `work/ide-${palette.name}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    await page.getByRole('button', { name: 'Example', exact: true }).click();
    await settle();
    expect(
      await page.locator('.tab.active').evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe('rgb(255, 176, 138)');
    await page.getByRole('button', { name: 'Edit code', exact: true }).click();
    await settle();
    expect(
      await page.locator('.tab.active').evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe('rgb(190, 228, 189)');
  }
  expect(new Set(backgrounds).size).toBe(palettes.length);
});
