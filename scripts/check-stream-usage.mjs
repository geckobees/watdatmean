// Offline comparison with a committed baseline: no provider keys or network requests.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
const baseline = process.argv[2] || 'e0758b4';
if (!/^[0-9a-f]{7,40}$/.test(baseline)) throw new Error('Supply a committed baseline hash.');
const root = path.resolve('work/stream-usage');
const beforeRoot = path.join(root, baseline);
const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', baseline, 'src'], {
  encoding: 'utf8',
  windowsHide: true,
})
  .trim()
  .split('\n');
for (const file of paths) {
  if (!file.startsWith('src/') || !file.endsWith('.ts')) continue;
  const target = path.join(beforeRoot, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(
    target,
    execFileSync('git', ['show', `${baseline}:${file}`], {
      windowsHide: true,
      maxBuffer: 10000000,
    }),
  );
}
const exports =
  "export {makeRequest} from './src/provider'; export {javaTraceLesson} from './src/java-trace'; export {literalLesson} from './src/literal-lesson';";
for (const [name, resolveDir] of [
  ['before', beforeRoot],
  ['after', process.cwd()],
]) {
  await build({
    stdin: { contents: exports, resolveDir, loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(root, name + '.cjs'),
  });
}
await build({
  stdin: {
    contents:
      "export {javaStreamCases} from './tests/quality/java-stream-cases'; export {wombRequest} from './tests/quality/depth-cases';",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: path.join(root, 'fixtures.cjs'),
});
const require = createRequire(import.meta.url),
  before = require(path.join(root, 'before.cjs')),
  after = require(path.join(root, 'after.cjs'));
const { javaStreamCases, wombRequest } = require(path.join(root, 'fixtures.cjs'));
const fixtures = [
  { id: 'simple-print', code: 'System.out.println("hello");' },
  { id: 'womb', code: wombRequest.code },
  ...javaStreamCases,
];
const results = fixtures.map((fixture) => {
  const request = { ...wombRequest, code: fixture.code };
  const a = before.javaTraceLesson(request) ?? before.literalLesson(request),
    b = after.javaTraceLesson(request) ?? after.literalLesson(request);
  const previous = before.makeRequest('groq', 'qwen/qwen3.8-27b', 'unused', request).body;
  const current = after.makeRequest('groq', 'qwen/qwen3.8-27b', 'unused', request).body;
  const config = JSON.parse(current);
  return {
    id: fixture.id,
    beforeLocal: !!a,
    afterLocal: !!b,
    beforeUsage: a?.usage ?? null,
    afterUsage: b?.usage ?? null,
    beforeInputCharacters: JSON.parse(previous).messages.reduce((n, m) => n + m.content.length, 0),
    afterInputCharacters: config.messages.reduce((n, m) => n + m.content.length, 0),
    fallbackRequestUnchanged: previous === current,
    outputUnchanged: a ? a.output?.text === b?.output?.text : null,
    outputMatches: fixture.expected === undefined || fixture.expected === b?.output?.text,
    maxCompletionTokens: config.max_completion_tokens,
    reasoningEffort: config.reasoning_effort,
    requestSha256: createHash('sha256').update(current).digest('hex'),
  };
});
if (
  results.some(
    (r) =>
      !r.afterLocal ||
      !r.fallbackRequestUnchanged ||
      !r.outputMatches ||
      r.afterUsage?.total !== 0 ||
      r.outputUnchanged === false,
  )
)
  throw new Error('Local coverage or fallback requests regressed.');
const report = {
  baseline,
  method:
    'Offline local-path and serialized fallback-request comparison; null beforeUsage means no live API usage was measured. Input characters are not tokens.',
  results,
  passed: true,
};
await writeFile(path.join(root, 'result.json'), JSON.stringify(report, null, 2) + '\n');
console.log(
  `PASS: ${javaStreamCases.length} new examples change from AI fallback to zero API tokens; simple print and Womb remain local; all fallback request bodies are unchanged.`,
);
