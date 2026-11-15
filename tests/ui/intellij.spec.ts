import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { wombLesson, wombOutput, wombRequest } from '../quality/depth-cases';
import { javaTraceLesson } from '../../src/java-trace';
import { inspectCode } from '../../src/languages';
import { javaControlCases } from '../quality/java-control-cases';
import { javaArrayExceptionCases } from '../quality/java-array-exception-cases';

test('the packaged IntelliJ panel uses its host bridge and language, with no VS Code API', async ({
  page,
}) => {
  const html = readFileSync('intellij/build/generated/web/panel.html', 'utf8')
    .replaceAll('__WDM_NONCE__', 'test-intellij')
    .replace(
      '/*__WDM_BRIDGE__*/',
      `window.messages = []; window.watdatmeanHost = {
      postMessage: m => window.messages.push(m), getState: () => ({}), setState: () => {}
    };`,
    );
  await page.route('http://watdatmean.local/**', (route) =>
    route.fulfill({ body: html, contentType: 'text/html' }),
  );
  await page.goto('http://watdatmean.local/');
  await expect
    .poll(() => page.evaluate(() => (window as any).messages))
    .toContainEqual({ type: 'ready' });
  await page.evaluate(() =>
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'selection',
          code: 'System.out.println("hello");',
          start: 40,
          language: 'Java',
          file: 'Demo.java',
          line: 3,
          parts: [
            {
              token: 'println',
              start: 51,
              end: 58,
              brief: 'The method being called.',
              detail: 'Arguments are evaluated before the method is invoked.',
            },
            {
              token: '"hello"',
              start: 59,
              end: 66,
              brief: 'A literal value: text.',
              detail: 'This writes text directly in the source. Here it is an argument.',
            },
          ],
        },
      }),
    ),
  );
  await expect(page.locator('#language')).toHaveText('JAVA');
  await expect(page.locator('#syntax-section')).toBeVisible();
  await page.getByRole('button', { name: 'println', exact: true }).click();
  await expect(page.locator('#part-detail')).toContainText('Arguments are evaluated');
  await page.getByRole('button', { name: '"hello"', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#part-detail')).toContainText('Here it is an argument');
  expect(await page.evaluate(() => (window as any).messages)).toEqual([{ type: 'ready' }]);
  await page.locator('#explain').click();
  expect(await page.evaluate(() => (window as any).messages.at(-1))).toMatchObject({
    type: 'request',
    task: 'explain',
  });
  await page.evaluate(() =>
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'lesson',
          task: 'explain',
          provider: 'test',
          model: 'fixture',
          cached: false,
          lesson: {
            usage: { input: 200, output: 70, total: 270 },
            notice: 'The AI answer did not match the code. This explanation uses local code facts.',
            title: 'Return a value',
            summary: 'The return statement sends a value back to the caller.',
            steps: [],
            concepts: [
              {
                term: 'return',
                explanation: 'Ends the method and sends its result to the caller.',
              },
            ],
            example: { code: '', explanation: '' },
            predictions: [],
            checks: [],
          },
        },
      }),
    ),
  );
  await expect(page.locator('#explanation')).toContainText('270 tokens (200 input + 70 output)');
  await expect(page.locator('#explanation')).toContainText('uses local code facts');
  await page.getByRole('button', { name: 'Define return', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Definition of return' })).toContainText(
    'Ends the method',
  );
  expect(
    await page.evaluate(
      () => (window as any).messages.filter((m: any) => m.type === 'request').length,
    ),
  ).toBe(1);
  await page.getByRole('button', { name: 'Explain further · AI ↗', exact: true }).click();
  expect(await page.evaluate(() => (window as any).messages.at(-1))).toMatchObject({
    type: 'request',
    task: 'concept',
    concept: 'return',
  });
  await page.getByRole('button', { name: 'Try it yourself', exact: true }).click();
  await page.evaluate(() =>
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'preview', errors: [], syntaxChecked: false } }),
    ),
  );
  await expect(page.locator('#apply')).toBeDisabled();
  await expect(page.locator('#preview-status')).toContainText('no syntax checker');
  await page.getByRole('button', { name: 'Understand', exact: true }).click();
  await page.evaluate(
    (lesson) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'lesson',
            task: 'explain',
            provider: 'fixture',
            model: 'test',
            lesson,
          },
        }),
      ),
    wombLesson,
  );
  await expect(page.locator('#explanation ol > li')).toHaveCount(11);
  await expect(page.locator('#explanation')).not.toContainText('How the parts work together');
  await expect(page.locator('#explanation')).not.toContainText('Details that matter');
  await expect(page.locator('#explanation ol pre code')).toHaveCount(0);
  await expect(page.locator('.lesson-terms')).not.toHaveAttribute('open', '');
  expect(await page.locator('#explanation .lesson > pre code').textContent()).toBe(wombOutput);
  const python = 'import math as m\ndef size():\n    score = m.sqrt(9)\n    return score';
  const snippet = inspectCode(python, python.indexOf('    score'), python.length, 'python');
  await page.evaluate(
    (snippet) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'selection', ...snippet, language: 'Python', file: 'size.py', line: 3 },
        }),
      ),
    snippet,
  );
  expect(await page.locator('#parts').textContent()).toBe(snippet.code);
  await page.getByRole('button', { name: 'm', exact: true }).click();
  await expect(page.locator('#part-detail')).toContainText('math');
  for (const id of [
    'many-passes',
    'list-remove-overloads',
    'overload-then-override',
    'array-alias-clone',
    'array-bounds',
    'finally-saved-return',
    'finally-return-replaces',
  ]) {
    const fixture = [...javaControlCases, ...javaArrayExceptionCases].find((c) => c.id === id)!;
    await page.evaluate(
      (lesson) =>
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { type: 'lesson', task: 'explain', provider: 'fixture', model: 'test', lesson },
          }),
        ),
      javaTraceLesson({ ...wombRequest, code: fixture.code }),
    );
    await expect(page.locator('#explanation')).toContainText('0 tokens');
    await expect(page.locator('#explanation .lesson > pre code')).toHaveCount(1);
    expect(await page.locator('#explanation .lesson > pre code').textContent()).toBe(
      fixture.expected,
    );
    await expect(page.locator('.lesson-terms')).not.toHaveAttribute('open', '');
    if (id === 'many-passes') await expect(page.locator('#explanation ol > li')).toHaveCount(2);
  }
  await page.evaluate(
    (lesson) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'lesson', task: 'explain', provider: 'fixture', model: 'test', lesson },
        }),
      ),
    javaTraceLesson(wombRequest),
  );
  await expect(page.locator('#explanation ol > li')).toHaveCount(4);
  await expect(page.locator('#explanation')).toContainText('x.s → A.s="A"');
  await expect(page.locator('#explanation')).toContainText('0 tokens');
  expect(await page.locator('#explanation .lesson > pre code').textContent()).toBe(wombOutput);
});
