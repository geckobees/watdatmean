import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { activate } from '../src/extension';

const host = vi.hoisted(() => ({
  commands: new Map<string, (...args: any[]) => unknown>(),
  messages: [] as Record<string, any>[],
  comparisons: [] as { before: string; after: string; beforeUri: vscode.Uri }[],
  receive: undefined as ((message: unknown) => Promise<void>) | undefined,
  changed: undefined as ((event: vscode.TextDocumentChangeEvent) => void) | undefined,
  provider: undefined as vscode.TextDocumentContentProvider | undefined,
  hover: undefined as vscode.HoverProvider | undefined,
  editor: undefined as unknown as vscode.TextEditor,
  text: '',
  version: 1,
  confirm: vi.fn(),
  context: vi.fn(),
  readyOnLoad: false,
  subscriptions: [] as vscode.Disposable[],
  panels: [] as {
    disposed: boolean;
    html: string;
    receive?: (message: unknown) => Promise<void> | undefined;
    onDispose?: () => void;
  }[],
}));

vi.mock('../src/context', () => ({
  collectContext: host.context,
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
    MarkdownString: class {
      value = '';
      appendMarkdown(value: string) {
        this.value += value;
        return this;
      }
    },
    Hover: class {
      contents: unknown[];
      constructor(content: unknown) {
        this.contents = [content];
      }
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
    languages: {
      registerHoverProvider: (_selector: unknown, provider: vscode.HoverProvider) => {
        host.hover = provider;
        return disposable();
      },
    },
    workspace: {
      isTrusted: true,
      openTextDocument: async () => host.editor.document,
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
      createWebviewPanel: () => {
        const state: (typeof host.panels)[number] = { disposed: false, html: '' };
        host.panels.push(state);
        return {
          dispose() {
            state.disposed = true;
            state.onDispose?.();
          },
          reveal() {},
          onDidDispose: (callback: () => void) => {
            state.onDispose = callback;
            return disposable();
          },
          webview: {
            get html() {
              return state.html;
            },
            set html(html: string) {
              state.html = html;
              if (host.readyOnLoad) void state.receive?.({ type: 'ready' });
            },
            cspSource: 'test:',
            asWebviewUri: (uri: vscode.Uri) => uri,
            postMessage: (message: Record<string, unknown>) => {
              if (state.disposed) throw new Error('Webview is disposed');
              host.messages.push(message);
              return Promise.resolve(true);
            },
            onDidReceiveMessage: (callback: typeof host.receive) => {
              host.receive = callback;
              state.receive = callback;
              return disposable();
            },
          },
        };
      },
    },
  };
});

async function start(
  code = 'const score = 0;\nconst untouched = 9;',
  selection?: [number, number],
  language = 'typescript',
  ready = true,
) {
  host.text = code;
  const document = {
    uri: vscode.Uri.parse(
      'file:/test.' +
        ({ typescript: 'ts', python: 'py', javascript: 'js', java: 'java' }[language] ?? 'txt'),
    ),
    languageId: language,
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
    subscriptions: host.subscriptions,
    secrets: { get: async () => undefined },
  } as unknown as vscode.ExtensionContext);
  await host.commands.get('watdatmean.inspect')!();
  if (ready) await message({ type: 'ready' });
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
  host.hover = undefined;
  host.comparisons.length = 0;
  host.version = 1;
  host.confirm.mockReset().mockResolvedValue('Use this code');
  host.context
    .mockReset()
    .mockResolvedValue({ context: '', evidence: [], locations: new Map(), note: '' });
  host.panels.length = 0;
  host.readyOnLoad = false;
});

afterEach(() => {
  host.subscriptions.splice(0).forEach((subscription) => subscription.dispose());
  vi.useRealTimers();
});

