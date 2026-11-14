import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import './build.mjs';

const macCode = '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';
const executable =
  process.env.VSCODE_EXECUTABLE ||
  (process.platform === 'darwin' && existsSync(macCode)
    ? macCode
    : process.platform === 'win32'
      ? 'code.cmd'
      : 'code');
const child = spawn(
  executable,
  [
    '--new-window',
    '--wait',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-updates',
    `--user-data-dir=${resolve('.vscode-dev/profile')}`,
    `--extensions-dir=${resolve('.vscode-dev/extensions')}`,
    `--extensionDevelopmentPath=${process.cwd()}`,
    resolve('demo'),
  ],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
child.on('error', (error) => {
  console.error(
    `Could not launch VS Code: ${error.message}. Set VSCODE_EXECUTABLE to its CLI path.`,
  );
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
