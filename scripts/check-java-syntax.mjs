import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
const index = process.argv.indexOf('--java-home');
const jdk = index < 0 ? process.env.JAVA_HOME : process.argv[index + 1];
if (!jdk)
  throw new Error(
    'Supply --java-home for this compiler test. Installed plugins do not require it.',
  );
const dir = path.resolve('work/java-syntax-check');
await mkdir(dir, { recursive: true });
const bundle = await build({
  stdin: {
    contents:
      "export { javaSyntaxFixes } from './tests/quality/java-syntax-cases'; export { javaSyntaxHelp } from './src/java-syntax-help';",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const { javaSyntaxFixes, javaSyntaxHelp } = await import(
  'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')
);
const sources = [];
for (const [i, fixture] of javaSyntaxFixes.entries()) {
  const correction = javaSyntaxHelp(fixture.code)?.corrected;
  if (correction !== fixture.corrected) throw new Error('Unexpected repair: ' + fixture.id);
  const file = path.join(dir, `Case${i}.java`);
  const contents =
    fixture.id === 'call-in-method'
      ? `class Case${i} { ${correction}\n}`
      : `class Case${i} { void test() { ${correction}\n} }`;
  await writeFile(file, contents);
  sources.push(file);
}
const run = (name, args) =>
  new Promise((resolve, reject) =>
    execFile(
      path.resolve(jdk, 'bin', name + (process.platform === 'win32' ? '.exe' : '')),
      args,
      { windowsHide: true, timeout: 30000 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(stderr || error.message));
        else {
          process.stdout.write(stdout);
          resolve();
        }
      },
    ),
  );
await run('javac', ['--release', '17', '-d', dir, 'tests/tooling/JavaSyntaxCheck.java']);
await run('java', ['-cp', dir, 'JavaSyntaxCheck', ...sources]);
