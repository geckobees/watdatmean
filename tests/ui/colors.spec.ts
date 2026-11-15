import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { panelHtml } from '../../src/panel';
import { inspectCode } from '../../src/languages';
const code = 'const score = 3;\nconst label = "<img src=x onerror=alert(1)>";';
const exampleCode = 'const next = 4;\r\n\r\nreturn next;\r\n';
const sampleLesson = {
  title: 'An example',
  summary: 'Read the next value.',
  steps: [],
  concepts: [],
  example: { code: exampleCode, explanation: 'This example starts at line one.' },
  predictions: [],
  checks: [],
};
const dispatch = (page: Page, data: unknown) =>
  page.evaluate((data) => window.dispatchEvent(new MessageEvent('message', { data })), data);
for (const editor of ['VS Code', 'IntelliJ'])
  test.describe(`${editor} native color surfaces`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        const w = window as any;
        w.messages = [];
        w.color = '#c586c0';
        w.hold = false;
        w.answer = (m: any) => {
          const runs = [...m.code.matchAll(/\b(?:const|return|int)\b|\d+|"[^"\n]*"/g)].map(
            (match: any) => [match.index, match.index + match[0].length, 0],
          );
          window.dispatchEvent(
            new MessageEvent('message', {
              data: { ...m, runs, styles: [{ color: w.color, font: 3 }] },
            }),
          );
        };
        w.watdatmeanHost = {
          getState: () => ({}),
          setState: () => {},
          postMessage: (m: any) => {
            w.messages.push(m);
            if (m.type === 'highlight' && !w.hold) queueMicrotask(() => w.answer(m));
          },
        };
      });
      await page.route('https://colors.test/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('.js') || path.endsWith('.css'))
          await route.fulfill({
            body: readFileSync(`media${path}`),
            contentType: path.endsWith('.js') ? 'application/javascript' : 'text/css',
          });
        else
          await route.fulfill({
            body:
              editor === 'IntelliJ'
                ? readFileSync('intellij/build/generated/web/panel.html', 'utf8').replaceAll(
                    '__WDM_NONCE__',
                    'colors-test',
                  )
                : panelHtml(
                    {
                      cspSource: 'https://colors.test',
                      css: 'https://colors.test/panel.css',
                      script: 'https://colors.test/panel.js',
                    },
                    'colors-test',
                  ),
            contentType: 'text/html',
          });
      });
      await page.goto('https://colors.test/');
      await dispatch(page, {
        type: 'selection',
        code,
        start: 0,
        parts: ['const', 'score', '3'].map((token) => ({
          token,
          start: code.indexOf(token),
          end: code.indexOf(token) + token.length,
          brief: 'A local code piece.',
          detail: 'A local explanation.',
        })),
        file: 'colors.ts',
        language: 'TypeScript',
        line: 1,
      });
      await expect(page.locator('#source .wdm-source-0').first()).toHaveCSS(
        'color',
        'rgb(197, 134, 192)',
      );
    });
    test('colors original, clickable pieces and draft while preserving exact text and local clicks', async ({
      page,
    }) => {
      expect(await page.locator('#source').textContent()).toBe(code);
      expect(await page.locator('#parts').textContent()).toBe(code);
      await expect(page.locator('#parts .wdm-source-0').first()).toHaveCSS(
        'color',
        'rgb(197, 134, 192)',
      );
      await page.locator('#parts [role=button]').first().click();
      await expect(page.locator('#part-detail')).toBeVisible();
      await page.getByRole('button', { name: 'Try it yourself', exact: true }).click();
      await expect(page.locator('#draft-colors .wdm-draft-0').first()).toHaveCSS(
        'color',
        'rgb(197, 134, 192)',
      );
      // Editable glyphs keep the textarea's exact regular metrics, even if the theme uses bold/italic.
      await expect(page.locator('#draft-colors .wdm-draft-0').first()).toHaveCSS(
        'font-style',
        'normal',
      );
      expect(await page.locator('#replacement').inputValue()).toBe(code);
      await expect(page.locator('img')).toHaveCount(0);
      expect(
        await page.evaluate(() =>
          (window as any).messages.filter((m: any) => !['ready', 'highlight'].includes(m.type)),
        ),
      ).toEqual([]);
    });
    test('numbers and colors Another Example from one, preserving blank lines and theme updates', async ({
      page,
    }) => {
      await dispatch(page, {
        type: 'lesson',
        task: 'example',
        lesson: sampleLesson,
        provider: 'fixture',
        model: 'local',
        cached: true,
      });
      await page.locator('[data-tab=examples]').click();
      const frame = page.locator('#example-result .standalone-code');
      await expect(frame.locator('.line-number')).toHaveText(['1', '2', '3', '4']);
      expect(await frame.locator('code').textContent()).toBe(exampleCode);
      await expect(frame.locator('code span').first()).toHaveCSS('color', 'rgb(197, 134, 192)');
      expect(await frame.locator('button').count()).toBe(0);
      await page.evaluate(() => {
        (window as any).color = '#123456';
      });
      await dispatch(page, { type: 'syntaxThemeChanged' });
      await expect(frame.locator('code span').first()).toHaveCSS('color', 'rgb(18, 52, 86)');
      expect(
        await page.evaluate(() =>
          (window as any).messages.filter((m: any) => m.type === 'request'),
        ),
      ).toEqual([]);
    });
    test('colors snapshots in their saved language and file line numbers, with example numbering separate', async ({
      page,
    }) => {
      const saved = {
        id: 'saved-colors',
        file: 'Demo.java',
        line: 40,
        language: 'Java',
        code: 'int saved = 2;\nreturn saved;',
        mode: 'standalone',
        audience: 'beginner',
        updatedAt: Date.now(),
        results: {
          example: {
            lesson: {
              ...sampleLesson,
              example: { code: 'int extra = 3;', explanation: 'A fresh example.' },
            },
            provider: 'fixture',
            model: 'local',
          },
        },
      };
      await dispatch(page, { type: 'history', enabled: true, entries: [saved] });
      await page.locator('#history-toggle').click();
      await page.locator('.history-entry').click();
      await expect(page.locator('.history-source .line-number')).toHaveText(['40', '41']);
      await expect(page.locator('#history-detail .lesson-practice .line-number')).toHaveText(['1']);
      await expect(page.locator('.history-source code span').first()).toHaveCSS(
        'color',
        'rgb(197, 134, 192)',
      );
      const requests = await page.evaluate(() =>
        (window as any).messages.filter((m: any) => m.target?.startsWith('block-')),
      );
      expect(requests.every((m: any) => m.language === 'Java')).toBe(true);
      // Old replies must not paint a different saved entry, and their palette rules are removed.
      await dispatch(page, {
        type: 'history',
        enabled: true,
        entries: [{ ...saved, code: 'int changed = 9;' }],
      });
      await page.evaluate((old) => (window as any).answer(old), requests[0]);
      expect(await page.locator('.history-source code').textContent()).toBe('int changed = 9;');
      expect(await page.locator('#code-palette').textContent()).not.toContain(
        `.wdm-${requests[0].target}-`,
      );
      expect(
        await page.evaluate(() =>
          (window as any).messages.filter((m: any) =>
            ['request', 'apply', 'openSourceLine'].includes(m.type),
          ),
        ),
      ).toEqual([]);
    });
    test('virtualizes snapshot gutters, follows scrolling, and preserves code copying without numbers', async ({
      page,
    }) => {
      const longCode = Array.from({ length: 1800 }, (_, i) => `const n${i} = ${i};`).join('\n');
      await dispatch(page, {
        type: 'lesson',
        task: 'example',
        lesson: { ...sampleLesson, example: { code: longCode, explanation: '' } },
      });
      await page.locator('[data-tab=examples]').click();
      const frame = page.locator('#example-result .standalone-code');
      await expect(frame.locator('.line-number').first()).toHaveText('1');
      expect(await frame.locator('.line-number').count()).toBeLessThan(30);
      await frame.locator('pre').evaluate((e) => {
        e.scrollTop = e.scrollHeight;
      });
      await expect(frame.locator('.line-number').last()).toHaveText('1800');
      expect(await frame.locator('code').textContent()).toBe(longCode);
      const alignment = await frame.evaluate((e) => {
        const pre = e.querySelector('pre')!,
          row = e.querySelector('.line-number')!;
        const css = getComputedStyle(pre),
          height = parseFloat(css.lineHeight);
        const expected =
          pre.getBoundingClientRect().top +
          parseFloat(css.paddingTop) +
          (Number(row.textContent) - 1) * height -
          pre.scrollTop;
        return Math.abs(row.getBoundingClientRect().top - expected);
      });
      expect(alignment).toBeLessThan(1.5);
    });
    test('retries empty colors once and recovers without repeated polling or AI', async ({
      page,
    }) => {
      const original = await page.evaluate(() =>
        (window as any).messages.find((m: any) => m.target === 'source'),
      );
      await dispatch(page, { ...original, runs: [], styles: [] });
      await expect(page.locator('#source span').first()).toHaveCSS('color', 'rgb(197, 134, 192)');
      const requests = await page.evaluate(() =>
        (window as any).messages.filter((m: any) => m.target === 'source'),
      );
      expect(requests.length).toBe(2);
      await dispatch(page, { ...requests[1], runs: [], styles: [] });
      await page.waitForTimeout(350);
      expect(
        await page.evaluate(
          () => (window as any).messages.filter((m: any) => m.target === 'source').length,
        ),
      ).toBe(2);
    });
    test('boxes separate tokens throughout the screenshot loop instead of its whole nested body', async ({
      page,
    }) => {
      const source = readFileSync('src/edit.ts', 'utf8'),
        start = source.indexOf('for (const change');
      const snippet = inspectCode(source, start);
      await dispatch(page, {
        type: 'selection',
        ...snippet,
        file: 'src/edit.ts',
        line: 40,
        language: 'TypeScript',
      });
      const pieces = await page.locator('#parts .part').allTextContents();
      expect(pieces.filter((p) => p === 'change').length).toBeGreaterThan(4);
      expect(pieces).toContain('Math');
      expect(pieces.every((p) => !/[\r\n]/.test(p))).toBe(true);
      expect(await page.locator('#parts').textContent()).toBe(snippet.code);
      await page
        .locator('#parts .part')
        .filter({ hasText: /^Math$/ })
        .last()
        .click();
      await expect(page.locator('#part-detail')).toBeVisible();
    });
    test('applies a later semantic color update to all three surfaces without losing piece details', async ({
      page,
    }) => {
      await page.locator('#parts [role=button]').first().click();
      const detail = await page.locator('#part-detail').textContent();
      await page.getByRole('button', { name: 'Try it yourself', exact: true }).click();
      const message = await page.evaluate(() =>
        (window as any).messages.find((m: any) => m.type === 'highlight' && m.target === 'source'),
      );
      const start = code.indexOf('score'),
        end = start + 5;
      await dispatch(page, {
        ...message,
        runs: [
          [0, start, 0],
          [start, end, 1],
          [end, code.length, 0],
        ],
        styles: [
          { color: '#c586c0', font: 0 },
          { color: '#5588cc', font: 0 },
        ],
      });
      for (const selector of [
        '#source .wdm-source-1',
        '#parts .wdm-source-1',
        '#draft-colors .wdm-draft-1',
      ]) {
        await expect(page.locator(selector)).toHaveText('score');
        await expect(page.locator(selector)).toHaveCSS('color', 'rgb(85, 136, 204)');
      }
      expect(await page.locator('#part-detail').textContent()).toBe(detail);
      expect(await page.locator('#replacement').inputValue()).toBe(code);
      expect(await page.locator('#source').textContent()).toBe(code);
    });
    test('recolors a live theme without resetting drafts, focus, selection, or piece details', async ({
      page,
    }) => {
      await page.locator('#parts [role=button]').first().click();
      await page.getByRole('button', { name: 'Try it yourself', exact: true }).click();
      await page.locator('#replacement').fill('const changed = 42;');
      await page
        .locator('#replacement')
        .evaluate((e: HTMLTextAreaElement) => e.setSelectionRange(6, 13));
      await page.evaluate(() => {
        (window as any).color = '#2244aa';
      });
      await dispatch(page, { type: 'syntaxThemeChanged' });
      await expect(page.locator('#draft-colors .wdm-draft-0').first()).toHaveCSS(
        'color',
        'rgb(34, 68, 170)',
      );
      await expect(page.locator('#source .wdm-source-0').first()).toHaveCSS(
        'color',
        'rgb(34, 68, 170)',
      );
      expect(await page.locator('#replacement').inputValue()).toBe('const changed = 42;');
      expect(
        await page
          .locator('#replacement')
          .evaluate((e: HTMLTextAreaElement) => [
            e.selectionStart,
            e.selectionEnd,
            document.activeElement === e,
          ]),
      ).toEqual([6, 13, true]);
      await expect(page.locator('#part-detail')).toBeVisible();
      expect(
        await page.evaluate(() => (window as any).messages.some((m: any) => m.type === 'request')),
      ).toBe(false);
    });
    test('ignores late highlight replies and keeps undo and reset working', async ({ page }) => {
      await page.getByRole('button', { name: 'Try it yourself', exact: true }).click();
      await page.evaluate(() => {
        (window as any).hold = true;
      });
      const input = page.locator('#replacement');
      await input.fill('return 11;');
      await expect
        .poll(() =>
          page.evaluate(() =>
            (window as any).messages.some(
              (m: any) => m.type === 'highlight' && m.code === 'return 11;',
            ),
          ),
        )
        .toBe(true);
      await input.fill('return 22;');
      await page.evaluate(() => {
        const w = window as any;
        w.answer(w.messages.find((m: any) => m.code === 'return 11;'));
      });
      expect(await page.locator('#draft-colors').textContent()).toBe('return 22;\n');
      await input.press('End');
      await page.keyboard.type('!');
      await input.press('Control+z');
      await expect(input).toHaveValue('return 22;');
      await page.getByRole('button', { name: 'Start over', exact: true }).click();
      await expect(input).toHaveValue(code);
      expect(await page.locator('#draft-colors').textContent()).toBe(code + '\n');
    });
    test('keeps scrolled text aligned and fits a narrow panel', async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 900 });
      await page.getByRole('button', { name: 'Try it yourself', exact: true }).click();
      const text = Array.from(
        { length: 40 },
        (_, i) => `\tconst line${i} = "${'x'.repeat(110)}";`,
      ).join('\n');
      await page.locator('#replacement').fill(text);
      await page.locator('#replacement').evaluate((e: HTMLTextAreaElement) => {
        e.scrollTop = 155;
        e.scrollLeft = 220;
        e.dispatchEvent(new Event('scroll'));
      });
      const metrics = await page.evaluate(() => {
        const a = document.getElementById('replacement')!,
          b = document.querySelector('.draft-colors')!;
        const s = getComputedStyle(a),
          t = getComputedStyle(b);
        return {
          scroll: [a.scrollTop, b.scrollTop, a.scrollLeft, b.scrollLeft],
          font: [s.fontSize, t.fontSize, s.lineHeight, t.lineHeight, s.padding, t.padding],
          fits: document.documentElement.scrollWidth <= innerWidth,
        };
      });
      expect(metrics.scroll[0]).toBe(metrics.scroll[1]);
      expect(metrics.scroll[2]).toBe(metrics.scroll[3]);
      expect(metrics.font[0]).toBe(metrics.font[1]);
      expect(metrics.font[2]).toBe(metrics.font[3]);
      expect(metrics.font[4]).toBe(metrics.font[5]);
      expect(metrics.fits).toBe(true);
      await page.screenshot({
        path: `work/colors-${editor === 'IntelliJ' ? 'intellij' : 'vscode'}.png`,
      });
    });
    test('keeps IME composition readable and uses native text in forced colors', async ({
      page,
    }) => {
      await page.getByRole('button', { name: 'Try it yourself', exact: true }).click();
      await page.locator('#replacement').dispatchEvent('compositionstart');
      await expect(page.locator('#code-input')).not.toHaveClass(/has-colors/);
      await page.locator('#replacement').fill('const 雪 = 3;');
      await page.locator('#replacement').dispatchEvent('compositionend');
      await expect(page.locator('#code-input')).toHaveClass(/has-colors/);
      await page.emulateMedia({ forcedColors: 'active' });
      await expect(page.locator('.draft-colors')).toHaveCSS('visibility', 'hidden');
      expect(
        await page.locator('#replacement').evaluate((e) => getComputedStyle(e).webkitTextFillColor),
      ).not.toBe('rgba(0, 0, 0, 0)');
    });
    test('rejects unsafe styles and invalid ranges without interpreting source as HTML', async ({
      page,
    }) => {
      const last = await page.evaluate(() =>
        (window as any).messages.findLast((m: any) => m.target === 'source'),
      );
      await dispatch(page, {
        ...last,
        runs: [[0, code.length, 0]],
        styles: [{ color: 'red;}body{display:none', font: 0 }],
      });
      expect(await page.locator('#source').textContent()).toBe(code);
      await expect(page.locator('#source span')).toHaveCount(0);
      await dispatch(page, {
        ...last,
        runs: [[0, code.length + 1, 0]],
        styles: [{ color: '#112233', font: 0 }],
      });
      await expect(page.locator('#source span')).toHaveCount(0);
      await expect(page.locator('img')).toHaveCount(0);
    });
  });
