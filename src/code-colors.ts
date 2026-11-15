import { Registry, parseRawGrammar, type IRawTheme, type StateStack } from 'vscode-textmate';
import { createOnigScanner, createOnigString, loadWASM } from 'vscode-oniguruma';

export type CodeColors = {
  runs: [number, number, number][];
  styles: { color: string; font: number }[];
};
export const plainColors = (): CodeColors => ({ runs: [], styles: [] });
export const safeColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(value);
let onig: Promise<void> | undefined;
export function oniguruma(bytes: () => Promise<Uint8Array>) {
  return (onig ??= bytes()
    .then((data) =>
      loadWASM(
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
      ),
    )
    .catch((error) => {
      onig = undefined;
      throw error;
    }));
}

/** Uses the same grammar/token-theme engine as VS Code; never executes source code. */
export class CodeColorizer {
  private registry: Registry;
  private active = 0;
  private disposed = false;
  private report?: (message: string) => void;
  constructor(options: {
    wasm: () => Promise<Uint8Array>;
    theme: IRawTheme;
    grammar: (scope: string) => Promise<{ text: string; file: string } | undefined>;
    injections: (scope: string) => string[];
    report?: (message: string) => void;
  }) {
    this.report = options.report;
    const library = oniguruma(options.wasm).then(() => ({ createOnigScanner, createOnigString }));
    // Unknown languages may never load a grammar; still handle a missing runtime gracefully.
    void library.catch(() => {});
    this.registry = new Registry({
      theme: options.theme,
      onigLib: library,
      loadGrammar: async (scope) => {
        const grammar = await options.grammar(scope);
        return grammar ? parseRawGrammar(grammar.text, grammar.file) : null;
      },
      getInjections: options.injections,
    });
  }
  dispose() {
    this.disposed = true;
    if (!this.active) this.registry.dispose();
  }
  async colorize(source: string, scope: string, start: number, end: number): Promise<CodeColors> {
    if (this.disposed) return plainColors();
    this.active++;
    try {
      return await this.tokens(source, scope, start, end);
    } finally {
      if (--this.active === 0 && this.disposed) this.registry.dispose();
    }
  }
  private async tokens(
    source: string,
    scope: string,
    start: number,
    end: number,
  ): Promise<CodeColors> {
    if (
      source.length > 500000 ||
      end - start > 50000 ||
      start < 0 ||
      end < start ||
      end > source.length
    )
      return plainColors();
    const grammar = await this.registry.loadGrammar(scope).catch((error) => {
      this.report?.(String(error));
      return null;
    });
    if (!grammar) return plainColors();
    const result = plainColors(),
      styles = new Map<number, number>();
    const colors = this.registry.getColorMap();
    let state: StateStack | null = null,
      offset = 0,
      lines = 0;
    let deadline = performance.now() + 750,
      retried = false;
    let lastYield = performance.now();
    for (const line of source.split('\n')) {
      if (offset >= end) break;
      const remaining = deadline - performance.now();
      if (++lines > 10000 || line.length > 20000 || remaining <= 0) {
        this.report?.('Color budget exceeded');
        return plainColors();
      }
      // Regexes compile lazily wherever new syntax first appears, not just on line 1.
      // Let every line use the remaining shared budget instead of a tiny fixed slice.
      let tokens = grammar.tokenizeLine2(line, state, remaining);
      if (tokens.stoppedEarly && !retried) {
        // Cold compilation can consume the budget before matching finishes. Retry
        // once with warmed regexes and the original (not partial) lexical state.
        retried = true;
        await new Promise((resolve) => setTimeout(resolve, 0));
        deadline = performance.now() + 250;
        tokens = grammar.tokenizeLine2(line, state, 250);
        lastYield = performance.now();
      }
      if (tokens.stoppedEarly) {
        this.report?.(`Grammar line ${lines} timed out`);
        return plainColors();
      }
      state = tokens.ruleStack;
      for (let i = 0; i < tokens.tokens.length; i += 2) {
        const from = Math.max(start, offset + tokens.tokens[i]);
        const to = Math.min(end, offset + (tokens.tokens[i + 2] ?? line.length));
        if (from >= to) continue;
        const metadata = tokens.tokens[i + 1];
        const color = colors[(metadata >>> 15) & 511];
        if (!safeColor(color)) continue;
        const font = (metadata >>> 11) & 15;
        const key = metadata & 0xffffff;
        let style = styles.get(key);
        if (style === undefined) {
          style = result.styles.length;
          styles.set(key, style);
          result.styles.push({ color, font });
        }
        result.runs.push([from - start, to - start, style]);
        if (result.runs.length > 12000) return plainColors();
      }
      offset += line.length + 1;
      if (offset < end && performance.now() - lastYield >= 16) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        lastYield = performance.now();
      }
    }
    return result;
  }
}
