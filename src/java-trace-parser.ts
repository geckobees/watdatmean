// Deliberately small Java 17 grammar. Unsupported/ambiguous syntax rejects the whole trace.
// This is a data reader, not a Java runtime; no user code or external helper is executed.
import { exceptionNames } from './java-exceptions';
import { optionalNames, optionalElement } from './java-optionals';
import {
  functionalNames,
  streamNames,
  importedJavaName,
  functionalType,
  streamElement,
} from './java-streams';
export type JExpr =
  | { kind: 'methodRef'; target: JExpr; name: string }
  | { kind: 'lambda'; params: { name: string; type?: string }[]; body: JExpr | JStmt[] }
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'name'; name: string }
  | { kind: 'member'; target: JExpr; name: string; typeArgs?: string[] }
  | { kind: 'call'; target: JExpr; args: JExpr[] }
  | { kind: 'new'; type: string; args: JExpr[] }
  | { kind: 'array'; type?: string; dimensions?: (JExpr | null)[]; items?: JExpr[] }
  | { kind: 'index'; target: JExpr; index: JExpr }
  | { kind: 'cast'; type: string; value: JExpr }
  | { kind: 'binary'; op: string; left: JExpr; right: JExpr }
  | { kind: 'negative'; value: JExpr }
  | { kind: 'not'; value: JExpr }
  | { kind: 'increment'; target: JExpr; delta: number; prefix: boolean };
export type JStmt =
  | { kind: 'print'; value: JExpr; newline: boolean }
  | { kind: 'assign'; target: JExpr; op: string; value: JExpr }
  | { kind: 'call'; value: JExpr }
  | { kind: 'super'; args: JExpr[] }
  | { kind: 'declare'; type: string; name: string; value: JExpr; final?: boolean }
  | { kind: 'return'; value?: JExpr }
  | { kind: 'throw'; value: JExpr }
  | {
      kind: 'try';
      body: JStmt[];
      catches: { types: string[]; name: string; body: JStmt[] }[];
      final?: JStmt[];
    }
  | { kind: 'block'; body: JStmt[] }
  | { kind: 'if'; condition: JExpr; yes: JStmt[]; no: JStmt[] }
  | {
      kind: 'loop';
      form: 'for' | 'while' | 'do';
      init?: JStmt;
      condition?: JExpr;
      update?: JStmt;
      body: JStmt[];
    }
  | { kind: 'foreach'; type: string; name: string; iterable: JExpr; body: JStmt[] }
  | { kind: 'break' | 'continue' };
export type JParameter = { name: string; type: string };
export type JTypeParameter = { name: string; bound: string };
export type JField = { name: string; type: string; initial?: JExpr };
export type JMethod = {
  typeParams?: JTypeParameter[];
  abstract?: boolean;
  default?: boolean;
  name: string;
  static: boolean;
  public: boolean;
  override: boolean;
  params: JParameter[];
  returns: string;
  throws: string[];
  body: JStmt[];
};
export type JClass = {
  interface?: boolean;
  functional?: boolean;
  interfaces?: string[];
  typeParams?: JTypeParameter[];
  rawName?: string;
  name: string;
  parent?: string;
  enclosing?: string;
  fields: JField[];
  initializers: (JField | JStmt[])[];
  constructor: JStmt[];
  throws: string[];
  params: JParameter[];
  methods: JMethod[];
};
export type JProgram = {
  outer: string;
  argument: string;
  classes: JClass[];
  main: JStmt[];
  imports: string[];
  throws: string[];
};
export const collectionNames = [
  'List',
  'ArrayList',
  'Set',
  'HashSet',
  'LinkedHashSet',
  'Map',
  'HashMap',
  'LinkedHashMap',
  'Arrays',
];
type Token = { text: string; value?: string | number; kind: 'word' | 'symbol' | 'literal' };
const forbidden = new Set(
  'String System Object abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null _ var record sealed permits yield'.split(
    ' ',
  ),
);
export function reject(): never {
  throw new Error('Outside the supported Java trace grammar.');
}

