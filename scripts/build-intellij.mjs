import * as esbuild from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

await mkdir('intellij/build/generated/web', { recursive: true });
await esbuild.build({
  entryPoints: ['src/bridge/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: 'intellij/build/generated/web/engine.cjs',
  minify: true,
});
const compiled = await esbuild.build({
  entryPoints: ['src/panel.ts'],
  bundle: true,
  write: false,
  format: 'esm',
});
const { panelHtml } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')
);
const nonce = '__WDM_NONCE__';
const css = await readFile('media/panel.css', 'utf8');
const script = await readFile('media/panel.js', 'utf8');
const colors = await readFile('media/code-colors.js', 'utf8');
const sound =
  'data:audio/wav;base64,' + (await readFile('media/button-click.wav')).toString('base64');
const html = panelHtml(
  { cspSource: `'nonce-${nonce}'`, css: 'panel.css', script: 'panel.js', sound },
  nonce,
)
  .replace(
    '<link rel="stylesheet" href="panel.css" />',
    () => `<style nonce="${nonce}">${css}</style>`,
  )
  .replace(
    /<script\b[^>]*\bsrc="(code-colors|panel)\.js"[^>]*>\s*<\/script>/g,
    (_tag, name) =>
      `<script nonce="${nonce}">${name === 'panel' ? '/*__WDM_BRIDGE__*/\n' + script : colors}</script>`,
  );
if (/<script\b[^>]*\bsrc=/.test(html) || !html.includes('window.watdatmeanColors ='))
  throw new Error('IntelliJ panel scripts were not embedded.');
await writeFile('intellij/build/generated/web/panel.html', html);
console.log('Built shared IntelliJ engine and learning panel.');
