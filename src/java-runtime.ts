import { access, readFile, readdir, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';

export interface JavaRuntimeHost {
  platform: string;
  home: string;
  env: NodeJS.ProcessEnv;
  read(file: string): Promise<string>;
  exists(file: string): Promise<boolean>;
  real(file: string): Promise<string>;
  directories(root: string): Promise<string[]>;
  probe(executable: string, flags: string[], signal?: AbortSignal): Promise<boolean>;
}
export const javaRuntimeHost: JavaRuntimeHost = {
  platform: process.platform,
  home: homedir(),
  env: process.env,
  read: (file) => readFile(file, 'utf8'),
  exists: (file) =>
    access(file).then(
      () => true,
      () => false,
    ),
  real: (file) => realpath(file),
  directories: (root) =>
    readdir(root, { withFileTypes: true }).then(
      (entries) => entries.filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => e.name),
      () => [],
    ),
  probe: (executable, flags, signal) =>
    new Promise((resolve) => {
      const env = { ...process.env };
      // A version check must never load agents or run code from Java option environment variables.
      for (const key of Object.keys(env))
        if (
          ['JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS', 'CLASSPATH'].includes(
            key.toUpperCase(),
          )
        )
          delete env[key];
      execFile(
        executable,
        [...flags, '-version'],
        { shell: false, windowsHide: true, timeout: 4000, maxBuffer: 16384, env, signal },
        (error) => resolve(!error),
      );
    }),
};
export type JavaInstallation = {
  home: string;
  executable: string;
  major: number;
  version: string;
  earlyAccess: boolean;
};
export type JavaRuntimePlan =
  | { status: 'healthy'; current: JavaInstallation }
  | {
      status: 'repair';
      current?: JavaInstallation;
      selected: JavaInstallation;
      preserveProject?: string;
    }
  | { status: 'manual'; reason: string }
  | { status: 'missing'; minimum: number };
const optionPattern =
  /^-XX:[+-](?:UseCompactObjectHeaders|UnlockExperimentalVMOptions|IgnoreUnrecognizedVMOptions)$/;
