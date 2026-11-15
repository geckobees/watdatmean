import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { activate } from '../src/extension';
import * as provider from '../src/provider';
import type { Lesson } from '../src/types';
import { WebResearchService, RESEARCH_ENABLED_KEY, type WebResearch } from '../src/web-research';
import { VSCodeCodeColors } from '../src/vscode-code-colors';
import type { CodeColors } from '../src/code-colors';
import { BOOKMARKS_KEY } from '../src/resource-bookmarks';
vi.mock('../src/java-runtime-setup', () => ({ registerJavaRuntimeSetup: vi.fn() }));

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
  showDocument: vi.fn(),
  revealRange: vi.fn(),
  decorations: vi.fn(),
  decorationDispose: vi.fn(),
  createDecoration: vi.fn(),
  context: vi.fn(),
  readyOnLoad: false,
  history: undefined as unknown,
  bookmarks: undefined as unknown,
  webEnabled: false,
  openExternal: vi.fn(),
  key: undefined as string | undefined,
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
    env: { openExternal: host.openExternal },
    extensions: { all: [], onDidChange: disposable },
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
    Position: class {
      constructor(
        public line: number,
        public character: number,
      ) {}
    },
    Selection: class {
      constructor(
        public start: vscode.Position,
        public end: vscode.Position,
      ) {}
    },
    TextEditorRevealType: { InCenterIfOutsideViewport: 2 },
    DecorationRangeBehavior: { ClosedClosed: 1 },
    ThemeColor: class {
      constructor(public id: string) {}
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
      createTextEditorDecorationType: host.createDecoration,
      onDidChangeActiveColorTheme: disposable,
      get activeTextEditor() {
        return host.editor;
      },
      get visibleTextEditors() {
        return [host.editor];
      },
      createStatusBarItem: () => ({ ...disposable(), show() {}, hide() {} }),
      onDidChangeActiveTextEditor: disposable,
      showWarningMessage: host.confirm,
      showInformationMessage: vi.fn(),
      showTextDocument: host.showDocument,
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
    viewColumn: 3,
    options: { tabSize: 4 },
    revealRange: host.revealRange,
    setDecorations: host.decorations,
    selection: {
      start: document.positionAt(selection?.[0] ?? code.indexOf('score')),
      end: document.positionAt(selection?.[1] ?? code.indexOf('score')),
    },
  } as unknown as vscode.TextEditor;
  activate({
    extensionUri: vscode.Uri.parse('file:/extension'),
    subscriptions: host.subscriptions,
    secrets: { get: async () => host.key },
    workspaceState: {
      get: (key: string) =>
        key === RESEARCH_ENABLED_KEY
          ? host.webEnabled
          : key === BOOKMARKS_KEY
            ? host.bookmarks
            : host.history,
      update: async (key: string, value: unknown) => {
        if (key === RESEARCH_ENABLED_KEY) host.webEnabled = value === true;
        else if (key === BOOKMARKS_KEY) host.bookmarks = value;
        else host.history = value;
      },
    },
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
  host.showDocument.mockReset().mockImplementation(async () => host.editor);
  host.revealRange.mockReset();
  host.decorations.mockReset();
  host.decorationDispose.mockReset();
  host.createDecoration
    .mockReset()
    .mockReturnValue({ key: 'source-line', dispose: host.decorationDispose });
  host.context
    .mockReset()
    .mockResolvedValue({ context: '', evidence: [], locations: new Map(), note: '' });
  host.panels.length = 0;
  host.readyOnLoad = false;
  host.history = undefined;
  host.webEnabled = false;
  host.openExternal.mockReset().mockResolvedValue(true);
  host.key = undefined;
});

