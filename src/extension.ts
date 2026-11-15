import { panelHtml } from './panel';
import { assertPreviewCurrent, trackRange, validateReplacement, type OffsetRange } from './edit';
import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { inspectCode, checkSyntax, languageLabel, languageId, learningContext } from './languages';
import { Cache, fingerprint, LESSON_CACHE_VERSION } from './cache';
import { RecentHistory, HISTORY_KEY, type HistoryEntry } from './history';
import {
  WebResearchService,
  RESEARCH_ENABLED_KEY,
  publicWebUrl,
  researchModels,
  type WebResearch,
} from './web-research';
import { collectContext, type ContextResult } from './context';
import { defaults, generate } from './provider';
import type { Audience, LearningRequest, Lesson, Mode, Provider, Snippet, Task } from './types';
import { registerJavaRuntimeSetup } from './java-runtime-setup';
import { VSCodeCodeColors } from './vscode-code-colors';
import { SourceLineHighlight } from './source-line-highlight';
import { ResourceBookmarks, BOOKMARKS_KEY } from './resource-bookmarks';
import { detectResearchVersions } from './research-versions';
import { readVersionManifests } from './research-manifests';
import { researchOptions } from './web-research';

interface Selection {
  document: vscode.TextDocument;
  source: string;
  version: number;
  snippet: Snippet;
  range: OffsetRange;
}

export function activate(context: vscode.ExtensionContext) {
  registerJavaRuntimeSetup(context);
  const app = new Tutor(context);
  context.subscriptions.push(app);
  for (const [name, action] of Object.entries({
    inspect: (args?: { uri: string; offset: number }) => app.inspectEditor(args),
    reopenPanel: () => app.reopenPanel(),
    configure: () => app.configure(),
    removeKey: () => app.removeKey(),
    clearCache: () => app.clearCache(),
    demo: () =>
      vscode.commands.executeCommand(
        'vscode.openFolder',
        vscode.Uri.joinPath(context.extensionUri, 'demo'),
        { forceNewWindow: true },
      ),
  }))
    context.subscriptions.push(vscode.commands.registerCommand(`watdatmean.${name}`, action));
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      [
        'typescript',
        'typescriptreact',
        'javascript',
        'javascriptreact',
        'python',
        'java',
        'kotlin',
        'csharp',
        'cpp',
        'c',
        'go',
        'rust',
        'ruby',
        'php',
        'swift',
        'sql',
      ].map((language) => ({ language })),
      {
        provideHover(document, position) {
          if (document.getText().length > 500000) return;
          const offset = document.offsetAt(position);
          const snippet = inspectCode(document.getText(), offset, offset, document.languageId);
          const md = new vscode.MarkdownString();
          md.appendMarkdown(`**WatDatMean** · ${languageLabel(document.languageId)}\n\n`);
          if (snippet.explanation) {
            md.appendMarkdown(`${snippet.explanation}\n\n`);
            md.appendMarkdown('*Instant explanation · no AI tokens*\n\n');
          } else
            md.appendMarkdown('Open the learning panel to explore this code and try changes.\n\n');
          const args = encodeURIComponent(
            JSON.stringify([{ uri: document.uri.toString(), offset: document.offsetAt(position) }]),
          );
          md.appendMarkdown(`[Wat Dat Mean? →](command:watdatmean.inspect?${args})`);
          md.isTrusted = { enabledCommands: ['watdatmean.inspect'] };
          return new vscode.Hover(md);
        },
      },
    ),
  );
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 20);
  status.text = '$(lightbulb) WatDatMean';
  status.command = 'watdatmean.inspect';
  status.tooltip = 'Understand code at your cursor';
  const update = () =>
    vscode.window.activeTextEditor &&
    vscode.window.activeTextEditor.document.uri.scheme !== 'watdatmean'
      ? status.show()
      : status.hide();
  context.subscriptions.push(status, vscode.window.onDidChangeActiveTextEditor(update));
  update();
}

