import * as vscode from 'vscode';
// Select the ESM entry so esbuild can bundle its relative imports (the UMD factory hides them).
import { parse } from 'jsonc-parser/lib/esm/main';
import { parseRawGrammar, type IRawTheme } from 'vscode-textmate';
type IRawThemeSetting = IRawTheme['settings'][number];
import { CodeColorizer, plainColors, safeColor, type CodeColors } from './code-colors';
import {
  SemanticPalette,
  semanticRanges,
  overlaySemantic,
  type ScopeRule,
  type SemanticRange,
} from './semantic-colors';

type SemanticTheme = { enabled?: boolean; rules: [string, unknown][] };

type Resource = { root: vscode.Uri; uri: vscode.Uri };
function resource(root: vscode.Uri, relative: unknown): Resource | undefined {
  if (typeof relative !== 'string' || !relative || relative.length > 1000) return;
  const uri = vscode.Uri.joinPath(root, relative);
  if (uri.scheme !== root.scheme || !uri.path.startsWith(root.path + '/')) return;
  return { root, uri };
}
async function read(file: Resource) {
  const stat = await vscode.workspace.fs.stat(file.uri);
  if (stat.size > 8_000_000) throw Error('Highlighting resource too large');
  return new TextDecoder().decode(await vscode.workspace.fs.readFile(file.uri));
}
export async function readColorTheme(
  file: Resource,
  seen = new Set<string>(),
  semantic?: SemanticTheme,
): Promise<IRawThemeSetting[]> {
  if (seen.size >= 12 || seen.has(file.uri.toString())) return [];
  seen.add(file.uri.toString());
  const raw = await read(file);
  const data = /\.jsonc?$/i.test(file.uri.path) ? parse(raw) : parseRawGrammar(raw, file.uri.path);
  if (!data || typeof data !== 'object') return [];
  const directory = vscode.Uri.joinPath(file.uri, '..');
  const relative = (name: string) => {
    const uri = vscode.Uri.joinPath(directory, name);
    return uri.path.startsWith(file.root.path + '/') ? { root: file.root, uri } : undefined;
  };
  const settings: IRawThemeSetting[] = [];
  if (typeof data.include === 'string') {
    const parent = relative(data.include);
    if (parent) settings.push(...(await readColorTheme(parent, seen, semantic)));
  }
  if (safeColor(data.colors?.['editor.foreground']))
    settings.push({ settings: { foreground: data.colors['editor.foreground'] } });
  if (Array.isArray(data.settings)) settings.push(...data.settings);
  if (Array.isArray(data.tokenColors)) settings.push(...data.tokenColors);
  else if (typeof data.tokenColors === 'string') {
    const tokens = relative(data.tokenColors);
    if (tokens) settings.push(...(await readColorTheme(tokens, seen)));
  }
  if (semantic) {
    if (typeof data.semanticHighlighting === 'boolean')
      semantic.enabled = data.semanticHighlighting;
    if (
      data.semanticTokenColors &&
      typeof data.semanticTokenColors === 'object' &&
      !Array.isArray(data.semanticTokenColors)
    )
      semantic.rules.push(...Object.entries(data.semanticTokenColors));
  }
  return settings;
}
export function customTokenRules(custom: Record<string, any>, theme: string): IRawThemeSetting[] {
  const settings: IRawThemeSetting[] = [];
  // Same user-facing token groups as VS Code's colorThemeData.ts.
  const groups: Record<string, string[]> = {
    comments: ['comment', 'punctuation.definition.comment'],
    strings: ['string', 'meta.embedded.assembly'],
    numbers: ['constant.numeric'],
    keywords: ['keyword - keyword.operator', 'keyword.control', 'storage', 'storage.type'],
    types: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class'],
    functions: ['entity.name.function', 'support.function'],
    variables: ['variable', 'entity.name.variable'],
  };
  const add = (values: Record<string, any>) => {
    for (const [key, scopes] of Object.entries(groups)) {
      const value = values[key];
      if (typeof value === 'string')
        settings.push({ scope: scopes, settings: { foreground: value } });
      else if (value && typeof value === 'object')
        settings.push({ scope: scopes, settings: value });
    }
    if (Array.isArray(values.textMateRules)) settings.push(...values.textMateRules);
  };
  for (const layer of themeCustomizations(custom, theme)) add(layer);
  return settings;
}
export function themeCustomizations(
  custom: Record<string, any>,
  theme: string,
): Record<string, any>[] {
  if (!custom || typeof custom !== 'object' || Array.isArray(custom)) return [];
  const layers = [custom];
  for (const [key, value] of Object.entries(custom)) {
    if (!key.startsWith('[') || !value || typeof value !== 'object') continue;
    const matches = [...key.matchAll(/\[([^\]]+)\]/g)].some(([, name]) => {
      const expression = name
        .split('*')
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*');
      return new RegExp('^' + expression + '$').test(theme);
    });
    if (matches) layers.push(value);
  }
  return layers;
}

