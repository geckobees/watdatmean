import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { activate } from '../src/extension';

const host = vi.hoisted(() => ({
  commands: new Map<string, (...args: any[]) => unknown>(),
  messages: [] as Record<string, any>[],
  comparisons: [] as { before: string; after: string; beforeUri: vscode.Uri }[],
  receive: undefined as ((message: unknown) => Promise<void>) | undefined,
  changed: undefined as ((event: vscode.TextDocumentChangeEvent) => void) | undefined,
  provider: undefined as vscode.TextDocumentContentProvider | undefined,
  editor: undefined as unknown as vscode.TextEditor,
  text: '',
  version: 1,
  confirm: vi.fn(),
  closePanel: undefined as (() => void) | undefined,
  panelClosed: false,
}));

vi.mock('../src/context', () => ({
  collectContext: async () => ({ context: '', evidence: [], locations: new Map(), note: '' }),
}));

vi.mock('vscode', () => {
  const disposable = () => ({ dispose() {} });
  const uri = (value: string) => ({
    scheme: value.split(':')[0],
    path: value.slice(value.indexOf(':') + 1),
    toString: () => value,
  });
  return {
    Uri: {
      parse: uri,
      joinPath: (base: vscode.Uri, ...parts: string[]) =>
        uri([base.toString(), ...parts].join('/')),
    },
    Range: class {
      constructor(
        public start: vscode.Position,
        public end: vscode.Position,
      ) {}
    },
    WorkspaceEdit: class {
      changes: { range: vscode.Range; text: string }[] = [];
      replace(_uri: vscode.Uri, range: vscode.Range, text: string) {
        this.changes.push({ range, text });
      }
    },
    ViewColumn: { One: 1, Beside: 2 },
    StatusBarAlignment: { Right: 2 },
    commands: {
      registerCommand: (name: string, action: (...args: any[]) => unknown) => {
        host.commands.set(name, action);
        return disposable();
      },
      executeCommand: async (name: string, ...args: vscode.Uri[]) => {
        if (name === 'vscode.diff')
          host.comparisons.push({
            before: (await host.provider!.provideTextDocumentContent(
              args[0],
              {} as vscode.CancellationToken,
            )) as string,
            after: (await host.provider!.provideTextDocumentContent(
              args[1],
              {} as vscode.CancellationToken,
            )) as string,
            beforeUri: args[0],
          });
      },
    },
    languages: { registerHoverProvider: disposable },
    workspace: {
      isTrusted: true,
      registerTextDocumentContentProvider: (
        _scheme: string,
        provider: vscode.TextDocumentContentProvider,
      ) => {
        host.provider = provider;
        return disposable();
      },
      onDidChangeTextDocument: (callback: typeof host.changed) => {
        host.changed = callback;
        return disposable();
      },
      onDidCloseTextDocument: disposable,
      onDidChangeWorkspaceFolders: disposable,
      onDidChangeConfiguration: disposable,
      createFileSystemWatcher: () => ({
        ...disposable(),
        onDidCreate: disposable,
        onDidChange: disposable,
        onDidDelete: disposable,
      }),
      getConfiguration: () => ({ get: (_name: string, fallback: unknown) => fallback }),
      asRelativePath: (uri: vscode.Uri) => uri.path,
      applyEdit: async (edit: { changes: { range: vscode.Range; text: string }[] }) => {
        const document = host.editor.document;
        const changes = edit.changes.map((change) => ({
          ...change,
          rangeOffset: document.offsetAt(change.range.start),
          rangeLength: document.offsetAt(change.range.end) - document.offsetAt(change.range.start),
        }));
        for (const change of changes.sort((a, b) => b.rangeOffset - a.rangeOffset))
          host.text =
            host.text.slice(0, change.rangeOffset) +
            change.text +
            host.text.slice(change.rangeOffset + change.rangeLength);
        host.version++;
        host.changed!({ document, contentChanges: changes, reason: undefined });
        return true;
      },
    },
    window: {
      get activeTextEditor() {
        return host.editor;
      },
      createStatusBarItem: () => ({ ...disposable(), show() {}, hide() {} }),
      onDidChangeActiveTextEditor: disposable,
      showWarningMessage: host.confirm,
      showInformationMessage: vi.fn(),
      showTextDocument: async () => host.editor,
      createWebviewPanel: () => ({
        ...disposable(),
        reveal() {},
        onDidDispose: (callback: () => void) => {
          host.closePanel = () => {
            host.panelClosed = true;
            callback();
          };
          return disposable();
        },
        webview: {
          cspSource: 'test:',
          asWebviewUri: (uri: vscode.Uri) => uri,
          postMessage: (message: Record<string, unknown>) => {
            if (host.panelClosed) throw new Error('Webview is disposed');
            host.messages.push(message);
            return Promise.resolve(true);
          },
          onDidReceiveMessage: (callback: typeof host.receive) => {
            host.receive = callback;
            return disposable();
          },
        },
      }),
    },
  };
});