describe('project history adapter', () => {
  it.each(['cancel', 'edit'])(
    'does not save an explanation that finishes after %s',
    async (action) => {
      host.key = 'test-key';
      await start('const score = 2;', [0, 16]);
      let finish!: (lesson: Lesson) => void;
      const generated = vi.spyOn(provider, 'generate').mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const pending = message({ type: 'request', task: 'explain' });
      await vi.waitFor(() => expect(generated).toHaveBeenCalled());
      if (action === 'cancel') await message({ type: 'cancel' });
      else await externalEdit(14, 15, '3');
      finish({
        title: 'Old result',
        summary: 'A previous request.',
        steps: [],
        concepts: [],
        example: { code: '', explanation: '' },
        predictions: [],
        checks: [],
      });
      await pending;
      expect(last('history').entries).toEqual([]);
      expect(host.messages.filter((m) => m.type === 'lesson')).toEqual([]);
    },
  );
  it('stores a completed local lesson, updates it on repeat, and reloads it after panel recovery', async () => {
    host.key = 'test-key';
    await start('const score = 2;', [0, 16]);
    await message({ type: 'request', task: 'explain', mode: 'standalone', audience: 'beginner' });
    await vi.waitFor(() => expect(last('history').entries).toHaveLength(1));
    expect(last('history').entries[0].results.explain.lesson.local).toBe(true);
    await message({ type: 'request', task: 'explain', mode: 'standalone', audience: 'beginner' });
    await host.commands.get('watdatmean.reopenPanel')!();
    await message({ type: 'ready' });
    expect(last('history').entries).toHaveLength(1);
    const snapshot = last('history').entries[0];
    await message({ type: 'historyList' });
    expect(last('selection').code).toBe('const score = 2;');
    await message({ type: 'historyRemove', id: snapshot.id });
    expect(last('history').entries).toEqual([]);
  });
  it('does not save failed requests or selection changes and can pause saving', async () => {
    await start();
    await message({ type: 'request', task: 'explain' });
    expect(last('history').entries).toEqual([]);
    await message({ type: 'historyEnabled', enabled: false });
    expect(last('history').enabled).toBe(false);
  });
});

const webFixture: WebResearch = {
  topic: 'TypeScript variables',
  provider: 'openai',
  model: 'gpt-5-mini',
  checkedAt: 1,
  blocks: [
    { text: 'A variable names a value.', sourceUrls: ['https://www.typescriptlang.org/docs/'] },
  ],
  sources: [
    {
      url: 'https://www.typescriptlang.org/docs/',
      title: 'TypeScript docs',
      kind: 'Documentation',
    },
  ],
  searches: 1,
  cached: false,
  usage: { input: 20, output: 10, total: 30 },
};
describe('VS Code optional web adapter', () => {
  it('forwards version/filter, saves only retrieved sources, and retains bookmarks after history clearing', async () => {
    host.bookmarks = undefined;
    host.key = 'test-key';
    await start('const score = 2;', [0, 16]);
    const options = { version: 'TypeScript 5.9', filter: 'docs' as const };
    const search = vi
      .spyOn(WebResearchService.prototype, 'search')
      .mockResolvedValue({ ...webFixture, options });
    await message({ type: 'researchToggle', enabled: true });
    await message({ type: 'research', topic: 'TypeScript variables', options });
    expect(search.mock.calls[0][5]).toEqual(options);
    await message({ type: 'bookmarkAdd', url: 'https://invented.example.com/' });
    expect(last('bookmarks').entries).toEqual([]);
    await message({ type: 'bookmarkAdd', url: webFixture.sources[0].url, title: 'Spoofed title' });
    expect(last('bookmarks').entries[0]).toMatchObject({
      ...webFixture.sources[0],
      version: 'TypeScript 5.9',
    });
    await message({ type: 'historyClear' });
    await message({ type: 'bookmarkList' });
    expect(last('bookmarks').entries).toHaveLength(1);
    await message({ type: 'bookmarkRemove', url: webFixture.sources[0].url });
    expect(last('bookmarks').entries).toHaveLength(0);
    expect(search).toHaveBeenCalledTimes(1);
  });
  it('stays off by default, saves a supplement with its lesson, and only opens known public sources', async () => {
    host.key = 'test-key';
    await start('const score = 2;', [0, 16]);
    const search = vi.spyOn(WebResearchService.prototype, 'search').mockResolvedValue(webFixture);
    await message({ type: 'research', topic: 'TypeScript variables' });
    expect(search).not.toHaveBeenCalled();
    await message({ type: 'request', task: 'explain' });
    await message({ type: 'researchToggle', enabled: true });
    await message({ type: 'research', topic: 'TypeScript variables', audience: 'beginner' });
    expect(last('research').result).toEqual(webFixture);
    await vi.waitFor(() =>
      expect(last('history').entries[0].results.explain.research).toEqual(webFixture),
    );
    expect(last('lesson').lesson.local).toBe(true);
    await message({ type: 'openWebSource', url: 'command:run' });
    await message({ type: 'openWebSource', url: 'https://invented.example.com/' });
    expect(host.openExternal).not.toHaveBeenCalled();
    await message({ type: 'openWebSource', url: webFixture.sources[0].url });
    expect(host.openExternal).toHaveBeenCalledTimes(1);
    expect(host.webEnabled).toBe(true);
  });
  it('keeps a completed lesson when research fails', async () => {
    host.key = 'test-key';
    await start('const score = 2;', [0, 16]);
    await message({ type: 'request', task: 'explain' });
    await message({ type: 'researchToggle', enabled: true });
    vi.spyOn(WebResearchService.prototype, 'search').mockRejectedValue(
      new Error('Web research is unavailable.'),
    );
    await message({ type: 'research', topic: 'TypeScript variables' });
    expect(last('researchError').message).toContain('unavailable');
    expect(last('lesson').lesson.local).toBe(true);
    expect(host.messages.filter((m) => m.type === 'error')).toEqual([]);
  });
  it.each(['off', 'edit', 'cancel'])('drops late web results after %s', async (action) => {
    host.key = 'test-key';
    await start('const score = 2;', [0, 16]);
    await message({ type: 'request', task: 'explain' });
    await message({ type: 'researchToggle', enabled: true });
    let finish!: (r: WebResearch) => void;
    const search = vi.spyOn(WebResearchService.prototype, 'search').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = message({ type: 'research', topic: 'TypeScript variables' });
    await vi.waitFor(() => expect(search).toHaveBeenCalled());
    if (action === 'off') await message({ type: 'researchToggle', enabled: false });
    else if (action === 'edit') await externalEdit(14, 15, '3');
    else await message({ type: 'cancel' });
    finish(webFixture);
    await pending;
    expect(host.messages.filter((m) => m.type === 'research')).toEqual([]);
    expect(last('history').entries[0].results.explain.research).toBeUndefined();
  });
});

