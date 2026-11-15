import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { panelHtml } from '../../src/panel';
import { javaTraceLesson } from '../../src/java-trace';
import { javaStreamCases } from '../quality/java-stream-cases';
import { javaMethodOptionalCases } from '../quality/java-method-optional-cases';
import { javaGenericInterfaceCases } from '../quality/java-generic-interface-cases';
import { wombRequest } from '../quality/depth-cases';
import { generate } from '../../src/provider';

async function send(page: Page, data: unknown) {
  await page.evaluate((data) => window.dispatchEvent(new MessageEvent('message', { data })), data);
}
for (const editor of ['VS Code', 'IntelliJ']) {
  test.describe(`${editor} shared Java lessons and repeated terms`, () => {
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
      await page.route('https://learning.test/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('.js') || path.endsWith('.css')) {
          await route.fulfill({
            body: readFileSync(`media${path}`),
            contentType: path.endsWith('.js') ? 'application/javascript' : 'text/css',
          });
        } else {
          const html =
            editor === 'IntelliJ'
              ? readFileSync('intellij/build/generated/web/panel.html', 'utf8').replaceAll(
                  '__WDM_NONCE__',
                  'test-nonce',
                )
              : panelHtml(
                  {
                    cspSource: 'https://learning.test',
                    css: 'https://learning.test/panel.css',
                    script: 'https://learning.test/panel.js',
                  },
                  'test-nonce',
                );
          await route.fulfill({ body: html, contentType: 'text/html' });
        }
      });
      await page.goto('https://learning.test/');
      await expect
        .poll(() => page.evaluate(() => (window as any).messages))
        .toContainEqual({ type: 'ready' });
      await send(page, {
        type: 'selection',
        code: 'unknown(input);',
        language: 'Java',
        file: 'Demo.java',
        line: 1,
        start: 0,
        parts: [],
      });
    });
    for (const [language, code, corrected] of [
      ['TypeScript', 'const total = (1 + 2;', 'const total = (1 + 2);'],
      [
        'Java',
        'int total = 3\nSystem.out.println(total);',
        'int total = 3;\nSystem.out.println(total);',
      ],
      ['Java', 'System.out.println(3;', 'System.out.println(3);'],
    ])
      test(`${language}: previews the correction without applying it: ${code}`, async ({
        page,
      }) => {
        await send(page, {
          type: 'selection',
          code,
          language,
          file: 'test.ts',
          line: 4,
          start: 0,
          parts: [],
        });
        const lesson = await generate(
          'groq',
          'test',
          'key',
          { code, language, task: 'explain', mode: 'standalone', audience: 'beginner' },
          undefined,
          async () => {
            throw new Error('This local arithmetic correction must not call AI');
          },
        );
        await send(page, {
          type: 'lesson',
          task: 'explain',
          provider: 'groq',
          model: 'test',
          lesson,
        });
        await expect(page.locator('.syntax-help')).toContainText('Syntax needs attention');
        await expect(page.locator('.syntax-help')).toContainText('Selection line 1');
        await page.locator('.syntax-help summary').click();
        await expect(page.locator('.syntax-help pre code')).toHaveText(corrected);
        await page.getByRole('button', { name: 'Try corrected version' }).click();
        await expect(page.locator('#replacement')).toHaveValue(corrected);
        await expect(page.locator('#apply')).toBeDisabled();
        expect(
          await page.evaluate(() =>
            (window as any).messages.filter((m: any) => m.type === 'apply'),
          ),
        ).toEqual([]);
        await expect(page.locator('#source')).toHaveText(code);
      });
    test('Java: warns about a missing value without inventing a correction', async ({ page }) => {
      const code = 'int score = ;';
      const lesson = await generate(
        'groq',
        'test',
        'unused',
        { code, language: 'Java', task: 'explain', mode: 'standalone', audience: 'beginner' },
        undefined,
        async () => {
          throw new Error('An ambiguous repair must not call AI');
        },
      );
      await send(page, {
        type: 'lesson',
        task: 'explain',
        provider: 'groq',
        model: 'test',
        lesson,
      });
      await expect(page.locator('.syntax-help')).toContainText('missing a value');
      await expect(page.getByRole('button', { name: 'Try corrected version' })).toHaveCount(0);
      await expect(page.locator('#explanation')).toContainText('0 tokens');
    });
    test('repairs repeated terms in an older cached lesson and keeps concept actions intact', async ({
      page,
    }) => {
      await send(page, {
        type: 'lesson',
        task: 'explain',
        provider: 'fixture',
        model: 'test',
        cached: true,
        lesson: {
          title: 'Text values',
          summary: 'A string holds text.',
          steps: [],
          concepts: [
            { term: 'string', explanation: 'A text value.' },
            { term: ' String ', explanation: 'A text value.' },
            { term: '`string`', explanation: 'A text value.' },
            { term: '` string `', explanation: 'A text value.' },
            { term: 'array', explanation: 'Items in order.' },
          ],
          example: { code: '', explanation: '' },
          predictions: [],
          checks: [],
        },
      });
      const terms = page.locator('.lesson-terms');
      await terms.locator(':scope > summary').click();
      await expect(terms.locator(':scope > details')).toHaveCount(2);
      await expect(terms.locator(':scope > details > summary')).toHaveText(['string', 'array']);
      const string = terms.locator(':scope > details').first();
      await string.locator('summary').click();
      await expect(string.locator('p')).toHaveText('A text value.');
      expect(await page.evaluate(() => (window as any).messages)).toEqual([{ type: 'ready' }]);
      await string.getByRole('button', { name: 'Explain this concept' }).click();
      expect(await page.evaluate(() => (window as any).messages.at(-1))).toMatchObject({
        type: 'request',
        task: 'concept',
        concept: 'string',
      });
    });
    for (const id of [
      'stream-filter-map-sum',
      'stream-early-match',
      'stream-count-elision',
      'lambda-capture',
      'stream-map-failure',
      'optional-eager-lazy',
      'optional-map-filter',
      'optional-throw-constructor',
      'reference-bound-null-now',
      'reference-constructor-later',
      'stream-reduce-optional',
      'generic-box-diamond',
      'generic-body-overload-bound',
      'interface-default',
      'interface-class-wins',
      'interface-generic-reference',
      'interface-lambda-failure-output',
    ]) {
      test(`renders ${id} compactly with exact output and zero tokens`, async ({ page }) => {
        const fixture = [
          ...javaStreamCases,
          ...javaMethodOptionalCases,
          ...javaGenericInterfaceCases,
        ].find((c) => c.id === id)!;
        const lesson = javaTraceLesson({ ...wombRequest, code: fixture.code })!;
        await send(page, {
          type: 'selection',
          code: fixture.code,
          language: 'Java',
          file: 'Demo.java',
          line: 1,
          start: 0,
          parts: [],
        });
        await send(page, {
          type: 'lesson',
          task: 'explain',
          provider: 'groq',
          model: 'test',
          lesson,
        });
        await expect(page.locator('#explanation')).toContainText('0 tokens');
        await expect(page.locator('#explanation .lesson > pre code')).toHaveText(fixture.expected);
        expect(await page.locator('#explanation .lesson > pre code').textContent()).toBe(
          fixture.expected,
        );
        expect(await page.locator('#explanation ol > li').count()).toBeLessThanOrEqual(6);
        await expect(page.locator('.lesson-terms')).not.toHaveAttribute('open', '');
        if (lesson.checks.length) {
          await expect(page.locator('.lesson-practice')).toHaveCount(1);
          await expect(page.locator('.lesson-practice')).not.toHaveAttribute('open', '');
        } else await expect(page.locator('.lesson-practice')).toHaveCount(0);
        const names = await page.locator('.lesson-terms > details > summary').allTextContents();
        expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
        await page.setViewportSize({ width: 380, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      });
    }
  });
}
