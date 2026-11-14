import './build.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const args = [
  '--new-window',
  '--user-data-dir',
  path.resolve('.vscode-dev/profile'),
  '--extensions-dir',
  path.resolve('.vscode-dev/extensions'),
  '--extensionDevelopmentPath=' + process.cwd(),
  path.resolve('demo'),
];
// code.cmd needs a command shell on Windows. Quote arguments and reject shell metacharacters.
const windows = process.platform === 'win32';
if (windows && args.some((arg) => /["%\r\n]/.test(arg)))
  throw new Error(
    'Move the checkout to a path without quotes or percent signs before running dev.',
  );
const child = spawn(windows ? 'code.cmd' : 'code', windows ? args.map((arg) => `"${arg}"`) : args, {
  stdio: 'inherit',
  shell: windows,
  windowsHide: true,
});
child.on('error', () => {
  console.error('Could not launch VS Code. Install its code command on PATH.');
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