afterEach(() => {
  host.subscriptions.splice(0).forEach((subscription) => subscription.dispose());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('progressive native colors', () => {
  it('colors the displayed snapshot after a file edit while keeping live semantic data out', async () => {
    await start();
    const code = last('selection').code;
    const colorize = vi
      .spyOn(VSCodeCodeColors.prototype, 'colorize')
      .mockResolvedValue({ runs: [[0, 5, 0]], styles: [{ color: '#112233', font: 0 }] });
    vi.spyOn(VSCodeCodeColors.prototype, 'withSemantic').mockImplementation(async (base) => base);
    await externalEdit(0, 0, '// added after snapshot\n');
    await message({ type: 'highlight', id: 19, target: 'source', code });
    expect(last('highlight')).toMatchObject({ id: 19, code });
    expect(colorize.mock.calls[0][0]).not.toContain('// added after snapshot');
  });
  it('colors independent snapshots in their own language without active-file semantic results', async () => {
    await start();
    const colorize = vi
      .spyOn(VSCodeCodeColors.prototype, 'colorize')
      .mockResolvedValue({ runs: [], styles: [] });
    const semantic = vi.spyOn(VSCodeCodeColors.prototype, 'withSemantic');
    const code = 'int saved = 2;';
    await message({ type: 'highlight', id: 20, target: 'block-20', code, language: 'Java' });
    expect(colorize).toHaveBeenCalledWith(code, 'java', 0, code.length);
    expect(semantic).not.toHaveBeenCalled();
    expect(last('highlight')).toMatchObject({ id: 20, target: 'block-20', code });
    await message({
      type: 'highlight',
      id: 21,
      target: 'block-21',
      code: 'x'.repeat(50001),
      language: 'Java',
    });
    expect(colorize).toHaveBeenCalledTimes(1);
  });
  it('sends syntax immediately and then semantic colors using the same request identity', async () => {
    await start();
    const base: CodeColors = { runs: [[0, 5, 0]], styles: [{ color: '#112233', font: 0 }] };
    const enhanced: CodeColors = { runs: [[0, 5, 0]], styles: [{ color: '#445566', font: 0 }] };
    vi.spyOn(VSCodeCodeColors.prototype, 'colorize').mockResolvedValue(base);
    let complete!: (value: CodeColors) => void;
    vi.spyOn(VSCodeCodeColors.prototype, 'withSemantic').mockReturnValue(
      new Promise((resolve) => (complete = resolve)),
    );
    const code = last('selection').code;
    const pending = message({ type: 'highlight', id: 7, target: 'source', code });
    await vi.waitFor(() =>
      expect(last('highlight')).toMatchObject({ id: 7, code, styles: base.styles }),
    );
    complete(enhanced);
    await pending;
    expect(host.messages.filter((m) => m.type === 'highlight')).toEqual([
      { type: 'highlight', id: 7, target: 'source', code, ...base },
      { type: 'highlight', id: 7, target: 'source', code, ...enhanced },
    ]);
  });
  it('does not send delayed semantic colors after the selected document changes', async () => {
    await start();
    const base: CodeColors = { runs: [[0, 5, 0]], styles: [{ color: '#112233', font: 0 }] };
    vi.spyOn(VSCodeCodeColors.prototype, 'colorize').mockResolvedValue(base);
    let complete!: (value: CodeColors) => void;
    vi.spyOn(VSCodeCodeColors.prototype, 'withSemantic').mockReturnValue(
      new Promise((resolve) => (complete = resolve)),
    );
    const pending = message({
      type: 'highlight',
      id: 8,
      target: 'source',
      code: last('selection').code,
    });
    await vi.waitFor(() => expect(last('highlight')).toMatchObject({ id: 8 }));
    await externalEdit(0, 0, '// new context\n');
    complete({ ...base, styles: [{ color: '#445566', font: 0 }] });
    await pending;
    expect(host.messages.filter((m) => m.type === 'highlight')).toHaveLength(1);
  });
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
    expect(last('selection').line).toBe(2);
    await externalEdit(0, 0, '// added before the selection\n');
    await message({ type: 'refresh' });
    expect(last('selection')).toMatchObject({
      code: 'const score = 0;\nconsole.log(score);',
      line: 3,
      keepTab: true,
    });
    await message({ type: 'preview', replacement: 'const score = 10;' });
    await message({ type: 'apply', replacement: 'const score = 10;' });
    expect(host.text).toBe(
      '// added before the selection\nconst before = 1;\nconst score = 10;\nconst untouched = 9;',
    );
    expect(host.messages.filter((m) => m.type === 'error')).toEqual([]);
  });

  it('gets selection line numbers from the complete CRLF document, including distant prefixes', async () => {
    const prefix = '// earlier code\r\n'.repeat(1600);
    const selected = 'const score = 1;\r\nconsole.log(score);';
    await start(prefix + selected + '\r\n// later code', [
      prefix.length,
      prefix.length + selected.length,
    ]);
    expect(last('selection')).toMatchObject({ code: selected, start: prefix.length, line: 1601 });
    await externalEdit(0, 0, '// new first line\r\n');
    await message({ type: 'refresh' });
    expect(last('selection')).toMatchObject({ code: selected, line: 1602 });
  });

  it('keeps the complete selected file available for line numbering beyond the part limit', async () => {
    const code = Array.from({ length: 400 }, (_, i) => `const value${i} = ${i};`).join('\n');
    await start(code, [0, code.length]);
    expect(last('selection')).toMatchObject({ code, start: 0, line: 1 });
    expect(last('selection').parts.length).toBeLessThan(400);
  });

  it('opens the captured source at the clicked line and reuses its editor column without editing', async () => {
    const prefix = '// before\r\n// 😀\r\n';
    const selected = 'const score = 1;\r\nconsole.log(score);';
    await start(prefix + selected + '\r\n// after', [
      prefix.length,
      prefix.length + selected.length,
    ]);
    const before = host.text;
    await message({
      type: 'openSourceLine',
      selectionId: last('selection').selectionId,
      line: 4,
      uri: 'file:/unrelated.ts',
    });
    expect(host.showDocument).toHaveBeenCalledWith(host.editor.document, {
      viewColumn: 3,
      preserveFocus: false,
    });
    expect(host.editor.selection).toMatchObject({
      start: { line: 3, character: 0 },
      end: { line: 3, character: 0 },
    });
    expect(host.revealRange).toHaveBeenCalledWith(
      expect.objectContaining({ start: { line: 3, character: 0 } }),
      vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    );
    expect(host.text).toBe(before);
    expect(host.context).not.toHaveBeenCalled();
  });

  it('briefly highlights the destination, restarts on another click, and preserves the code', async () => {
    const code = 'const score = 1;\nconsole.log(score);';
    await start(code, [0, code.length]);
    vi.useFakeTimers();
    const selectionId = last('selection').selectionId;
    await message({ type: 'openSourceLine', selectionId, line: 1 });
    expect(host.createDecoration).toHaveBeenCalledWith(
      expect.objectContaining({
        isWholeLine: true,
        backgroundColor: { id: 'editor.findMatchHighlightBackground' },
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      }),
    );
    expect(host.decorations.mock.calls.at(-1)![1][0].start).toEqual({ line: 0, character: 0 });
    await vi.advanceTimersByTimeAsync(800);
    await message({ type: 'openSourceLine', selectionId, line: 2 });
    await vi.advanceTimersByTimeAsync(400);
    expect(host.decorations.mock.calls.at(-1)![1][0].start).toEqual({ line: 1, character: 0 });
    await vi.advanceTimersByTimeAsync(800);
    expect(host.decorations.mock.calls.at(-1)![1]).toEqual([]);
    expect(host.text).toBe(code);
    expect(host.createDecoration).toHaveBeenCalledOnce();
  });

  it('clears destination highlighting on source edits and disposes its decoration', async () => {
    await start();
    await message({ type: 'openSourceLine', selectionId: last('selection').selectionId, line: 1 });
    await externalEdit(0, 0, '// changed\n');
    expect(host.decorations.mock.calls.at(-1)![1]).toEqual([]);
    host.subscriptions.splice(0).forEach((item) => item.dispose());
    expect(host.decorationDispose).toHaveBeenCalledOnce();
  });

  it('uses the original editor tab width in the panel selection', async () => {
    await start();
    expect(last('selection').tabSize).toBe(4);
    host.editor.options.tabSize = 8;
    await message({ type: 'refresh' });
    expect(last('selection').tabSize).toBe(8);
  });

  it('navigates back to the original file even when another editor is active', async () => {
    await start('const score = 1;', [0, 16]);
    const original = host.editor;
    host.editor = {
      ...original,
      document: { ...original.document, uri: vscode.Uri.parse('file:/other.ts') },
    } as vscode.TextEditor;
    host.showDocument.mockResolvedValue(original);
    await message({ type: 'openSourceLine', selectionId: last('selection').selectionId, line: 1 });
    expect(host.showDocument).toHaveBeenCalledWith(original.document, {
      viewColumn: vscode.ViewColumn.One,
      preserveFocus: false,
    });
    expect(original.selection.start).toEqual({ line: 0, character: 0 });
  });

  it('ignores malformed, out-of-selection and old-selection line navigation', async () => {
    const code = '// before\nconst score = 1;\n// after';
    await start(code, [code.indexOf('const'), code.indexOf('\n// after')]);
    const selectionId = last('selection').selectionId;
    for (const line of [0, -1, 1, 3, 2.5, '2', null, Infinity, Number.MAX_SAFE_INTEGER])
      await message({ type: 'openSourceLine', selectionId, line });
    for (const id of [undefined, null, '1', 0, -1, selectionId + 1])
      await message({ type: 'openSourceLine', selectionId: id, line: 2 });
    expect(host.showDocument).not.toHaveBeenCalled();
  });

  it('requires current source positions and rejects old links after refreshing', async () => {
    await start('const score = 1;', [0, 16]);
    const selectionId = last('selection').selectionId;
    await externalEdit(0, 0, '// shifted\n');
    await message({ type: 'openSourceLine', selectionId, line: 1 });
    expect(host.showDocument).not.toHaveBeenCalled();
    expect(last('error').message).toContain('Use latest code');
    await message({ type: 'refresh' });
    await message({ type: 'openSourceLine', selectionId, line: 2 });
    expect(host.showDocument).not.toHaveBeenCalled();
    await message({ type: 'openSourceLine', selectionId: last('selection').selectionId, line: 2 });
    expect(host.revealRange).toHaveBeenCalledOnce();
    expect(host.editor.selection.start).toEqual({ line: 1, character: 0 });
  });

  it('does not move the caret if the document changes while its editor is opening', async () => {
    await start('const score = 1;', [0, 16]);
    const before = host.editor.selection;
    host.showDocument.mockImplementationOnce(async () => {
      await externalEdit(0, 0, '// shifted\n');
      return host.editor;
    });
    await message({ type: 'openSourceLine', selectionId: last('selection').selectionId, line: 1 });
    expect(host.revealRange).not.toHaveBeenCalled();
    expect(host.editor.selection).toBe(before);
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
