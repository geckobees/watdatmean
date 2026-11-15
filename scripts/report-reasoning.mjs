import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const file = process.argv[2] ?? 'work/reasoning-comparison.json';
const output = path.resolve(process.argv[3] ?? 'work/reasoning-summary.json');
if (!output.startsWith(path.resolve('work') + path.sep))
  throw new Error('Write generated summaries under work/.');
const report = JSON.parse(await readFile(file, 'utf8'));
const pairs = [];
for (const id of ['typescript-simple', 'python-simple', 'java-simple', 'java-construction']) {
  const before = report.results.find(
    (r) => r.id === id && r.variant === 'before' && r.status === 'complete',
  );
  const after = report.results.find(
    (r) => r.id === id && r.variant === 'after' && r.status === 'complete',
  );
  if (!before || !after) continue;
  const { reasoning_effort: oldEffort, ...oldBody } = before.requestBody;
  const { reasoning_effort: newEffort, ...newBody } = after.requestBody;
  if (JSON.stringify(oldBody) !== JSON.stringify(newBody))
    throw new Error('Changed prompts, source, schema, limits or sampling settings: ' + id);
  const metrics = (record) => {
    const usage = record.lesson.usage;
    const reasoning =
      record.local && record.networkRequests === 0
        ? 0
        : record.usage?.completion_tokens_details?.reasoning_tokens;
    return {
      ...usage,
      reasoning: reasoning ?? null,
      answer: typeof reasoning === 'number' ? usage.output - reasoning : null,
      words: [record.lesson.summary, record.lesson.note ?? '', ...record.lesson.steps]
        .join(' ')
        .split(/\s+/)
        .filter(Boolean).length,
      steps: record.lesson.steps.length,
      outputMatches: record.lesson.output?.text === record.expectedOutput,
      local: !!record.lesson.local,
      networkRequests: record.networkRequests ?? 1,
      finishReason: record.local
        ? 'local: no provider request'
        : (record.finishReason ?? 'previous saved response'),
    };
  };
  pairs.push({
    id,
    oldEffort,
    newEffort: after.local ? 'local: no provider request' : newEffort,
    policyChanged: !!after.local || oldEffort !== newEffort,
    before: metrics(before),
    after: metrics(after),
    ...(before.reusedFrom ? { baselineSource: before.reusedFrom } : {}),
  });
}
const totals = {
  before: { input: 0, output: 0, reasoning: 0, total: 0 },
  after: { input: 0, output: 0, reasoning: 0, total: 0 },
};
for (const pair of pairs.filter((p) => p.policyChanged))
  for (const side of ['before', 'after'])
    for (const key of ['input', 'output', 'reasoning', 'total'])
      totals[side][key] += pair[side][key] ?? 0;
const result = {
  complete: pairs.length === 4,
  provider: report.provider,
  model: report.model,
  pairs,
  changedPolicyTotals: totals,
  changedPolicyTotalReductionPercent: totals.before.total
    ? Number((100 * (1 - totals.after.total / totals.before.total)).toFixed(1))
    : null,
  reportedEvaluationTokens: report.results
    .filter((r) => !r.reusedFrom)
    .reduce((sum, r) => sum + (r.lesson?.usage?.total ?? 0), 0),
  attempts: report.results.map((r) => ({
    id: r.id,
    variant: r.variant,
    trial: r.trial,
    status: r.status,
    outputMatches: r.outputMatches,
    reusedFrom: r.reusedFrom,
  })),
  limitations:
    'Small synthetic sample; not a guarantee of general AI quality. Java keeps exactly the same reasoning policy, so variation in its completion usage is not credited to this optimization. Prose must also be reviewed, not only output. No private reasoning text is saved.',
};
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
