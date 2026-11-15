import { describe, it, expect, vi } from 'vitest';
import { mkdir, mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  archiveRoot,
  configureBuildProperties,
  downloadJava17,
  java17Download,
  setupBuildJava,
  oraclePlatformId,
} from '../src/build-java';
import { javaRuntimeHost } from '../src/java-runtime';

describe('portable checkout Java setup', () => {
  async function fixture(run: (root: string, host: typeof javaRuntimeHost) => Promise<void>) {
    const root = await mkdtemp(path.join(tmpdir(), 'watdatmean-java-unit-'));
    try {
      await run(root, {
        ...javaRuntimeHost,
        home: root,
        env: {},
        directories: async () => [],
        probe: async () => true,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  async function fakeJava(root: string, major = 17) {
    await mkdir(path.join(root, 'bin'), { recursive: true });
    for (const name of ['java', 'javac'])
      await writeFile(
        path.join(root, 'bin', name + (process.platform === 'win32' ? '.exe' : '')),
        'fixture',
      );
    await writeFile(path.join(root, 'release'), `JAVA_VERSION="${major}.0.1"`);
    return root;
  }
  it('provisions without Java, then reuses the private runtime offline', async () =>
    fixture(async (root, host) => {
      const download = vi.fn(async (stage: string) => fakeJava(path.join(stage, 'jdk-17')));
      const home = await setupBuildJava(root, { host, download, log: () => {} });
      expect(home).toBe(path.join(root, 'intellij/.gradle/java-home'));
      const properties = await readFile(path.join(root, 'intellij/gradle.properties'), 'utf8');
      expect(properties).toContain('org.gradle.java.home=');
      await setupBuildJava(root, {
        host,
        download: async () => {
          throw new Error('offline');
        },
        log: () => {},
      });
      expect(download).toHaveBeenCalledTimes(1);
      expect(await readFile(path.join(root, 'intellij/gradle.properties'), 'utf8')).toBe(
        properties,
      );
      expect(await readdir(path.join(root, 'intellij/.gradle'))).toEqual([
        'editor-java-home.json',
        'java-home',
      ]);
      expect(host.env).toEqual({});
    }));
  it('reuses a discovered Java 17 with spaces in its path and preserves its files', async () =>
    fixture(async (root, host) => {
      const installed = await fakeJava(path.join(root, 'Existing JDK 17'));
      host.env = { JAVA_HOME: installed };
      const download = vi.fn();
      await setupBuildJava(root, { host, download, log: () => {} });
      expect(download).not.toHaveBeenCalled();
      expect(await readFile(path.join(installed, 'release'), 'utf8')).toContain('17.0.1');
      expect(host.env.JAVA_HOME).toBe(installed);
    }));
  it('does not accept Java 25 as the build runtime', async () =>
    fixture(async (root, host) => {
      host.env = { JAVA_HOME: await fakeJava(path.join(root, 'jdk-25'), 25) };
      const download = vi.fn(async (stage: string) => fakeJava(path.join(stage, 'jdk-17')));
      await setupBuildJava(root, { host, download, log: () => {} });
      expect(download).toHaveBeenCalledTimes(1);
      expect(host.env.JAVA_HOME).toContain('jdk-25');
    }));
  it('rejects the wrong downloaded version and cleans only its staging directory', async () =>
    fixture(async (root, host) => {
      await expect(
        setupBuildJava(root, {
          host,
          download: async (stage) => fakeJava(path.join(stage, 'wrong'), 25),
          log: () => {},
        }),
      ).rejects.toThrow('Java 17 check');
      expect(await readdir(path.join(root, 'intellij/.gradle'))).toEqual([]);
    }));
  it('refuses a corrupted download before extraction or execution', async () =>
    fixture(async (root) => {
      const request = vi
        .fn()
        .mockResolvedValueOnce(new Response('a'.repeat(64)))
        .mockResolvedValueOnce(new Response('corrupt archive'));
      await expect(downloadJava17(root, 'win32', 'x64', request)).rejects.toThrow(
        'checksum mismatch',
      );
      expect(await readdir(root)).toEqual(['java.zip']);
    }));
  it.each([
    '../escape/bin/java',
    '/absolute/bin/java',
    'C:/escape/bin/java',
    'root/../../escape',
    'root\\..\\escape',
    'one/bin/java\ntwo/bin/java',
  ])('rejects unsafe archive layout %s', (list) => expect(() => archiveRoot(list)).toThrow());
  it('accepts the vendor archive layout', () =>
    expect(archiveRoot('jdk-17/\njdk-17/bin/java\n')).toBe('jdk-17'));
  it.each(['win32', 'darwin', 'linux'])('supports x64 and ARM64 on %s', (platform) => {
    for (const arch of ['x64', 'arm64']) {
      const spec = java17Download(platform, arch);
      expect(spec.url).toMatch(/^https:\/\/aka\.ms\/download-jdk\/microsoft-jdk-17-/);
      expect(spec.checksum).toBe(spec.url + '.sha256sum.txt');
    }
  });
  it('rejects unsupported platforms before downloading', () =>
    expect(() => java17Download('win32', 'ia32')).toThrow());
  it('preserves explicit Gradle settings and refreshes only its generated Java pointer', () => {
    const custom = 'org.gradle.jvmargs=-Xmx2g\norg.gradle.java.home=/custom/jdk\n';
    expect(configureBuildProperties(custom, '/new/home')).toBe(custom);
    const original = configureBuildProperties('org.gradle.jvmargs=-Xmx2g\n', '/old/home');
    const updated = configureBuildProperties(original, 'C:\\Users\\Someone Else\\jdk');
    expect(updated).toContain('org.gradle.jvmargs=-Xmx2g');
    expect(updated).not.toContain('/old/home');
    expect(updated).toContain('org.gradle.java.home=C\\:/Users/Someone Else/jdk');
    expect(updated.match(/org.gradle.java.home=/g)).toHaveLength(1);
    expect(configureBuildProperties('', '/Users/José/jdk')).toContain('/Users/Jos\\u00e9/jdk');
  });
  it('selects Oracle’s registered project runtime without overriding a custom choice', () => {
    expect(oraclePlatformId('C:/Users/A Person/jdk-17')).toBe('C__Users_A_Person_jdk-17');
    const first = configureBuildProperties('', '/home/java', 'old_runtime');
    const next = configureBuildProperties(first, '/home/java', 'new_runtime');
    expect(next).not.toContain('old_runtime');
    expect(next.match(/netbeans.hint.jdkPlatform=/g)).toHaveLength(1);
    expect(next).toContain('netbeans.hint.jdkPlatform=new_runtime');
    expect(
      configureBuildProperties('netbeans.hint.jdkPlatform=custom\n', '/home/java', 'managed'),
    ).toContain('netbeans.hint.jdkPlatform=custom');
  });
});