class Tutor implements vscode.Disposable {
  private history: RecentHistory;
  private bookmarks: ResourceBookmarks;
  private research = new WebResearchService();
  private researchEnabled = false;
  private researchRunning = false;
  private latestResearch?: WebResearch;
  private lastExplanation?: {
    selection: Selection;
    source: Omit<HistoryEntry, 'id' | 'updatedAt' | 'results'>;
    task: Task;
    lesson: Lesson;
  };
  private panel?: vscode.WebviewPanel;
  private panelReady = false;
  private panelLoadTimer?: ReturnType<typeof setTimeout>;
  private selection?: Selection;
  private selectionId = 0;
  private lineHighlight = new SourceLineHighlight();
  private cache = new Cache<Lesson>();
  private abort?: AbortController;
  private busy = false;
  private revision = 0;
  private evidence?: ContextResult;
  private preview?: { replacement: string; revision: number };
  private virtual = new Map<string, string>();
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly extension: vscode.ExtensionContext) {
    this.researchEnabled = extension.workspaceState?.get(RESEARCH_ENABLED_KEY) === true;
    this.history = new RecentHistory(
      extension.workspaceState?.get(HISTORY_KEY),
      (state) => extension.workspaceState?.update(HISTORY_KEY, state) ?? Promise.resolve(),
    );
    this.bookmarks = new ResourceBookmarks(
      extension.workspaceState?.get(BOOKMARKS_KEY),
      (state) => extension.workspaceState?.update(BOOKMARKS_KEY, state) ?? Promise.resolve(),
    );
    this.colors = new VSCodeCodeColors(extension.extensionUri);
    this.disposables.push(
      this.colors,
      this.lineHighlight,
      vscode.window.onDidChangeActiveColorTheme(() => this.refreshColors()),
    );
    this.disposables.push(vscode.extensions.onDidChange(() => this.refreshColors()));
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration('editor.tokenColorCustomizations') ||
          event.affectsConfiguration('editor.semanticTokenColorCustomizations') ||
          event.affectsConfiguration('editor.semanticHighlighting') ||
          event.affectsConfiguration('workbench.colorCustomizations') ||
          event.affectsConfiguration('workbench.colorTheme')
        )
          this.refreshColors();
      }),
    );
    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider('watdatmean', {
        provideTextDocumentContent: (uri) => this.virtual.get(uri.toString()) ?? '',
      }),
    );
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (!event.contentChanges.length || event.document.uri.scheme === 'watdatmean') return;
        if (this.selection?.document.uri.toString() === event.document.uri.toString()) {
          if (this.selection.version === event.document.version) return;
          this.selection.range = trackRange(this.selection.range, event.contentChanges);
        }
        this.invalidate(event.document.uri);
      }),
    );
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    const onFileChange = (uri: vscode.Uri) => {
      if (
        !/(?:^|\/)(?:node_modules|\.git|\.idea|\.venv|venv|__pycache__|dist|build|target|vendor)\//i.test(
          uri.path,
        )
      )
        this.invalidate(uri);
    };
    this.disposables.push(
      watcher,
      watcher.onDidCreate(onFileChange),
      watcher.onDidChange(onFileChange),
      watcher.onDidDelete(onFileChange),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.invalidate()),
      vscode.workspace.onDidCloseTextDocument((document) => {
        if (document.uri.scheme === 'watdatmean') this.virtual.delete(document.uri.toString());
        else if (document === this.selection?.document) this.invalidate(document.uri);
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration('watdatmean')) return;
        this.cancelRequest();
        this.cache.clear();
        this.research.clear();
        void this.sendConfig();
      }),
    );
  }

  private cancelRequest() {
    this.researchRunning = false;
    this.abort?.abort();
    this.abort = undefined;
    this.busy = false;
    this.send({ type: 'busy', value: false });
  }

  private invalidate(uri?: vscode.Uri) {
    this.lineHighlight.clear();
    this.revision++;
    this.preview = undefined;
    this.evidence = undefined;
    this.cancelRequest();
    this.send({
      type:
        uri?.toString() === this.selection?.document.uri.toString() ? 'stale' : 'contextChanged',
    });
  }

  dispose() {
    clearTimeout(this.panelLoadTimer);
    this.cancelRequest();
    this.panel?.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.cache.clear();
  }

  private send(data: unknown) {
    void this.panel?.webview.postMessage(data);
  }

  private sendHistory() {
    this.send({ type: 'history', ...this.history.snapshot() });
  }
  private sendBookmarks() {
    this.send({ type: 'bookmarks', ...this.bookmarks.snapshot() });
  }
  private savedResearch() {
    return [
      ...(this.latestResearch ? [this.latestResearch] : []),
      ...this.history
        .snapshot()
        .entries.flatMap((e) =>
          Object.values(e.results).flatMap((r) => (r?.research ? [r.research] : [])),
        ),
    ];
  }
  private async bookmarkWork(work: Promise<void>) {
    try {
      await work;
      this.sendBookmarks();
    } catch (error) {
      this.send({
        type: 'bookmarkError',
        message:
          error instanceof Error && error.message.startsWith('Your 100')
            ? error.message
            : 'Bookmarks could not be saved. Check local storage and try again.',
      });
    }
  }
  private async historyWork(work: Promise<void>) {
    try {
      await work;
      this.sendHistory();
    } catch {
      this.send({
        type: 'historyError',
        message:
          'History could not be saved. Your current lesson is still available; check local storage and try again.',
      });
    }
  }

  private colors: VSCodeCodeColors;
  private colorRevision = 0;
  private refreshColors() {
    this.colorRevision++;
    this.colors.reset();
    this.send({ type: 'syntaxThemeChanged' });
  }
  private async highlight(message: Record<string, unknown>) {
    const selected = this.selection,
      panel = this.panel,
      revision = this.colorRevision;
    if (typeof message.target === 'string' && /^block-\d{1,9}$/.test(message.target)) {
      if (
        typeof message.code !== 'string' ||
        message.code.length > 50000 ||
        !Number.isSafeInteger(message.id) ||
        typeof message.language !== 'string' ||
        message.language.length > 100
      )
        return;
      const colors = await this.colors.colorize(
        message.code,
        languageId(message.language),
        0,
        message.code.length,
      );
      if (panel === this.panel && revision === this.colorRevision)
        this.send({
          type: 'highlight',
          target: message.target,
          id: message.id,
          code: message.code,
          ...colors,
        });
      return;
    }
    if (
      !selected ||
      typeof message.code !== 'string' ||
      message.code.length > 50000 ||
      !Number.isSafeInteger(message.id) ||
      !['source', 'draft'].includes(String(message.target))
    )
      return;
    if (message.target === 'source' && message.code !== selected.snippet.code) return;
    const source = selected.source;
    // Preserve the selection's lexical context without accepting a path from the webview.
    const text =
      source.slice(0, selected.snippet.start) + message.code + source.slice(selected.snippet.end);
    const colors = await this.colors.colorize(
      text,
      selected.document.languageId,
      selected.snippet.start,
      selected.snippet.start + message.code.length,
    );
    if (selected !== this.selection || panel !== this.panel || revision !== this.colorRevision)
      return;
    this.send({
      type: 'highlight',
      target: message.target,
      id: message.id,
      code: message.code,
      ...colors,
    });
    const semantic = await this.colors.withSemantic(
      colors,
      selected.document,
      text,
      selected.snippet.start,
      selected.snippet.start + message.code.length,
    );
    if (
      semantic === colors ||
      selected !== this.selection ||
      panel !== this.panel ||
      revision !== this.colorRevision ||
      selected.document.version !== selected.version
    )
      return;
    this.send({
      type: 'highlight',
      target: message.target,
      id: message.id,
      code: message.code,
      ...semantic,
    });
  }

  private config() {
    const settings = vscode.workspace.getConfiguration('watdatmean');
    const provider = settings.get<Provider>('provider', 'openai');
    return {
      provider: Object.hasOwn(defaults, provider) ? provider : ('openai' as Provider),
      model: settings.get<string>('model', '').trim(),
      audience: settings.get<Audience>('audience', 'beginner'),
    };
  }

  private async sendConfig() {
    const config = this.config();
    this.send({
      type: 'config',
      ...config,
      webResearch: this.researchEnabled,
      webResearchModel: researchModels[config.provider],
      model: config.model || defaults[config.provider],
      hasKey: !!(await this.extension.secrets.get(`key.${config.provider}`)),
    });
  }

  async configure() {
    const current = this.config();
    const provider = await vscode.window.showQuickPick(
      [
        { label: 'OpenAI', description: defaults.openai, value: 'openai' as Provider },
        { label: 'Anthropic', description: defaults.anthropic, value: 'anthropic' as Provider },
        { label: 'Groq', description: defaults.groq, value: 'groq' as Provider },
      ],
      {
        title: 'WatDatMean · Choose your AI provider',
        placeHolder: 'Your key is stored securely by VS Code',
      },
    );
    if (!provider) return;
    const existing = await this.extension.secrets.get(`key.${provider.value}`);
    const key = await vscode.window.showInputBox({
      title: `${provider.label} API key`,
      password: true,
      ignoreFocusOut: true,
      prompt: existing
        ? 'Enter a new key, or leave blank to keep your stored key.'
        : 'Stored in VS Code SecretStorage. Code is sent only when you request AI help.',
      validateInput: (value) =>
        !value.trim() && !existing
          ? 'Enter an API key.'
          : /\s/.test(value.trim())
            ? 'The key must not contain whitespace.'
            : undefined,
    });
    if (key === undefined) return;
    const model = await vscode.window.showInputBox({
      title: `${provider.label} model`,
      value:
        current.provider === provider.value && current.model
          ? current.model
          : defaults[provider.value],
      prompt: 'Use a model available to your API account.',
      validateInput: (value) => (value.trim() ? undefined : 'Enter a model ID.'),
    });
    if (model === undefined) return;
    if (key.trim()) await this.extension.secrets.store(`key.${provider.value}`, key.trim());
    const settings = vscode.workspace.getConfiguration('watdatmean');
    await settings.update('provider', provider.value, vscode.ConfigurationTarget.Global);
    await settings.update('model', model.trim(), vscode.ConfigurationTarget.Global);
    await this.sendConfig();
    void vscode.window.showInformationMessage(
      `${provider.label} configured. The key will be checked on your first AI request.`,
    );
  }

  async removeKey() {
    const provider = await vscode.window.showQuickPick(['openai', 'anthropic', 'groq'], {
      title: 'Remove a stored API key',
    });
    if (!provider) return;
    this.cancelRequest();
    await this.extension.secrets.delete(`key.${provider}`);
    this.cache.clear();
    this.research.clear();
    await this.sendConfig();
    void vscode.window.showInformationMessage(`Removed ${provider} API key.`);
  }

  clearCache() {
    this.cancelRequest();
    this.cache.clear();
    this.research.clear();
    void vscode.window.showInformationMessage('WatDatMean explanation cache cleared.');
  }

  async inspectEditor(args?: { uri: string; offset: number }) {
    let document = vscode.window.activeTextEditor?.document;
    let start = vscode.window.activeTextEditor?.selection.start;
    let end = vscode.window.activeTextEditor?.selection.end;
    if (args && typeof args.uri === 'string' && Number.isInteger(args.offset)) {
      document = await vscode.workspace.openTextDocument(vscode.Uri.parse(args.uri));
      start = document.positionAt(args.offset);
      end = start;
    }
    if (!document || document.uri.scheme === 'watdatmean' || !start || !end) {
      void vscode.window.showInformationMessage(
        'Open a source file and place your cursor on code, or select a snippet.',
      );
      return;
    }
    if (document.getText().length > 500000) {
      void vscode.window.showInformationMessage('Choose a source file under 500,000 characters.');
      return;
    }
    this.cancelRequest();
    this.preview = undefined;
    this.evidence = undefined;
    const snippet = inspectCode(
      document.getText(),
      document.offsetAt(start),
      document.offsetAt(end),
      document.languageId,
    );
    this.selection = {
      document,
      source: document.getText(),
      version: document.version,
      snippet,
      range: { start: snippet.start, end: snippet.end },
    };
    if (!this.panel) this.openPanel();
    else {
      this.panel.reveal(vscode.ViewColumn.Beside, true);
      this.sendSelection();
    }
  }

  async reopenPanel() {
    if (!this.selection || this.selection.document.isClosed) return this.inspectEditor();
    // Refresh the saved range, even when focus is on a broken webview or a diff.
    this.refreshSelection(false);
    const selection = this.selection;
    this.panel?.dispose();
    this.selection = selection;
    this.openPanel();
  }

  private openPanel() {
    const panel = vscode.window.createWebviewPanel(
      'watdatmean',
      'WatDatMean',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extension.extensionUri, 'media')],
      },
    );
    this.panel = panel;
    this.panelReady = false;
    // Register the ready listener before loading HTML so a fast panel cannot miss it.
    panel.webview.onDidReceiveMessage((message) => {
      if (this.panel !== panel) return;
      const selection = this.selection;
      return this.handle(message).catch((error) => {
        if (selection !== this.selection || this.panel !== panel) return;
        this.send({
          type: 'error',
          message:
            error instanceof Error ? error.message : 'Something went wrong. Please try again.',
        });
      });
    });
    panel.onDidDispose(() => {
      if (this.panel !== panel) return;
      clearTimeout(this.panelLoadTimer);
      this.panel = undefined;
      this.cancelRequest();
      this.panelReady = false;
      this.selection = undefined;
    });
    this.panelLoadTimer = setTimeout(() => {
      if (this.panel !== panel || this.panelReady) return;
      void vscode.window
        .showWarningMessage(
          'WatDatMean’s learning panel did not finish loading. Try reopening it. If VS Code reports a ServiceWorker error, save your work, fully quit VS Code, and reopen it.',
          'Reopen panel',
        )
        .then((choice) => {
          if (choice === 'Reopen panel' && this.panel === panel && !this.panelReady)
            return this.reopenPanel();
        });
    }, 10000);
    this.panelLoadTimer.unref();
    panel.webview.html = this.html(panel.webview);
  }

  private sendSelection(keepTab = false) {
    if (!this.selection) return;
    this.lineHighlight.clear();
    const { document, snippet } = this.selection;
    const editor = vscode.window.visibleTextEditors.find((item) => item.document === document);
    const tabSize =
      editor?.options.tabSize ??
      vscode.workspace.getConfiguration('editor', document.uri).get('tabSize', 4);
    this.send({
      type: 'selection',
      selectionId: ++this.selectionId,
      tabSize: typeof tabSize === 'number' ? tabSize : 4,
      keepTab,
      code: snippet.code,
      language: languageLabel(document.languageId),
      start: snippet.start,
      parts: snippet.parts,
      symbol: snippet.symbol,
      file: vscode.workspace.asRelativePath(document.uri),
      line: document.positionAt(snippet.start).line + 1,
    });
    void this.sendConfig();
    const id = this.selectionId;
    const root = vscode.workspace.getWorkspaceFolder?.(document.uri)?.uri;
    if (document.uri.scheme === 'file' && root?.scheme === 'file') {
      void readVersionManifests(root.fsPath, document.uri.fsPath).then((manifests) => {
        if (id === this.selectionId)
          this.send({
            type: 'researchHints',
            selectionId: id,
            hints: detectResearchVersions(document.languageId, manifests),
          });
      });
    }
  }

  private refreshSelection(send = true) {
    if (!this.selection) return;
    const { document, range } = this.selection;
    if (document.isClosed) throw new Error('Reopen this file and inspect the code again.');
    const source = document.getText();
    if (source.length > 500000) throw new Error('Choose a source file under 500,000 characters.');
    this.cancelRequest();
    this.preview = undefined;
    this.evidence = undefined;
    this.selection = {
      document,
      source,
      version: document.version,
      range,
      // An empty selection is an insertion point after deletion. Do not
      // accidentally select and replace the statement following it.
      snippet:
        range.start === range.end
          ? { code: '', ...range, symbol: '', symbolOffset: range.start, parts: [] }
          : inspectCode(source, range.start, range.end, document.languageId),
    };
    if (send) this.sendSelection(true);
  }

  private current(): Selection {
    if (!this.selection) throw new Error('Inspect some code first.');
    if (
      this.selection.document.isClosed ||
      this.selection.document.version !== this.selection.version
    )
      throw new Error('Your file changed. Choose “Use latest code” to continue.');
    return this.selection;
  }

  private trusted() {
    if (!vscode.workspace.isTrusted)
      throw new Error(
        'Trust this workspace in VS Code before sending code to AI or applying edits. Local explanations still work.',
      );
  }

  private async openSourceLine(m: Record<string, unknown>) {
    if (
      !Number.isSafeInteger(m.selectionId) ||
      (m.selectionId as number) < 1 ||
      m.selectionId !== this.selectionId ||
      !Number.isSafeInteger(m.line)
    )
      return;
    const selected = this.current();
    const { document, snippet } = selected;
    const line = m.line as number;
    // Only the selected original file and its displayed lines are navigation targets.
    if (
      line < document.positionAt(snippet.start).line + 1 ||
      line > document.positionAt(snippet.end).line + 1
    )
      return;
    const position = new vscode.Position(line - 1, 0);
    const range = new vscode.Range(position, position);
    const visible = vscode.window.visibleTextEditors.find((editor) => editor.document === document);
    const editor = await vscode.window.showTextDocument(document, {
      viewColumn: visible?.viewColumn ?? vscode.ViewColumn.One,
      preserveFocus: false,
    });
    if (
      this.selection !== selected ||
      this.selectionId !== m.selectionId ||
      document.isClosed ||
      document.version !== selected.version
    )
      return;
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    this.lineHighlight.show(editor, range);
  }

  private async handle(message: unknown) {
    if (!message || typeof message !== 'object') return;
    const m = message as Record<string, unknown>;
    if (m.type === 'bookmarkList') {
      this.sendBookmarks();
      return;
    }
    if (m.type === 'bookmarkRemove' && typeof m.url === 'string') {
      await this.bookmarkWork(this.bookmarks.remove(m.url));
      return;
    }
    if (m.type === 'bookmarkAdd') {
      const url = publicWebUrl(m.url);
      const research = this.savedResearch().find((r) => r.sources.some((s) => s.url === url));
      const source = research?.sources.find((s) => s.url === url);
      if (source && research) await this.bookmarkWork(this.bookmarks.add(source, research));
      return;
    }
    if (m.type === 'researchToggle' && typeof m.enabled === 'boolean') {
      this.researchEnabled = m.enabled;
      if (!m.enabled && this.researchRunning) this.cancelRequest();
      await this.extension.workspaceState?.update(RESEARCH_ENABLED_KEY, m.enabled);
      return;
    }
    if (m.type === 'openWebSource') {
      const url = publicWebUrl(m.url);
      if (!url) return;
      if (
        [
          ...this.savedResearch().flatMap((r) => r.sources),
          ...this.bookmarks.snapshot().entries,
        ].some((s) => s?.url === url)
      )
        await vscode.env.openExternal(vscode.Uri.parse(url));
      return;
    }
    if (m.type === 'highlight') {
      await this.highlight(m);
      return;
    }
    if (m.type === 'ready') {
      this.panelReady = true;
      clearTimeout(this.panelLoadTimer);
      this.sendSelection();
      this.sendHistory();
      this.sendBookmarks();
      return;
    }
    if (m.type === 'historyList') {
      this.sendHistory();
      return;
    }
    if (m.type === 'historyRemove' && typeof m.id === 'string') {
      await this.historyWork(this.history.remove(m.id));
      return;
    }
    if (m.type === 'historyClear') {
      await this.historyWork(this.history.clear());
      return;
    }
    if (m.type === 'historyEnabled' && typeof m.enabled === 'boolean') {
      await this.historyWork(this.history.enable(m.enabled));
      return;
    }
    if (m.type === 'configure') {
      await this.configure();
      return;
    }
    if (m.type === 'cancel') {
      this.cancelRequest();
      return;
    }
    if (m.type === 'refresh') {
      this.refreshSelection();
      return;
    }
    if (m.type === 'openSourceLine') {
      await this.openSourceLine(m);
      return;
    }
    if (m.type === 'openEvidence' && typeof m.id === 'string') {
      const location = this.evidence?.locations.get(m.id);
      if (location)
        await vscode.window.showTextDocument(location.uri, {
          selection: location.range,
          viewColumn: vscode.ViewColumn.One,
        });
      return;
    }
    if (this.busy) return;
    if (m.type !== 'request' && m.type !== 'preview' && m.type !== 'apply' && m.type !== 'research')
      return;
    if (m.type === 'research' && !this.researchEnabled) return;
    const selection = this.current();
    this.busy = true;
    const abort = new AbortController();
    this.abort = abort;
    this.researchRunning = m.type === 'research';
    const revision = this.revision;
    this.send({ type: 'busy', value: true });
    try {
      if (m.type === 'apply') {
        if (typeof m.replacement === 'string') await this.apply(m.replacement, abort.signal);
        return;
      }
      if (m.type === 'preview') {
        await this.makePreview(
          typeof m.replacement === 'string' ? m.replacement : '',
          selection,
          revision,
          abort.signal,
        );
        return;
      }
      this.trusted();
      if (m.type === 'research') {
        const config = this.config();
        const key = await this.extension.secrets.get(`key.${config.provider}`);
        if (!key) throw new Error('Connect a provider to search the web.');
        if (abort.signal.aborted || !this.researchEnabled) return;
        const previous = this.lastExplanation;
        const result = await this.research.search(
          config.provider,
          key,
          typeof m.topic === 'string' ? m.topic : '',
          m.audience === 'experienced' ? 'experienced' : 'beginner',
          abort.signal,
          researchOptions(m.options),
        );
        if (
          abort.signal.aborted ||
          !this.researchEnabled ||
          selection !== this.selection ||
          revision !== this.revision
        )
          return;
        this.latestResearch = result;
        this.send({ type: 'research', result });
        if (previous?.selection === selection)
          void this.historyWork(
            this.history.attachResearch(previous.source, previous.task, previous.lesson, result),
          );
        return;
      }
      const task = m.task as Task;
      if (!['explain', 'walkthrough', 'example', 'concept', 'impact'].includes(task)) return;
      const audience: Audience = m.audience === 'experienced' ? 'experienced' : 'beginner';
      const mode: Mode = task === 'impact' || m.mode === 'project' ? 'project' : 'standalone';
      const config = this.config();
      const key = await this.extension.secrets.get(`key.${config.provider}`);
      if (abort.signal.aborted) return;
      if (!key) throw new Error('Connect an AI provider first. Use “Connect provider” above.');
      if (selection.snippet.code.length > 12000)
        throw new Error('Select a smaller block of code (under 12,000 characters).');
      const request: LearningRequest = {
        task,
        mode,
        audience,
        code: selection.snippet.code,
        language: languageLabel(selection.document.languageId),
      };
      if (task === 'concept')
        request.concept = typeof m.concept === 'string' ? m.concept.slice(0, 150) : '';
      if (task === 'impact') {
        request.replacement = this.validateReplacement(m.replacement, selection);
      }
      if (mode === 'project') {
        if (task === 'walkthrough')
          request.learningContext = learningContext(
            selection.document.getText(),
            selection.document.languageId,
            selection.snippet,
          );
        const evidence = await collectContext(selection.document, selection.snippet);
        if (abort.signal.aborted || revision !== this.revision) return;
        this.evidence = evidence;
        request.context = evidence.context;
        request.evidence = evidence.evidence;
        this.send({ type: 'evidence', items: evidence.evidence, note: evidence.note });
      }
      if (abort.signal.aborted) return;
      const model = config.model || defaults[config.provider];
      const cacheKey = fingerprint({
        version: LESSON_CACHE_VERSION,
        provider: config.provider,
        model,
        request,
      });
      const cached = this.cache.get(cacheKey);
      const lesson = cached ?? (await generate(config.provider, model, key, request, abort.signal));
      if (abort.signal.aborted || selection !== this.selection) return;
      if (revision !== this.revision)
        throw new Error(
          'Code changed during the request. Refresh and request the explanation again.',
        );
      this.cache.set(cacheKey, lesson);
      this.send({
        type: 'lesson',
        lesson,
        task,
        concept: request.concept,
        cached: !!cached,
        provider: config.provider,
        model,
      });
      const historySource = {
        file: vscode.workspace.asRelativePath(selection.document.uri),
        line: selection.document.positionAt(selection.snippet.start).line + 1,
        code: request.code,
        language: request.language!,
        mode,
        audience,
      };
      if (task === 'explain' || task === 'walkthrough')
        this.lastExplanation = { selection, source: historySource, task, lesson };
      void this.historyWork(
        this.history.add(historySource, task, {
          lesson,
          provider: config.provider,
          model,
          mode,
          audience,
          ...(task === 'impact' ? { replacement: request.replacement } : {}),
        }),
      );
    } catch (error) {
      if (!abort.signal.aborted || (m.type === 'apply' && selection === this.selection)) {
        if (m.type === 'research')
          this.send({
            type: 'researchError',
            message:
              error instanceof Error
                ? error.message
                : 'Web research failed. Your explanation is unchanged.',
          });
        else throw error;
      }
    } finally {
      // A cancelled request may finish after a newer request has already started.
      if (this.abort === abort) {
        this.researchRunning = false;
        this.abort = undefined;
        this.busy = false;
        this.send({ type: 'busy', value: false });
      }
    }
  }

  private validateReplacement(value: unknown, selection: Selection) {
    return validateReplacement(value, selection.snippet.code);
  }

  private async makePreview(
    value: string,
    selection: Selection,
    revision: number,
    signal: AbortSignal,
  ) {
    this.preview = undefined;
    this.send({ type: 'previewReset' });
    const replacement = this.validateReplacement(value, selection);
    const source = selection.document.getText();
    const proposed =
      source.slice(0, selection.snippet.start) + replacement + source.slice(selection.snippet.end);
    const evidence = await collectContext(selection.document, selection.snippet);
    if (signal.aborted) return;
    if (selection !== this.selection || revision !== this.revision)
      throw new Error('Code changed while preparing the preview. Inspect it again.');
    this.evidence = evidence;
    this.send({ type: 'evidence', items: evidence.evidence, note: evidence.note });
    const { errors, checked } = checkSyntax(proposed, selection.document.languageId);
    const id = randomBytes(8).toString('hex');
    const extension = /\.[a-z0-9]+$/i.exec(selection.document.uri.path)?.[0] ?? '.txt';
    const before = vscode.Uri.parse(`watdatmean:/${id}/original${extension}`);
    const after = vscode.Uri.parse(`watdatmean:/${id}/proposed${extension}`);
    this.virtual.set(before.toString(), source);
    this.virtual.set(after.toString(), proposed);
    try {
      // Keep the editable source document open when the diff replaces the preview tab.
      await vscode.window.showTextDocument(selection.document, {
        viewColumn: vscode.ViewColumn.One,
        preview: false,
        preserveFocus: true,
      });
      if (signal.aborted) return;
      await vscode.commands.executeCommand(
        'vscode.diff',
        before,
        after,
        'WatDatMean · See what changes',
        { viewColumn: vscode.ViewColumn.One, preview: true, preserveFocus: true },
      );
      if (signal.aborted || selection !== this.selection || revision !== this.revision) return;
      this.current();
      this.preview = !checked || errors.length ? undefined : { replacement, revision };
      this.send({ type: 'preview', errors, replacement, syntaxChecked: checked });
    } catch (error) {
      this.virtual.delete(before.toString());
      this.virtual.delete(after.toString());
      throw error;
    }
  }

  private async apply(replacement: string, signal: AbortSignal) {
    this.trusted();
    const selection = this.current();
    assertPreviewCurrent(this.preview, replacement, this.revision);
    const preview = this.preview;
    const confirmed = await vscode.window.showWarningMessage(
      'Use this code in your file? This changes the editor’s contents. You can undo it. The code has not been run.',
      { modal: true },
      'Use this code',
    );
    if (confirmed !== 'Use this code' || signal.aborted) return;
    this.current();
    if (selection !== this.selection || preview !== this.preview)
      throw new Error('The code changed. Choose “See what changes” again.');
    assertPreviewCurrent(this.preview, replacement, this.revision);
    const source = selection.document.getText();
    const expected =
      source.slice(0, selection.snippet.start) + replacement + source.slice(selection.snippet.end);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      selection.document.uri,
      new vscode.Range(
        selection.document.positionAt(selection.snippet.start),
        selection.document.positionAt(selection.snippet.end),
      ),
      replacement,
    );
    if (!(await vscode.workspace.applyEdit(edit)))
      throw new Error('VS Code could not apply the edit.');
    this.preview = undefined;
    if (this.selection === selection && selection.document.getText() === expected) {
      selection.range = {
        start: selection.snippet.start,
        end: selection.snippet.start + replacement.length,
      };
      this.refreshSelection();
      this.send({ type: 'applied' });
      await vscode.window.showTextDocument(selection.document, {
        viewColumn: vscode.ViewColumn.One,
        preserveFocus: true,
      });
    }
  }

  private html(webview: vscode.Webview) {
    const nonce = randomBytes(16).toString('hex');
    const resource = (name: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.extension.extensionUri, 'media', name));
    return panelHtml(
      {
        cspSource: webview.cspSource,
        css: resource('panel.css').toString(),
        script: resource('panel.js').toString(),
      },
      nonce,
    );
  }
}
