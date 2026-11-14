import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { inspect } from '../../src/analyzer';
import { collectContext } from '../../src/context';

export async function run() {
  try {
    await checks();
    writeFileSync(
      process.env.WATDATMEAN_TEST_RESULT!,
      JSON.stringify({
        passed: true,
        message:
          'PASS: activation, commands, hover, panel, cross-file references, test links, evidence bounds.',
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
async function checks() {
  const hasTutorHover = (hovers: vscode.Hover[] | undefined) =>
    hovers?.some((h) =>
      h.contents.some((content) =>
        (typeof content === 'string' ? content : content.value).includes('WatDatMean'),
      ),
    );
  const extension = vscode.extensions.getExtension('watdatmean.watdatmean');
  assert.ok(extension, 'Extension is installed in the development host');
  await extension.activate();
  const commands = await vscode.commands.getCommands();
  for (const name of ['inspect', 'configure', 'removeKey', 'clearCache', 'demo'])
    assert.ok(commands.includes(`watdatmean.${name}`));
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder);
  const document = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(folder.uri, 'score.ts'),
  );
  const editor = await vscode.window.showTextDocument(document);
  const offset = document.getText().indexOf('private score');
  const position = document.positionAt(offset + 9);
  editor.selection = new vscode.Selection(position, position);
  let hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
    'vscode.executeHoverProvider',
    document.uri,
    position,
  );
  for (let attempt = 0; attempt < 5 && !hasTutorHover(hovers); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      document.uri,
      position,
    );
  }
  assert.ok(hasTutorHover(hovers), 'Actual hover provider returns local learning content');
  await vscode.commands.executeCommand('watdatmean.inspect');
  for (
    let attempt = 0;
    attempt < 10 &&
    !vscode.window.tabGroups.all.some((g) => g.tabs.some((t) => t.label === 'WatDatMean'));
    attempt++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(
    vscode.window.tabGroups.all.some((g) => g.tabs.some((t) => t.label === 'WatDatMean')),
    'Learning panel opens',
  );
  // Allow the built-in TypeScript service to initialize, then inspect real cross-file references.
  await vscode.extensions.getExtension('vscode.typescript-language-features')?.activate();
  const source = document.getText();
  const snippet = inspect(source, source.lastIndexOf('calculatePoints'));
  let result = await collectContext(document, snippet);
  for (
    let attempt = 0;
    attempt < 8 && !result.evidence.some((e) => e.file.endsWith('score.test.ts'));
    attempt++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    result = await collectContext(document, snippet);
  }
  assert.ok(
    result.evidence.some((e) => e.file.endsWith('dashboard.ts')),
    'Real caller is linked',
  );
  assert.ok(
    result.evidence.some((e) => e.file.endsWith('score.test.ts') && e.test),
    'Real tests are linked',
  );
  assert.ok(
    result.evidence.every((e) => result.locations.has(e.id)),
    'Each evidence ID resolves to a location',
  );
  assert.ok(result.evidence.length <= 12);
  // Exercise the hover provider during actual editor changes, including invalid intermediate code.
  const scratch = await vscode.workspace.openTextDocument({
    language: 'typescript',
    content: 'const score: number = 0;',
  });
  const scratchEditor = await vscode.window.showTextDocument(scratch);
  for (const content of ['const score=;', 'const score:=0;', 'const score: number = 1;']) {
    await scratchEditor.edit((edit) => {
      edit.replace(
        new vscode.Range(scratch.positionAt(0), scratch.positionAt(scratch.getText().length)),
        content,
      );
    });
    const editHovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      scratch.uri,
      new vscode.Position(0, 7),
    );
    assert.ok(
      hasTutorHover(editHovers),
      'Hover remains responsive while a declaration is incomplete',
    );
  }
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  console.log(
    'PASS: activation, commands, hover, panel, cross-file references, test links, evidence bounds.',
  );
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}
