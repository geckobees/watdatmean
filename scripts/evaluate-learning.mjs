// Explicitly invoked live evaluation. Uses VS Code's existing SecretStorage; never exports the key.
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
const reportArg = process.argv.indexOf('--report');
const depthSuite = process.argv.includes('--depth');
const compactSuite = process.argv.includes('--compact');
const caseArg = process.argv.indexOf('--case');
const caseId = caseArg < 0 ? undefined : process.argv[caseArg + 1];
const reportPath = path.resolve(
  reportArg < 0 ? 'work/learning-live-results.json' : process.argv[reportArg + 1],
);
if (!reportPath.startsWith(path.resolve('work') + path.sep))
  throw new Error('Keep live reports inside work/.');
const root = path.resolve('work/live-evaluation-extension');
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
import {generate} from './src/provider';
import {learningCases} from './tests/quality/cases';
import {depthCases} from './tests/quality/depth-cases';
import {compactCases} from './tests/quality/compact-cases';
import * as vscode from 'vscode';
import {writeFileSync,readFileSync,existsSync} from 'node:fs';
export function activate(context) {
 const api = { async evaluate() {
  const key = await context.secrets.get('key.groq');
  if (!key) return {available:false, results:[], message:'No Groq key in this VS Code profile.'};
  const results = existsSync(report) ? JSON.parse(readFileSync(report,'utf8')).results : [];
  const save = () => writeFileSync(report,JSON.stringify({available:true,provider:'groq',model:'qwen/qwen3.8-27b',results},null,2));
  const cases = ${compactSuite ? 'compactCases' : depthSuite ? 'depthCases' : "[...learningCases.slice(0,4).map(c=>({...c,id:c.id+'-short', request:{...c.request,task:'explain'}})), ...learningCases, {...learningCases[3],id:'ts-local-module-short-reviewed',request:{...learningCases[3].request,task:'explain'}}]"};
  const selected = cases.filter(c => !${JSON.stringify(caseId) ?? 'undefined'} || c.id === ${JSON.stringify(caseId) ?? 'undefined'});
  for (const item of selected) {
   if (results.length >= 20) break;
   if (results.some(r=>r.id===item.id && r.lesson)) continue;
   const started = Date.now();
   const record={id:item.id,status:'started'};results.push(record);save();
   try {
    let raw;
    const transport=async (...args)=>{const response=await fetch(...args);const body=await response.clone().json();if(response.ok){raw=body.choices?.[0]?.message?.content;}else{record.providerStatus=response.status;record.providerCode=body.error?.code;record.retryAfter=response.headers.get('retry-after');record.rateLimitKind=body.error?.message?.match(/(?:tokens|requests) per (?:minute|day)/i)?.[0];record.suggestedWait=body.error?.message?.match(/try again in ([0-9.hms]+)/i)?.[1]; if(typeof body.error?.failed_generation === 'string') record.failedGeneration=body.error.failed_generation;}return response;};
    const lesson = await generate('groq','qwen/qwen3.8-27b',key,item.request,undefined,transport);
    Object.assign(record,item,{lesson,raw,ms:Date.now()-started,status:'complete'});
   }
   catch(error) { Object.assign(record,{status:'failed',error:error instanceof Error?error.message:'Evaluation failed'});save();break; }
   save();if(item !== selected.at(-1) && !record.lesson?.local) await new Promise(resolve=>setTimeout(resolve,${depthSuite || compactSuite ? 75000 : 20000}));
  }
  return {available:true, provider:'groq', model:'qwen/qwen3.8-27b', results};
 }};
 const report = ${JSON.stringify(reportPath)};
 void api.evaluate().then(result=>writeFileSync(report,JSON.stringify(result,null,2))).finally(()=>vscode.commands.executeCommand('workbench.action.closeWindow'));
 return api;
}`,
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['vscode'],
  outfile: path.join(root, 'extension.cjs'),
});
const executable = process.env.VSCODE_EXECUTABLE;
if (!executable)
  throw new Error(
    'Set VSCODE_EXECUTABLE to the VS Code installation containing your saved Groq key.',
  );
const args = [
  '--new-window',
  '--wait',
  '--disable-extensions',
  '--skip-welcome',
  '--skip-release-notes',
  `--extensionDevelopmentPath=${root}`,
];
const child = spawn(executable, args, { stdio: 'inherit', windowsHide: true });
const timer = setTimeout(() => {
  child.kill();
  process.exitCode = 1;
}, 600000);
child.on('exit', (code) => {
  clearTimeout(timer);
  process.exitCode = code ?? 1;
});
child.on('error', () => {
  clearTimeout(timer);
  process.exitCode = 1;
});
