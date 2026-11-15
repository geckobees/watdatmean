import * as vscode from 'vscode';

/** A short-lived editor decoration; never changes the source or its selection. */
export class SourceLineHighlight implements vscode.Disposable {
  private decoration?: vscode.TextEditorDecorationType;
  private editor?: vscode.TextEditor;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;

  show(editor: vscode.TextEditor, range: vscode.Range) {
    this.clear();
    if (this.disposed || editor.document.isClosed) return;
    this.decoration ??= vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
      borderColor: new vscode.ThemeColor('editor.findMatchHighlightBorder'),
      borderWidth: '1px',
      borderStyle: 'solid',
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });
    this.editor = editor;
    editor.setDecorations(this.decoration, [range]);
    this.timer = setTimeout(() => this.clear(), 1200);
    this.timer.unref();
  }

  clear() {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.editor && this.decoration) {
      // Editors may have been closed before their decoration timer expires.
      try {
        this.editor.setDecorations(this.decoration, []);
      } catch {
        /* Already closed. */
      }
    }
    this.editor = undefined;
  }

  dispose() {
    this.disposed = true;
    this.clear();
    this.decoration?.dispose();
    this.decoration = undefined;
  }
}
