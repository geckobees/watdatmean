// Summarize actual provider usage; character counts are never described as token counts.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const input = process.argv[2] ?? 'work/optimization-comparison.json';
const output = path.resolve(process.argv[3] ?? 'work/optimization-summary.json');
if (!output.startsWith(path.resolve('work') + path.sep))
  throw new Error('Keep generated summaries in work/.');
const report = JSON.parse(await readFile(input, 'utf8'));
const records = report.results ?? [];
const comparisonVariant = ['after-output', 'after-refs', 'after-format', 'after-final'].find(
  (variant) => records.some((r) => r.variant === variant),
);
const ids = [...new Set(records.map((r) => r.id))];
const pairs = [];
for (const id of ids) {
  const before = records.find(
    (r) => r.id === id && r.variant === 'before' && r.status === 'complete',
  );
  const after = records.find(
    (r) => r.id === id && r.variant === comparisonVariant && r.status === 'complete',
  );
  if (!before || !after) continue;
  for (const key of [
    'model',
    'temperature',
    'reasoning_effort',
    'reasoning_format',
    'max_completion_tokens',
  ]) {
    if (JSON.stringify(before.requestBody[key]) !== JSON.stringify(after.requestBody[key]))
      throw new Error('Incomparable settings for ' + id + ': ' + key);
  }
  if (
    before.requestBody.response_format.type !== after.requestBody.response_format.type ||
    !after.requestBody.response_format.json_schema.strict
  )
    throw new Error('Changed response mode for ' + id);
  if (JSON.stringify(before.request) !== JSON.stringify(after.request))
    throw new Error('Different source inputs for ' + id);
  function metrics(record) {
    const lesson =
      record.variant !== 'before' ? (record.reviewedLesson ?? record.lesson) : record.lesson;
    const concepts = JSON.parse(record.raw).concepts ?? [];
    return {
      ...lesson.usage,
      steps: lesson.steps.length,
      outputMatches:
        lesson.output?.text.replaceAll('\r\n', '\n') ===
        record.expectedOutput.replaceAll('\r\n', '\n'),
      valuesMatchIgnoringFinalNewline:
        lesson.output?.text.replaceAll('\r\n', '\n').trimEnd() ===
        record.expectedOutput.replaceAll('\r\n', '\n').trimEnd(),
      localFallback: !!lesson.local,
      filledDefinitions: concepts.filter(
        (c) =>
          (typeof c === 'string' || c.explanation === '') &&
          lesson.concepts.some(
            (d) => d.term === (typeof c === 'string' ? c : c.term) && d.explanation,
          ),
      ).length,
    };
  }
  pairs.push({ id, before: metrics(before), after: metrics(after) });
}
const totals = {
  before: { input: 0, output: 0, total: 0 },
  after: { input: 0, output: 0, total: 0 },
};
for (const pair of pairs)
  for (const side of ['before', 'after'])
    for (const key of ['input', 'output', 'total']) totals[side][key] += pair[side][key];
const reduction = Object.fromEntries(
  ['input', 'output', 'total'].map((key) => [
    key,
    totals.before[key]
      ? Number((100 * (1 - totals.after[key] / totals.before[key])).toFixed(1))
      : null,
  ]),
);
const summary = {
  complete: pairs.length === 3,
  provider: report.provider,
  model: report.model,
  comparisonVariant,
  pairs,
  totals,
  reductionPercent: reduction,
  attempts: records.map((r) => ({
    id: r.id,
    variant: r.variant,
    status: r.status,
    total: r.lesson?.usage?.total,
    outputMatches: r.outputMatches,
  })),
  limitations:
    'One live sample per final condition, not a statistical benchmark. Completion tokens include reasoning. Initial candidate failures are retained; correctness also requires reviewing the explanation, not just matching output. No source was executed by the extension.',
};
await writeFile(output, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
