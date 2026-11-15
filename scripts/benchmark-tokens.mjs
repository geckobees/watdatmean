// Paired comparison using synthetic fixtures and the existing VS Code SecretStorage key.
// --capture must run before changing production code. No keys or request headers are saved.
import { build } from 'esbuild';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
const baseline = path.resolve('work/optimization-before.cjs');
const report = path.resolve('work/optimization-comparison.json');
const capture = process.argv.includes('--capture');
const snapshot = process.argv.includes('--snapshot');
const finalPass = process.argv.includes('--final');
const formatPass = process.argv.includes('--format-final');
const refsPass = process.argv.includes('--refs-final');
const outputPass = process.argv.includes('--compact-output');
await mkdir('work', { recursive: true });
if (capture || snapshot) {
  const engineFile = snapshot ? path.resolve('work/optimization-after.cjs') : baseline;
  await build({
    entryPoints: ['src/provider.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: engineFile,
  });
  await build({
    entryPoints: ['tests/quality/optimization-cases.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: 'work/optimization-cases.cjs',
  });
  const require = createRequire(import.meta.url);
  const { makeRequest } = require(engineFile);
  const { optimizationCases } = require(path.resolve('work/optimization-cases.cjs'));
  const requests = optimizationCases.map((item) => ({
    ...item,
    body: JSON.parse(makeRequest('groq', 'qwen/qwen3.8-27b', 'fixture', item.request).body),
  }));
  await writeFile(
    `tests/quality/optimization-${snapshot ? 'after' : 'before'}-requests.json`,
    JSON.stringify(requests, null, 2) + '\n',
  );
  console.log(
    `Captured ${snapshot ? 'optimized' : 'original'} engine and three key-free request fixtures.`,
  );
} else {
  await access(baseline);
  const executable = process.env.VSCODE_EXECUTABLE;
  if (!executable)
    throw new Error('Set VSCODE_EXECUTABLE to the VS Code installation with the saved Groq key.');
  const root = path.resolve('work/token-comparison-extension');
  await mkdir(root, { recursive: true });
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ ...manifest, main: './extension.cjs', activationEvents: ['*'] }),
  );
  const caseIndex = process.argv.indexOf('--case');
  const onlyCase = caseIndex < 0 ? undefined : process.argv[caseIndex + 1];
  await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
import * as before from './work/optimization-before.cjs';
import * as after from './src/provider';
import {optimizationCases} from './tests/quality/optimization-cases';
import * as vscode from 'vscode';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
const report = ${JSON.stringify(report)};
export function activate(context) {
 const run = async () => {
  const key = await context.secrets.get('key.groq');
  if (!key) { writeFileSync(report, JSON.stringify({available:false,error:'No configured Groq key.'})); return; }
  const results = existsSync(report) ? JSON.parse(readFileSync(report,'utf8')).results ?? [] : [];
  const save = () => writeFileSync(report, JSON.stringify({provider:'groq',model:'qwen/qwen3.8-27b',results},null,2));
  const cases = optimizationCases.filter(c => !${JSON.stringify(onlyCase) ?? 'undefined'} || ${JSON.stringify(onlyCase?.split(',')) ?? '[]'}.includes(c.id));
  const jobs = cases.flatMap((item,index) => (${outputPass} ? ['after-output'] : ${refsPass} ? ['after-refs'] : ${formatPass} ? ['after-format'] : ${finalPass} ? ['after-final'] : index % 2 ? ['after','before'] : ['before','after']).map(variant => ({item,variant})));
  for (const {item,variant} of jobs) {
   if (results.some(r => r.id===item.id && r.variant===variant && r.status==='complete')) continue;
   if (results.length >= 19) break;
   const engine = variant === 'before' ? before : after;
   const record = {id:item.id,variant,status:'started',request:item.request,expectedOutput:item.expectedOutput};
   results.push(record);save();
   try {
    const sent = JSON.parse(engine.makeRequest('groq','qwen/qwen3.8-27b',key,item.request).body);
    record.requestBody=sent;
    record.systemCharacters=sent.messages[0].content.length;
    record.inputCharacters=sent.messages[1].content.length;
    const transport = async (...args) => {
     const response = await fetch(...args);
     const body = await response.clone().json();
     if(response.ok) {record.raw=body.choices?.[0]?.message?.content;record.usage=body.usage;}
     else {record.providerStatus=response.status;record.providerCode=body.error?.code;record.retryAfter=response.headers.get('retry-after');record.rateLimitKind=body.error?.message?.match(/(?:tokens|requests) per (?:minute|day)/i)?.[0];record.suggestedWait=body.error?.message?.match(/try again in ([0-9.hms]+)/i)?.[1];record.tokenLimit=response.headers.get('x-ratelimit-limit-tokens');record.tokenReset=response.headers.get('x-ratelimit-reset-tokens');record.numericLimit=body.error?.message?.match(/Limit[: ]+([0-9]+)/i)?.[1];record.numericRequested=body.error?.message?.match(/Requested[: ]+([0-9]+)/i)?.[1];}
     return response;
    };
    record.lesson=await engine.generate('groq','qwen/qwen3.8-27b',key,item.request,undefined,transport);
    record.outputMatches=record.lesson.output?.text === item.expectedOutput;
    record.status='complete';save();
   } catch(error) {record.status='failed';record.error=error instanceof Error?error.message:'Evaluation failed';save();break;}
   if (item !== jobs.at(-1)?.item || variant !== jobs.at(-1)?.variant) await new Promise(resolve=>setTimeout(resolve,${formatPass || refsPass || outputPass ? 150000 : 75000}));
  }
 };
 void run().finally(()=>vscode.commands.executeCommand('workbench.action.closeWindow'));
}
`,
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['vscode'],
    outfile: path.join(root, 'extension.cjs'),
  });
  const child = spawn(
    executable,
    [
      '--new-window',
      '--wait',
      '--disable-extensions',
      '--skip-welcome',
      '--skip-release-notes',
      '--extensionDevelopmentPath=' + root,
    ],
    { stdio: 'inherit', windowsHide: true },
  );
  child.on('error', () => {
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}
