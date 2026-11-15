import type { IRawTheme } from 'vscode-textmate';
import { type CodeColors, plainColors, safeColor } from './code-colors';
import { createMatchers, type MatcherWithPriority } from './textmate-scope-matcher';

export type SemanticStyle = {
  color?: string;
  italic?: boolean;
  bold?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
};
export type SemanticRange = { start: number; end: number; type: string; modifiers: string[] };
export type ScopeRule = { selector: string; language?: string; scopes: string[][] };
const fonts = { italic: 1, bold: 2, underline: 4, strikethrough: 8 } as const;
const properties = ['color', ...Object.keys(fonts)] as (keyof SemanticStyle)[];

function hex(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  if (/^#[\da-f]{3,4}$/i.test(value)) value = '#' + [...value.slice(1)].map((c) => c + c).join('');
  return safeColor(value) ? value.toUpperCase() : undefined;
}
function style(value: any): SemanticStyle {
  if (typeof value === 'string') return { color: hex(value) };
  if (!value || typeof value !== 'object') return {};
  const result: SemanticStyle = { color: hex(value.foreground) };
  for (const name of Object.keys(fonts) as (keyof typeof fonts)[]) {
    if (typeof value.fontStyle === 'string')
      result[name] = value.fontStyle.split(/\s+/).includes(name);
    else if (typeof value[name] === 'boolean') result[name] = value[name];
  }
  return result;
}

// VS Code's standard semantic fallback scopes; installed extensions can add language-specific rules.
const fallback: Record<string, string[]> = {
  comment: ['comment'],
  string: ['string'],
  keyword: ['keyword.control'],
  number: ['constant.numeric'],
  regexp: ['constant.regexp'],
  operator: ['keyword.operator'],
  namespace: ['entity.name.namespace'],
  type: ['entity.name.type', 'support.type'],
  struct: ['entity.name.type.struct'],
  class: ['entity.name.type.class', 'support.class'],
  interface: ['entity.name.type.interface'],
  enum: ['entity.name.type.enum'],
  typeParameter: ['entity.name.type.parameter'],
  function: ['entity.name.function', 'support.function'],
  method: ['entity.name.function.member', 'support.function'],
  macro: ['entity.name.function.preprocessor'],
  variable: ['variable.other.readwrite', 'entity.name.variable'],
  parameter: ['variable.parameter'],
  property: ['variable.other.property'],
  enumMember: ['variable.other.enummember'],
  event: ['variable.other.event'],
  decorator: ['entity.name.decorator', 'entity.name.function'],
  'variable.readonly': ['variable.other.constant'],
  'property.readonly': ['variable.other.constant.property'],
  'type.defaultLibrary': ['support.type'],
  'class.defaultLibrary': ['support.class'],
  'interface.defaultLibrary': ['support.class'],
  'variable.defaultLibrary': ['support.variable', 'support.other.variable'],
  'variable.defaultLibrary.readonly': ['support.constant'],
  'property.defaultLibrary': ['support.variable.property'],
  'property.defaultLibrary.readonly': ['support.constant.property'],
  'function.defaultLibrary': ['support.function'],
  'member.defaultLibrary': ['support.function'],
};

/** Matches native per-property precedence, including explicit false font flags and subtype rules. */
export class SemanticPalette {
  private scopes: { match: (scopes: string[]) => number; style: SemanticStyle }[];
  private defaults: ScopeRule[];
  constructor(
    syntax: IRawTheme['settings'],
    private rules: [string, unknown][],
    scopes: ScopeRule[] = [],
    private parents = new Map<string, string>([['member', 'method']]),
  ) {
    this.defaults = [
      ...Object.entries(fallback).map(([selector, names]) => ({
        selector,
        scopes: names.map((n) => [n]),
      })),
      ...scopes,
    ];
    this.scopes = syntax.slice(0, 10000).flatMap((rule) => {
      if (!rule.scope || !rule.settings) return [];
      const matchers: MatcherWithPriority<string[]>[] = [];
      const nameMatch = (names: string[], stack: string[]) => {
        let index = 0,
          score = -1;
        for (let n = 0; n < names.length; n++) {
          while (
            index < stack.length &&
            stack[index] !== names[n] &&
            !stack[index].startsWith(names[n] + '.')
          )
            index++;
          if (index === stack.length) return -1;
          index++;
          score = (n + 1) * 65536 + names[n].length;
        }
        return score;
      };
      for (const selector of Array.isArray(rule.scope) ? rule.scope : [rule.scope]) {
        if (
          typeof selector === 'string' &&
          selector.length <= 1000 &&
          (selector.match(/\(/g)?.length ?? 0) <= 20
        )
          createMatchers(selector, nameMatch, matchers);
      }
      return [
        {
          match: (stack: string[]) => Math.max(-1, ...matchers.map((m) => m.matcher(stack))),
          style: style(rule.settings),
        },
      ];
    });
  }
  private score(selector: string, type: string, modifiers: string[], language: string): number {
    if (!/^(?:[\w+-]+|\*)(?:\.[\w+-]+)*(?::[\w+-]+)?$/.test(selector)) return -1;
    const [names, lang] = selector.split(':');
    if (lang !== undefined && lang !== language) return -1;
    const [wanted, ...required] = names.split('.');
    if (!required.every((m) => modifiers.includes(m))) return -1;
    let score = (lang === undefined ? 0 : 10) + required.length * 100;
    if (wanted !== '*') {
      const seen = new Set<string>();
      while (type !== wanted && !seen.has(type) && seen.size < 32) {
        seen.add(type);
        type = this.parents.get(type) ?? '';
      }
      if (type !== wanted) return -1;
      score += 100 - seen.size;
    }
    return score;
  }
  private probe(candidates: string[][]): SemanticStyle | undefined {
    for (const stack of candidates) {
      const result: SemanticStyle = {},
        scores = new Map<keyof SemanticStyle, number>();
      for (const rule of this.scopes) {
        const score = rule.match(stack);
        if (score < 0) continue;
        for (const key of properties)
          if (rule.style[key] !== undefined && score >= (scores.get(key) ?? -1)) {
            (result as any)[key] = rule.style[key];
            scores.set(key, score);
          }
      }
      if (scores.size) return result;
    }
  }
  resolve(type: string, modifiers: string[], language: string): SemanticStyle {
    const result: SemanticStyle = {},
      scores = new Map<keyof SemanticStyle, number>();
    const apply = (values: SemanticStyle, score: number) => {
      if (score < 0) return;
      for (const key of properties)
        if (values[key] !== undefined && score >= (scores.get(key) ?? -1)) {
          (result as any)[key] = values[key];
          scores.set(key, score);
        }
    };
    for (const [selector, values] of this.rules.slice(0, 10000))
      apply(style(values), this.score(selector, type, modifiers, language));
    // Explicit semantic styling wins; fill only missing properties from TextMate fallback rules.
    for (const key of scores.keys()) scores.set(key, Number.MAX_VALUE);
    for (const rule of this.defaults) {
      if (rule.language && rule.language !== language) continue;
      const score = this.score(rule.selector, type, modifiers, language);
      if (score >= 0) apply(this.probe(rule.scopes) ?? {}, score);
    }
    return result;
  }
}

/** Decode the public semantic token format using UTF-16 document offsets. Reject invalid batches. */
export function semanticRanges(
  source: string,
  data: ArrayLike<number>,
  legend: { tokenTypes: string[]; tokenModifiers: string[] },
): SemanticRange[] {
  if (
    !data ||
    data.length % 5 ||
    data.length > 250000 ||
    !Array.isArray(legend?.tokenTypes) ||
    !Array.isArray(legend?.tokenModifiers)
  )
    return [];
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
  const result: SemanticRange[] = [];
  let line = 0,
    column = 0,
    previousEnd = 0;
  for (let i = 0; i < data.length; i += 5) {
    const values = Array.from({ length: 5 }, (_, n) => data[i + n]);
    if (values.some((n) => !Number.isSafeInteger(n) || n < 0 || n > 0xffffffff)) return [];
    const [delta, character, length, index, flags] = values;
    line += delta;
    column = delta ? character : column + character;
    const start = starts[line] + column,
      end = start + length;
    let limit = starts[line + 1] === undefined ? source.length : starts[line + 1] - 1;
    if (source[limit - 1] === '\r') limit--;
    if (
      !length ||
      starts[line] === undefined ||
      end > limit ||
      start < previousEnd ||
      typeof legend.tokenTypes[index] !== 'string'
    )
      return [];
    previousEnd = end;
    result.push({
      start,
      end,
      type: legend.tokenTypes[index],
      modifiers: legend.tokenModifiers.slice(0, 32).filter((_, bit) => (flags & (1 << bit)) !== 0),
    });
  }
  return result;
}

/** Overlay foreground/font properties only; keep syntax colors for everything a provider omits. */
export function overlaySemantic(
  base: CodeColors,
  ranges: SemanticRange[],
  start: number,
  end: number,
  palette: SemanticPalette,
  language: string,
): CodeColors {
  if (!base.runs.length || end - start > 50000) return base;
  const indices = new Int32Array(end - start).fill(-1),
    styles = base.styles.map((s) => ({ ...s }));
  const known = new Map(styles.map((s, i) => [s.color + ':' + s.font, i]));
  for (const [a, b, index] of base.runs) indices.fill(index, a, b);
  const resolved = new Map<string, SemanticStyle>();
  const deadline = performance.now() + 150;
  for (const range of ranges) {
    if (performance.now() > deadline || resolved.size > 256) return base;
    const a = Math.max(start, range.start) - start,
      b = Math.min(end, range.end) - start;
    if (a >= b) continue;
    const key = JSON.stringify([range.type, range.modifiers]);
    let overlay = resolved.get(key);
    if (!overlay) {
      overlay = palette.resolve(range.type, range.modifiers, language);
      resolved.set(key, overlay);
    }
    for (let i = a; i < b; i++) {
      const before = styles[indices[i]];
      if (!before) continue;
      const color = overlay.color ?? before.color;
      let font = before.font;
      for (const [name, bit] of Object.entries(fonts))
        if (overlay[name as keyof typeof fonts] !== undefined)
          font = overlay[name as keyof typeof fonts] ? font | bit : font & ~bit;
      const styleKey = color + ':' + font;
      let index = known.get(styleKey);
      if (index === undefined) {
        index = styles.length;
        styles.push({ color, font });
        known.set(styleKey, index);
      }
      indices[i] = index;
    }
  }
  const result = plainColors();
  result.styles = styles;
  for (let a = 0; a < indices.length;) {
    let b = a + 1;
    while (b < indices.length && indices[b] === indices[a]) b++;
    if (indices[a] >= 0) result.runs.push([a, b, indices[a]]);
    if (result.runs.length > 12000) return base;
    a = b;
  }
  return result;
}
