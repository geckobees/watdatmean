// Synthetic fixtures only. Store usage and final answers, never the saved key or private reasoning.
import { build } from 'esbuild';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
const baseline = path.resolve('work/reasoning-before.cjs');
const report = path.resolve('work/reasoning-comparison.json');
await mkdir('work', { recursive: true });
if (process.argv.includes('--capture')) {
  if (
    await access(baseline).then(
      () => true,
      () => false,
    )
  )
    throw new Error('Baseline already exists; refusing to replace it.');
  await build({
    entryPoints: ['src/provider.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: baseline,
  });
  await build({
    entryPoints: ['tests/quality/reasoning-cases.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: 'work/reasoning-cases.cjs',
  });
  const require = createRequire(import.meta.url);
  const { makeRequest } = require(baseline);
  const { reasoningCases } = require(path.resolve('work/reasoning-cases.cjs'));
  const bodies = reasoningCases.map((item) => ({
    ...item,
    body: JSON.parse(makeRequest('groq', 'qwen/qwen3.8-27b', 'fixture', item.request).body),
  }));
  await writeFile(
    'tests/quality/reasoning-before-requests.json',
    JSON.stringify(bodies, null, 2) + '\n',
  );
  // Reuse the recent completed Java baseline only after checking its exact source and wire request.
  const previous = JSON.parse(
    await readFile('tests/quality/groq-optimization-2026-11-14.json', 'utf8'),
  ).results.find(
    (r) => r.id === 'java-construction' && r.variant === 'after-output' && r.status === 'complete',
  );
  if (JSON.stringify(previous.requestBody) !== JSON.stringify(bodies.at(-1).body))
    throw new Error('Java baseline differs.');
  await writeFile(
    report,
    JSON.stringify(
      {
        provider: 'groq',
        model: 'qwen/qwen3.8-27b',
        results: [
          {
            ...previous,
            variant: 'before',
            trial: 1,
            reusedFrom: 'groq-optimization-2026-11-14.json:after-output',
          },
        ],
      },
      null,
      2,
    ) + '\n',
  );
  console.log('Captured baseline and verified the recent Java baseline.');
} else if (process.argv.includes('--local')) {
  const saved = JSON.parse(await readFile(report, 'utf8'));
  if (
    !saved.results.some(
      (r) => r.id === 'java-construction' && r.variant === 'after' && r.status === 'complete',
    )
  )
    throw new Error('Finish the live Java comparison before recording the final local route.');
  const engine = path.resolve('work/reasoning-final.cjs');
  await build({
    entryPoints: ['src/provider.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: engine,
  });
  const require = createRequire(import.meta.url);
  const { generate, makeRequest } = require(engine);
  const { reasoningCases } = require(path.resolve('work/reasoning-cases.cjs'));
  for (const result of saved.results)
    if (result.variant === 'after' && result.id !== 'java-construction' && !result.local)
      result.variant = 'candidate-no-reasoning';
  for (const item of reasoningCases.filter((c) => c.id !== 'java-construction')) {
    if (saved.results.some((r) => r.id === item.id && r.variant === 'after' && r.local)) continue;
    let networkRequests = 0;
    const transport = async () => {
      networkRequests++;
      throw new Error('Local comparison must not request AI.');
    };
    const lesson = await generate(
      'groq',
      'qwen/qwen3.8-27b',
      'fixture',
      item.request,
      undefined,
      transport,
    );
    if (networkRequests || !lesson.local || lesson.output?.text !== item.expectedOutput)
      throw new Error('Local quality check failed: ' + item.id);
    saved.results.push({
      ...item,
      variant: 'after',
      trial: 1,
      status: 'complete',
      local: true,
      networkRequests,
      requestBody: JSON.parse(
        makeRequest('groq', 'qwen/qwen3.8-27b', 'fixture', item.request).body,
      ),
      lesson,
      outputMatches: true,
    });
  }
  await writeFile(report, JSON.stringify(saved, null, 2) + '\n');
  console.log(
    'Recorded exact local results with zero transport calls; retained failed no-reasoning replies.',
  );
} else {
  await access(baseline);
  const executable = process.env.VSCODE_EXECUTABLE;
  if (!executable)
    throw new Error('Set VSCODE_EXECUTABLE to the installation with the configured Groq key.');
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i < 0 ? fallback : process.argv[i + 1];
  };
  const variant = arg('--variant', 'after');
  if (!['before', 'after', 'experiment-none'].includes(variant))
    throw new Error('Unknown comparison variant.');
  const trial = Number(arg('--trial', '1'));
  if (![1, 2].includes(trial)) throw new Error('Only two trials are supported.');
  const only = arg('--case', '').split(',').filter(Boolean);
  const root = path.resolve('work/reasoning-comparison-extension');
  await mkdir(root, { recursive: true });
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ ...manifest, main: './extension.cjs', activationEvents: ['*'] }),
  );
  await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
import * as before from './work/reasoning-before.cjs';
import * as after from './src/provider';
import {reasoningCases} from './tests/quality/reasoning-cases';
import * as vscode from 'vscode';
import {readFileSync,writeFileSync} from 'node:fs';
const file=${JSON.stringify(report)};
export function activate(context) {
 const run=async()=>{
  const key=await context.secrets.get('key.groq');
  if(!key) throw new Error('No configured Groq key.');
  const report=JSON.parse(readFileSync(file,'utf8'));
  const save=()=>writeFileSync(file,JSON.stringify(report,null,2)+'\\n');
  const cases=reasoningCases.filter(c=>!${JSON.stringify(only)}.length || ${JSON.stringify(only)}.includes(c.id));
  for(const item of cases) {
   if(report.results.some(r=>r.id===item.id&&r.variant===${JSON.stringify(variant)}&&r.trial===${trial}&&r.status==='complete'))continue;
   if(report.results.length>=14)break;
   const engine=${JSON.stringify(variant)}==='before'?before:after;
   const record={...item,variant:${JSON.stringify(variant)},trial:${trial},status:'started'};
   report.results.push(record);save();
   try {
    const transport=async(url,init)=>{
     const sent=JSON.parse(init.body);
     if(record.variant==='experiment-none')sent.reasoning_effort='none';
     record.requestBody=sent;save();
     const response=await fetch(url,{...init,body:JSON.stringify(sent)});
     const payload=await response.clone().json();
     if(response.ok){record.raw=payload.choices?.[0]?.message?.content;record.usage=payload.usage;record.finishReason=payload.choices?.[0]?.finish_reason;}
     else {record.providerStatus=response.status;record.rateLimitKind=payload.error?.message?.match(/(?:tokens|requests) per (?:minute|day)/i)?.[0];record.providerCode=payload.error?.code;}
     return response;
    };
    record.lesson=await engine.generate('groq','qwen/qwen3.8-27b',key,item.request,undefined,transport);
    record.outputMatches=record.lesson.output?.text===item.expectedOutput;
    record.status='complete';save();
   }catch(e){record.status='failed';record.error=e instanceof Error?e.message:'Comparison failed';save();break;}
   if(item!==cases.at(-1)) {
    const next=cases[cases.indexOf(item)+1];
    await new Promise(r=>setTimeout(r,item.id==='java-construction'||next?.id==='java-construction'?150000:90000));
   }
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
