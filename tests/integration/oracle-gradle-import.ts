import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export async function run() {
  try {
    const oracle = vscode.extensions.getExtension('Oracle.oracle-java');
    assert.ok(oracle);
    await oracle.activate();
    const root = vscode.workspace.workspaceFolders![0].uri;
    const uri = vscode.Uri.joinPath(root, 'intellij/src/main/java/SetupProbe.java');
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
    let runtime = '';
    for (let i = 0; i < 150; i++) {
      try {
        runtime = readFileSync(path.join(root.fsPath, 'intellij/wdm-runtime.txt'), 'utf8');
      } catch {}
      if (runtime) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    assert.match(runtime, /^17\./, 'Oracle must evaluate the actual Kotlin build using Java 17');
    let definition: unknown;
    for (let i = 0; i < 60; i++) {
      definition = await vscode.commands.executeCommand(
        'vscode.executeDefinitionProvider',
        uri,
        new vscode.Position(0, 76),
      );
      if (JSON.stringify(definition).includes('intellij')) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    assert.ok(
      JSON.stringify(definition).includes('intellij'),
      'The imported IntelliJ SDK type must resolve',
    );
    const errors = vscode.languages
      .getDiagnostics()
      .flatMap(([uri, ds]) =>
        ds
          .filter((d) => d.severity === vscode.DiagnosticSeverity.Error)
          .map((d) => `${uri.fsPath}: ${d.message}`),
      );
    assert.deepEqual(errors, []);
    writeFileSync(
      process.env.WATDATMEAN_TEST_RESULT!,
      JSON.stringify({
        passed: true,
        runtime,
        message: 'Oracle Java: actual Gradle/Kotlin project evaluated on Java 17, no diagnostics',
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
