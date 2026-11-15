import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { panelHtml } from '../../src/panel';

const send = (page: Page, data: unknown) =>
  page.evaluate((data) => window.dispatchEvent(new MessageEvent('message', { data })), data);

for (const editor of ['VS Code', 'IntelliJ']) {
  test.describe(`${editor} stage controls`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        const w = window as any;
        w.messages = [];
        w.state = {};
        w.watdatmeanHost = {
          getState: () => w.state,
          setState: (state: unknown) => {
            w.state = state;
          },
          postMessage: (m: unknown) => {
            w.messages.push(m);
          },
        };
      });
      await page.route('https://stages.test/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (/\.(js|css|wav)$/.test(path)) {
          await route.fulfill({
            body: readFileSync(`media${path}`),
            contentType: path.endsWith('.wav')
              ? 'audio/wav'
              : path.endsWith('.css')
                ? 'text/css'
                : 'application/javascript',
          });
        } else {
          await route.fulfill({
            body:
              editor === 'IntelliJ'
                ? readFileSync('intellij/build/generated/web/panel.html', 'utf8').replaceAll(
                    '__WDM_NONCE__',
                    'stages',
                  )
                : panelHtml(
                    {
                      cspSource: 'https://stages.test',
                      css: 'https://stages.test/panel.css',
                      script: 'https://stages.test/panel.js',
                    },
                    'stages',
                  ),
            contentType: 'text/html',
          });
        }
      });
      await page.goto('https://stages.test/');
      await send(page, {
        type: 'selection',
        code: 'const score = 3;',
        start: 0,
        language: 'TypeScript',
        file: 'score.ts',
        line: 8,
        parts: [],
      });
    });

    test('numbered green, yellow and red stages work with keyboard and preserve panel actions', async ({
      page,
    }) => {
      await expect(page.locator('h1')).toHaveText('WatDatMean');
      await expect(page.locator('h1')).toHaveCSS('font-weight', '700');
      await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(27, 40, 56)');
      await expect(page.locator('.source-card')).toHaveCSS('border-radius', '2px');
      const names = ['Understand', 'Another example', 'Try it yourself'];
      const ids = ['understand', 'examples', 'impact'];
      for (let i = 0; i < names.length; i++) {
        const button = page.getByRole('button', { name: names[i], exact: true });
        await expect(button.locator('.stage-lamp')).toHaveText(String(i + 1));
        await button.focus();
        await page.keyboard.press('Enter');
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator(`#${ids[i]}`)).toBeVisible();
        expect(
          await button.evaluate((el) => getComputedStyle(el).getPropertyValue('--stage').trim()),
        ).toBe(['#63db95', '#f2ce54', '#f47b77'][i]);
        expect(
          await button.locator('.stage-lamp').evaluate((el) => getComputedStyle(el).boxShadow),
        ).not.toBe('none');
      }
      expect(
        await page.evaluate(() =>
          (window as any).messages.filter((m: any) => m.type === 'request'),
        ),
      ).toEqual([]);
    });

    test('click sound is local and decodes under the actual content security policy', async ({
      page,
    }) => {
      const failures: string[] = [];
      page.on('pageerror', (e) => failures.push(e.message));
      await page.getByRole('button', { name: 'Another example', exact: true }).click();
      await expect
        .poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => el.readyState))
        .toBeGreaterThanOrEqual(2);
      const audio = await page.locator('audio').evaluate((el: HTMLAudioElement) => ({
        src: el.src,
        volume: el.volume,
        duration: el.duration,
        error: el.error,
      }));
      expect(audio.error).toBeNull();
      expect(audio.volume).toBe(0.25);
      expect(audio.duration).toBeGreaterThan(0.05);
      expect(audio.duration).toBeLessThan(0.15);
      expect(
        audio.src.startsWith(
          editor === 'IntelliJ' ? 'data:audio/wav;base64,' : 'https://stages.test/',
        ),
      ).toBe(true);
      expect(failures).toEqual([]);
    });

    test('mute survives preference changes and host reload; background events and disabled buttons stay silent', async ({
      page,
    }) => {
      await page.evaluate(() => {
        (window as any).plays = 0;
        HTMLMediaElement.prototype.play = function () {
          (window as any).plays++;
          return Promise.resolve();
        };
      });
      await page.getByRole('button', { name: 'Another example', exact: true }).click();
      expect(await page.evaluate(() => (window as any).plays)).toBe(1);
      await page.getByRole('button', { name: 'Button sounds' }).click();
      await expect(page.locator('#sound-toggle')).toHaveText('Sound off');
      await page.locator('#mode').selectOption('project');
      expect(await page.evaluate(() => (window as any).state)).toMatchObject({
        soundEnabled: false,
        mode: 'project',
      });
      expect(await page.evaluate(() => (window as any).messages)).toContainEqual({
        type: 'soundToggle',
        enabled: false,
      });
      await page.getByRole('button', { name: 'Try it yourself', exact: true }).click();
      expect(await page.evaluate(() => (window as any).plays)).toBe(1);
      await page.reload();
      await send(page, { type: 'config', soundEnabled: false });
      await expect(page.locator('#sound-toggle')).toHaveAttribute('aria-pressed', 'false');
      await page.getByRole('button', { name: 'Button sounds' }).click();
      await page.evaluate(() => {
        (window as any).plays = 0;
        HTMLMediaElement.prototype.play = function () {
          (window as any).plays++;
          return Promise.resolve();
        };
        document.querySelector<HTMLButtonElement>('[data-tab=impact]')!.click();
      });
      await send(page, { type: 'busy', value: true });
      await page.locator('#analyze').click({ force: true });
      expect(await page.evaluate(() => (window as any).plays)).toBe(0);
      // A late initial config cannot undo a user's newer choice.
      await send(page, { type: 'config', soundEnabled: false });
      await expect(page.locator('#sound-toggle')).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: 'Understand', exact: true }).focus();
      await page.keyboard.press('Space');
      expect(await page.evaluate(() => (window as any).plays)).toBe(1);
    });

    test('audio failure leaves navigation working; compact layout fits light and high contrast themes', async ({
      page,
    }) => {
      await page.evaluate(() => {
        HTMLMediaElement.prototype.play = () => Promise.reject(new Error('Audio unavailable'));
      });
      for (const width of [320, 450, 860]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.getByRole('button', { name: 'Another example', exact: true }).click();
        await expect(page.locator('#examples')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width,
        );
        for (const button of await page.locator('.tab').all()) {
          const box = await button.boundingBox();
          expect(box!.width).toBeGreaterThan(70);
          expect(box!.height).toBeGreaterThan(44);
        }
      }
      await page.evaluate(() => {
        document.body.classList.add('vscode-light');
        document.documentElement.style.setProperty('--vscode-editor-background', '#ffffff');
        document.documentElement.style.setProperty('--vscode-editor-foreground', '#202020');
      });
      await expect(page.locator('#source-frame')).toHaveCSS('color', 'rgb(32, 32, 32)');
      await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
      await expect(page.locator('.tab.active')).toHaveCSS('outline-style', 'solid');
      await expect(page.locator('.stage-lamp').first()).toHaveCSS('transition-duration', '0s');
    });
  });
}