export class VSCodeCodeColors {
  private engine?: ReturnType<VSCodeCodeColors['create']>;
  private cache = new Map<string, Promise<CodeColors>>();
  private semanticCache = new Map<string, Promise<SemanticRange[]>>();
  private semanticBusy = 0;
  constructor(
    private extensionUri: vscode.Uri,
    private report?: (message: string) => void,
  ) {}
  reset() {
    const old = this.engine;
    this.engine = undefined;
    this.cache.clear();
    this.semanticCache.clear();
    if (old)
      void old.then(
        (e) => e.colorizer.dispose(),
        () => {},
      );
  }
  dispose() {
    this.reset();
  }
  private engineReady() {
    if (!this.engine) {
      const pending = this.create();
      this.engine = pending;
      void pending.catch(() => {
        if (this.engine === pending) this.engine = undefined;
      });
    }
    return this.engine;
  }
  private async create() {
    const grammars = new Map<string, Resource>(),
      languages = new Map<string, string>(),
      injections = new Map<string, string[]>();
    const themeName = vscode.workspace.getConfiguration('workbench').get<string>('colorTheme', '');
    let themeFile: Resource | undefined;
    const semantic: SemanticTheme = { rules: [] },
      scopes: ScopeRule[] = [];
    const parents = new Map<string, string>([['member', 'method']]);
    for (const extension of vscode.extensions.all) {
      const contributes = extension.packageJSON.contributes;
      for (const type of contributes?.semanticTokenTypes ?? [])
        if (typeof type.id === 'string' && typeof type.superType === 'string')
          parents.set(type.id, type.superType);
      for (const group of contributes?.semanticTokenScopes ?? []) {
        for (const [selector, names] of Object.entries(group.scopes ?? {})) {
          if (Array.isArray(names) && names.every((n) => typeof n === 'string'))
            scopes.push({
              selector,
              language: group.language,
              scopes: names.map((n) => n.split(' ')),
            });
        }
      }
      for (const grammar of contributes?.grammars ?? []) {
        const file = resource(extension.extensionUri, grammar.path);
        if (!file || typeof grammar.scopeName !== 'string') continue;
        grammars.set(grammar.scopeName, file);
        if (typeof grammar.language === 'string')
          languages.set(grammar.language, grammar.scopeName);
        for (const target of grammar.injectTo ?? [])
          injections.set(target, [...(injections.get(target) ?? []), grammar.scopeName]);
      }
      for (const theme of contributes?.themes ?? [])
        if (theme.id === themeName || theme.label === themeName)
          themeFile = resource(extension.extensionUri, theme.path);
    }
    const settings: IRawThemeSetting[] = themeFile
      ? await readColorTheme(themeFile, new Set(), semantic)
      : [];
    const uiColors = Object.assign(
      {},
      ...themeCustomizations(
        vscode.workspace.getConfiguration('workbench').get('colorCustomizations', {}),
        themeName,
      ),
    );
    if (safeColor(uiColors['editor.foreground']))
      settings.push({ settings: { foreground: uiColors['editor.foreground'] } });
    settings.push(
      ...customTokenRules(
        vscode.workspace.getConfiguration('editor').get('tokenColorCustomizations', {}),
        themeName,
      ),
    );
    // Unknown/custom unavailable themes use the panel foreground instead of an unrelated palette.
    if (!settings.length) languages.clear();
    this.report?.(
      `Theme ${themeName}: ${settings.length} rules, ${languages.size} languages; TypeScript scope ${languages.get('typescript')}`,
    );
    const colorizer = new CodeColorizer({
      wasm: async () =>
        vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.extensionUri, 'dist', 'onig.wasm')),
      theme: { settings },
      grammar: async (scope) => {
        const file = grammars.get(scope);
        return file ? { text: await read(file), file: file.uri.path } : undefined;
      },
      injections: (scope) => injections.get(scope) ?? [],
      report: this.report,
    });
    return { colorizer, languages, semantic, settings, themeName, scopes, parents };
  }
  /** Uses native provider results only for the exact current document, never for an edited draft. */
  async withSemantic(
    base: CodeColors,
    document: vscode.TextDocument,
    source: string,
    start: number,
    end: number,
  ): Promise<CodeColors> {
    if (
      !base.runs.length ||
      source.length > 500000 ||
      document.isClosed ||
      document.getText() !== source
    )
      return base;
    const version = document.version,
      enginePromise = this.engineReady();
    try {
      const engine = await enginePromise;
      const config = vscode.workspace.getConfiguration('editor', {
        uri: document.uri,
        languageId: document.languageId,
      });
      const custom = themeCustomizations(
        config.get('semanticTokenColorCustomizations', {}),
        engine.themeName,
      );
      let enabled = engine.semantic.enabled ?? false;
      const rules = [...engine.semantic.rules];
      for (const layer of custom) {
        if (typeof layer.enabled === 'boolean') enabled = layer.enabled;
        if (layer.rules && typeof layer.rules === 'object')
          rules.push(...Object.entries(layer.rules));
      }
      const setting = config.get<boolean | string>(
        'semanticHighlighting.enabled',
        'configuredByTheme',
      );
      if (typeof setting === 'boolean') enabled = setting;
      if (!enabled) return base;
      const key = JSON.stringify([document.uri.toString(), version, start, end]);
      let pending = this.semanticCache.get(key);
      if (!pending) {
        if (this.semanticCache.size >= 4)
          this.semanticCache.delete(this.semanticCache.keys().next().value!);
        pending = this.fetchSemantic(document, source, start, end);
        this.semanticCache.set(key, pending);
      }
      const ranges = await pending;
      // Providers can refresh after indexing without changing document.version. Only coalesce
      // in-flight semantic work; the installed provider owns caching its completed analysis.
      if (this.semanticCache.get(key) === pending) this.semanticCache.delete(key);
      if (
        !ranges.length ||
        enginePromise !== this.engine ||
        version !== document.version ||
        document.isClosed ||
        document.getText() !== source
      )
        return base;
      return overlaySemantic(
        base,
        ranges,
        start,
        end,
        new SemanticPalette(engine.settings, rules, engine.scopes, engine.parents),
        document.languageId,
      );
    } catch {
      return base;
    }
  }
  private async fetchSemantic(
    document: vscode.TextDocument,
    source: string,
    start: number,
    end: number,
  ): Promise<SemanticRange[]> {
    if (this.semanticBusy >= 2) return [];
    this.semanticBusy++;
    // A provider may be absent, warming up or stalled. Never make syntax colors wait indefinitely.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + 2000;
    const run = async () => {
      const range = new vscode.Range(document.positionAt(start), document.positionAt(end));
      for (const kind of ['DocumentRange', 'Document']) {
        if (Date.now() >= deadline || document.isClosed) return [];
        const args = kind === 'DocumentRange' ? [document.uri, range] : [document.uri];
        const legend = await vscode.commands.executeCommand<vscode.SemanticTokensLegend>(
          `vscode.provide${kind}SemanticTokensLegend`,
          ...args,
        );
        if (!legend || Date.now() >= deadline) continue;
        const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
          `vscode.provide${kind}SemanticTokens`,
          ...args,
        );
        if (tokens?.data.length) return semanticRanges(source, tokens.data, legend);
      }
      return [];
    };
    try {
      return await Promise.race([
        run().finally(() => this.semanticBusy--),
        new Promise<SemanticRange[]>((resolve) => {
          timer = setTimeout(() => resolve([]), 2000);
        }),
      ]);
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
  async colorize(
    source: string,
    language: string,
    start: number,
    end: number,
  ): Promise<CodeColors> {
    const key = JSON.stringify([language, start, end, source]);
    const previous = this.cache.get(key);
    if (previous) return previous;
    if (this.cache.size >= 4) this.cache.delete(this.cache.keys().next().value!);
    const result = (async () => {
      try {
        const pending = this.engineReady();
        const engine = await pending;
        const scope = engine.languages.get(language);
        const colors = scope
          ? await engine.colorizer.colorize(source, scope, start, end)
          : plainColors();
        // A failed grammar/runtime load is cached inside TextMate. Rebuild on the next bounded retry.
        if (scope && !colors.runs.length && this.engine === pending) {
          this.engine = undefined;
          engine.colorizer.dispose();
        }
        return colors;
      } catch (error) {
        this.report?.(error instanceof Error ? error.message : 'Highlighting unavailable');
        return plainColors();
      }
    })();
    this.cache.set(key, result);
    const colors = await result;
    // A transient timeout must not leave the same selection permanently uncolored.
    // Keep sharing in-flight work, but only retain successful results afterward.
    if (!colors.runs.length && this.cache.get(key) === result) this.cache.delete(key);
    return colors;
  }
}
