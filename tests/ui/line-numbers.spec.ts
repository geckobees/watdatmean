import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { panelHtml } from '../../src/panel';

const dispatch = (page: Page, data: unknown) =>
  page.evaluate((data) => window.dispatchEvent(new MessageEvent('message', { data })), data);
async function selection(page: Page, code: string, line = 35, token = 'const', tabSize = 4) {
  const start = 1234;
  const offset = code.indexOf(token);
  await dispatch(page, {
    type: 'selection',
    selectionId: line,
    tabSize,
    code,
    start,
    line,
    file: 'src/Demo.ts',
    language: 'TypeScript',
    parts:
      offset < 0
        ? []
        : [
            {
              start: start + offset,
              end: start + offset + token.length,
              token,
              brief: 'A code piece.',
              detail: 'This explanation stays local.',
            },
          ],
  });
}
for (const editor of ['VS Code', 'IntelliJ']) {
  test.describe(`${editor} source line numbers`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        const w = window as any;
        w.messages = [];
        w.watdatmeanHost = {
          getState: () => ({}),
          setState: () => {},
          postMessage: (m: any) => {
            w.messages.push(m);
            if (m.type === 'highlight')
              queueMicrotask(() =>
                window.dispatchEvent(
                  new MessageEvent('message', {
                    data: {
                      ...m,
                      runs: [[0, m.code.length, 0]],
                      styles: [{ color: '#77aacc', font: 0 }],
                    },
                  }),
                ),
              );
          },
        };
      });
      await page.route('https://lines.test/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('.js') || path.endsWith('.css'))
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
                    'lines-test',
                  )
                : panelHtml(
                    {
                      cspSource: 'https://lines.test',
                      css: 'https://lines.test/panel.css',
                      script: 'https://lines.test/panel.js',
                    },
                    'lines-test',
                  ),
          });
      });
      await page.goto('https://lines.test/');
    });
    for (const newline of ['\n', '\r\n', '\r']) {
      test(`counts blank and trailing lines with ${JSON.stringify(newline)} without changing the source`, async ({
        page,
      }) => {
        const code = ['const first = "😀";', '', '\tconst second = 2;', ''].join(newline);
        await selection(page, code, 998, 'second');
        for (const id of ['source', 'parts']) {
          await expect(page.locator(`#${id}-lines > span`)).toHaveText([
            '998',
            '999',
            '1000',
            '1001',
          ]);
          expect(await page.locator(`#${id}`).textContent()).toBe(code);
          await expect(page.locator(`#${id}-lines`).locator('..')).toHaveAttribute('role', 'group');
        }
        await page.locator('#parts [role=button]').focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('.part-location')).toHaveText('src/Demo.ts:1000');
        await expect(page.locator('#parts-lines .active')).toHaveText('1000');
        await expect(page.locator('#part-detail')).toContainText('This explanation stays local.');
        await page.getByRole('button', { name: 'Try it yourself', exact: true }).click();
        await expect(page.locator('#draft-lines > span')).toHaveText([
          '998',
          '999',
          '1000',
          '1001',
        ]);
        expect(await page.locator('#replacement').inputValue()).toBe(code.replace(/\r\n?/g, '\n'));
        expect(
          await page.evaluate(() =>
            (window as any).messages.filter((m: any) => !['ready', 'highlight'].includes(m.type)),
          ),
        ).toEqual([]);
      });
    }
    test('numbers an entire 2000-line file beyond the boxed pieces, with fixed gutters and no rounding drift', async ({
      page,
    }) => {
      const code = Array.from(
        { length: 2000 },
        (_, i) => `const value${i} = "${'x'.repeat(160)}";`,
      ).join('\n');
      await selection(page, code, 1);
      for (const id of ['source', 'parts']) {
        const labels = page.locator(`#${id}-lines > span`);
        await expect(labels.first()).toHaveText('1');
        const left = (await labels.first().boundingBox())!.x;
        await page.locator(`#${id}-scroll`).evaluate((e) => {
          e.scrollTop = e.scrollHeight;
          e.scrollLeft = 200;
        });
        await expect(labels.last()).toHaveText('2000');
        expect(await labels.count()).toBeLessThan(25);
        expect((await labels.last().boundingBox())!.x).toBeCloseTo(left, 1);
        // Compare actual text baselines, not rounded scrollHeight or computed CSS.
        const delta = await page.evaluate((id) => {
          const walker = document.createTreeWalker(
            document.getElementById(id)!,
            NodeFilter.SHOW_TEXT,
          );
          let text: Node | null;
          while ((text = walker.nextNode())) {
            const index = text.textContent!.indexOf('value1999');
            if (index < 0) continue;
            const codeRange = document.createRange(),
              numberRange = document.createRange();
            codeRange.setStart(text, index);
            codeRange.setEnd(text, index + 9);
            numberRange.selectNodeContents(
              document.querySelector(`#${id}-lines > span:last-child > button`)!,
            );
            return Math.abs(
              codeRange.getBoundingClientRect().top - numberRange.getBoundingClientRect().top,
            );
          }
          return Infinity;
        }, id);
        expect(delta).toBeLessThan(1);
      }
      await expect(page.locator('#parts [role=button]')).toHaveCount(1);
      expect(await page.locator('#parts').textContent()).toBe(code);
      // Copying code excludes the separate, unselectable gutter.
      expect(
        await page.locator('#source').evaluate((e) => {
          const range = document.createRange();
          range.selectNodeContents(e);
          const selection = window.getSelection()!;
          selection.removeAllRanges();
          selection.addRange(range);
          return selection.toString();
        }),
      ).toBe(code);
    });
    test('renumbers edited drafts, marks the caret line, and refreshes original file positions', async ({
      page,
    }) => {
      await selection(page, 'const a = 1;\nconst b = 2;');
      await page.getByRole('button', { name: 'Try it yourself', exact: true }).click();
      const draft = page.locator('#replacement');
      await draft.fill('const a = 1;\n\nconst b = 2;\n');
      await expect(page.locator('#draft-lines > span')).toHaveText(['35', '36', '37', '38']);
      await draft.evaluate((e: HTMLTextAreaElement) => {
        e.setSelectionRange(14, 14);
        e.dispatchEvent(new Event('select'));
      });
      await expect(page.locator('#draft-lines .active')).toHaveText('37');
      await expect(page.locator('#source-lines > span')).toHaveText(['35', '36']);
      await page.getByRole('button', { name: 'Start over', exact: true }).click();
      await expect(page.locator('#draft-lines > span')).toHaveText(['35', '36']);
      await selection(page, 'const a = 1;\nconst b = 2;', 78, '1;\nconst');
      await expect(page.locator('#source-lines > span')).toHaveText(['78', '79']);
      await page.locator('#parts [role=button]').click();
      await expect(page.locator('.part-location')).toHaveText('src/Demo.ts:78–79');
    });
    test('clicks all three gutters without editing the draft, hiding details, or requesting AI', async ({
      page,
    }) => {
      await selection(page, 'const a = 1;\nconst b = 2;');
      await page.locator('#parts [role=button]').click();
      const detail = await page.locator('#part-detail').textContent();
      for (const [id, line] of [
        ['source', 35],
        ['parts', 36],
      ] as const)
        await page
          .locator(`#${id}-lines button`)
          .filter({ hasText: String(line) })
          .click();
      await page.getByRole('button', { name: 'Try it yourself', exact: true }).click();
      await page.locator('#replacement').fill('const a = 10;\nconst b = 20;');
      await page.locator('#draft-lines button').last().click();
      expect(
        await page.evaluate(() =>
          (window as any).messages.filter((m: any) => !['ready', 'highlight'].includes(m.type)),
        ),
      ).toEqual([35, 36, 36].map((line) => ({ type: 'openSourceLine', selectionId: 35, line })));
      expect(await page.locator('#replacement').inputValue()).toBe('const a = 10;\nconst b = 20;');
      expect(await page.locator('#part-detail').textContent()).toBe(detail);
    });

    test('navigates virtualized gutter rows with arrows, Home, End, Enter and Space', async ({
      page,
    }) => {
      await selection(
        page,
        Array.from({ length: 2000 }, (_, i) => `const n${i} = 0;`).join('\n'),
        1,
      );
      await page.locator('#source-lines button[tabindex="0"]').focus();
      await page.keyboard.press('ArrowDown');
      await expect(page.locator('#source-lines button:focus')).toHaveText('2');
      await page.keyboard.press('Enter');
      await page.keyboard.press('End');
      await expect(page.locator('#source-lines button:focus')).toHaveText('2000');
      await page.keyboard.press('Space');
      await page.keyboard.press('Home');
      await expect(page.locator('#source-lines button:focus')).toHaveText('1');
      await expect(page.locator('#source-lines button[tabindex="0"]')).toHaveCount(1);
      expect(await page.locator('#source-lines button').count()).toBeLessThan(25);
      expect(
        await page.evaluate(() =>
          (window as any).messages
            .filter((m: any) => m.type === 'openSourceLine')
            .map((m: any) => m.line),
        ),
      ).toEqual([2, 2000]);
    });

    test('blocks outdated positions and extra draft rows until the original selection is updated', async ({
      page,
    }) => {
      await selection(page, 'const a = 1;\nconst b = 2;');
      await page.getByRole('button', { name: 'Try it yourself', exact: true }).click();
      await page.locator('#replacement').fill('const a = 1;\nconst b = 2;\nconst c = 3;');
      await expect(page.locator('#draft-lines button').last()).toBeDisabled();
      await expect(page.locator('#draft-lines button').last()).toHaveAttribute(
        'title',
        /outside the original selection/,
      );
      await dispatch(page, { type: 'stale' });
      for (const id of ['source', 'parts', 'draft'])
        await expect(page.locator(`#${id}-lines button:enabled`)).toHaveCount(0);
      await selection(page, 'const a = 1;\nconst b = 2;\nconst c = 3;', 80);
      await page.getByRole('button', { name: 'Try it yourself', exact: true }).click();
      await page.locator('#draft-lines button').last().click();
      expect(
        await page.evaluate(() =>
          (window as any).messages.filter((m: any) => m.type === 'openSourceLine'),
        ),
      ).toEqual([{ type: 'openSourceLine', selectionId: 80, line: 82 }]);
    });

    test('keeps a wider gutter-to-code gap and uses the original editor tab width in all three areas', async ({
      page,
    }) => {
      const code = '\tconst first = 1;\n\t\tconst second = 2;';
      await selection(page, code, 35, 'const', 8);
      for (const id of ['source', 'parts']) {
        await expect(page.locator(`#${id}-scroll`)).toHaveCSS('padding-left', '20px');
        await expect(page.locator(`#${id}-scroll`)).toHaveCSS('tab-size', '8');
        await expect(page.locator(`#${id}-lines button`).first()).toHaveCSS(
          'padding-right',
          '21px',
        );
        expect(await page.locator(`#${id}`).textContent()).toBe(code);
      }
      await page.getByRole('button', { name: 'Try it yourself', exact: true }).click();
      for (const selector of ['#replacement', '.draft-colors']) {
        await expect(page.locator(selector)).toHaveCSS('padding-left', '20px');
        await expect(page.locator(selector)).toHaveCSS('tab-size', '8');
      }
      expect(await page.locator('#replacement').inputValue()).toBe(code);
      await selection(page, code, 35, 'const', 2);
      await expect(page.locator('#source-scroll')).toHaveCSS('tab-size', '2');
      await selection(page, code, 35, 'const', -100);
      await expect(page.locator('#source-scroll')).toHaveCSS('tab-size', '4');
    });

    test('follows native gutter colors, font changes, draft resizing, and narrow layouts', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 380, height: 1000 });
      await selection(
        page,
        Array.from({ length: 90 }, (_, i) => `const value${i} = 1;`).join('\n'),
      );
      await page.evaluate(() => {
        const css = document.documentElement.style;
        css.setProperty('--vscode-editorLineNumber-foreground', '#778899');
        css.setProperty('--vscode-editorLineNumber-activeForeground', '#aabbcc');
        css.setProperty('--vscode-editorGutter-background', '#112233');
        css.setProperty('--vscode-editor-font-size', '17px');
      });
      await expect(page.locator('#source-lines')).toHaveCSS('color', 'rgb(119, 136, 153)');
      await expect(page.locator('#source-lines').locator('..')).toHaveCSS(
        'background-color',
        'rgb(17, 34, 51)',
      );
      await page.locator('#source-scroll').evaluate((e) => {
        e.scrollTop = e.scrollHeight;
      });
      await expect(page.locator('#source-lines > span').last()).toHaveText('124');
      await page.getByRole('button', { name: 'Try it yourself', exact: true }).click();
      const draft = page.locator('#replacement');
      await draft.evaluate((e: HTMLTextAreaElement) => {
        e.style.height = '320px';
        e.focus();
        e.setSelectionRange(e.value.length, e.value.length);
        e.scrollTop = e.scrollHeight;
        e.dispatchEvent(new Event('select'));
      });
      await expect(page.locator('#draft-lines .active')).toHaveText('124');
      await expect(page.locator('#draft-lines .active')).toHaveCSS('color', 'rgb(170, 187, 204)');
      await expect.poll(() => draft.evaluate((e) => e.clientHeight)).toBe(320);
      expect(
        await page
          .locator('#draft-lines')
          .locator('..')
          .evaluate((e) => e.clientHeight),
      ).toBe(320);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `work/line-numbers-${editor.replaceAll(' ', '-')}.png`,
        fullPage: true,
      });
      await page.emulateMedia({ forcedColors: 'active' });
      await expect(page.locator('#draft-lines > span').last()).toBeVisible();
      expect(
        await page.evaluate(() => (window as any).messages.some((m: any) => m.type === 'request')),
      ).toBe(false);
    });
  });
}
