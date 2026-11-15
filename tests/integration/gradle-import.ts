import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Runs with the real Red Hat language server in an isolated VS Code profile.
export async function run() {
  try {
    const java = vscode.extensions.getExtension('redhat.java');
    assert.ok(java, 'Install/provide the Java extension to this integration test');
    const api = await java.activate();
    assert.equal(await api.serverReady(), true);
    const gradle = vscode.extensions.getExtension('vscjava.vscode-gradle');
    if (gradle) {
      await gradle.activate();
      let taskNames: string[] = [];
      for (let attempt = 0; attempt < 60; attempt++) {
        taskNames = (await vscode.tasks.fetchTasks({ type: 'gradle' })).map((t) => t.name);
        if (taskNames.some((name) => name.includes('buildPlugin'))) break;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      assert.ok(
        taskNames.some((name) => name.includes('buildPlugin')),
        'Gradle for Java must discover plugin build tasks using the generated Java home',
      );
      assert.ok(
        !taskNames.some((name) => name.includes('wrapper-bootstrap')),
        'Gradle task discovery must exclude scratch projects',
      );
    }
    const runtime = readFileSync(
      path.join(vscode.workspace.workspaceFolders![0].uri.fsPath, 'intellij/wdm-runtime.txt'),
      'utf8',
    );
    assert.match(runtime, /^17\./, 'The real Gradle build must run on Java 17');
    const projects = await vscode.commands.executeCommand<string[]>(
      'java.execute.workspaceCommand',
      'java.project.getAll',
    );
    assert.ok(
      projects?.some((p) => /\/intellij\/?$/.test(p)),
      JSON.stringify(projects),
    );
    assert.ok(
      !projects?.some((p) => p.includes('wrapper-bootstrap')),
      'Scratch project was imported',
    );
    const uri = vscode.Uri.joinPath(
      vscode.workspace.workspaceFolders![0].uri,
      'intellij/src/main/java/SetupProbe.java',
    );
    const settings = await api.getProjectSettings(uri.toString(), [
      'org.eclipse.jdt.core.compiler.source',
      'org.eclipse.jdt.core.compiler.codegen.targetPlatform',
    ]);
    assert.equal(settings['org.eclipse.jdt.core.compiler.source'], '17');
    assert.equal(settings['org.eclipse.jdt.core.compiler.codegen.targetPlatform'], '17');
    const paths = await api.getClasspaths(uri.toString(), { scope: 'runtime' });
    assert.ok(
      paths.classpaths.some((p: string) =>
        p
          .replaceAll('\\', '/')
          .toLowerCase()
          .startsWith(
            process.env.WATDATMEAN_TEST_IDE_HOME!.replaceAll('\\', '/').toLowerCase() + '/',
          ),
      ),
      'IntelliJ SDK classpath missing',
    );
    const errors = vscode.languages
      .getDiagnostics()
      .flatMap(([uri, diagnostics]) =>
        diagnostics
          .filter((d) => d.severity === vscode.DiagnosticSeverity.Error)
          .map((d) => `${uri.fsPath}: ${d.message}`),
      );
    assert.deepEqual(errors, []);
    writeFileSync(
      process.env.WATDATMEAN_TEST_RESULT!,
      JSON.stringify({
        passed: true,
        message:
          'PASS: real VS Code Java import, Java 17 target, IntelliJ SDK classpath, scratch exclusion, no import errors',
        projects,
        settings,
        javaRequirement: api.javaRequirement,
        runtime,
        gradleTasksVerified: !!gradle,
      }),
    );
  } catch (error) {
    writeFileSync(
      process.env.WATDATMEAN_TEST_RESULT!,
      JSON.stringify({ passed: false, message: String(error) }),
    );
    throw error;
  }
}
