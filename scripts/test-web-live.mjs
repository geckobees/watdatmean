// Explicit live test only. Read the existing VS Code SecretStorage in its own host;
// never put credentials in files, command arguments, environment, or reports.
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
const option = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const caseId = option('--case', 'java17-docs');
const editor = option('--editor', 'vscode');
if (!['vscode', 'intellij'].includes(editor)) throw new Error('Choose vscode or intellij.');
const cases = {
  'java17-docs': {
    topic: 'Java Stream collecting elements into a list',
    version: 'Java 17',
    filter: 'docs',
  },
  'java8-docs': {
    topic: 'Java Stream collecting elements into a list',
    version: 'Java 8',
    filter: 'docs',
  },
  'ts-code': {
    topic: 'TypeScript generics example source code',
    version: 'TypeScript 5.9',
    filter: 'code',
  },
  'python-videos': {
    topic: 'Python list comprehension beginner tutorial',
    version: 'Python 3.11',
    filter: 'videos',
  },
  'python-books': {
    topic: 'Python beginner free book from its author or publisher',
    version: 'Python 3.11',
    filter: 'books',
  },
};
if (!cases[caseId]) throw new Error('Choose a supported synthetic live case.');
const report = path.resolve(option('--report', `work/web-live-${caseId}.json`));
const root = path.resolve('work/web-live-extension', path.basename(report, '.json'));
if (!report.startsWith(path.resolve('work') + path.sep))
  throw new Error('Keep live reports in work/.');
await mkdir(root, { recursive: true });
let nativeJava;
if (editor === 'intellij') {
  const ide = path.resolve(option('--ide-home', 'work/idea-2022.3'));
  const product = JSON.parse(await readFile(path.join(ide, 'product-info.json'), 'utf8'));
  const launch = product.launch.find(
    (item) => item.os === { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[process.platform],
  );
  nativeJava = path.join(ide, launch.javaExecutablePath);
  if (
    !(await readFile('intellij/build/test-jvm.args', 'utf8')).includes(
      '-Dwatdatmean.test.live=true',
    )
  )
    throw new Error(
      'Prepare the isolated IntelliJ test profile with --prepare-only --live-web --ui first.',
    );
}
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
await writeFile(
  path.join(root, 'package.json'),
  JSON.stringify({ ...manifest, main: 'extension.cjs', activationEvents: ['*'] }),
);
await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'ts',
    contents: `
import * as vscode from 'vscode';
import {writeFileSync,readFileSync,unlinkSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {WebResearchService} from './src/web-research';
import {ResourceBookmarks} from './src/resource-bookmarks';
const report=${JSON.stringify(report)}, job=${JSON.stringify(cases[caseId])};
export function activate(context) {
  const run=async()=>{
    const key=await context.secrets.get('key.groq');
    const record={case:${JSON.stringify(caseId)},editor:'vscode',startedAt:new Date().toISOString(),available:!!key};
    const save=()=>writeFileSync(report,JSON.stringify(record,null,2).replaceAll(key || '__no_key__','[REDACTED]'));
    if(!key){record.error='No Groq key configured in this VS Code profile.';save();return;}
    if (${editor === 'intellij'}) {
      await new Promise((resolve,reject)=>{
        const child=spawn(${JSON.stringify(nativeJava ?? '')},['@intellij/build/test-jvm.args'],{cwd:${JSON.stringify(process.cwd())},stdio:['pipe','ignore','ignore'],windowsHide:true});
        const timer=setTimeout(()=>{child.kill();reject(new Error('Native live test timed out'));},180000);
        child.on('error',error=>{clearTimeout(timer);reject(error)});
        child.on('exit',code=>{clearTimeout(timer);if(code!==0 && !readFileSync(report,'utf8').includes('"error"'))reject(new Error('Native test failed before its live report; see isolated IDE log.'));else resolve(code)});
        child.stdin.on('error',()=>{});
        child.stdin.end(JSON.stringify({...job,case:${JSON.stringify(caseId)},key,report}));
      });
      return;
    }
    let calls=0;
    const transport=async(url,init)=>{
      calls++; if(calls>1) throw new Error('Live test request limit reached.');
      const body=JSON.parse(init.body);
      const inputBytes=Buffer.byteLength(body.messages.map(m=>m.content).join('')+JSON.stringify(body.response_format));
      if(inputBytes>3500 || body.max_completion_tokens!==900 || body.reasoning_effort!=='low' || body.tools) throw new Error('Live request exceeded bounded settings.');
      record.request={inputBytes,outputLimit:body.max_completion_tokens,reasoning:body.reasoning_effort,tools:false};
      const response=await fetch(url,init);
      const payload=await response.clone().json();
      record.httpStatus=response.status;record.payload=payload;save();return response;
    };
    const service=new WebResearchService(transport), signal=new AbortController().signal;
    try {
      record.result=await service.search('groq',key,job.topic,'beginner',signal,{version:job.version,filter:job.filter});
      const wanted={docs:'Documentation',videos:'Video',code:'Source code',books:'Book / PDF'}[job.filter];
      if(wanted && !record.result.sources.some(s=>s.kind===wanted)) throw new Error('No real source matched the requested resource filter.');
      record.cacheHit=(await service.search('groq',key,job.topic,'beginner',signal,{version:job.version,filter:job.filter})).cached;
      const storage=report+'.bookmarks.json';
      const persist=async state=>writeFileSync(storage,JSON.stringify(state));
      const bookmarks=new ResourceBookmarks(undefined,persist);
      const source=record.result.sources[0];
      await bookmarks.add(source,record.result);await bookmarks.add(source,record.result);
      const restored=new ResourceBookmarks(JSON.parse(readFileSync(storage,'utf8')),persist);
      record.bookmarks={deduplicated:restored.snapshot().entries.length===1,restoredUrl:restored.snapshot().entries[0].url,version:restored.snapshot().entries[0].version};
      await restored.remove(source.url);record.bookmarks.removed=restored.snapshot().entries.length===0;
      unlinkSync(storage);
      record.status='complete';
    } catch(error) {record.status='failed';record.error=error instanceof Error?error.message:'Live web test failed';}
    record.calls=calls;record.finishedAt=new Date().toISOString();save();
  };
  void run().catch(()=>writeFileSync(report,JSON.stringify({status:'failed',error:'Live harness failed before a report was available.'}))).finally(()=>vscode.commands.executeCommand('workbench.action.closeWindow'));
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
  throw new Error('Set VSCODE_EXECUTABLE to the installation with the configured Groq key.');
await writeFile(report, JSON.stringify({ status: 'starting', case: caseId, editor }));
const child = spawn(
  executable,
  [
    '--new-window',
    '--wait',
    '--disable-extensions',
    '--skip-welcome',
    '--skip-release-notes',
    `--extensionDevelopmentPath=${root}`,
  ],
  { stdio: 'inherit', windowsHide: true },
);
child.on('error', () => {
  process.exitCode = 1;
});
// Electron can hand off to an existing installation before the extension has finished.
const deadline = Date.now() + 210000;
let complete = false;
while (Date.now() < deadline) {
  const state = await readFile(report, 'utf8')
    .then(JSON.parse)
    .catch(() => ({}));
  if (['complete', 'failed'].includes(state.status) || state.error) {
    console.log(
      JSON.stringify({
        editor,
        case: caseId,
        status: state.status,
        usage: state.result?.usage,
        error: state.error,
      }),
    );
    process.exitCode = state.status === 'complete' ? 0 : 1;
    complete = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!complete) {
  child.kill();
  throw new Error('Live report did not complete within its timeout.');
}
