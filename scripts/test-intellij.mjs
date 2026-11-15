// Run the real installed IDE with a test-only starter and separate config/system/plugin paths.
import './package-intellij.mjs';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, cp, readdir } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
const option = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const ide = option('--runtime-home', option('--ide-home', process.env.INTELLIJ_HOME));
const jdk = option('--java-home', process.env.JAVA_HOME);
const ui = process.argv.includes('--ui');
const hold = process.argv.includes('--hold');
const sandbox = path.resolve(
  'work/intellij-test-' +
    JSON.parse(await readFile(path.join(ide, 'product-info.json'), 'utf8')).buildNumber,
);
const plugin = path.join(sandbox, 'plugins/watdatmean');
// A minimal, isolated config skips first-run import/onboarding (which blocks app starters).
await mkdir(path.join(sandbox, 'config/options'), { recursive: true });
await writeFile(path.join(sandbox, 'config/options/other.xml'), '<application/>');
await mkdir(plugin, { recursive: true });
await cp('intellij/build/distribution/watdatmean', plugin, { recursive: true });
const testClasses = path.resolve('intellij/build/test-classes');
await mkdir(testClasses, { recursive: true });
const compileArgs = (await readFile('intellij/build/javac.args', 'utf8')).split('\n');
const cpIndex = compileArgs.indexOf('-classpath') + 1;
const testCp =
  compileArgs[cpIndex].slice(1, -1) +
  path.delimiter +
  path.resolve('intellij/build/classes').replaceAll('\\', '/');
const exec = (binary, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: 'inherit', windowsHide: true, ...options });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Process exited ${code}`)),
    );
  });
const exe = (name) => path.join(jdk, 'bin', name + (process.platform === 'win32' ? '.exe' : ''));
const quoted = (value) => '"' + value.replaceAll('\\', '/') + '"';
await writeFile(
  'intellij/build/test-javac.args',
  [
    '--release',
    '17',
    '-encoding',
    'UTF-8',
    '-classpath',
    quoted(testCp),
    '-d',
    quoted(testClasses),
    ...(await readdir('intellij/src/test/java/com/watdatmean/intellij'))
      .filter((name) => name.endsWith('.java'))
      .map((name) => quoted(path.resolve('intellij/src/test/java/com/watdatmean/intellij', name))),
  ].join('\n'),
);
await exec(exe('javac'), ['@intellij/build/test-javac.args']);
const resources = path.resolve('intellij/build/test-resources');
await mkdir(path.join(resources, 'META-INF'), { recursive: true });
const fixtureBundle = await build({
  stdin: {
    contents:
      "export { javaGeneralCases } from './tests/quality/java-general-cases'; export { javaControlCases } from './tests/quality/java-control-cases'; export { javaArrayExceptionCases } from './tests/quality/java-array-exception-cases';",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
});
const { javaGeneralCases, javaControlCases, javaArrayExceptionCases } = await import(
  'data:text/javascript;base64,' + Buffer.from(fixtureBundle.outputFiles[0].text).toString('base64')
);
await writeFile(
  path.join(resources, 'java-general-fixtures.json'),
  JSON.stringify([...javaGeneralCases, ...javaControlCases, ...javaArrayExceptionCases]),
);
const xml = (await readFile('intellij/src/main/resources/META-INF/plugin.xml', 'utf8')).replace(
  '<extensions defaultExtensionNs="com.intellij">',
  '<extensions defaultExtensionNs="com.intellij">\n<appStarter implementation="com.watdatmean.intellij.SmokeStarter" id="watdatmean-smoke"/>',
);
await writeFile(path.join(resources, 'META-INF/plugin.xml'), xml);
await exec(exe('jar'), [
  '--update',
  '--file',
  path.join(plugin, 'lib/watdatmean.jar'),
  '-C',
  testClasses,
  '.',
  '-C',
  resources,
  '.',
]);
const product = JSON.parse(await readFile(path.join(ide, 'product-info.json'), 'utf8'));
const launch = product.launch.find(
  (item) => item.os === { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[process.platform],
);
const args = launch.additionalJvmArguments.map((arg) => arg.replaceAll('%IDE_HOME%', ide));
args.push(
  '-Xmx1200m',
  '-Djava.awt.headless=' + !ui,
  '-Dwatdatmean.test.ui=' + ui,
  '-Dwatdatmean.test.hold=' + hold,
  '-Dwatdatmean.test.download=' + process.argv.includes('--download-node'),
  '-Didea.home.path=' + ide,
  '-Didea.config.path=' + path.join(sandbox, 'config'),
  '-Didea.system.path=' + path.join(sandbox, 'system'),
  '-Didea.plugins.path=' + path.join(sandbox, 'plugins'),
  '-Didea.log.path=' + path.join(sandbox, 'log'),
  '-Dwatdatmean.node.path=' + process.execPath,
  '-Dwatdatmean.test.result=' + path.join(sandbox, 'result.txt'),
  '-cp',
  launch.bootClassPathJarNames.map((jar) => path.join(ide, 'lib', jar)).join(path.delimiter),
  'com.intellij.idea.Main',
  'watdatmean-smoke',
);
await writeFile('intellij/build/test-jvm.args', args.map(quoted).join('\n'));
await exec(path.join(ide, launch.javaExecutablePath), ['@intellij/build/test-jvm.args'], {
  timeout: process.argv.includes('--download-node') ? 300000 : 120000,
});
console.log(await readFile(path.join(sandbox, 'result.txt'), 'utf8'));
