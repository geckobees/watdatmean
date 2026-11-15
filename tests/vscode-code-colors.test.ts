import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { type CodeColors, plainColors } from '../src/code-colors';
import {
  customTokenRules,
  readColorTheme,
  themeCustomizations,
  VSCodeCodeColors,
} from '../src/vscode-code-colors';
const data = vi.hoisted(() => new Map<string, string>());
const config = vi.hoisted(() => new Map<string, unknown>());
const command = vi.hoisted(() => vi.fn());
vi.mock('vscode', async () => {
  const path = await import('node:path');
  const uri = (value: string): any => ({ path: value, scheme: 'file', toString: () => value });
  return {
    commands: { executeCommand: command },
    Range: class {
      constructor(
        public start: unknown,
        public end: unknown,
      ) {}
    },
    Uri: {
      file: uri,
      joinPath: (root: any, ...pieces: string[]) => uri(path.posix.join(root.path, ...pieces)),
    },
    workspace: {
      getConfiguration: (_section: string, _scope: unknown) => ({
        get: (key: string, fallback: unknown) => config.get(key) ?? fallback,
      }),
      fs: {
        stat: async (uri: any) => {
          if (!data.has(uri.path)) throw Error('missing');
          return { size: data.get(uri.path)!.length };
        },
        readFile: async (uri: any) => Buffer.from(data.get(uri.path)!),
      },
    },
  };
});
beforeEach(() => {
  data.clear();
  config.clear();
  command.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const read = (name: string) =>
  readColorTheme({
    root: vscode.Uri.file('/extension'),
    uri: vscode.Uri.file('/extension/' + name),
  });
it('loads JSONC parent themes before child token rules', async () => {
  data.set(
    '/extension/base.json',
    '{"colors":{"editor.foreground":"#dddddd"},"tokenColors":[{"scope":"keyword","settings":{"foreground":"#112233"}}]}',
  );
  data.set(
    '/extension/themes/child.json',
    '{ // comment\n "include":"../base.json", "tokenColors":[{"scope":"keyword","settings":{"foreground":"#445566"}}],}',
  );
  const rules = await read('themes/child.json');
  expect(rules).toHaveLength(3);
  expect(rules.at(-1)?.settings.foreground).toBe('#445566');
});
it('resolves old plist token themes', async () => {
  data.set('/extension/theme.json', '{"tokenColors":"tokens.tmTheme"}');
  data.set(
    '/extension/tokens.tmTheme',
    '<?xml version="1.0"?><plist version="1.0"><dict><key>settings</key><array><dict><key>scope</key><string>keyword</string><key>settings</key><dict><key>foreground</key><string>#aabbcc</string></dict></dict></array></dict></plist>',
  );
  expect((await read('theme.json'))[0].settings.foreground).toBe('#aabbcc');
});
it('bounds include cycles and refuses includes outside the installed extension', async () => {
  data.set('/extension/a.json', '{"include":"b.json","tokenColors":[]}');
  data.set('/extension/b.json', '{"include":"a.json"}');
  expect(await read('a.json')).toEqual([]);
  data.set('/extension/a.json', '{"include":"../outside.json"}');
  data.set('/outside.json', '{"tokenColors":[{}]}');
  expect(await read('a.json')).toEqual([]);
});
it('maps native token groups including storage.type and punctuation comments', () => {
  const rules = customTokenRules({ keywords: '#123456', comments: '#445566' }, 'Dark+');
  expect(rules.find((r) => r.settings.foreground === '#123456')?.scope).toContain('storage.type');
  expect(rules.find((r) => r.settings.foreground === '#445566')?.scope).toContain(
    'punctuation.definition.comment',
  );
});
it('applies global, matching theme and explicit TextMate rules in order', () => {
  const rules = customTokenRules(
    {
      keywords: '#111111',
      '[Dark*][Light+]': {
        keywords: '#222222',
        textMateRules: [{ scope: 'storage.type', settings: { foreground: '#333333' } }],
      },
      '[Other]': { keywords: '#ffffff' },
    },
    'Dark+',
  );
  expect(rules.map((r) => r.settings.foreground)).toEqual(['#111111', '#222222', '#333333']);
});
it('matches theme punctuation literally and resolves foreground customization layers', () => {
  const values = {
    'editor.foreground': '#111111',
    '[Dark+]': { 'editor.foreground': '#222222' },
    '[Dark.]': { 'editor.foreground': '#333333' },
  };
  expect(Object.assign({}, ...themeCustomizations(values, 'Dark+'))['editor.foreground']).toBe(
    '#222222',
  );
  expect(themeCustomizations(null as any, 'Dark+')).toEqual([]);
});

const colored: CodeColors = {
  runs: [[0, 5, 0]],
  styles: [{ color: '#112233', font: 0 }],
};
function cachedEngine() {
  const colorize = vi.fn<(...args: unknown[]) => Promise<CodeColors>>();
  const adapter = new VSCodeCodeColors(vscode.Uri.file('/extension'));
  vi.spyOn(adapter as any, 'create').mockResolvedValue({
    colorizer: { colorize, dispose: vi.fn() },
    languages: new Map([['typescript', 'source.ts']]),
  });
  const request = () => adapter.colorize('const n = 1;', 'typescript', 0, 12);
  return { adapter, colorize, request };
}
it('retries a previously timed-out selection and caches the recovered colors', async () => {
  const { adapter, colorize, request } = cachedEngine();
  colorize.mockResolvedValueOnce(plainColors()).mockResolvedValue(colored);
  expect(await request()).toEqual(plainColors());
  expect(await request()).toEqual(colored);
  expect(await request()).toEqual(colored);
  expect(colorize).toHaveBeenCalledTimes(2);
  adapter.dispose();
});
it('recovers after a transient engine/theme initialization failure', async () => {
  const { adapter, colorize, request } = cachedEngine();
  colorize.mockResolvedValue(colored);
  (adapter as any).create.mockRejectedValueOnce(new Error('temporarily unavailable'));
  expect(await request()).toEqual(plainColors());
  expect(await request()).toEqual(colored);
  adapter.dispose();
});
it('recovers from a highlighting exception on the next request', async () => {
  const { adapter, colorize, request } = cachedEngine();
  colorize.mockRejectedValueOnce(new Error('temporarily unavailable')).mockResolvedValue(colored);
  expect(await request()).toEqual(plainColors());
  expect(await request()).toEqual(colored);
  adapter.dispose();
});
it('shares pending highlighting work between identical requests', async () => {
  const { adapter, colorize, request } = cachedEngine();
  let complete!: (value: CodeColors) => void;
  colorize.mockReturnValue(new Promise((resolve) => (complete = resolve)));
  const first = request(),
    second = request();
  complete(colored);
  expect(await Promise.all([first, second])).toEqual([colored, colored]);
  expect(colorize).toHaveBeenCalledTimes(1);
  adapter.dispose();
});
it('does not evict new theme colors when an older pending request fails', async () => {
  const { adapter, colorize, request } = cachedEngine();
  let complete!: (value: CodeColors) => void;
  colorize.mockReturnValueOnce(new Promise((resolve) => (complete = resolve)));
  const old = request();
  await Promise.resolve();
  adapter.reset();
  colorize.mockResolvedValue(colored);
  expect(await request()).toEqual(colored);
  complete(plainColors());
  await old;
  expect(await request()).toEqual(colored);
  expect(colorize).toHaveBeenCalledTimes(2);
  adapter.dispose();
});

function semanticEngine() {
  const adapter = new VSCodeCodeColors(vscode.Uri.file('/extension'));
  const engine = {
    semantic: { enabled: true, rules: [['variable', '#123456']] },
    settings: [],
    themeName: 'Dark+',
    scopes: [],
    parents: new Map(),
    colorizer: { dispose: vi.fn() },
  };
  vi.spyOn(adapter as any, 'create').mockResolvedValue(engine);
  const source = 'const n = 1;';
  const document = {
    uri: vscode.Uri.file('/code.ts'),
    languageId: 'typescript',
    version: 1,
    isClosed: false,
    getText: () => source,
    positionAt: (offset: number) => ({ line: 0, character: offset }),
  } as any;
  const base: CodeColors = {
    runs: [[0, source.length, 0]],
    styles: [{ color: '#aaaaaa', font: 0 }],
  };
  command.mockImplementation(async (name: string) =>
    name.endsWith('Legend')
      ? { tokenTypes: ['variable'], tokenModifiers: ['declaration'] }
      : { data: [0, 6, 1, 0, 1] },
  );
  const request = (text = source) => adapter.withSemantic(base, document, text, 0, text.length);
  return { adapter, engine, document, base, source, request };
}
it('reads inherited semantic theme rules and child opt-in separately from syntax rules', async () => {
  data.set(
    '/extension/base.json',
    '{"semanticHighlighting":true,"semanticTokenColors":{"class":"#123456"}}',
  );
  data.set(
    '/extension/child.json',
    '{"include":"base.json","semanticHighlighting":false,"semanticTokenColors":{"class":"#654321"}}',
  );
  const semantic = { enabled: undefined as boolean | undefined, rules: [] as [string, unknown][] };
  await readColorTheme(
    { root: vscode.Uri.file('/extension'), uri: vscode.Uri.file('/extension/child.json') },
    new Set(),
    semantic,
  );
  expect(semantic).toEqual({
    enabled: false,
    rules: [
      ['class', '#123456'],
      ['class', '#654321'],
    ],
  });
});
it('uses native range providers with theme-specific semantic overrides', async () => {
  const { adapter, request } = semanticEngine();
  config.set('semanticTokenColorCustomizations', { '[Dark+]': { rules: { variable: '#abcdef' } } });
  const result = await request();
  const run = result.runs.find(([a, b]) => a === 6 && b === 7)!;
  expect(result.styles[run[2]].color).toBe('#ABCDEF');
  expect(command.mock.calls.map((c) => c[0])).toEqual([
    'vscode.provideDocumentRangeSemanticTokensLegend',
    'vscode.provideDocumentRangeSemanticTokens',
  ]);
  adapter.dispose();
});
it('honors disabled semantic highlighting even when theme customization enables it', async () => {
  const { adapter, request, base } = semanticEngine();
  config.set('semanticHighlighting.enabled', false);
  config.set('semanticTokenColorCustomizations', { enabled: true });
  expect(await request()).toBe(base);
  expect(command).not.toHaveBeenCalled();
  adapter.dispose();
});
it('falls back from missing range providers to document providers', async () => {
  const { adapter, request } = semanticEngine();
  command.mockImplementation(async (name: string) =>
    name.includes('DocumentRange')
      ? undefined
      : name.endsWith('Legend')
        ? { tokenTypes: ['variable'], tokenModifiers: [] }
        : { data: [0, 6, 1, 0, 0] },
  );
  expect((await request()).styles.some((s) => s.color === '#123456')).toBe(true);
  expect(command).toHaveBeenCalledWith('vscode.provideDocumentSemanticTokens', expect.anything());
  adapter.dispose();
});
it('keeps drafts local and never borrows semantic positions from different source', async () => {
  const { adapter, request, base } = semanticEngine();
  expect(await request('const longerName = 1;')).toBe(base);
  expect(command).not.toHaveBeenCalled();
  adapter.dispose();
});
it('discards semantic results after a document edit or theme reset', async () => {
  const { adapter, request, base, document } = semanticEngine();
  command.mockImplementation(async () => {
    document.version++;
    return { tokenTypes: ['variable'], tokenModifiers: [] };
  });
  expect(await request()).toBe(base);
  command.mockImplementation(async () => {
    adapter.reset();
    return undefined;
  });
  expect(await request()).toBe(base);
  adapter.dispose();
});
it('keeps syntax on provider failure and retries later without caching the failure', async () => {
  const { adapter, request, base } = semanticEngine();
  command.mockRejectedValueOnce(new Error('warming up'));
  expect(await request()).toBe(base);
  expect((await request()).styles.some((s) => s.color === '#123456')).toBe(true);
  adapter.dispose();
});
it('bounds stalled semantic requests without losing syntax colors', async () => {
  vi.useFakeTimers();
  const { adapter, request, base } = semanticEngine();
  command.mockImplementation(() => new Promise(() => {}));
  const pending = request();
  await vi.advanceTimersByTimeAsync(2001);
  expect(await pending).toBe(base);
  adapter.dispose();
});
