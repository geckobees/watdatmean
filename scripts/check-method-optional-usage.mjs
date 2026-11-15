// Offline measurement. Capture a pre-change bundle with --snapshot <file.cjs>, then compare it.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
const exports =
  "export {makeRequest} from './src/provider'; export {javaTraceLesson} from './src/java-trace'; export {literalLesson} from './src/literal-lesson';";
async function bundle(contents, outfile) {
  await build({
    stdin: { contents, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
  });
}
if (process.argv[2] === '--snapshot') {
  if (!process.argv[3]) throw Error('Supply a snapshot destination.');
  await bundle(exports, process.argv[3]);
} else {
  if (!process.argv[2]) throw Error('Supply the pre-change snapshot bundle.');
  const root = path.resolve('work/method-optional-usage');
  await mkdir(root, { recursive: true });
  await bundle(exports, path.join(root, 'after.cjs'));
  await bundle(
    "export {javaStreamCases} from './tests/quality/java-stream-cases'; export {javaMethodOptionalCases} from './tests/quality/java-method-optional-cases'; export {wombRequest} from './tests/quality/depth-cases';",
    path.join(root, 'fixtures.cjs'),
  );
  const require = createRequire(import.meta.url),
    before = require(path.resolve(process.argv[2])),
    after = require(path.join(root, 'after.cjs'));
  const { javaStreamCases, javaMethodOptionalCases, wombRequest } = require(
    path.join(root, 'fixtures.cjs'),
  );
  const fixtures = [
    { id: 'simple-print', code: 'System.out.println("hello");' },
    { id: 'womb', code: wombRequest.code },
    ...javaStreamCases,
    ...javaMethodOptionalCases,
  ];
  const results = fixtures.map((f) => {
    const request = { ...wombRequest, code: f.code },
      a = before.javaTraceLesson(request) ?? before.literalLesson(request),
      b = after.javaTraceLesson(request) ?? after.literalLesson(request);
    const oldBody = before.makeRequest('groq', 'qwen/qwen3.8-27b', 'unused', request).body,
      body = after.makeRequest('groq', 'qwen/qwen3.8-27b', 'unused', request).body;
    const config = JSON.parse(body);
    return {
      id: f.id,
      beforeLocal: !!a,
      afterLocal: !!b,
      beforeUsage: a?.usage ?? null,
      afterUsage: b?.usage ?? null,
      fallbackRequestUnchanged: oldBody === body,
      outputUnchanged: a ? a.output?.text === b?.output?.text : null,
      outputMatches: f.expected === undefined || b?.output?.text === f.expected,
      maxCompletionTokens: config.max_completion_tokens,
      reasoningEffort: config.reasoning_effort,
      requestSha256: createHash('sha256').update(body).digest('hex'),
    };
  });
  if (
    results.some(
      (r) =>
        !r.afterLocal ||
        r.afterUsage?.total !== 0 ||
        !r.fallbackRequestUnchanged ||
        r.outputUnchanged === false ||
        !r.outputMatches,
    )
  )
    throw Error('Usage, output, or fallback request regression.');
  const report = {
    baseline: '0.1.9 working tree captured before method-reference/Optional edits',
    baselineSha256: createHash('sha256')
      .update(await readFile(process.argv[2]))
      .digest('hex'),
    method:
      'Offline before/after local-path and serialized provider request comparison. Null beforeUsage means no live API token total was measured. No provider requests were sent.',
    newLocalExamples: results.filter((r) => !r.beforeLocal && r.afterLocal).length,
    results,
    passed: true,
  };
  await writeFile(path.join(root, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(
    `PASS: ${report.newLocalExamples} newly local examples use 0 API tokens; all ${results.length} fallback bodies unchanged; previous local outputs preserved.`,
  );
}