async function start(
  code = 'const score = 0;\nconst untouched = 9;',
  selection?: [number, number],
) {
  host.text = code;
  const document = {
    uri: vscode.Uri.parse('file:/test.ts'),
    languageId: 'typescript',
    isClosed: false,
    get version() {
      return host.version;
    },
    getText: () => host.text,
    positionAt: (offset: number) => {
      const lines = host.text.slice(0, offset).split('\n');
      return { line: lines.length - 1, character: lines.at(-1)!.length } as vscode.Position;
    },
    offsetAt: (position: vscode.Position) =>
      host.text
        .split('\n')
        .slice(0, position.line)
        .reduce((n, line) => n + line.length + 1, 0) + position.character,
  } as vscode.TextDocument;
  host.editor = {
    document,
    selection: {
      start: document.positionAt(selection?.[0] ?? code.indexOf('score')),
      end: document.positionAt(selection?.[1] ?? code.indexOf('score')),
    },
  } as vscode.TextEditor;
  activate({
    extensionUri: vscode.Uri.parse('file:/extension'),
    subscriptions: [],
    secrets: { get: async () => undefined },
  } as unknown as vscode.ExtensionContext);
  await host.commands.get('watdatmean.inspect')!();
  await message({ type: 'ready' });
}
const message = async (value: Record<string, unknown>) => host.receive!(value);
const last = (type: string) => host.messages.filter((m) => m.type === type).at(-1)!;
async function externalEdit(start: number, end: number, text: string) {
  const document = host.editor.document;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(document.positionAt(start), document.positionAt(end)),
    text,
  );
  await vscode.workspace.applyEdit(edit);
}

beforeEach(() => {
  host.commands.clear();
  host.messages.length = 0;
  host.comparisons.length = 0;
  host.version = 1;
  host.panelClosed = false;
  host.confirm.mockReset().mockResolvedValue('Use this code');
});

describe('repeatable code experiments in the extension host', () => {
  it('closes the panel without sending messages to a disposed webview', async () => {
    await start();
    expect(() => host.closePanel!()).not.toThrow();
    await externalEdit(0, 0, '// changed after closing\n');
    expect(host.messages.filter((m) => m.type === 'error')).toEqual([]);
  });

  it('compares repeatedly and recovers from syntax errors without modifying the file', async () => {
    await start();
    const original = host.text;
    for (const replacement of ['const score = 10;', 'const score = ;', 'const score = 200;']) {
      await message({ type: 'preview', replacement });
      expect(host.text).toBe(original);
      expect(host.comparisons.at(-1)?.before).toBe(original);
      expect(host.comparisons.at(-1)?.after).toBe(replacement + '\nconst untouched = 9;');
      expect(last('preview').errors.length > 0).toBe(replacement === 'const score = ;');
      expect(last('preview').replacement).toBe(replacement);
      expect(last('busy').value).toBe(false);
    }
    expect(host.messages.filter((m) => m.type === 'error')).toEqual([]);
    expect(
      await host.provider!.provideTextDocumentContent(
        host.comparisons[0].beforeUri,
        {} as vscode.CancellationToken,
      ),
    ).toBe(original);
  });

  it('uses each applied edit as the next baseline, including multiple statements and deletion', async () => {
    await start();
    const attempts = [
      'const score = 10;',
      'const score = 20;\nconsole.log(score);',
      '',
      'const score = 300;',
    ];
    for (const replacement of attempts) {
      const before = host.text;
      await message({ type: 'preview', replacement });
      expect(host.comparisons.at(-1)?.before).toBe(before);
      await message({ type: 'apply', replacement });
      expect(host.text).toBe(replacement + '\nconst untouched = 9;');
      expect(last('selection')).toMatchObject({ code: replacement, keepTab: true });
      expect(last('busy').value).toBe(false);
    }
    expect(host.messages.filter((m) => m.type === 'applied')).toHaveLength(attempts.length);
    expect(host.messages.filter((m) => m.type === 'error')).toEqual([]);
  });

  it('refreshes the same selected region after edits elsewhere and allows another comparison', async () => {
    const code = 'const before = 1;\nconst score = 0;\nconsole.log(score);\nconst untouched = 9;';
    const startOffset = code.indexOf('const score');
    const endOffset = code.indexOf('\nconst untouched');
    await start(code, [startOffset, endOffset]);
    await externalEdit(0, 0, '// added before the selection\n');
    await message({ type: 'refresh' });
    expect(last('selection')).toMatchObject({
      code: 'const score = 0;\nconsole.log(score);',
      keepTab: true,
    });
    await message({ type: 'preview', replacement: 'const score = 10;' });
    await message({ type: 'apply', replacement: 'const score = 10;' });
    expect(host.text).toBe(
      '// added before the selection\nconst before = 1;\nconst score = 10;\nconst untouched = 9;',
    );
    expect(host.messages.filter((m) => m.type === 'error')).toEqual([]);
  });

  it('still rejects a reviewed edit when the file changes during confirmation', async () => {
    await start();
    await message({ type: 'preview', replacement: 'const score = 10;' });
    host.confirm.mockImplementationOnce(async () => {
      await externalEdit(host.text.indexOf('0'), host.text.indexOf('0') + 1, '5');
      return 'Use this code';
    });
    await message({ type: 'apply', replacement: 'const score = 10;' });
    expect(host.text).toBe('const score = 5;\nconst untouched = 9;');
    expect(last('stale')).toMatchObject({ type: 'stale' });
    expect(host.messages.filter((m) => m.type === 'applied')).toEqual([]);
    expect(last('busy').value).toBe(false);
    await message({ type: 'refresh' });
    await message({ type: 'preview', replacement: 'const score = 10;' });
    await message({ type: 'apply', replacement: 'const score = 10;' });
    expect(last('selection').code).toBe('const score = 10;');
  });

  it('honors cancellation while an apply confirmation is open', async () => {
    await start();
    await message({ type: 'preview', replacement: 'const score = 10;' });
    host.confirm.mockImplementationOnce(async () => {
      await message({ type: 'cancel' });
      return 'Use this code';
    });
    await message({ type: 'apply', replacement: 'const score = 10;' });
    expect(host.text).toBe('const score = 0;\nconst untouched = 9;');
    expect(host.messages.filter((m) => m.type === 'applied')).toEqual([]);
    expect(last('busy').value).toBe(false);
    await message({ type: 'preview', replacement: 'const score = 20;' });
    expect(last('preview')).toMatchObject({ replacement: 'const score = 20;', errors: [] });
  });
});
