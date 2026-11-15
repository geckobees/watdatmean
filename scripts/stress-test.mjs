import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
await build({
  entryPoints: ['tests/stress-worker.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'work/stress-worker.cjs',
});
const output = execFileSync(
  process.execPath,
  ['--max-old-space-size=256', 'work/stress-worker.cjs'],
  { timeout: 30000, maxBuffer: 100000, windowsHide: true, encoding: 'utf8' },
);
const report = JSON.parse(output);
writeFileSync('work/stress-results.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
