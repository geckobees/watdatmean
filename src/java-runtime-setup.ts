import * as vscode from 'vscode';
import path from 'node:path';
import { javaRuntimeHost, oracleRuntimeRules, planJavaRuntime } from './java-runtime';
import {
  applyJavaRuntime,
  restoreJavaRuntime,
  type JavaRuntimeBackup,
  type JavaRuntimeSettings,
} from './java-runtime-settings';

const backupKey = 'javaRuntimeBackup.v1';
export function registerJavaRuntimeSetup(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('WatDatMean Java Setup');
  let running: Promise<unknown> | undefined,
    timer: ReturnType<typeof setTimeout> | undefined,
    disposed = false,
    applying = false;
  let controller: AbortController | undefined;
  const notified = new Set<string>();
  const config = () => vscode.workspace.getConfiguration('jdk');
  const hasWorkspaceOverride = () =>
    [
      config(),
      ...(vscode.workspace.workspaceFolders ?? []).map((f) =>
        vscode.workspace.getConfiguration('jdk', f.uri),
      ),
    ].some((c) =>
      ['jdkhome', 'serverVmOptions'].some((k) => {
        const value = c.inspect(k);
        return value?.workspaceValue !== undefined || value?.workspaceFolderValue !== undefined;
      }),
    );
  const settings: JavaRuntimeSettings = {
    get: (key) => config().inspect<string | null>(key)?.globalValue,
    update: (key, value) => config().update(key, value, vscode.ConfigurationTarget.Global),
    save: (value) => context.globalState.update(backupKey, value),
  };
  async function notice(message: string, manual: boolean, action = 'Open Java Setup') {
    output.appendLine(message);
    if (!manual && notified.has(message)) return;
    notified.add(message);
    const selected = await vscode.window.showInformationMessage(message, action, 'Show Details');
    if (selected === 'Show Details') output.show(true);
    else if (selected === 'Reload Window')
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    else if (selected === 'Open Java Settings')
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        '@ext:Oracle.oracle-java jdkhome',
      );
    else if (selected === 'Open Java Setup') {
      const commands = await vscode.commands.getCommands(true);
      // Oracle owns downloading/installing its JDK. Open its supported setup command if present.
      const command = commands.find((c) => c === 'jdk.download.jdk' || c === 'jdk.downloadJdk');
      if (command) await vscode.commands.executeCommand(command);
      else
        await vscode.commands.executeCommand(
          'workbench.action.openSettings',
          '@ext:Oracle.oracle-java jdkhome',
        );
    }
  }
  async function check(manual: boolean) {
    if (disposed) return;
    if (!vscode.workspace.isTrusted) {
      if (manual)
        await notice(
          'Trust this workspace before checking installed Java runtimes. Local WatDatMean explanations remain available.',
          true,
          'Open Java Settings',
        );
      return { status: 'untrusted' };
    }
    if (
      !manual &&
      !vscode.workspace.getConfiguration('watdatmean').get('autoConfigureJavaRuntime', true)
    )
      return { status: 'disabled' };
    const oracle = vscode.extensions.getExtension('Oracle.oracle-java');
    if (!oracle) {
      if (manual)
        await notice(
          'Oracle Java is not installed in this extension host. WatDatMean’s local Java explanations do not require it.',
          true,
          'Open Java Settings',
        );
      return { status: 'not-installed' };
    }
    // Avoid committing machine paths or changing an explicitly shared workspace setup.
    const workspaceConfigured = hasWorkspaceOverride();
    if (workspaceConfigured && !manual) return { status: 'workspace-configured' };
    const snapshot = JSON.stringify([
      config().get('jdkhome'),
      config().get('project.jdkhome'),
      config().get('serverVmOptions', []),
    ]);
    const [readme, conf] = await Promise.all([
      javaRuntimeHost.read(path.join(oracle.extensionPath, 'README.md')),
      javaRuntimeHost.read(path.join(oracle.extensionPath, 'nbcode', 'etc', 'nbcode.conf')),
    ]);
    const rules = oracleRuntimeRules(readme, conf, config().get('serverVmOptions', []));
    if (!rules) {
      if (manual)
        await notice(
          'Oracle’s Java requirements or custom VM options could not be verified. Existing settings were preserved.',
          true,
          'Open Java Settings',
        );
      return { status: 'unknown-requirements' };
    }
    controller = new AbortController();
    const deadline = setTimeout(() => controller?.abort(), 20000);
    let plan;
    try {
      plan = await planJavaRuntime({
        serverHome: config().get<string>('jdkhome'),
        projectHome: config().get<string>('project.jdkhome'),
        ...rules,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(deadline);
    }
    if (disposed || controller.signal.aborted) return { status: 'cancelled' };
    if (plan.status === 'healthy') {
      output.appendLine(
        `Oracle Java server: compatible JDK ${plan.current.version} at ${plan.current.home}. No settings changed.`,
      );
      if (manual)
        await vscode.window.showInformationMessage(
          `Java setup is compatible (JDK ${plan.current.version}). Older project JDKs can remain unchanged.`,
        );
    } else if (plan.status === 'repair') {
      if (workspaceConfigured) {
        await notice(
          `A compatible JDK ${plan.selected.version} was found at ${plan.selected.home}. This workspace explicitly controls Oracle’s server; select it in Java Settings to keep that shared configuration under your control.`,
          true,
          'Open Java Settings',
        );
        return { status: 'workspace-configured' };
      }
      if (
        !vscode.workspace.isTrusted ||
        snapshot !==
          JSON.stringify([
            config().get('jdkhome'),
            config().get('project.jdkhome'),
            config().get('serverVmOptions', []),
          ])
      )
        return { status: 'settings-changed' };
      if (hasWorkspaceOverride()) return { status: 'workspace-configured' };
      if (
        !manual &&
        !vscode.workspace.getConfiguration('watdatmean').get('autoConfigureJavaRuntime', true)
      )
        return { status: 'disabled' };
      applying = true;
      let backup: JavaRuntimeBackup;
      try {
        backup = await applyJavaRuntime(settings, plan.selected.home, plan.preserveProject);
      } finally {
        applying = false;
      }
      output.appendLine(
        `Selected JDK ${plan.selected.version}: ${plan.selected.home}. ${backup.changedProject ? 'Preserved default project JDK: ' + backup.projectAfter + '.' : 'Existing project configuration was preserved.'}`,
      );
      await notice(
        `Java setup adjusted automatically to JDK ${plan.selected.version} for Oracle’s server. Your project Java setting was preserved. Reload if the earlier server error is still open.`,
        manual,
        'Reload Window',
      );
    } else if (plan.status === 'missing')
      await notice(
        `Oracle’s Java server needs a compatible JDK ${plan.minimum} or newer. Open Java Setup to install or select one; WatDatMean’s local explanations still work.`,
        manual,
      );
    else await notice(plan.reason, manual, 'Open Java Settings');
    return plan;
  }
  function run(manual = false): Promise<unknown> {
    if (running) return running;
    running = check(manual)
      .catch(async () => {
        if (!disposed)
          await notice(
            'Java setup could not complete. Existing settings were preserved where possible. Open Java Setup to retry.',
            manual,
          );
        return { status: 'error' };
      })
      .finally(() => {
        running = undefined;
      });
    return running;
  }
  const schedule = () => {
    if (!applying && !disposed) {
      clearTimeout(timer);
      timer = setTimeout(() => void run(), 500);
    }
  };
  context.subscriptions.push(
    output,
    vscode.commands.registerCommand('watdatmean.checkJavaRuntime', () => run(true)),
    vscode.commands.registerCommand('watdatmean.restoreJavaRuntime', async () => {
      const backup = context.globalState.get<JavaRuntimeBackup>(backupKey);
      if (!backup)
        return vscode.window.showInformationMessage(
          'There is no WatDatMean Java setup adjustment to restore.',
        );
      applying = true;
      try {
        const restored = await restoreJavaRuntime(settings, backup);
        if (restored)
          await vscode.workspace
            .getConfiguration('watdatmean')
            .update('autoConfigureJavaRuntime', false, vscode.ConfigurationTarget.Global);
        await vscode.window.showInformationMessage(
          restored
            ? 'Previous Java settings restored; automatic Java setup is now off.'
            : 'Java settings have been edited since setup; your changes were preserved.',
        );
      } catch {
        await notice(
          'Previous Java settings could not be fully restored. Open Java Settings to review them.',
          true,
          'Open Java Settings',
        );
      } finally {
        applying = false;
      }
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(schedule),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration('jdk') ||
        e.affectsConfiguration('watdatmean.autoConfigureJavaRuntime')
      )
        schedule();
    }),
    vscode.extensions.onDidChange(schedule),
    {
      dispose() {
        disposed = true;
        clearTimeout(timer);
        controller?.abort();
      },
    },
  );
  schedule();
}
