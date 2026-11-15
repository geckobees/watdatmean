import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import type * as vscode from 'vscode';
import { registerJavaRuntimeSetup } from '../src/java-runtime-setup';
const host = vi.hoisted(() => ({
  commands: new Map<string, (...args: any[]) => any>(),
  values: {} as Record<string, any>,
  workspaceValues: {} as Record<string, any>,
  trusted: true,
  enabled: true,
  installed: true,
  backup: undefined as any,
  action: undefined as string | undefined,
  notices: [] as string[],
  writes: [] as any[],
  executed: [] as string[],
  plan: vi.fn(),
  read: vi.fn(),
  configurationChanged: undefined as any,
  trustChanged: undefined as any,
  extensionsChanged: undefined as any,
}));
vi.mock('../src/java-runtime', async (original) => {
  const actual = await original<typeof import('../src/java-runtime')>();
  return { ...actual, planJavaRuntime: host.plan, javaRuntimeHost: { read: host.read } };
});
vi.mock('vscode', () => {
  const disposable = () => ({ dispose() {} });
  return {
    ConfigurationTarget: { Global: 1 },
    workspace: {
      get isTrusted() {
        return host.trusted;
      },
      workspaceFolders: [],
      getConfiguration: (section: string) => ({
        get: (key: string, fallback: any) =>
          section === 'watdatmean'
            ? host.enabled
            : (host.workspaceValues[key] ?? host.values[key] ?? fallback),
        inspect: (key: string) => ({
          globalValue: host.values[key],
          workspaceValue: host.workspaceValues[key],
        }),
        update: async (key: string, value: any, target: any) => {
          host.writes.push([section, key, value, target]);
          if (section === 'watdatmean') host.enabled = value;
          else host.values[key] = value;
          host.configurationChanged?.({ affectsConfiguration: () => true });
        },
      }),
      onDidGrantWorkspaceTrust: (callback: any) => {
        host.trustChanged = callback;
        return disposable();
      },
      onDidChangeConfiguration: (callback: any) => {
        host.configurationChanged = callback;
        return disposable();
      },
    },
    extensions: {
      getExtension: () => (host.installed ? { extensionPath: '/installed/oracle' } : undefined),
      onDidChange: (callback: any) => {
        host.extensionsChanged = callback;
        return disposable();
      },
    },
    commands: {
      registerCommand: (name: string, callback: any) => {
        host.commands.set(name, callback);
        return disposable();
      },
      getCommands: async () => ['jdk.download.jdk'],
      executeCommand: async (name: string) => {
        host.executed.push(name);
      },
    },
    window: {
      createOutputChannel: () => ({ ...disposable(), appendLine() {}, show() {} }),
      showInformationMessage: async (message: string) => {
        host.notices.push(message);
        return host.action;
      },
    },
  };
});
let context: vscode.ExtensionContext;
const jdk = {
  home: '/jdk25',
  executable: '/jdk25/bin/java',
  major: 25,
  version: '25.0.5',
  earlyAccess: false,
};
beforeEach(() => {
  vi.useFakeTimers();
  host.commands.clear();
  host.values = {};
  host.workspaceValues = {};
  host.trusted = true;
  host.enabled = true;
  host.installed = true;
  host.backup = undefined;
  host.action = undefined;
  host.notices = [];
  host.writes = [];
  host.executed = [];
  host.plan.mockReset().mockResolvedValue({ status: 'healthy', current: jdk });
  host.read
    .mockReset()
    .mockImplementation(async (file: string) =>
      file.endsWith('README.md')
        ? 'The extension requires JDK 21 or newer to run.'
        : 'default_options="-J-XX:+UseCompactObjectHeaders -J-XX:+IgnoreUnrecognizedVMOptions"',
    );
  context = {
    subscriptions: [],
    globalState: {
      get: () => host.backup,
      update: async (_key: string, value: any) => {
        host.backup = value;
      },
    },
  } as unknown as vscode.ExtensionContext;
  registerJavaRuntimeSetup(context);
});
afterEach(() => {
  context.subscriptions.forEach((d) => d.dispose());
  vi.useRealTimers();
});
const start = () => vi.advanceTimersByTimeAsync(500);
const check = () => host.commands.get('watdatmean.checkJavaRuntime')!();
it('checks once at startup without prompting when the existing runtime works', async () => {
  await start();
  expect(host.plan).toHaveBeenCalledTimes(1);
  expect(host.notices).toEqual([]);
  expect(host.writes).toEqual([]);
});
it('performs no discovery or process checks in an untrusted workspace', async () => {
  host.trusted = false;
  await start();
  expect(host.plan).not.toHaveBeenCalled();
  expect(host.read).not.toHaveBeenCalled();
  expect(host.writes).toEqual([]);
  expect(await check()).toEqual({ status: 'untrusted' });
});
it('checks after trust is granted', async () => {
  host.trusted = false;
  await start();
  host.trusted = true;
  host.trustChanged();
  await start();
  expect(host.plan).toHaveBeenCalledTimes(1);
});
it('does nothing when Oracle Java is absent', async () => {
  host.installed = false;
  await start();
  expect(host.read).not.toHaveBeenCalled();
  expect(host.plan).not.toHaveBeenCalled();
  expect(host.writes).toEqual([]);
});
it('respects the automatic-setup switch while allowing an explicit check', async () => {
  host.enabled = false;
  await start();
  expect(host.plan).not.toHaveBeenCalled();
  await check();
  expect(host.plan).toHaveBeenCalledTimes(1);
});
it('backs up and applies the compatible server without changing project Java', async () => {
  host.plan.mockResolvedValue({
    status: 'repair',
    selected: jdk,
    preserveProject: '${env:JAVA_HOME}',
  });
  await start();
  expect(host.writes).toEqual([
    ['jdk', 'project.jdkhome', '${env:JAVA_HOME}', 1],
    ['jdk', 'jdkhome', '/jdk25', 1],
  ]);
  expect(host.backup.serverAfter).toBe('/jdk25');
  expect(host.notices[0]).toContain('adjusted automatically');
  await vi.advanceTimersByTimeAsync(1000);
  expect(host.plan).toHaveBeenCalledTimes(1);
});
it('keeps explicit project configuration when repairing the server', async () => {
  host.values['project.jdkhome'] = '/jdk8';
  host.plan.mockResolvedValue({ status: 'repair', selected: jdk, preserveProject: '/jdk24' });
  await start();
  expect(host.values['project.jdkhome']).toBe('/jdk8');
  expect(host.writes).toHaveLength(1);
});
it('preserves both the inherited machine project default and an explicit workspace project', async () => {
  host.workspaceValues['project.jdkhome'] = '/jdk8';
  host.plan.mockResolvedValue({ status: 'repair', selected: jdk, preserveProject: '/jdk24' });
  await start();
  expect(host.workspaceValues['project.jdkhome']).toBe('/jdk8');
  expect(host.values['project.jdkhome']).toBe('/jdk24');
  expect(host.values.jdkhome).toBe('/jdk25');
});
it('treats an explicit null workspace path as an intentional override', async () => {
  host.workspaceValues.jdkhome = null;
  await start();
  expect(host.plan).not.toHaveBeenCalled();
  expect(host.writes).toEqual([]);
});
it('does not overwrite explicit workspace server settings', async () => {
  host.workspaceValues.jdkhome = '/shared-jdk';
  host.plan.mockResolvedValue({ status: 'repair', selected: jdk });
  await start();
  expect(host.plan).not.toHaveBeenCalled();
  expect(await check()).toEqual({ status: 'workspace-configured' });
  expect(host.writes).toEqual([]);
  expect(host.notices[0]).toContain('workspace explicitly controls');
});
it('preserves settings edited during discovery', async () => {
  host.plan.mockImplementation(async () => {
    host.values.jdkhome = '/new-user-choice';
    return { status: 'repair', selected: jdk };
  });
  await start();
  expect(host.writes).toEqual([]);
});
it('does not apply a repair if trust was revoked during discovery', async () => {
  host.plan.mockImplementation(async () => {
    host.trusted = false;
    return { status: 'repair', selected: jdk };
  });
  await start();
  expect(host.writes).toEqual([]);
});
it('does not apply a repair if automatic setup is switched off during discovery', async () => {
  host.plan.mockImplementation(async () => {
    host.enabled = false;
    return { status: 'repair', selected: jdk };
  });
  await start();
  expect(host.writes).toEqual([]);
});
it('preserves a workspace override added during discovery even if its value is unchanged', async () => {
  host.values.jdkhome = '/jdk24';
  host.plan.mockImplementation(async () => {
    host.workspaceValues.jdkhome = '/jdk24';
    return { status: 'repair', selected: jdk };
  });
  await start();
  expect(host.writes).toEqual([]);
});
it('offers Oracle setup once when no compatible JDK exists', async () => {
  host.plan.mockResolvedValue({ status: 'missing', minimum: 21 });
  host.action = 'Open Java Setup';
  await start();
  expect(host.executed).toEqual(['jdk.download.jdk']);
  host.configurationChanged({ affectsConfiguration: () => true });
  await start();
  expect(host.notices).toHaveLength(1);
  expect(host.writes).toEqual([]);
});
it('only reloads after the user chooses the reload action', async () => {
  host.plan.mockResolvedValue({ status: 'repair', selected: jdk });
  host.action = 'Reload Window';
  await start();
  expect(host.executed).toEqual(['workbench.action.reloadWindow']);
});
it('skips unknown extension requirements without guessing', async () => {
  host.read.mockResolvedValue('unknown');
  await start();
  expect(host.plan).not.toHaveBeenCalled();
  expect(host.writes).toEqual([]);
});
it('contains probe/setup failures without breaking extension activation', async () => {
  host.plan.mockRejectedValue(Error('probe failed'));
  await start();
  expect(host.notices).toHaveLength(1);
  expect(host.writes).toEqual([]);
});
it('deduplicates simultaneous checks', async () => {
  let finish: (v: any) => void = () => {};
  host.plan.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = check(),
    second = check();
  await vi.advanceTimersByTimeAsync(0);
  finish({ status: 'healthy', current: jdk });
  await Promise.all([first, second]);
  expect(host.plan).toHaveBeenCalledTimes(1);
});
it('cancels pending setup when disposed', async () => {
  let finish: (v: any) => void = () => {};
  host.plan.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = check();
  await vi.advanceTimersByTimeAsync(0);
  context.subscriptions.forEach((d) => d.dispose());
  finish({ status: 'repair', selected: jdk });
  await pending;
  expect(host.writes).toEqual([]);
});
it('restores a previous repair and turns automatic setup off', async () => {
  host.values.jdkhome = '/jdk25';
  host.values['project.jdkhome'] = '/jdk24';
  host.backup = {
    serverBefore: undefined,
    projectBefore: undefined,
    serverAfter: '/jdk25',
    projectAfter: '/jdk24',
    changedProject: true,
  };
  await host.commands.get('watdatmean.restoreJavaRuntime')!();
  expect(host.values.jdkhome).toBeUndefined();
  expect(host.values['project.jdkhome']).toBeUndefined();
  expect(host.enabled).toBe(false);
});