describe('learning panel startup and recovery', () => {
  it('keeps Python language, origins, shifted ranges and preview safety when recovering', async () => {
    await start('import math as m\nscore = m.sqrt(9)\nprint(score)', [17, 34], 'python');
    await message({ type: 'preview', replacement: 'score = 7\n' });
    await externalEdit(0, 0, '# shifted\n');
    await host.commands.get('watdatmean.reopenPanel')!();
    await message({ type: 'ready' });
    const selection = last('selection');
    expect(selection.language).toBe('Python');
    expect(selection.code).toContain('score = m.sqrt(9)');
    expect(selection.start).toBe(27);
    expect(selection.parts.map((p: any) => p.detail).join(' ')).toContain('math');
    for (const part of selection.parts)
      expect(host.text.slice(part.start, part.end)).toBe(part.token);
    await message({ type: 'apply', replacement: 'score = 7\n' });
    expect(host.confirm).not.toHaveBeenCalled();
    expect(host.text).toContain('m.sqrt(9)');
  });
  it('catches ready even when the panel loads immediately', async () => {
    host.readyOnLoad = true;
    await start(
      'const glossary: Record<string, [string, string]> = {};',
      [0, 0],
      'typescript',
      false,
    );
    expect(last('selection').parts.map((p: { token: string }) => p.token)).toContain('Record');
    expect(host.panels).toHaveLength(1);
  });

  it('recreates a failed panel with the saved selection even when no text editor has focus', async () => {
    const code =
      'const glossary: Record<string, [string, string]> = { const: ["brief", "detail"] };';
    await start(code, [0, 0], 'typescript', false);
    const oldPanel = host.panels[0];
    const editor = host.editor;
    host.editor = undefined as unknown as vscode.TextEditor;
    await host.commands.get('watdatmean.reopenPanel')!();
    host.editor = editor;
    expect(oldPanel.disposed).toBe(true);
    expect(host.panels).toHaveLength(2);
    await message({ type: 'ready' });
    expect(last('selection').code).toBe(code);
    const count = host.messages.length;
    await oldPanel.receive?.({ type: 'ready' });
    expect(host.messages).toHaveLength(count);
  });

  it('offers recovery when startup stalls and stops prompting once the replacement loads', async () => {
    vi.useFakeTimers();
    await start(undefined, undefined, 'typescript', false);
    host.confirm.mockResolvedValueOnce('Reopen panel');
    await vi.advanceTimersByTimeAsync(10000);
    expect(host.confirm).toHaveBeenCalledWith(
      expect.stringContaining('ServiceWorker'),
      'Reopen panel',
    );
    expect(host.panels[0].disposed).toBe(true);
    expect(host.panels).toHaveLength(2);
    await message({ type: 'ready' });
    await vi.advanceTimersByTimeAsync(20000);
    expect(host.confirm).toHaveBeenCalledTimes(1);
    expect(last('selection').code).toBe('const score = 0;');
  });

  it('opens a normal panel at the current editor when nothing has been inspected yet', async () => {
    await start();
    host.panels[0].onDispose?.();
    await host.commands.get('watdatmean.reopenPanel')!();
    await message({ type: 'ready' });
    expect(last('selection').code).toBe('const score = 0;');
  });

  it('ignores an old comparison that finishes after a reopened panel starts a new one', async () => {
    await start();
    let finishOld!: (value: unknown) => void;
    let finishNew!: (value: unknown) => void;
    const context = { context: '', evidence: [], locations: new Map(), note: '' };
    host.context.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    );
    const old = message({ type: 'preview', replacement: 'const score = 1;' });
    await host.commands.get('watdatmean.reopenPanel')!();
    await message({ type: 'ready' });
    host.context.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishNew = resolve;
        }),
    );
    const current = message({ type: 'preview', replacement: 'const score = 2;' });
    finishOld(context);
    await old;
    expect(last('busy').value).toBe(true);
    expect(host.messages.filter((m) => m.type === 'preview')).toEqual([]);
    finishNew(context);
    await current;
    expect(last('preview').replacement).toBe('const score = 2;');
    expect(last('busy').value).toBe(false);
  });
});

