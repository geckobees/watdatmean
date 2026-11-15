import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import {
  planJavaRuntime,
  inspectJava,
  expandJavaHome,
  oracleRuntimeRules,
  type JavaRuntimeHost,
} from '../src/java-runtime';
import {
  applyJavaRuntime,
  restoreJavaRuntime,
  type JavaRuntimeSettings,
  type JavaRuntimeBackup,
} from '../src/java-runtime-settings';
const flags = ['-XX:+UseCompactObjectHeaders', '-XX:+IgnoreUnrecognizedVMOptions'];
function machine(platform = 'win32') {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const home = platform === 'win32' ? 'C:\\Users\\Learner' : '/home/learner';
  const files = new Map<string, string>(),
    dirs = new Map<string, string[]>(),
    links = new Map<string, string>();
  const host: JavaRuntimeHost = {
    platform,
    home,
    env: {},
    read: vi.fn(async (f) => {
      if (!files.has(p.normalize(f))) throw Error('missing');
      return files.get(p.normalize(f))!;
    }),
    exists: vi.fn(async (f) => files.has(p.normalize(f))),
    real: vi.fn(async (f) => links.get(p.normalize(f)) ?? p.normalize(f)),
    directories: vi.fn(async (r) => dirs.get(p.normalize(r)) ?? []),
    probe: vi.fn(async (binary, options) => {
      const root = p.dirname(p.dirname(binary)),
        version = /JAVA_VERSION="(\d+)/.exec(files.get(p.join(root, 'release')) ?? '')?.[1],
        major = Number(version);
      const compact = options.indexOf('-XX:+UseCompactObjectHeaders'),
        unlock = options.indexOf('-XX:+UnlockExperimentalVMOptions');
      return major === 24 && compact >= 0
        ? unlock >= 0 && unlock < compact
        : major < 24 && compact >= 0
          ? options.includes('-XX:+IgnoreUnrecognizedVMOptions')
          : true;
    }),
  };
  function jdk(root: string, version: string) {
    root = p.normalize(root);
    files.set(p.join(root, 'release'), `JAVA_VERSION="${version}"`);
    files.set(p.join(root, 'bin', platform === 'win32' ? 'java.exe' : 'java'), '');
    files.set(p.join(root, 'bin', platform === 'win32' ? 'javac.exe' : 'javac'), '');
    const parent = p.dirname(root);
    dirs.set(parent, [...(dirs.get(parent) ?? []), p.basename(root)]);
    return root;
  }
  const installed = (version: string) => jdk(p.join(home, '.jdks', 'jdk-' + version), version);
  return { host, p, files, dirs, links, jdk, installed };
}
describe('portable Java runtime selection', () => {
  it.each([17, 21, 25])('keeps a working JDK %s instead of forcing an upgrade', async (major) => {
    const m = machine(),
      current = m.installed(`${major}.0.2`);
    m.host.env.JAVA_HOME = current;
    m.installed('26.0.1');
    const plan = await planJavaRuntime(
      { minimum: major === 17 ? 17 : 21, flags: major === 17 ? [] : flags },
      m.host,
    );
    expect(plan.status).toBe('healthy');
    expect((plan as any).current.home).toBe(current);
    expect(m.host.directories).not.toHaveBeenCalled();
  });
  it.each(['win32', 'darwin', 'linux'])(
    'repairs JDK 24 on %s and preserves its project pointer',
    async (platform) => {
      const m = machine(platform),
        current = m.installed('24.0.2'),
        selected = m.installed('25.0.5');
      m.host.env.JAVA_HOME = current;
      const plan = await planJavaRuntime({ minimum: 21, flags }, m.host);
      expect(plan).toMatchObject({
        status: 'repair',
        current: { home: current },
        selected: { home: selected },
        preserveProject: '${env:JAVA_HOME}',
      });
    },
  );
  it('accepts JDK 21 as a compatible fallback when JDK 25 is absent', async () => {
    const m = machine();
    m.host.env.JAVA_HOME = m.installed('24.0.2');
    const replacement = m.installed('21.0.9');
    expect(await planJavaRuntime({ minimum: 21, flags }, m.host)).toMatchObject({
      status: 'repair',
      selected: { home: replacement, major: 21 },
    });
  });
  it('keeps JDK 24 when its experimental option is correctly unlocked first', async () => {
    const m = machine();
    m.host.env.JAVA_HOME = m.installed('24.0.2');
    expect(
      await planJavaRuntime(
        { minimum: 21, flags: ['-XX:+UnlockExperimentalVMOptions', ...flags] },
        m.host,
      ),
    ).toMatchObject({ status: 'healthy' });
  });
  it('preserves an older project JDK when the server requires a newer one', async () => {
    const m = machine();
    m.host.env.JAVA_HOME = m.installed('8.0.1');
    m.installed('21.0.9');
    expect(await planJavaRuntime({ minimum: 21, flags }, m.host)).toMatchObject({
      status: 'repair',
      preserveProject: '${env:JAVA_HOME}',
    });
  });
  it('retains the inherited project default even when a workspace has another project choice', async () => {
    const m = machine();
    m.host.env.JAVA_HOME = m.installed('24.0.2');
    m.installed('25.0.5');
    const plan = await planJavaRuntime(
      { minimum: 21, flags, projectHome: m.installed('17.0.5') },
      m.host,
    );
    expect(plan.status).toBe('repair');
    expect(plan).toHaveProperty('preserveProject', '${env:JAVA_HOME}');
  });
  it('uses Oracle precedence and preserves configured server expressions', async () => {
    const m = machine();
    m.host.env.JAVA_HOME = m.installed('25.0.5');
    m.host.env.JDK_HOME = m.installed('24.0.2');
    expect(await planJavaRuntime({ minimum: 21, flags }, m.host)).toMatchObject({
      status: 'repair',
      preserveProject: '${env:JDK_HOME}',
    });
    expect(
      await planJavaRuntime({ minimum: 21, flags, serverHome: '${env:JAVA_HOME}' }, m.host),
    ).toMatchObject({ status: 'healthy', current: { major: 25 } });
  });
  it('repairs a stale pointer instead of claiming JAVA_HOME is the configured runtime', async () => {
    const m = machine();
    m.host.env.JAVA_HOME = m.installed('25.0.5');
    expect(
      await planJavaRuntime({ minimum: 21, flags, serverHome: 'C:\\removed-jdk' }, m.host),
    ).toMatchObject({ status: 'repair', selected: { major: 25 } });
  });
  it('finds a Windows JDK in a vendor directory containing spaces', async () => {
    const m = machine();
    m.host.env.ProgramFiles = 'C:\\Program Files';
    const selected = m.jdk('C:\\Program Files\\Eclipse Adoptium\\jdk-25', '25.0.1');
    expect(await planJavaRuntime({ minimum: 21, flags }, m.host)).toMatchObject({
      status: 'repair',
      selected: { home: selected },
    });
  });
  it('finds a macOS JDK bundle', async () => {
    const m = machine('darwin');
    m.dirs.set('/Library/Java/JavaVirtualMachines', ['temurin-25.jdk']);
    const selected = m.jdk(
      '/Library/Java/JavaVirtualMachines/temurin-25.jdk/Contents/Home',
      '25.0.1',
    );
    expect(await planJavaRuntime({ minimum: 21, flags }, m.host)).toMatchObject({
      status: 'repair',
      selected: { home: selected },
    });
  });
  it('finds a Linux system JDK', async () => {
    const m = machine('linux'),
      selected = m.jdk('/usr/lib/jvm/java-21-openjdk', '21.0.9');
    expect(await planJavaRuntime({ minimum: 21, flags }, m.host)).toMatchObject({
      status: 'repair',
      selected: { home: selected },
    });
  });
  it('resolves a PATH Java symlink to its real JDK', async () => {
    const m = machine('linux'),
      selected = m.installed('21.0.9');
    m.host.env.PATH = '.:relative:/usr/bin';
    m.files.set('/usr/bin/java', '');
    m.links.set('/usr/bin/java', m.p.join(selected, 'bin', 'java'));
    expect(await planJavaRuntime({ minimum: 21, flags }, m.host)).toMatchObject({
      status: 'healthy',
      current: { home: selected },
    });
  });
  it('requires a JDK, not only a Java runtime', async () => {
    const m = machine(),
      root = m.installed('25.0.5');
    m.files.delete(m.p.join(root, 'bin', 'javac.exe'));
    expect(await inspectJava(root, m.host)).toBeUndefined();
    expect(m.host.probe).not.toHaveBeenCalled();
  });
  it('rejects unknown variables and relative executable paths', async () => {
    const m = machine();
    expect(expandJavaHome('${workspaceFolder}/jdk', m.host)).toBeUndefined();
    expect(expandJavaHome('./jdk', m.host)).toBeUndefined();
    expect(
      await planJavaRuntime({ minimum: 21, flags, serverHome: '${env:MISSING}' }, m.host),
    ).toMatchObject({ status: 'manual' });
    expect(m.host.probe).not.toHaveBeenCalled();
  });
  it.each(['JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS', 'java_tool_options'])(
    'does not execute custom options from %s',
    async (key) => {
      const m = machine();
      m.host.env[key] = '-javaagent:project.jar';
      m.host.env.JAVA_HOME = m.installed('24.0.2');
      expect(await planJavaRuntime({ minimum: 21, flags }, m.host)).toMatchObject({
        status: 'manual',
      });
      expect(m.host.probe).not.toHaveBeenCalled();
    },
  );
  it('skips a failing candidate and prefers stable over early-access installations', async () => {
    const m = machine();
    m.installed('27-ea');
    m.installed('25.0.5');
    m.installed('21.0.9');
    vi.mocked(m.host.probe).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect(await planJavaRuntime({ minimum: 21, flags }, m.host)).toMatchObject({
      status: 'repair',
      selected: { major: 21 },
    });
    expect(vi.mocked(m.host.probe).mock.calls[0][0]).toContain('25.0.5');
  });
  it('returns a setup action when no compatible JDK exists', async () => {
    const m = machine();
    m.host.env.JAVA_HOME = m.installed('24.0.2');
    expect(await planJavaRuntime({ minimum: 21, flags }, m.host)).toEqual({
      status: 'missing',
      minimum: 21,
    });
  });
  it('honors cancellation before launching processes', async () => {
    const m = machine();
    m.installed('25.0.5');
    const controller = new AbortController();
    controller.abort();
    expect(
      await planJavaRuntime({ minimum: 21, flags, signal: controller.signal }, m.host),
    ).toMatchObject({ status: 'manual' });
    expect(m.host.probe).not.toHaveBeenCalled();
  });
  it('reads installed extension requirements and retains flag order', () => {
    expect(
      oracleRuntimeRules(
        'The extension requires JDK 17 or newer to run.',
        'default_options="-J-XX:+UseCompactObjectHeaders -J-XX:+IgnoreUnrecognizedVMOptions"',
        ['-XX:+UnlockExperimentalVMOptions'],
      ),
    ).toEqual({ minimum: 17, flags: [...flags, '-XX:+UnlockExperimentalVMOptions'] });
    expect(
      oracleRuntimeRules('requires JDK 21 or newer', 'default_options="-J-Xmx1G"', [
        '-javaagent:agent.jar',
      ]),
    ).toBeUndefined();
    expect(oracleRuntimeRules('unknown', 'default_options="x"', [])).toBeUndefined();
  });
});
describe('Java settings repair and restore', () => {
  function store(initial: Partial<Record<'jdkhome' | 'project.jdkhome', string | null>> = {}) {
    const values = { ...initial },
      saved: { value?: JavaRuntimeBackup } = {};
    const settings: JavaRuntimeSettings = {
      get: (k) => values[k],
      update: vi.fn(async (k: 'jdkhome' | 'project.jdkhome', v: string | null | undefined) => {
        values[k] = v;
      }),
      save: vi.fn(async (b) => {
        saved.value = b;
      }),
    };
    return { settings, values, saved };
  }
  it('backs up before applying and pins project Java before changing the server', async () => {
    const s = store();
    await applyJavaRuntime(s.settings, '/jdk25', '${env:JAVA_HOME}');
    expect(s.saved.value).toMatchObject({
      serverAfter: '/jdk25',
      projectAfter: '${env:JAVA_HOME}',
      changedProject: true,
    });
    expect(vi.mocked(s.settings.update).mock.calls).toEqual([
      ['project.jdkhome', '${env:JAVA_HOME}'],
      ['jdkhome', '/jdk25'],
    ]);
    expect(vi.mocked(s.settings.save).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(s.settings.update).mock.invocationCallOrder[0],
    );
  });
  it('leaves explicit project choices alone', async () => {
    const s = store({ 'project.jdkhome': '/jdk8' });
    await applyJavaRuntime(s.settings, '/jdk25', '/jdk24');
    expect(s.values['project.jdkhome']).toBe('/jdk8');
  });
  it('rolls back its project edit if writing the server setting fails', async () => {
    const s = store();
    vi.mocked(s.settings.update).mockImplementation(async (k, v) => {
      if (k === 'jdkhome') throw Error('write failed');
      s.values[k] = v;
    });
    await expect(applyJavaRuntime(s.settings, '/jdk25', '/jdk24')).rejects.toThrow();
    expect(s.values['project.jdkhome']).toBeUndefined();
    expect(s.saved.value).toBeUndefined();
  });
  it('does not overwrite edits made while saving a backup', async () => {
    const s = store();
    vi.mocked(s.settings.save).mockImplementation(async () => {
      s.values.jdkhome = '/chosen-by-user';
    });
    await expect(applyJavaRuntime(s.settings, '/jdk25')).rejects.toThrow();
    expect(s.settings.update).not.toHaveBeenCalled();
  });
  it('restores exactly the previous settings', async () => {
    const s = store({ jdkhome: '/jdk24' });
    const backup = await applyJavaRuntime(s.settings, '/jdk25', '/jdk24');
    expect(await restoreJavaRuntime(s.settings, backup)).toBe(true);
    expect(s.values).toEqual({ jdkhome: '/jdk24', 'project.jdkhome': undefined });
  });
  it('preserves settings the user changed after repair', async () => {
    const s = store();
    const backup = await applyJavaRuntime(s.settings, '/jdk25', '/jdk24');
    s.values.jdkhome = '/user-jdk';
    expect(await restoreJavaRuntime(s.settings, backup)).toBe(false);
    expect(s.values.jdkhome).toBe('/user-jdk');
  });
});
