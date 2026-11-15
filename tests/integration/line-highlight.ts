import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { SourceLineHighlight } from '../../src/source-line-highlight';

export async function checkLineHighlight() {
  const document = await vscode.workspace.openTextDocument({
    language: 'typescript',
    content: 'const first = 1;\n\nconst second = 2;',
  });
  const editor = await vscode.window.showTextDocument(document);
  const before = editor.selection;
  const calls: vscode.Range[][] = [];
  // Forward to the real editor API, while observing expiration of its decoration.
  // VS Code freezes its editor facade. Wrap the two used members rather than
  // proxying/overriding its non-configurable properties.
  const observed = {
    document,
    setDecorations(type: vscode.TextEditorDecorationType, ranges: vscode.Range[]) {
      calls.push(ranges);
      editor.setDecorations(type, ranges);
    },
  } as unknown as vscode.TextEditor;
  const highlight = new SourceLineHighlight();
  try {
    highlight.show(observed, new vscode.Range(1, 0, 1, 0));
    assert.equal(calls.at(-1)?.[0].start.line, 1, 'An empty destination line can be highlighted');
    highlight.show(observed, new vscode.Range(2, 0, 2, 0));
    assert.equal(calls.at(-2)?.length, 0, 'The previous decoration is cleared on another jump');
    assert.equal(calls.at(-1)?.[0].start.line, 2);
    await new Promise((resolve) => setTimeout(resolve, 1450));
    assert.equal(calls.at(-1)?.length, 0, 'The real editor decoration expires automatically');
    assert.equal(document.getText(), 'const first = 1;\n\nconst second = 2;');
    assert.ok(
      editor.selection.isEqual(before),
      'Highlighting does not replace the native caret/selection',
    );
    highlight.show(observed, new vscode.Range(0, 0, 0, 0));
  } finally {
    highlight.dispose();
  }
  assert.equal(calls.at(-1)?.length, 0, 'Disposal clears the active decoration');
  console.log(
    'PASS: real VS Code transient destination highlight, blank lines, repeated jumps, timeout and disposal without edits or selection changes',
  );
}