export function oracleRuntimeRules(readme: string, configuration: string, userOptions: unknown) {
  const minimum = /requires\s+JDK\s+(\d+)\s+or\s+(?:newer|higher)/i.exec(readme)?.[1];
  const defaults = /^default_options="([^"\r\n]*)"/m.exec(configuration)?.[1];
  if (
    !minimum ||
    !defaults ||
    !Array.isArray(userOptions) ||
    userOptions.some(
      (o) =>
        typeof o !== 'string' || (!optionPattern.test(o) && !/^-X(?:mx|ms|ss)\d+[kmg]?$/i.test(o)),
    )
  )
    return;
  const flags = defaults
    .split(/\s+/)
    .filter((o) => o.startsWith('-J') && optionPattern.test(o.slice(2)))
    .map((o) => o.slice(2));
  flags.push(...userOptions.filter((o) => optionPattern.test(o)));
  return { minimum: Number(minimum), flags };
}
export function expandJavaHome(value: string, host: JavaRuntimeHost): string | undefined {
  const p = host.platform === 'win32' ? path.win32 : path.posix;
  let expanded = value
    .trim()
    .replace(/^~(?=$|[\\/])/, host.home)
    .replace(/\$\{userHome\}/g, host.home);
  expanded = expanded.replace(/\$\{env:([^}]+)\}/g, (original, key: string) => {
    const actual =
      host.platform === 'win32'
        ? Object.keys(host.env).find((k) => k.toLowerCase() === key.toLowerCase())
        : key;
    return actual && host.env[actual] ? host.env[actual]! : original;
  });
  if (!p.isAbsolute(expanded) || /[\r\n\0]|\$\{/.test(expanded)) return;
  return p.normalize(expanded);
}
export async function inspectJava(
  home: string,
  host: JavaRuntimeHost,
): Promise<JavaInstallation | undefined> {
  const p = host.platform === 'win32' ? path.win32 : path.posix;
  try {
    let root = expandJavaHome(home, host);
    if (!root) return;
    if (/^java(?:\.exe)?$/i.test(p.basename(root)))
      root = p.dirname(p.dirname(await host.real(root)));
    if (
      host.platform === 'darwin' &&
      (await host.exists(p.join(root, 'Contents', 'Home', 'release')))
    )
      root = p.join(root, 'Contents', 'Home');
    root = await host.real(root);
    const executable = p.join(root, 'bin', host.platform === 'win32' ? 'java.exe' : 'java');
    if (
      !(await host.exists(executable)) ||
      !(await host.exists(p.join(root, 'bin', host.platform === 'win32' ? 'javac.exe' : 'javac')))
    )
      return;
    const release = await host.read(p.join(root, 'release'));
    if (release.length > 65536) return;
    const version = /^JAVA_VERSION="([^"\r\n]+)"/m.exec(release)?.[1];
    const major = version && /^(?:1\.)?(\d+)/.exec(version)?.[1];
    if (!version || !major) return;
    return {
      home: root,
      executable,
      major: Number(major),
      version,
      earlyAccess: /(?:^|[-+])ea(?:$|[-+])/i.test(version),
    };
  } catch {
    return;
  }
}
export async function planJavaRuntime(
  input: {
    serverHome?: string | null;
    projectHome?: string | null;
    minimum: number;
    maximum?: number;
    flags: string[];
    signal?: AbortSignal;
  },
  host = javaRuntimeHost,
): Promise<JavaRuntimePlan> {
  const p = host.platform === 'win32' ? path.win32 : path.posix;
  if (!['win32', 'darwin', 'linux'].includes(host.platform))
    return {
      status: 'manual',
      reason: 'Automatic Java discovery is not available on this operating system.',
    };
  if (
    Object.entries(host.env).some(
      ([k, v]) =>
        ['JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS'].includes(k.toUpperCase()) &&
        v?.trim(),
    )
  )
    return {
      status: 'manual',
      reason: 'Custom Java environment options are set; automatic setup will preserve them.',
    };
  if (
    !Number.isInteger(input.minimum) ||
    input.minimum < 8 ||
    input.minimum > 100 ||
    (input.maximum !== undefined &&
      (!Number.isInteger(input.maximum) || input.maximum < input.minimum || input.maximum > 100)) ||
    input.flags.some((f) => !optionPattern.test(f))
  )
    return { status: 'manual', reason: 'The Java server requirements could not be verified.' };
  const cancelled = () => input.signal?.aborted;
  const seen = new Set<string>();
  const installations: JavaInstallation[] = [];
  const add = async (value?: string | null) => {
    if (!value || cancelled() || seen.size >= 180) return;
    const expanded = expandJavaHome(value, host);
    if (!expanded) return;
    const key = host.platform === 'win32' ? expanded.toLowerCase() : expanded;
    if (seen.has(key)) return;
    seen.add(key);
    const found = await inspectJava(expanded, host);
    if (
      found &&
      !installations.some((j) =>
        host.platform === 'win32'
          ? j.home.toLowerCase() === found.home.toLowerCase()
          : j.home === found.home,
      )
    )
      installations.push(found);
    return found;
  };
  // Match Oracle's precedence. A stale configured location does not silently become JAVA_HOME.
  const pointer = input.serverHome || host.env.JDK_HOME || host.env.JAVA_HOME;
  if (pointer && !expandJavaHome(pointer, host))
    return {
      status: 'manual',
      reason: 'The Java server path contains an unresolved variable or is not an absolute path.',
    };
  let current = await add(pointer);
  let preserveProject =
    input.serverHome ||
    (host.env.JDK_HOME ? '${env:JDK_HOME}' : host.env.JAVA_HOME ? '${env:JAVA_HOME}' : undefined);
  if (!pointer) {
    for (const dir of (host.env.PATH ?? host.env.Path ?? '')
      .split(host.platform === 'win32' ? ';' : ':')
      .slice(0, 80)) {
      if (!p.isAbsolute(dir)) continue;
      const executable = p.join(dir, host.platform === 'win32' ? 'java.exe' : 'java');
      if (await host.exists(executable)) {
        current = await add(executable);
        if (current) preserveProject = current.home;
        break;
      }
    }
  }
  const compatible = async (jdk: JavaInstallation) =>
    !cancelled() &&
    jdk.major >= input.minimum &&
    jdk.major <= (input.maximum ?? 100) &&
    (await host.probe(jdk.executable, input.flags, input.signal));
  if (current && (await compatible(current))) return { status: 'healthy', current };
  await add(host.env.JDK_HOME);
  await add(host.env.JAVA_HOME);
  await add(input.projectHome);
  const roots = [p.join(host.home, '.jdks'), p.join(host.home, '.sdkman', 'candidates', 'java')];
  if (host.platform === 'win32') {
    for (const programFiles of [host.env.ProgramFiles, host.env['ProgramFiles(x86)']].filter(
      (v): v is string => !!v,
    ))
      for (const vendor of ['Java', 'Eclipse Adoptium', 'Microsoft', 'Amazon Corretto', 'Zulu'])
        roots.push(p.join(programFiles, vendor));
  } else if (host.platform === 'darwin')
    roots.push(
      '/Library/Java/JavaVirtualMachines',
      p.join(host.home, 'Library/Java/JavaVirtualMachines'),
      '/opt/homebrew/opt',
      '/usr/local/opt',
    );
  else roots.push('/usr/lib/jvm', '/usr/java', '/opt/java', '/opt/jdk');
  for (const root of roots) {
    if (cancelled()) break;
    await add(root);
    const names = (await host.directories(root))
      .filter((n) => !n.includes('/') && !n.includes('\\') && n !== '.' && n !== '..')
      .sort()
      .slice(0, 60);
    for (const name of names) {
      if (root.endsWith('/opt') && !/java|jdk|temurin|corretto/i.test(name)) continue;
      await add(p.join(root, name));
      if (host.platform === 'darwin')
        await add(p.join(root, name, 'libexec', 'openjdk.jdk', 'Contents', 'Home'));
    }
  }
  for (const dir of (host.env.PATH ?? host.env.Path ?? '')
    .split(host.platform === 'win32' ? ';' : ':')
    .slice(0, 80))
    if (p.isAbsolute(dir)) await add(p.join(dir, host.platform === 'win32' ? 'java.exe' : 'java'));
  const candidates = installations
    .filter((j) => j.home !== current?.home)
    .sort(
      (a, b) =>
        Number(a.earlyAccess) - Number(b.earlyAccess) ||
        b.major - a.major ||
        b.version.localeCompare(a.version, undefined, { numeric: true }),
    );
  let probes = 0;
  for (const selected of candidates) {
    if (cancelled()) break;
    if (selected.major < input.minimum || selected.major > (input.maximum ?? 100)) continue;
    if (++probes > 5) break;
    if (await compatible(selected))
      return {
        status: 'repair',
        current,
        selected,
        // The settings adapter retains explicit choices. Keep the inherited machine default
        // too: a workspace-only project choice must not upgrade other projects implicitly.
        ...(current ? { preserveProject } : {}),
      };
  }
  return cancelled()
    ? { status: 'manual', reason: 'Java compatibility check was cancelled.' }
    : { status: 'missing', minimum: input.minimum };
}