export function javaTokens(code: string): Token[] {
  if (code.length > 12000 || /\\u/.test(code)) reject(); // Java processes Unicode escapes before comments.
  const tokens: Token[] = [];
  let at = 0;
  while (at < code.length) {
    if (/[ \t\r\n\f]/.test(code[at])) {
      at++;
      continue;
    }
    if (code.startsWith('//', at)) {
      const end = code.slice(at + 2).search(/[\r\n]/);
      at = end < 0 ? code.length : at + 2 + end;
      continue;
    }
    if (code.startsWith('/*', at)) {
      const end = code.indexOf('*/', at + 2);
      if (end < 0) reject();
      at = end + 2;
      continue;
    }
    if (code[at] === '"') {
      const start = at++;
      let value = '',
        closed = false;
      const escapes: Record<string, string> = {
        '"': '"',
        "'": "'",
        '\\': '\\',
        n: '\n',
        r: '\r',
        t: '\t',
        b: '\b',
        f: '\f',
      };
      while (at < code.length) {
        const ch = code[at++];
        if (ch === '"') {
          closed = true;
          break;
        }
        if (ch === '\n' || ch === '\r') reject();
        if (ch === '\\') {
          const next = code[at++];
          if (!Object.hasOwn(escapes, next)) reject();
          value += escapes[next];
        } else value += ch;
      }
      if (!closed || value.length > 2000) reject();
      tokens.push({ text: code.slice(start, at), value, kind: 'literal' });
    } else {
      const word = /^[A-Za-z_$][\w$]*/.exec(code.slice(at));
      const number = /^(?:0|[1-9]\d*)/.exec(code.slice(at));
      if (word) {
        tokens.push({ text: word[0], kind: 'word' });
        at += word[0].length;
      } else if (number) {
        const value = Number(number[0]);
        if (value > 2147483647) reject();
        tokens.push({ text: number[0], value, kind: 'literal' });
        at += number[0].length;
      } else {
        const op =
          /^(?:::|->|\+\+|--|<=|>=|==|!=|&&|\|\||\+=|\*=|-=|\/=|%=|[{}()[\];:.,@=!<>+*\/%\-|])/.exec(
            code.slice(at),
          );
        if (!op) reject();
        tokens.push({ text: op[0], kind: 'symbol' });
        at += op[0].length;
      }
    }
    if (tokens.length > 2000) reject();
  }
  return tokens;
}