describe('repeatable code experiments in the extension host', () => {
  it('opens Python, shows local origins, previews and applies a checked edit', async () => {
    await start('score = 3\nprint(score)', [0, 9], 'python');
    expect(last('selection').language).toBe('Python');
    expect(last('selection').parts.length).toBeGreaterThan(0);
    await message({ type: 'preview', replacement: 'score = (' });
    expect(last('preview').errors.length).toBeGreaterThan(0);
    await message({ type: 'preview', replacement: 'score = 7' });
    expect(last('preview').syntaxChecked).toBe(true);
    await message({ type: 'apply', replacement: 'score = 7' });
    expect(host.text).toBe('score = 7\nprint(score)');
    expect(last('selection').language).toBe('Python');
  });
  it('offers a Java diff but blocks apply without a matching local parser', async () => {
    await start('int score = 3;', [0, 14], 'java');
    expect(last('selection').language).toBe('Java');
    await message({ type: 'preview', replacement: 'int score = 7;' });
    expect(last('preview').syntaxChecked).toBe(false);
    await message({ type: 'apply', replacement: 'int score = 7;' });
    expect(last('error').message).toMatch(/preview|compare|changes/i);
    expect(host.confirm).not.toHaveBeenCalled();
    expect(host.text).toBe('int score = 3;');
  });
  it.each(['if True:\n    x=1\n  y=2', 'return 3', 'def f(x, x):\n return x'])(
    'blocks applying invalid Python even when the editor grammar recovers: %s',
    async (replacement) => {
      await start('score = 3\nprint(score)', [0, 22], 'python');
      await message({ type: 'preview', replacement });
      expect(last('preview').syntaxChecked).toBe(true);
      expect(last('preview').errors.length).toBeGreaterThan(0);
      await message({ type: 'apply', replacement });
      expect(host.confirm).not.toHaveBeenCalled();
      expect(host.text).toBe('score = 3\nprint(score)');
    },
  );
  it('closes the panel without sending messages to a disposed webview', async () => {
    await start();
    expect(() => {
      const panel = host.panels.at(-1)!;
      panel.disposed = true;
      panel.onDispose!();
    }).not.toThrow();
    await externalEdit(0, 0, '// changed after closing\n');
    expect(host.messages.filter((m) => m.type === 'error')).toEqual([]);
  });

  it('explains an interface line in the hover and opens that exact line from its panel link', async () => {
    const source = 'export interface Part {\n  token: string;\n  start?: number;\n}';
    await start(source, [0, 0]);
    const offset = source.indexOf('start?');
    const hover = await host.hover!.provideHover(
      host.editor.document,
      host.editor.document.positionAt(offset),
      {} as vscode.CancellationToken,
    );
    const content = (hover!.contents[0] as vscode.MarkdownString).value;
    expect(content).toContain('`start` is an optional property');
    expect(content).toContain('`?` means it can be left out');
    expect(content).toContain('Instant explanation · no AI tokens');
    expect(content).not.toContain('`Part` describes');
    const link = content.match(/command:watdatmean\.inspect\?([^\)]+)/)!;
    const args = JSON.parse(decodeURIComponent(link[1]));
    await host.commands.get('watdatmean.inspect')!(...args);
    expect(last('selection')).toMatchObject({
      code: 'start?: number;',
      start: offset,
      symbol: 'start',
    });
    expect(last('selection').parts.map((part: { token: string }) => part.token)).toEqual([
      'start',
      '?',
      ':',
      'number',
      ';',
    ]);

    // Trying a change from the focused panel must keep the neighboring members.
    await message({ type: 'preview', replacement: 'start?: string;' });
    expect(last('preview').errors).toEqual([]);
    await message({ type: 'apply', replacement: 'start?: string;' });
    expect(host.text).toBe(source.replace('start?: number;', 'start?: string;'));
    expect(last('selection').code).toBe('start?: string;');
  });

  it('sends the source offset so panel pieces stay aligned for code later in a file', async () => {
    const prefix = 'const note = "token: string";\n\n';
    const code = 'export interface Part {\n  token: string;\n}';
    await start(prefix + code, [prefix.length, prefix.length]);
    const selection = last('selection');
    expect(selection).toMatchObject({ code, start: prefix.length });
    for (const part of selection.parts)
      expect(code.slice(part.start - selection.start, part.end - selection.start)).toBe(part.token);
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
