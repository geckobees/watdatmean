// Offline replay of synthetic provider transcripts. Never calls a provider or executes sample code.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const input = path.resolve(process.argv[2] ?? 'work/learning-quality-v2.json');
const output = path.resolve(process.argv[3] ?? 'work/learning-quality-v2-reviewed.json');
if (!output.startsWith(path.resolve('work') + path.sep))
  throw new Error('Keep generated review reports inside work/.');
await build({
  stdin: {
    resolveDir: process.cwd(),
    contents: String.raw`
import {readFileSync,writeFileSync} from 'node:fs';
import {parseLesson} from './src/provider';
import {reviewLesson,teachingNotes,localLesson} from './src/teaching';
const report=JSON.parse(readFileSync(process.argv[2],'utf8'));
for(const record of report.results) {
 if(!record.lesson || !record.request) continue;
 const notes=teachingNotes(record.request);
 if(record.raw) {
  try { record.reviewedLesson=reviewLesson(record.request,parseLesson(record.raw,record.request.evidence?.map(e=>e.id)??[],record.request.language),notes); }
  catch { record.reviewedLesson={...localLesson(record.request,notes,'Invalid AI reply; local facts shown.'),local:true}; }
 } else record.reviewedLesson=record.lesson.local ? record.lesson : reviewLesson(record.request,record.lesson,notes);
 record.reviewedLesson.usage=record.lesson.usage;
 const lesson=record.reviewedLesson;
 record.proseWords=[lesson.summary,lesson.note??'',...lesson.steps,lesson.output?.explanation??''].join(' ').split(/\s+/).filter(Boolean).length;
}
report.reviewNote='Final shared guards replayed locally against saved synthetic responses. No additional provider requests. Original replies and actual usage are preserved. This is a regression review, not proof of arbitrary AI accuracy or a child usability study.';
writeFileSync(process.argv[3],JSON.stringify(report,null,2)+'\n');
const complete=report.results.filter(r=>r.lesson);
const total=complete.reduce((s,r)=>s+(r.lesson.usage?.total||0),0);
console.log(JSON.stringify({records:report.results.length,complete:complete.length,localWithoutApi:complete.filter(r=>r.lesson.local&&r.lesson.usage?.total===0).length,reportedTokens:total,lessons:complete.map(r=>({id:r.id,words:r.proseWords,summary:r.reviewedLesson.summary,notice:r.reviewedLesson.notice}))},null,2));
`,
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'work/learning-review.cjs',
});
process.stdout.write(
  execFileSync(process.execPath, ['work/learning-review.cjs', input, output], {
    encoding: 'utf8',
    windowsHide: true,
  }),
);