export function parseJavaTrace(code: string): JProgram {
  const tokens = javaTokens(code);
  let at = 0,
    depth = 0;
  const classNames = new Set(
    tokens
      .filter((t, i) => i > 0 && ['class', 'interface'].includes(tokens[i - 1].text))
      .map((t) => t.text),
  );
  let typeVariables = new Map<string, string>();
  let typeSerial = 0;
  const peek = (offset = 0) => tokens[at + offset]?.text;
  const take = (word: string) => {
    if (peek() !== word) return false;
    at++;
    return true;
  };
  const need = (word: string) => {
    if (!take(word)) reject();
  };
  const name = () => {
    const t = tokens[at++];
    if (t?.kind !== 'word' || forbidden.has(t.text)) reject();
    return t.text;
  };
  const classes: JClass[] = [];
  const imports: string[] = [];
  while (take('import')) {
    need('java');
    need('.');
    need('util');
    need('.');
    let prefix = '';
    if (peek() === 'stream' || peek() === 'function') {
      prefix = name() + '.';
      need('.');
    }
    const imported = take('*') ? '*' : name();
    const allowed =
      prefix === 'stream.'
        ? streamNames
        : prefix === 'function.'
          ? functionalNames
          : [...collectionNames, ...optionalNames, 'NoSuchElementException'];
    if (imported !== '*' && !allowed.includes(imported)) reject();
    need(';');
    imports.push(prefix + imported);
  }
  if (
    [...classNames].some(
      (n) =>
        [
          ...collectionNames,
          ...streamNames,
          ...functionalNames,
          ...optionalNames,
          'Runnable',
        ].includes(n) || ['Integer', 'Boolean', 'Number', ...exceptionNames].includes(n),
    )
  )
    reject();
  let main: JStmt[] | undefined,
    argument = '',
    outer = '';
  let mainThrows: string[] = [];
  const baseType = () =>
    [
      'int',
      'long',
      'boolean',
      'String',
      'Integer',
      'Object',
      'Number',
      'Runnable',
      ...optionalNames,
      ...collectionNames,
      ...streamNames,
      ...functionalNames,
      ...exceptionNames,
    ].includes(peek()) ||
    classNames.has(peek()) ||
    typeVariables.has(peek());
  function brackets(type: string): string {
    let count = 0;
    while (peek() === '[' && peek(1) === ']') {
      at += 2;
      type += '[]';
      if (++count > 3) reject();
    }
    return type;
  }
  function throwsList(): string[] {
    const result: string[] = [];
    if (take('throws'))
      do {
        const type = name();
        if (!exceptionNames.includes(type)) reject();
        result.push(type);
      } while (take(','));
    return result;
  }
  function argumentsList(): JExpr[] {
    need('(');
    const args: JExpr[] = [];
    if (take(')')) return args;
    do {
      args.push(expression());
      if (args.length > 6) reject();
    } while (take(','));
    need(')');
    return args;
  }
  function parameters(): JParameter[] {
    need('(');
    const result: JParameter[] = [];
    if (take(')')) return result;
    do {
      let type = typeName();
      const parameter = name();
      type = brackets(type);
      if (classNames.has(parameter) || result.some((p) => p.name === parameter)) reject();
      result.push({ name: parameter, type });
      if (result.length > 6) reject();
    } while (take(','));
    need(')');
    return result;
  }
  function typeName(diamond = false, arraySuffix = true): string {
    const type = peek();
    if (typeVariables.has(type)) {
      at++;
      return arraySuffix ? brackets(typeVariables.get(type)!) : typeVariables.get(type)!;
    }
    if (
      ![
        'int',
        'long',
        'boolean',
        'String',
        'Integer',
        'Object',
        'Number',
        'Runnable',
        ...optionalNames,
        ...collectionNames,
        ...streamNames,
        ...functionalNames,
        ...exceptionNames,
      ].includes(type) &&
      !classNames.has(type)
    )
      reject();
    at++;
    if (classNames.has(type) && take('<')) {
      if (diamond && take('>')) return type + '<>';
      const args: string[] = [];
      do {
        if (++depth > 16) reject();
        const arg = typeName();
        depth--;
        if (['int', 'long', 'boolean'].includes(arg) || args.length >= 3) reject();
        args.push(arg);
      } while (take(','));
      need('>');
      return `${type}<${args.join(',')}>`;
    }
    if (
      streamNames.includes(type) ||
      functionalNames.includes(type) ||
      optionalNames.includes(type)
    ) {
      if (!importedJavaName(type, imports) || type === 'Collectors') reject();
      if (
        type === 'IntStream' ||
        type === 'OptionalInt' ||
        (type.startsWith('Int') && type !== 'IntFunction')
      )
        return type;
      need('<');
      const args: string[] = [];
      do {
        if (++depth > 16) reject();
        const arg = typeName();
        depth--;
        if (['int', 'long', 'boolean'].includes(arg)) reject();
        args.push(arg);
      } while (take(','));
      need('>');
      const full = `${type}<${args.join(',')}>`;
      if (!streamElement(full) && !functionalType(full) && !optionalElement(full)) reject();
      return full;
    }
    if (!collectionNames.includes(type)) return arraySuffix ? brackets(type) : type;
    if (type === 'Arrays') reject();
    if (!imports.includes(type) && !imports.includes('*')) reject();
    need('<');
    if (diamond && take('>')) return type + '<>';
    const args: string[] = [];
    do {
      const arg = peek();
      if (!['String', 'Integer'].includes(arg)) reject();
      at++;
      args.push(arg);
    } while (take(','));
    need('>');
    if (args.length !== (type.endsWith('Map') || type === 'Map' ? 2 : 1)) reject();
    return `${type}<${args.join(',')}>`;
  }
  function expression(min = 0): JExpr {
    if (++depth > 16) reject();
    let left: JExpr;
    const token = tokens[at];
    if (!token) reject();
    // A lambda's parameter list is distinguished by ->; ordinary groups/casts keep their grammar.
    const saved = at;
    let lambdaParams: { name: string; type?: string }[] | undefined;
    if (min === 0 && token.kind === 'word' && peek(1) === '->') lambdaParams = [{ name: name() }];
    else if (min === 0 && peek() === '(') {
      try {
        at++;
        const params: { name: string; type?: string }[] = [];
        if (!take(')')) {
          do {
            const type = baseType() ? typeName() : undefined;
            params.push({ name: name(), type });
            if (params.length > 2) reject();
          } while (take(','));
          need(')');
        }
        if (peek() === '->') lambdaParams = params;
      } catch {
        /* Not a lambda parameter list. */
      }
      if (!lambdaParams) at = saved;
    }
    if (lambdaParams) {
      need('->');
      if (
        new Set(lambdaParams.map((p) => p.name)).size !== lambdaParams.length ||
        (lambdaParams.some((p) => p.type) && lambdaParams.some((p) => !p.type))
      )
        reject();
      let body: JExpr | JStmt[];
      if (peek() === '{') body = block();
      else if (peek() === 'System' && peek(1) === '.') {
        at++;
        need('.');
        need('out');
        need('.');
        const method = name();
        if (!['print', 'println'].includes(method)) reject();
        const values = argumentsList();
        if (values.length !== 1) reject();
        body = [{ kind: 'print', value: values[0], newline: method === 'println' }];
      } else body = expression();
      depth--;
      return { kind: 'lambda', params: lambdaParams, body };
    }
    if (take('new')) {
      const type = typeName(true, false);
      if (peek() === '[') {
        const dimensions: (JExpr | null)[] = [];
        let empty = false;
        while (take('[')) {
          const dim = peek() === ']' ? null : expression();
          need(']');
          if (empty && dim) reject();
          empty ||= dim === null;
          dimensions.push(dim);
          if (dimensions.length > 3) reject();
        }
        const arrayType = type + '[]'.repeat(dimensions.length);
        if (dimensions[0] === null) {
          if (dimensions.some(Boolean)) reject();
          left = { ...arrayInitializer(), type: arrayType };
        } else left = { kind: 'array', type: arrayType, dimensions };
      } else left = { kind: 'new', type, args: argumentsList() };
    } else if (peek() === '++' || peek() === '--') {
      const delta = take('++') ? 1 : (need('--'), -1);
      left = { kind: 'increment', target: expression(30), delta, prefix: true };
    } else if (take('!')) left = { kind: 'not', value: expression(30) };
    else if (take('-')) left = { kind: 'negative', value: expression(30) };
    else if (take('(')) {
      const start = at;
      let castType: string | undefined;
      if (baseType()) {
        try {
          const type = typeName();
          if (peek() === ')' && !['int', 'boolean'].includes(type)) castType = type;
        } catch {
          /* Try a parenthesized expression instead. */
        }
      }
      if (castType) {
        need(')');
        left = { kind: 'cast', type: castType, value: expression(30) };
      } else {
        at = start;
        left = expression();
        need(')');
      }
    } else if (token.kind === 'literal') {
      at++;
      left = { kind: 'literal', value: token.value! };
    } else if (take('null')) left = { kind: 'literal', value: null };
    else if (take('true')) left = { kind: 'literal', value: true };
    else if (take('false')) left = { kind: 'literal', value: false };
    else if (take('String')) left = { kind: 'name', name: 'String' };
    else if (take('Object')) left = { kind: 'name', name: 'Object' };
    else if (take('System')) left = { kind: 'name', name: 'System' };
    else if (take('this')) left = { kind: 'name', name: 'this' };
    else if (take('super')) {
      if (peek() !== '.') reject();
      left = { kind: 'name', name: 'super' };
    } else left = { kind: 'name', name: name() };
    while (true) {
      if (take('::'))
        left = { kind: 'methodRef', target: left, name: take('new') ? 'new' : name() };
      else if (take('.')) {
        let typeArgs: string[] | undefined;
        if (take('<')) {
          typeArgs = [typeName()];
          need('>');
        }
        left = { kind: 'member', target: left, name: name(), ...(typeArgs ? { typeArgs } : {}) };
      } else if (take('[')) {
        const index = expression();
        need(']');
        left = { kind: 'index', target: left, index };
      } else if (peek() === '(') {
        left = { kind: 'call', target: left, args: argumentsList() };
      } else break;
    }
    if (peek() === '++' || peek() === '--') {
      const delta = take('++') ? 1 : (need('--'), -1);
      left = { kind: 'increment', target: left, delta, prefix: false };
    }
    while (true) {
      const op = peek(),
        precedence = ['*', '/', '%'].includes(op)
          ? 20
          : op === '+' || op === '-'
            ? 10
            : ['<', '<=', '>', '>='].includes(op)
              ? 8
              : ['==', '!='].includes(op)
                ? 7
                : op === '&&'
                  ? 5
                  : op === '||'
                    ? 4
                    : 0;
      if (!precedence || precedence < min) break;
      at++;
      left = { kind: 'binary', op, left, right: expression(precedence + 1) };
    }
    depth--;
    return left;
  }
  const condition = () => {
    need('(');
    const result = expression();
    need(')');
    return result;
  };
  function arrayInitializer(): Extract<JExpr, { kind: 'array' }> {
    need('{');
    const items: JExpr[] = [];
    if (!take('}')) {
      do {
        if (peek() === '}') break;
        items.push(peek() === '{' ? arrayInitializer() : expression());
        if (items.length > 128) reject();
      } while (take(','));
      need('}');
    }
    return { kind: 'array', items };
  }
  function branch(): JStmt[] {
    const result = peek() === '{' ? block() : [statement()];
    if (result.some((s) => s.kind === 'declare') && tokens[at - 1]?.text !== '}') reject();
    return result;
  }
  function statement(ending = true): JStmt {
    if (take('try')) {
      const body = block(),
        catches: Extract<JStmt, { kind: 'try' }>['catches'] = [];
      while (take('catch')) {
        need('(');
        const types: string[] = [];
        do {
          const type = name();
          if (!exceptionNames.includes(type)) reject();
          types.push(type);
        } while (take('|'));
        const variable = name();
        need(')');
        catches.push({ types, name: variable, body: block() });
        if (catches.length > 8) reject();
      }
      const final = take('finally') ? block() : undefined;
      if (!catches.length && !final) reject();
      return { kind: 'try', body, catches, final };
    }
    if (take('throw')) {
      const value = expression();
      need(';');
      return { kind: 'throw', value };
    }
    if (peek() === '{') return { kind: 'block', body: block() };
    if (take('if')) {
      const test = condition(),
        yes = branch(),
        no = take('else') ? branch() : [];
      return { kind: 'if', condition: test, yes, no };
    }
    if (take('while')) {
      const test = condition();
      return { kind: 'loop', form: 'while', condition: test, body: branch() };
    }
    if (take('do')) {
      const body = branch();
      need('while');
      const test = condition();
      need(';');
      return { kind: 'loop', form: 'do', condition: test, body };
    }
    if (take('for')) {
      need('(');
      const start = at;
      if (baseType()) {
        const type = typeName(),
          variable = name();
        if (take(':')) {
          const iterable = expression();
          need(')');
          return { kind: 'foreach', type, name: variable, iterable, body: branch() };
        }
      }
      at = start;
      const init = peek() === ';' ? undefined : statement(false);
      need(';');
      const test = peek() === ';' ? undefined : expression();
      need(';');
      const update = peek() === ')' ? undefined : statement(false);
      need(')');
      if (update && !['assign', 'call'].includes(update.kind)) reject();
      if (init && !['declare', 'assign', 'call'].includes(init.kind)) reject();
      return { kind: 'loop', form: 'for', init, condition: test, update, body: branch() };
    }
    if (peek() === 'break' || peek() === 'continue') {
      const kind = peek() as 'break' | 'continue';
      at++;
      need(';');
      return { kind };
    }
    if (peek() === 'super' && peek(1) === '(') {
      at++;
      const args = argumentsList();
      need(';');
      return { kind: 'super', args };
    }
    if (take('return')) {
      const value = peek() === ';' ? undefined : expression();
      need(';');
      return { kind: 'return', value };
    }
    if (peek() === 'System' && peek(1) === '.') {
      at++;
      need('.');
      need('out');
      need('.');
      const method = peek();
      if (method !== 'print' && method !== 'println') reject();
      at++;
      need('(');
      const value = expression();
      need(')');
      need(';');
      return { kind: 'print', value, newline: method === 'println' };
    }
    const final = take('final');
    if (baseType() && (tokens[at + 1]?.kind === 'word' || peek(1) === '<' || peek(1) === '[')) {
      let type = typeName();
      const variable = name();
      type = brackets(type);
      if (classNames.has(variable)) reject();
      need('=');
      const value = peek() === '{' ? arrayInitializer() : expression();
      if (ending) need(';');
      return { kind: 'declare', type, name: variable, value, ...(final ? { final: true } : {}) };
    }
    if (final) reject();
    const target = expression(),
      op = peek();
    if (['=', '+=', '*=', '-=', '/=', '%='].includes(op)) {
      at++;
      const value = expression();
      if (ending) need(';');
      return { kind: 'assign', target, op, value };
    }
    if (ending) need(';');
    if (target.kind !== 'call' && target.kind !== 'increment') reject();
    return { kind: 'call', value: target };
  }
  function block(): JStmt[] {
    need('{');
    const result: JStmt[] = [];
    while (!take('}')) {
      result.push(statement());
      if (result.length > 24) reject();
    }
    return result;
  }
  function typeParameters(): JTypeParameter[] {
    if (!take('<')) return [];
    const result: JTypeParameter[] = [];
    do {
      const written = name();
      if (typeVariables.has(written) || classNames.has(written) || result.length >= 3) reject();
      const variable = `$T${typeSerial++}_${written}`;
      // F-bounds and intersections stay on the general explanation path.
      const bound = take('extends') ? typeName() : 'Object';
      if (['int', 'long', 'boolean'].includes(bound)) reject();
      typeVariables.set(written, variable);
      result.push({ name: variable, bound });
    } while (take(','));
    need('>');
    return result;
  }
  function nested(enclosing?: string, isInterface = false, functional = false): JClass {
    const type = name();
    const previousVariables = typeVariables;
    typeVariables = new Map();
    const classParameters = typeParameters();
    let parent: string | undefined;
    const interfaces: string[] = [];
    if (take('extends')) {
      if (isInterface) {
        do {
          interfaces.push(typeName());
        } while (take(','));
      } else parent = typeName();
    }
    if (!isInterface && take('implements')) {
      do {
        interfaces.push(typeName());
      } while (take(','));
    }
    need('{');
    const fields: JField[] = [],
      initializers: (JField | JStmt[])[] = [],
      methods: JMethod[] = [];
    let ctor: JStmt[] | undefined,
      params: JParameter[] = [],
      declaredThrows: string[] = [];
    while (!take('}')) {
      if (peek() === '{') {
        if (isInterface) reject();
        const body = block();
        if (body.some((s) => s.kind !== 'assign')) reject();
        initializers.push(body);
        continue;
      }
      let override = false,
        annotatedFunctional = false;
      if (take('@')) {
        if (take('Override')) override = true;
        else {
          need('FunctionalInterface');
          annotatedFunctional = true;
        }
      }
      const isPublic = take('public');
      const isStatic = take('static');
      const defaultMethod = take('default');
      const abstractMethod = take('abstract');
      if (peek() === 'class' || peek() === 'interface') {
        const nestedInterface = take('interface');
        if (!nestedInterface) need('class');
        if (
          (!isStatic && !nestedInterface && !isInterface) ||
          override ||
          enclosing ||
          defaultMethod ||
          abstractMethod ||
          (annotatedFunctional && !nestedInterface)
        )
          reject();
        classes.push(nested(type, nestedInterface, annotatedFunctional));
        if (classes.length > 7) reject();
        continue;
      }
      if (peek() === type && peek(1) === '(') {
        if (
          ctor ||
          override ||
          isStatic ||
          isInterface ||
          defaultMethod ||
          abstractMethod ||
          annotatedFunctional
        )
          reject();
        at++;
        params = parameters();
        declaredThrows = throwsList();
        ctor = block();
        if (ctor.some((s, i) => s.kind === 'return' || (s.kind === 'super' && i !== 0))) reject();
        continue;
      }
      if (
        annotatedFunctional ||
        (!isInterface && (defaultMethod || abstractMethod)) ||
        (defaultMethod && (abstractMethod || isStatic))
      )
        reject();
      const methodVariables = new Map(typeVariables);
      const methodParameters = typeParameters();
      let returnType = take('void') ? 'void' : typeName();
      const member = name();
      if (member === 'main' && peek() === '(') {
        if (
          !isPublic ||
          !isStatic ||
          returnType !== 'void' ||
          override ||
          main ||
          enclosing ||
          isInterface ||
          classParameters.length ||
          methodParameters.length
        )
          reject();
        need('(');
        need('String');
        need('[');
        need(']');
        argument = name();
        need(')');
        if (classNames.has(argument)) reject();
        mainThrows = throwsList();
        main = block();
        outer = type;
        continue;
      }
      if (peek() === '(') {
        const parametersList = parameters();
        const methodThrows = throwsList();
        if (
          methods.some(
            (m) =>
              m.name === member &&
              m.params.map((p) => p.type.replace(/<.*>/, '')).join(',') ===
                parametersList.map((p) => p.type.replace(/<.*>/, '')).join(','),
          )
        )
          reject();
        if (
          [
            'toString',
            'hashCode',
            'getClass',
            'clone',
            'finalize',
            'equals',
            'wait',
            'notify',
            'notifyAll',
          ].includes(member)
        )
          reject();
        const abstractBody = take(';');
        if (
          abstractBody
            ? !isInterface || isStatic || defaultMethod
            : isInterface && !isStatic && !defaultMethod
        )
          reject();
        if (abstractMethod && !abstractBody) reject();
        const body = abstractBody ? [] : block();
        if (body.some((s) => s.kind === 'super') || (isStatic && override)) reject();
        methods.push({
          name: member,
          static: isStatic,
          public: isPublic || isInterface,
          typeParams: methodParameters,
          abstract: abstractBody,
          default: defaultMethod,
          override,
          params: parametersList,
          returns: returnType as JMethod['returns'],
          throws: methodThrows,
          body,
        });
      } else {
        returnType = brackets(returnType);
        if (
          isStatic ||
          isInterface ||
          methodParameters.length ||
          override ||
          fields.some((f) => f.name === member)
        )
          reject();
        const initial = take('=')
          ? peek() === '{'
            ? arrayInitializer()
            : expression()
          : undefined;
        need(';');
        const field: JField = { name: member, type: returnType as JField['type'], initial };
        fields.push(field);
        initializers.push(field);
        if (fields.length > 8) reject();
      }
      typeVariables = methodVariables;
      if (methods.length > 8 || initializers.length > 12) reject();
    }
    typeVariables = previousVariables;
    return {
      interface: isInterface,
      functional,
      interfaces,
      typeParams: classParameters,
      name: type,
      parent,
      enclosing,
      fields,
      initializers,
      constructor: ctor ?? [],
      params,
      throws: declaredThrows,
      methods,
    };
  }
  let publicClasses = 0;
  while (at < tokens.length) {
    const annotatedFunctional = take('@');
    if (annotatedFunctional) need('FunctionalInterface');
    if (take('public') && ++publicClasses > 1) reject();
    const isInterface = take('interface');
    if (!isInterface) need('class');
    if (annotatedFunctional && !isInterface) reject();
    classes.push(nested(undefined, isInterface, annotatedFunctional));
    if (classes.length > 8) reject();
  }
  if (
    at !== tokens.length ||
    !classes.length ||
    new Set(classes.map((c) => c.name)).size !== classes.length ||
    !main?.length
  )
    reject();
  if (main.some((s) => s.kind === 'super')) reject();
  if (
    tokens.some((t) => t.text === 'NoSuchElementException') &&
    !importedJavaName('NoSuchElementException', imports)
  )
    reject();
  return { outer, argument, classes, main, imports, throws: mainThrows };
}
