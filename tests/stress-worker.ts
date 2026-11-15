import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { inspectCode, checkSyntax } from '../src/languages';
const cases = [
  ['ts-deep', 'typescript', 'const x = ' + '('.repeat(6000) + '1' + ')'.repeat(6000) + ';'],
  ['python-deep', 'python', 'x = ' + '['.repeat(4000) + '1' + ']'.repeat(4000)],
  ['ts-long-string', 'typescript', 'const x = "' + 'x'.repeat(480000) + '";'],
  ['python-long-string', 'python', 'x = "' + 'x'.repeat(480000) + '"'],
  [
    'python-many-bindings',
    'python',
    Array.from({ length: 10000 }, (_, i) => `item${i} = ${i}\n`).join(''),
  ],
  ['ts-many-statements', 'typescript', 'const x = 1;\n'.repeat(20000)],
  ['ts-unfinished', 'typescript', 'const score:=;\n'.repeat(5000)],
  ['python-unfinished', 'python', 'def f(:\n    x = (\n'.repeat(1500)],
];
const measurements = [];
for (const [id, language, code] of cases) {
  const start = performance.now();
  const snippet = inspectCode(code, 0, 0, language);
  assert(snippet.start >= 0 && snippet.end <= code.length);
  const syntax = checkSyntax(code, language);
  assert(Array.isArray(syntax.errors));
  measurements.push({
    id,
    characters: code.length,
    ms: Math.round(performance.now() - start),
    parts: snippet.parts.length,
    checked: syntax.checked,
    syntaxErrors: syntax.errors.length,
  });
}
let seed = 20261114;
const random = (n: number) => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed % n;
};
const sources = [
  ['typescript', 'function score(x: number) { const points = x * 2; return points; }'],
  [
    'python',
    'import math as m\ndef score(value):\n    points = m.sqrt(value)\n    return points\n',
  ],
  ['javascriptreact', 'const view = <button onClick={() => log(3)}>Hi</button>;'],
];
const start = performance.now();
for (let i = 0; i < 1200; i++) {
  const [language, source] = sources[i % sources.length];
  const at = random(source.length + 1);
  const code =
    i % 2
      ? source.slice(0, at)
      : source.slice(0, at) + ['}', '(', '"', '\n', ';', '😀'][random(6)] + source.slice(at + 1);
  const from = random(code.length + 1),
    to = from + random(code.length - from + 1);
  const snippet = inspectCode(code, from, to, language);
  assert(snippet.start >= 0 && snippet.end <= code.length && snippet.end >= snippet.start);
  if (to > from) assert.equal(snippet.code, code.slice(from, to));
  checkSyntax(code, language);
}
console.log(
  JSON.stringify({
    passed: true,
    mutations: 1200,
    fuzzMs: Math.round(performance.now() - start),
    measurements,
  }),
);
