import './build-intellij.mjs';
import { spawnSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';

// Build against a real, locally installed IntelliJ SDK without downloading an entire IDE.
const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const ide = option('--ide-home', process.env.INTELLIJ_HOME);
const jdk = option('--java-home', process.env.JAVA_HOME);
if (!ide || !jdk)
  throw new Error('Set INTELLIJ_HOME and JAVA_HOME (JDK 17+) or pass --ide-home and --java-home.');
const product = JSON.parse(await readFile(path.join(ide, 'product-info.json'), 'utf8'));
if (!product.buildNumber.startsWith('223.'))
  throw new Error(
    'Compile against IntelliJ IDEA 2022.3 (build 223) to preserve backward compatibility. Use --runtime-home to test newer IDEs.',
  );
const build = path.resolve('intellij/build');
const classes = path.join(build, 'classes');
const staging = path.join(build, 'distribution', 'watdatmean');
// Never ship classes removed or renamed since a previous build.
for (const directory of [classes, staging]) {
  const target = path.resolve(directory);
  if (!target.startsWith(build + path.sep)) throw new Error('Invalid build output path');
  await rm(target, { recursive: true, force: true });
}
await mkdir(classes, { recursive: true });
await mkdir(path.join(staging, 'lib'), { recursive: true });
await mkdir('dist/intellij', { recursive: true });
async function files(root, extension, recursive = false) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory() && recursive)
      result.push(...(await files(path.join(root, entry.name), extension, true)));
    else if (entry.name.endsWith(extension)) result.push(path.join(root, entry.name));
  }
  return result;
}
const jars = [
  ...(await files(path.join(ide, 'lib'), '.jar', true)),
  ...(await files(path.join(ide, 'plugins/java/lib'), '.jar', true)),
];
const sources = await files(path.resolve('intellij/src/main/java'), '.java', true);
const quote = (value) => '"' + value.replaceAll('\\', '/').replaceAll('"', '\\"') + '"';
await writeFile(
  path.join(build, 'javac.args'),
  [
    '--release',
    '17',
    '-encoding',
    'UTF-8',
    '-classpath',
    quote(jars.join(path.delimiter)),
    '-d',
    quote(classes),
    ...sources.map(quote),
  ].join('\n'),
);
function run(binary, args) {
  const result = spawnSync(
    path.join(jdk, 'bin', binary + (process.platform === 'win32' ? '.exe' : '')),
    args,
    { stdio: 'inherit', windowsHide: true },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run('javac', ['@' + path.join(build, 'javac.args')]);
run('jar', [
  '--create',
  '--file',
  path.join(staging, 'lib/watdatmean.jar'),
  '-C',
  classes,
  '.',
  '-C',
  'intellij/src/main/resources',
  '.',
  '-C',
  path.join(build, 'generated'),
  '.',
]);
await copyFile('LICENSE', path.join(staging, 'LICENSE'));
await copyFile('THIRD_PARTY_NOTICES.md', path.join(staging, 'THIRD_PARTY_NOTICES.md'));
await mkdir(path.join(staging, 'licenses'), { recursive: true });
for (const file of await files('licenses', '.txt'))
  await copyFile(file, path.join(staging, 'licenses', path.basename(file)));
run('jar', [
  '--create',
  '--no-manifest',
  '--file',
  path.resolve('dist/intellij/watdatmean-intellij-0.1.2.zip'),
  '-C',
  path.dirname(staging),
  'watdatmean',
]);
console.log(
  'Created dist/intellij/watdatmean-intellij-0.1.2.zip against IntelliJ ' + product.version,
);
