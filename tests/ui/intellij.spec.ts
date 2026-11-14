import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

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
          language: 'Java',
          file: 'Demo.java',
          line: 3,
          parts: [],
        },
      }),
    ),
  );
  await expect(page.locator('#language')).toHaveText('JAVA');
  await page.locator('#explain').click();
  expect(await page.evaluate(() => (window as any).messages.at(-1))).toMatchObject({
    type: 'request',
    task: 'explain',
  });
  await page.getByRole('button', { name: 'Try it yourself', exact: true }).click();
  await page.evaluate(() =>
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'preview', errors: [], syntaxChecked: false } }),
    ),
  );
  await expect(page.locator('#apply')).toBeDisabled();
  await expect(page.locator('#preview-status')).toContainText('no syntax checker');
});
