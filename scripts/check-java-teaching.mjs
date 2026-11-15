// Executes only controlled checked-in regression fixtures, never editor selections.
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
const javaHome = process.argv[2] || process.env.JAVA_HOME;
const runtimeHome = process.argv[3] || javaHome;
if (!javaHome) throw new Error('Supply a JDK home as the first argument.');
const root = path.resolve('work/java-teaching');
const runtimeVersion = /^JAVA_VERSION="([^"]+)"/m.exec(
  await readFile(path.join(runtimeHome, 'release'), 'utf8'),
)?.[1];
await mkdir(root, { recursive: true });
await build({
  stdin: {
    contents: `export { wombCode, wombOutput, wombRequest } from './tests/quality/depth-cases';
      export { javaTraceCases } from './tests/quality/java-trace-cases';
      export { javaGeneralCases } from './tests/quality/java-general-cases';
      export { javaControlCases } from './tests/quality/java-control-cases';
      export { javaArrayExceptionCases } from './tests/quality/java-array-exception-cases';
      export { parseJavaTrace } from './src/java-trace-parser';
      export { javaTraceLesson } from './src/java-trace';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: path.join(root, 'fixture.cjs'),
});
const {
  wombOutput,
  wombRequest,
  javaTraceCases,
  javaGeneralCases,
  javaControlCases,
  javaArrayExceptionCases,
  parseJavaTrace,
  javaTraceLesson,
} = createRequire(import.meta.url)(path.join(root, 'fixture.cjs'));
const sources = [];
const cases = [
  ...javaTraceCases.map((c) => ({ ...c, main: 'Womb' })),
  ...javaGeneralCases,
  ...javaControlCases,
  ...javaArrayExceptionCases,
];
for (let i = 0; i < cases.length; i++) {
  const fixture = cases[i];
  if (parseJavaTrace(fixture.code).outer !== fixture.main)
    throw new Error('Fixture main class mismatch');
  const directory = path.join(root, 'src', `fixture${i}`);
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, fixture.main + '.java');
  // Each fixed fixture gets its own package only for the compiler check, avoiding name collisions.
  await writeFile(file, `package fixture${i};\n` + fixture.code);
  sources.push(file);
}
const exe = process.platform === 'win32' ? '.exe' : '';
execFileSync(
  path.join(javaHome, 'bin', 'javac' + exe),
  ['--release', '17', '-d', root, ...sources],
  { windowsHide: true, timeout: 30000 },
);
const results = [];
for (let i = 0; i < cases.length; i++) {
  const fixture = cases[i];
  const output = execFileSync(
    path.join(runtimeHome, 'bin', 'java' + exe),
    ['-Dline.separator=\n', '-cp', root, `fixture${i}.${fixture.main}`],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
    },
  );
  const lesson = javaTraceLesson({ ...wombRequest, code: fixture.code });
  if (!lesson || output !== lesson.output.text || (i === 0 && output !== wombOutput))
    throw new Error(
      'Java execution disagrees with the local trace for ' +
        fixture.id +
        ': ' +
        JSON.stringify(output),
    );
  results.push({
    id: fixture.id,
    sourceSha256: createHash('sha256').update(fixture.code).digest('hex'),
    output,
    localOutput: lesson.output.text,
    expected: fixture.expected,
    expectedMatches: fixture.expected === undefined || fixture.expected === output,
    visibleWords: [lesson.summary, ...lesson.steps, lesson.note].join(' ').split(/\s+/).length,
    usage: lesson.usage,
    passed: fixture.expected === undefined || fixture.expected === output,
  });
}
const old = JSON.parse(
  await readFile('tests/quality/groq-reasoning-2026-11-14.json', 'utf8'),
).results;
const comparison = old
  .filter((r) => r.request?.code.includes('class Womb'))
  .map((r) => ({
    variant: r.variant,
    before: r.lesson.usage,
    beforeOutput: r.lesson.output.text,
    after: javaTraceLesson(r.request).usage,
    afterOutput: javaTraceLesson(r.request).output.text,
  }));
await writeFile(
  path.join(root, 'result.json'),
  JSON.stringify(
    {
      compiledFor: 'Java 17',
      runtimeVersion,
      expected: wombOutput,
      results,
      comparison,
      passed: results.every((r) => r.passed),
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `PASS: ${results.length} controlled Java 17 fixtures agree with the local trace. Womb output: ${JSON.stringify(wombOutput)}`,
);
const mismatches = results.filter((r) => !r.expectedMatches);
if (mismatches.length)
  throw new Error(
    'Correct independent expected strings after review: ' +
      JSON.stringify(mismatches.map((r) => ({ id: r.id, expected: r.expected, java: r.output }))),
  );
