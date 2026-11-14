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
  const hoverText = (hovers: vscode.Hover[] | undefined) =>
    (
      hovers
        ?.flatMap((h) => h.contents.map((c) => (typeof c === 'string' ? c : c.value)))
        .join('\n') ?? ''
    )
      .replace(/&nbsp;/g, ' ')
      .replace(/\\([^\w\s])/g, '$1');
  const hasTutorHover = (hovers: vscode.Hover[] | undefined) =>
    hoverText(hovers).includes('WatDatMean');
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
  const dashboard = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(folder.uri, 'dashboard.ts'),
  );
  for (const [code, meaning] of [
    ['board.addCompletedTasks(3);', 'argument 1 to board.addCompletedTasks'],
    ['console.log(weeklySummary(3));', 'argument 1 to weeklySummary'],
  ]) {
    const start = dashboard.getText().indexOf(code);
    for (const relative of [0, code.indexOf('.'), code.indexOf('3'), code.length - 1]) {
      const actual = await vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider',
        dashboard.uri,
        dashboard.positionAt(start + relative),
      );
      const content = hoverText(actual);
      assert.ok(content.includes(meaning), `Instant breakdown at ${code}:${relative}: ${content}`);
      assert.ok(content.includes('no AI tokens'));
      assert.ok(content.includes('command:watdatmean.inspect?'), 'Panel link is present for calls');
    }
  }
  const longCall = await vscode.workspace.openTextDocument({
    language: 'typescript',
    content: `log(${Array.from({ length: 30 }, (_, i) => i).join(', ')});`,
  });
  const tail = await vscode.commands.executeCommand<vscode.Hover[]>(
    'vscode.executeHoverProvider',
    longCall.uri,
    longCall.positionAt(longCall.getText().indexOf('29')),
  );
  assert.ok(
    hoverText(tail).includes('argument 30 to log'),
    'Long hovers include the piece under the cursor',
  );
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
  console.log(
    'PASS: activation, commands, hover, panel, cross-file references, test links, evidence bounds.',
  );
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}
