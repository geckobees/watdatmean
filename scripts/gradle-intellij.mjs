import { javaHome } from './setup-intellij.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const child = spawn(
  path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'),
  [
    '-jar',
    path.join(root, 'intellij/gradle/wrapper/gradle-wrapper.jar'),
    '-p',
    path.join(root, 'intellij'),
    `-PnodeExecutable=${process.execPath}`,
    ...(process.argv.slice(2).length ? process.argv.slice(2) : ['buildPlugin']),
  ],
  { stdio: 'inherit', windowsHide: true },
);
child.once('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
