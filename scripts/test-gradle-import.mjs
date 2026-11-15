// Real VS Code Java/Gradle import test; all settings and projects are isolated.
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, writeFile, symlink } from 'node:fs/promises';
import { javaHome } from './setup-intellij.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const option = (name) => process.argv[process.argv.indexOf(name) + 1];
const oracle = process.argv.includes('--oracle-java');
const extensionName = oracle ? 'oracle.oracle-java' : 'redhat.java';
const { setupBuildJava } = (await import('../intellij/.gradle/setup-java.cjs')).default;
for (const name of ['--code', '--java-extension', '--ide-home', '--gradle-home'])
  if (!process.argv.includes(name)) throw new Error(`Missing ${name}`);
const root = await mkdtemp(path.join(tmpdir(), 'watdatmean-gradle-test-'));
const workspace = path.join(root, 'work/Checkout With Spaces');
const result = path.join(root, 'result.json');
await mkdir(path.join(workspace, '.vscode'), { recursive: true });
await mkdir(path.join(workspace, 'intellij/src/main/java'), { recursive: true });
await mkdir(path.join(workspace, 'intellij/src/main/resources/META-INF'), { recursive: true });
await mkdir(path.join(workspace, 'intellij/.gradle'), { recursive: true });
await symlink(
  javaHome,
  path.join(workspace, 'intellij/.gradle/java-home'),
  process.platform === 'win32' ? 'junction' : 'dir',
);
for (const file of [
  'build.gradle.kts',
  'settings.gradle.kts',
  'gradlew',
  'gradlew.bat',
  'gradle',
  'src/main/resources/META-INF/plugin.xml',
])
  await cp(path.join('intellij', file), path.join(workspace, 'intellij', file), {
    recursive: true,
  });
await writeFile(
  path.join(workspace, 'intellij/gradle.properties'),
  `localIdePath=${path.resolve(option('--ide-home')).replaceAll('\\', '/')}\n`,
);
await setupBuildJava(workspace, { log: () => {} });
{
  const buildFile = path.join(workspace, 'intellij/build.gradle.kts');
  await writeFile(
    buildFile,
    (await readFile(buildFile, 'utf8')) +
      '\nfile("wdm-runtime.txt").writeText(System.getProperty("java.version"))\n',
  );
}
await writeFile(
  path.join(workspace, 'intellij/src/main/java/SetupProbe.java'),
  'import com.intellij.openapi.project.Project; public class SetupProbe { Project project; }',
);
// This ignored scratch project reproduced the user's unsupported Java 25 warning.
await mkdir(path.join(workspace, 'work/wrapper-bootstrap'), { recursive: true });
await writeFile(
  path.join(workspace, 'work/wrapper-bootstrap/settings.gradle'),
  "rootProject.name='wrapper-bootstrap'",
);
await writeFile(
  path.join(workspace, 'work/wrapper-bootstrap/build.gradle'),
  "plugins { id 'java' }",
);
// Use this fixture's generated paths, never copy the developer's machine settings.
const settings = JSON.parse(await readFile(path.join(workspace, '.vscode/settings.json'), 'utf8'));
// The fixture owns its isolated profile. Put Oracle's setting at user scope so the test
// doesn't automate/bypass its interactive workspace-settings trust decision.
if (oracle) {
  await mkdir(path.join(root, 'profile/User'), { recursive: true });
  await writeFile(
    path.join(root, 'profile/User/settings.json'),
    JSON.stringify({
      'jdk.jdkhome': path.resolve(option('--oracle-java')),
      'jdk.project.jdkhome': settings['jdk.project.jdkhome'],
    }),
  );
  delete settings['jdk.project.jdkhome'];
}
await writeFile(
  path.join(workspace, '.vscode/settings.json'),
  JSON.stringify(
    {
      ...settings,
      'java.server.launchMode': 'Standard',
      'java.import.gradle.user.home': path.resolve(option('--gradle-home')),
      'java.configuration.detectJdksAtStart': false,
      'java.import.gradle.wrapper.checksums': [
        {
          sha256: 'ad16bca46cb71bb5887c546860d93992aeee35c1fdaf4a242b0a612375d937e0',
          allowed: true,
        },
      ],
    },
    null,
    2,
  ),
);
await mkdir(path.join(root, 'extensions'), { recursive: true });
if (process.argv.includes('--gradle-extension')) {
  await symlink(
    path.resolve(option('--gradle-extension')),
    path.join(root, 'extensions', 'vscjava.vscode-gradle'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
}
try {
  await symlink(
    path.resolve(option('--java-extension')),
    path.join(root, 'extensions', extensionName),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
} catch (error) {
  if (!['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) throw error;
  await cp(option('--java-extension'), path.join(root, 'extensions', extensionName), {
    recursive: true,
  });
}
await build({
  entryPoints: [
    oracle ? 'tests/integration/oracle-gradle-import.ts' : 'tests/integration/gradle-import.ts',
  ],
  outfile: 'dist/gradle-import.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['vscode'],
});
console.log(`Gradle import test logs and result: ${root}`);
const child = spawn(
  path.resolve(option('--code')),
  [
    '--new-window',
    '--wait',
    '--disable-workspace-trust',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-updates',
    `--user-data-dir=${path.join(root, 'profile')}`,
    `--extensions-dir=${path.join(root, 'extensions')}`,
    `--extensionDevelopmentPath=${process.cwd()}`,
    `--extensionTestsPath=${path.resolve('dist/gradle-import.cjs')}`,
    workspace,
  ],
  {
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      WATDATMEAN_TEST_RESULT: result,
      WATDATMEAN_TEST_IDE_HOME: path.resolve(option('--ide-home')),
    },
  },
);
const timeout = setTimeout(() => {
  console.error('Gradle import timed out');
  child.kill();
}, 300_000);
try {
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  const report = JSON.parse(await readFile(result, 'utf8'));
  console.log(report);
  if (!report.passed) process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
