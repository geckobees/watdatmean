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
const args = [
  '--new-window',
  '--wait',
  '--skip-welcome',
  '--skip-release-notes',
  '--disable-updates',
  `--user-data-dir=${resolve('.vscode-dev/profile')}`,
  `--extensions-dir=${resolve('.vscode-dev/extensions')}`,
  `--extensionDevelopmentPath=${process.cwd()}`,
  resolve('demo'),
];
// Batch launchers need a shell; direct executables (including paths with spaces) do not.
const shell = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable);
if (shell && [executable, ...args].some((value) => /["%\r\n]/.test(value)))
  throw new Error('Use a VS Code executable and checkout path without quotes or percent signs.');
const child = spawn(
  shell ? `"${executable}"` : executable,
  shell ? args.map((arg) => `"${arg}"`) : args,
  { stdio: 'inherit', shell, windowsHide: true },
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
