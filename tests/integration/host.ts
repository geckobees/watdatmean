import * as vscode from 'vscode';
import { checkNativeColors } from './colors';
import { checkLineHighlight } from './line-highlight';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { inspect } from '../../src/analyzer';
import { collectContext } from '../../src/context';
import { generate } from '../../src/provider';
import { wombRequest, wombOutput } from '../quality/depth-cases';
import { javaGeneralCases } from '../quality/java-general-cases';
import { javaControlCases } from '../quality/java-control-cases';
import { javaArrayExceptionCases } from '../quality/java-array-exception-cases';
import { javaStreamCases } from '../quality/java-stream-cases';
import { javaMethodOptionalCases } from '../quality/java-method-optional-cases';
import { javaGenericInterfaceCases } from '../quality/java-generic-interface-cases';

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
  await checkNativeColors(extension.extensionUri);
  await checkLineHighlight();
  for (const [code, corrected, expected] of [
    ['int n = 2\nSystem.out.println(n);', 'int n = 2;\nSystem.out.println(n);', '2\n'],
    ['System.out.println(3;', 'System.out.println(3);', '3\n'],
  ]) {
    const lesson = await generate(
      'groq',
      'test',
      'unused',
      { ...wombRequest, code },
      undefined,
      async () => {
        throw new Error('Java syntax repair must stay local');
      },
    );
    assert.equal(lesson.syntax?.corrected, corrected);
    assert.equal(lesson.output?.text, expected);
    assert.equal(lesson.usage?.total, 0);
  }
  const missing = await generate(
    'groq',
    'test',
    'unused',
    { ...wombRequest, code: 'int n = ;' },
    undefined,
    async () => {
      throw new Error('A missing Java value must not be guessed');
    },
  );
  assert.ok(missing.syntax?.issues.join(' ').includes('missing a value'));
  assert.equal(missing.syntax?.corrected, undefined);
  assert.equal(missing.usage?.total, 0);
  console.log(
    'PASS: real VS Code Java syntax warnings, rechecked fixes, corrected explanation, missing-value guard, zero tokens',
  );
  const javaLesson = await generate(
    'groq',
    'qwen/qwen3.8-27b',
    'unused',
    wombRequest,
    undefined,
    async () => {
      throw new Error('Local Java trace must not use the network');
    },
  );
  assert.equal(javaLesson.output?.text, wombOutput);
  assert.equal(javaLesson.usage?.total, 0);
  assert.equal(javaLesson.steps.length, 4);
  assert.ok(javaLesson.steps.join(' ').includes('x.s → A.s="A"'));
  console.log(
    'PASS: Java field hiding, constructor order and complete output in VS Code host (zero API tokens)',
  );
  const javaCases = [
    ...javaGeneralCases,
    ...javaControlCases,
    ...javaArrayExceptionCases,
    ...javaStreamCases,
    ...javaMethodOptionalCases,
    ...javaGenericInterfaceCases,
  ];
  for (const fixture of javaCases) {
    const lesson = await generate(
      'groq',
      'qwen/qwen3.8-27b',
      'unused',
      { ...wombRequest, code: fixture.code },
      undefined,
      async () => {
        throw new Error('General Java must not use the network');
      },
    );
    assert.equal(lesson.output?.text, fixture.expected, fixture.id);
    assert.equal(lesson.usage?.total, 0, fixture.id);
  }
  console.log(
    `PASS: ${javaCases.length} independent Java examples including arrays and exception handling in VS Code host, all at zero tokens`,
  );
  const commands = await vscode.commands.getCommands();
  for (const name of [
    'inspect',
    'reopenPanel',
    'configure',
    'removeKey',
    'clearCache',
    'demo',
    'checkJavaRuntime',
    'restoreJavaRuntime',
  ])
    assert.ok(commands.includes(`watdatmean.${name}`));
  const typeDocument = await vscode.workspace.openTextDocument({
    language: 'typescript',
    content:
      'export interface Options {\n  label?: string;\n}\ntype Record<K,V> = [K,V];\nconst pair: Record<string, number> = value;',
  });
  for (const [token, expected] of [
    ['label?', 'optional property'],
    ['const pair', 'Record<string, number>'],
  ]) {
    const hover = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      typeDocument.uri,
      typeDocument.positionAt(typeDocument.getText().indexOf(token)),
    );
    assert.ok(
      hoverText(hover).includes(expected),
      'Merged type explanations appear in the actual hover',
    );
    assert.ok(!hoverText(hover).includes('text keys'), 'Custom Record retains its own meaning');
  }
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
    ['board.addCompletedTasks(3);', '`3` as its input'],
    ['console.log(weeklySummary(3));', 'The outer call, `console.log(…)`'],
    ['console.log(board.getLevel());', 'The inner call, `board.getLevel()`'],
    ['const board = new Scoreboard();', '`board` holds a reference to that object'],
    [
      'export function weeklySummary(completedTasks: number): string',
      '`completedTasks` (a number)',
    ],
  ]) {
    const start = dashboard.getText().indexOf(code);
    for (const relative of [
      0,
      code.indexOf('.'),
      code.indexOf('('),
      code.lastIndexOf(')'),
      code.length - 1,
    ]) {
      if (relative < 0) continue;
      const actual = await vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider',
        dashboard.uri,
        dashboard.positionAt(start + relative),
      );
      const content = hoverText(actual?.filter((hover) => hasTutorHover([hover])));
      assert.ok(content.includes(meaning), `Instant breakdown at ${code}:${relative}: ${content}`);
      assert.ok(content.includes('no AI tokens'));
      assert.ok(content.includes('command:watdatmean.inspect?'), 'Panel link is present for calls');
      assert.ok(
        !/^\s*(?:[-*]|\d+\.)\s/m.test(content),
        'Hover contains no bullet or numbered lists',
      );
      assert.ok(!content.includes(' — '), 'Hover contains no token-by-token rows');
      if (code === 'console.log(board.getLevel());') {
        assert.ok(content.indexOf('The outer call') > content.indexOf('The inner call'));
        assert.ok(content.includes('`board` (initially a `Scoreboard` object)'));
        assert.ok(
          content.includes("built-in `console` object's `log` method to display that result"),
        );
      }
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
    hoverText(tail).includes('`29` is input 30 to `log`'),
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
  for (const [language, content] of [
    ['python', 'import math as m\nscore = m.sqrt(9)\nprint(score)'],
    ['javascript', 'const score = 3; console.log(score);'],
    ['javascriptreact', 'const view = <button>Hi</button>;'],
    ['java', 'class Demo { int score = 3; }'],
    ['csharp', 'int score = 3;'],
    ['go', 'package main\nfunc main() { score := 3; _ = score }'],
    ['rust', 'fn main() { let score = 3; }'],
  ]) {
    const file = await vscode.workspace.openTextDocument({ language, content });
    const editor = await vscode.window.showTextDocument(file);
    const at = file.positionAt(Math.max(0, content.indexOf('score')));
    editor.selection = new vscode.Selection(at, at);
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      file.uri,
      at,
    );
    assert.ok(hasTutorHover(hovers), `WatDatMean hover link available for ${language}`);
    await vscode.commands.executeCommand('watdatmean.inspect');
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  }
  console.log(
    'PASS: activation, commands, hover, panel, cross-file references, test links, evidence bounds.',
  );
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}
