import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
await build({
  entryPoints: ['tests/integration/host.ts'],
  outfile: 'dist/integration.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['vscode'],
  logLevel: 'info',
});
const args = [
  '--new-window',
  '--wait',
  '--disable-workspace-trust',
  '--skip-welcome',
  '--skip-release-notes',
  '--disable-updates',
  `--user-data-dir=${resolve('.vscode-test/profile')}`,
  `--extensions-dir=${resolve('.vscode-test/extensions')}`,
  `--extensionDevelopmentPath=${process.cwd()}`,
  `--extensionTestsPath=${resolve('dist/integration.cjs')}`,
  resolve('demo'),
];
const executable =
  process.env.VSCODE_EXECUTABLE || (process.platform === 'win32' ? 'code.cmd' : 'code');
const resultFile = resolve(`.vscode-test/result-${randomUUID()}.json`);
const child = spawn(executable, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  windowsHide: true,
  env: { ...process.env, WATDATMEAN_TEST_RESULT: resultFile },
});
const timeout = setTimeout(() => {
  console.error('Integration test timed out.');
  child.kill();
  process.exitCode = 1;
}, 90000);
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  clearTimeout(timeout);
  if (!existsSync(resultFile)) {
    console.error('VS Code did not produce a test result.');
    process.exitCode = 1;
    return;
  }
  const result = JSON.parse(readFileSync(resultFile, 'utf8'));
  console.log(result.message);
  process.exitCode = result.passed ? 0 : code || 1;
});
