import { panelHtml } from './panel';
import { assertPreviewCurrent, trackRange, validateReplacement, type OffsetRange } from './edit';
import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { inspect, syntaxErrors } from './analyzer';
import { Cache, fingerprint } from './cache';
import { collectContext, type ContextResult } from './context';
import { defaults, generate, GenerationError } from './provider';
import type { Audience, Generation, LearningRequest, Mode, Provider, Snippet, Task } from './types';

interface Selection {
  document: vscode.TextDocument;
  version: number;
  snippet: Snippet;
  range: OffsetRange;
}

export function activate(context: vscode.ExtensionContext) {
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
      { language: 'typescript' },
      {
        provideHover(document, position) {
          if (document.getText().length > 500000) return;
          const offset = document.offsetAt(position);
          const snippet = inspect(document.getText(), offset);
          const md = new vscode.MarkdownString();
          md.appendMarkdown('**WatDatMean** · TypeScript\n\n');
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
  status.tooltip = 'Understand TypeScript at your cursor';
  const update = () =>
    vscode.window.activeTextEditor?.document.languageId === 'typescript'
      ? status.show()
      : status.hide();
  context.subscriptions.push(status, vscode.window.onDidChangeActiveTextEditor(update));
  update();
}

class Tutor implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private panelReady = false;
  private panelLoadTimer?: ReturnType<typeof setTimeout>;
  private selection?: Selection;
  private cache = new Cache<Generation>();
  private abort?: AbortController;
  private busy = false;
  private revision = 0;
  private evidence?: ContextResult;
  private preview?: { replacement: string; revision: number };
  private virtual = new Map<string, string>();
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly extension: vscode.ExtensionContext) {
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
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.ts');
    const onFileChange = (uri: vscode.Uri) => {
      if (!/(?:^|\/)(?:node_modules|\.git|dist|build|vendor)\//i.test(uri.path))
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
        void this.sendConfig();
      }),
    );
  }

  private cancelRequest() {
    this.abort?.abort();
    this.abort = undefined;
    this.busy = false;
    this.send({ type: 'busy', value: false });
  }

  private invalidate(uri?: vscode.Uri) {
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
    await this.sendConfig();
    void vscode.window.showInformationMessage(`Removed ${provider} API key.`);
  }

  clearCache() {
    this.cancelRequest();
    this.cache.clear();
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
    if (
      !document ||
      document.languageId !== 'typescript' ||
      document.uri.scheme === 'watdatmean' ||
      !start ||
      !end
    ) {
      void vscode.window.showInformationMessage(
        'Open a TypeScript (.ts) file and place your cursor on code, or select a snippet.',
      );
      return;
    }
    if (document.getText().length > 500000) {
      void vscode.window.showInformationMessage(
        'Choose a TypeScript file smaller than 500 KB for this MVP.',
      );
      return;
    }
    this.cancelRequest();
    this.preview = undefined;
    this.evidence = undefined;
    const snippet = inspect(document.getText(), document.offsetAt(start), document.offsetAt(end));
    this.selection = {
      document,
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
      this.cancelRequest();
      this.panel = undefined;
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
    const { document, snippet } = this.selection;
    this.send({
      type: 'selection',
      keepTab,
      code: snippet.code,
      start: snippet.start,
      parts: snippet.parts,
      symbol: snippet.symbol,
      file: vscode.workspace.asRelativePath(document.uri),
      line: document.positionAt(snippet.start).line + 1,
    });
    void this.sendConfig();
  }

  private refreshSelection(send = true) {
    if (!this.selection) return;
    const { document, range } = this.selection;
    if (document.isClosed) throw new Error('Reopen this file and inspect the code again.');
    const source = document.getText();
    if (source.length > 500000) throw new Error('Choose a TypeScript file smaller than 500 KB.');
    this.cancelRequest();
    this.preview = undefined;
    this.evidence = undefined;
    this.selection = {
      document,
      version: document.version,
      range,
      // An empty selection is an insertion point after deletion. Do not
      // accidentally select and replace the statement following it.
      snippet:
        range.start === range.end
          ? { code: '', ...range, symbol: '', symbolOffset: range.start, parts: [] }
          : inspect(source, range.start, range.end),
    };
    if (send) this.sendSelection(true);
  }

  private current(): Selection {
    if (!this.selection) throw new Error('Inspect some TypeScript code first.');
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

  private async handle(message: unknown) {
    if (!message || typeof message !== 'object') return;
    const m = message as Record<string, unknown>;
    if (m.type === 'ready') {
      this.panelReady = true;
      clearTimeout(this.panelLoadTimer);
      this.sendSelection();
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
    if (m.type !== 'request' && m.type !== 'preview' && m.type !== 'apply') return;
    const selection = this.current();
    this.busy = true;
    const abort = new AbortController();
    this.abort = abort;
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
      const task = m.task as Task;
      if (!['explain', 'example', 'concept', 'impact'].includes(task)) return;
      const audience: Audience = m.audience === 'experienced' ? 'experienced' : 'beginner';
      const mode: Mode = task === 'impact' || m.mode === 'project' ? 'project' : 'standalone';
      const config = this.config();
      const key = await this.extension.secrets.get(`key.${config.provider}`);
      if (abort.signal.aborted) return;
      if (!key) throw new Error('Connect an AI provider first. Use “Connect provider” above.');
      if (selection.snippet.code.length > 12000)
        throw new Error('Select a smaller block of code (under 12,000 characters).');
      const request: LearningRequest = { task, mode, audience, code: selection.snippet.code };
      if (task === 'concept')
        request.concept = typeof m.concept === 'string' ? m.concept.slice(0, 150) : '';
      if (task === 'impact') {
        request.replacement = this.validateReplacement(m.replacement, selection);
      }
      if (mode === 'project') {
        const evidence = await collectContext(selection.document, selection.snippet);
        if (abort.signal.aborted || revision !== this.revision) return;
        this.evidence = evidence;
        request.context = evidence.context;
        request.evidence = evidence.evidence;
        this.send({ type: 'evidence', items: evidence.evidence, note: evidence.note });
      }
      if (abort.signal.aborted) return;
      const model = config.model || defaults[config.provider];
      const cacheKey = fingerprint({ version: 3, provider: config.provider, model, request });
      const cached = this.cache.get(cacheKey);
      let result: Generation;
      try {
        result = cached ?? (await generate(config.provider, model, key, request, abort.signal));
        if (this.abort !== abort) return;
        if (abort.signal.aborted || selection !== this.selection || revision !== this.revision)
          throw new GenerationError(
            abort.signal.aborted
              ? 'Request cancelled.'
              : 'Code changed during the request. Refresh and request the explanation again.',
            result.model,
            cached ? undefined : result.usage,
          );
      } catch (error) {
        if (this.abort !== abort) return;
        this.send({
          type: 'error',
          message: error instanceof Error ? error.message : 'The AI request failed. Please retry.',
          showUsage: true,
          usage: error instanceof GenerationError ? error.usage : undefined,
          provider: config.provider,
          model: error instanceof GenerationError ? error.model : model,
        });
        return;
      }
      this.cache.set(cacheKey, result);
      this.send({
        type: 'lesson',
        lesson: result.lesson,
        task,
        concept: request.concept,
        cached: !!cached,
        provider: config.provider,
        model: result.model,
        usage: cached ? undefined : result.usage,
      });
    } catch (error) {
      if (!abort.signal.aborted) throw error;
    } finally {
      // A cancelled request may finish after a newer request has already started.
      if (this.abort === abort) {
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
    const errors = syntaxErrors(proposed);
    const id = randomBytes(8).toString('hex');
    const before = vscode.Uri.parse(`watdatmean:/${id}/original.ts`);
    const after = vscode.Uri.parse(`watdatmean:/${id}/proposed.ts`);
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
      this.preview = errors.length ? undefined : { replacement, revision };
      this.send({ type: 'preview', errors, replacement });
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
