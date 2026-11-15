import {
  reject,
  collectionNames,
  type JClass,
  type JExpr,
  type JField,
  type JMethod,
  type JParameter,
  type JProgram,
  type JStmt,
} from './java-trace-parser';
import { collectionType, librarySignature, type LibraryCall } from './java-collections';
import { arrayComponent } from './java-arrays';
import { checkedException, exceptionNames, isException } from './java-exceptions';
import { exceptionSubtype } from './java-exceptions';
import { optionalNames, optionalElement, optionalSignature } from './java-optionals';
import { javaTypes, rawJavaType, substituteType } from './java-types';
import {
  functionalNames,
  streamNames,
  functionalType,
  expectedFunction,
  genericType,
  importedJavaName,
  streamElement,
  streamSignature,
  type StreamPlan,
  type FunctionalType,
} from './java-streams';
export type Field = { owner: JClass; field: JField; key: string };
export type Method = { owner: JClass; method: JMethod };
type Scope = {
  owner: JClass;
  static: boolean;
  locals: Map<string, string>;
  unready?: Set<string>;
  declared?: Set<string>;
  loop?: boolean;
  thrown: Set<string>;
  readonly?: Set<string>;
  written?: Set<string>;
  capture?: { outer: Set<string>; names: Set<string>; effects: boolean; returns: Set<string> };
};
export type LambdaInfo = {
  type: string;
  params: JParameter[];
  returns: string;
  captured: string[];
  pure: boolean;
};
const reservedNames = [
  ...collectionNames,
  ...streamNames,
  ...functionalNames,
  ...optionalNames,
  'Runnable',
];
function writesIn(body: JStmt[]): Set<string> {
  const names = new Set<string>(),
    pending: any[] = [...body];
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== 'object') continue;
    if (['assign', 'increment'].includes(node.kind) && node.target.kind === 'name')
      names.add(node.target.name);
    for (const value of Object.values(node))
      if (value && typeof value === 'object')
        pending.push(...(Array.isArray(value) ? value : [value]));
  }
  return names;
}
type Flow = Set<'normal' | 'return' | 'break' | 'continue' | 'throw'>;
const constant = (e: JExpr): boolean =>
  e.kind === 'literal' ||
  ((e.kind === 'negative' || e.kind === 'not') && constant(e.value)) ||
  (e.kind === 'binary' && constant(e.left) && constant(e.right));
const constantArray = (e: JExpr): boolean =>
  constant(e) ||
  (e.kind === 'array' &&
    (e.items?.every(constantArray) ?? e.dimensions?.every((d) => !d || constant(d)) ?? false));
// Constant conditions matter for Java's reachability rules, even when a loop never executes.
function constantValue(e: JExpr): string | number | boolean | undefined {
  if (!constant(e)) return;
  if (e.kind === 'literal') return e.value === null ? undefined : e.value;
  if (e.kind === 'negative') {
    const v = constantValue(e.value);
    return typeof v === 'number' ? -v | 0 : undefined;
  }
  if (e.kind === 'not') {
    const v = constantValue(e.value);
    return typeof v === 'boolean' ? !v : undefined;
  }
  if (e.kind !== 'binary') return;
  const a = constantValue(e.left),
    b = constantValue(e.right);
  if (a === undefined || b === undefined) return;
  if (e.op === '==' || e.op === '!=') return e.op === '==' ? a === b : a !== b;
  if (e.op === '+' && (typeof a === 'string' || typeof b === 'string'))
    return String(a) + String(b);
  if (typeof a === 'boolean' && typeof b === 'boolean')
    return e.op === '&&' ? a && b : e.op === '||' ? a || b : undefined;
  if (typeof a !== 'number' || typeof b !== 'number') return;
  switch (e.op) {
    case '+':
      return (a + b) | 0;
    case '-':
      return (a - b) | 0;
    case '*':
      return Math.imul(a, b);
    case '/':
      return b ? Math.trunc(a / b) | 0 : undefined;
    case '%':
      return b ? (a % b) | 0 : undefined;
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    case '>=':
      return a >= b;
  }
}

// Validate every accepted declaration and branch, then bind overloads using COMPILE-TIME types.
// The trace follows those bindings and only performs runtime overriding of the chosen signature.
export function javaModel(program: JProgram) {
  const { classes, variables, bound, erase, declared } = javaTypes(program);
  const types = new WeakMap<JExpr, string>();
  const calls = new WeakMap<
    JExpr,
    {
      method?: Method;
      library?: LibraryCall;
      stream?: StreamPlan;
      optional?: StreamPlan;
      functional?: FunctionalType;
      overload: boolean;
    }
  >();
  const lambdas = new WeakMap<JExpr, LambdaInfo>();
  const methodReferences = new WeakMap<
    JExpr,
    { expression: Extract<JExpr, { kind: 'lambda' }>; info: LambdaInfo; receiver?: JExpr }
  >();
  const signature = (m: JMethod) => m.params.map((p) => p.type).join(',');
  const erasedSignatures = new WeakMap<JStmt[], string>();
  for (const c of program.classes)
    for (const m of c.methods)
      erasedSignatures.set(m.body, m.params.map((p) => erase(p.type)).join(','));
  const reference = (t: string) =>
    ['String', 'Integer', 'Object', 'Number'].includes(t) ||
    variables.has(t) ||
    classes.has(t) ||
    !!collectionType(t) ||
    !!arrayComponent(t) ||
    !!streamElement(t) ||
    !!functionalType(t) ||
    !!optionalElement(t) ||
    isException(t);
  function visibleClass(name: string, owner: JClass): JClass {
    const c = classes.get(name);
    if (
      !c ||
      (c.enclosing && c.enclosing !== rawJavaType(owner.name) && c.enclosing !== owner.enclosing)
    )
      reject();
    return c;
  }
  function parents(c: JClass): string[] {
    return [...(c.parent && c.parent !== 'Object' ? [c.parent] : []), ...(c.interfaces ?? [])];
  }
  for (const owner of classes.values()) {
    const inheritedTypes = new Map<string, string>();
    function visit(c: JClass, path: string[]) {
      const raw = rawJavaType(c.name);
      if (path.includes(raw) || path.length >= 8) reject();
      const previous = inheritedTypes.get(raw);
      if (previous && previous !== c.name) reject();
      inheritedTypes.set(raw, c.name);
      if (c.parent && c.parent !== 'Object' && visibleClass(c.parent, c).interface) reject();
      if (new Set(c.interfaces ?? []).size !== (c.interfaces?.length ?? 0)) reject();
      for (const iface of c.interfaces ?? []) if (!visibleClass(iface, c).interface) reject();
      for (const p of parents(c)) visit(visibleClass(p, c), [...path, raw]);
    }
    visit(owner, []);
  }
  function isSubtype(from: string, to: string): boolean {
    if (from === to) return true;
    if (variables.has(from)) return isSubtype(bound(from), to);
    if (variables.has(to)) return false;
    if (from === 'Integer' && to === 'Number') return true;
    if (to === 'Object' && reference(from)) return true;
    if (isException(from) && isException(to)) return exceptionSubtype(from, to);
    const ac = arrayComponent(from),
      bc = arrayComponent(to);
    if (ac && bc) return reference(ac) && reference(bc) && isSubtype(ac, bc);
    const a = collectionType(from),
      b = collectionType(to);
    if (a && b && a.args.join(',') === b.args.join(','))
      return (
        a.kind === b.kind &&
        (['List', 'Set', 'Map'].includes(b.base) ||
          (a.base === 'LinkedHashSet' && b.base === 'HashSet') ||
          (a.base === 'LinkedHashMap' && b.base === 'HashMap'))
      );
    const owner = classes.get(from);
    return !!owner && parents(owner).some((p) => isSubtype(p, to));
  }
  function lookupField(type: string, name: string): Field | undefined {
    const owner = classes.get(type);
    if (!owner) return;
    const field = owner.fields.find((f) => f.name === name);
    return field
      ? { owner, field, key: `${rawJavaType(owner.name)}.${name}` }
      : owner.parent
        ? lookupField(owner.parent, name)
        : undefined;
  }
  function lookupMethod(type: string, name: string, params?: string[]): Method | undefined {
    return candidates(type, name).find((m) => !params || signature(m.method) === params.join(','));
  }
  function lookupGenericMethod(type: string, resolved: Method): Method | undefined {
    const matches = candidates(type, resolved.method.name).filter(
      (m) => erasedSignatures.get(m.method.body) === erasedSignatures.get(resolved.method.body),
    );
    if (matches.length !== 1 || matches[0].method.body !== resolved.method.body) return;
    return {
      owner: matches[0].owner,
      method: {
        ...matches[0].method,
        params: resolved.method.params,
        returns: resolved.method.returns,
      },
    };
  }
  function candidates(type: string, name: string) {
    const found = new Map<string, Method>();
    const interfaces: Method[] = [];
    const visited = new Set<string>();
    function visit(owner: JClass, direct: boolean) {
      if (visited.has(owner.name)) return;
      visited.add(owner.name);
      for (const method of owner.methods)
        if (method.name === name && (!owner.interface || !method.static || direct)) {
          if (owner.interface) interfaces.push({ owner, method });
          else if (!found.has(signature(method))) found.set(signature(method), { owner, method });
        }
      if (owner.parent && owner.parent !== 'Object') visit(classes.get(owner.parent)!, false);
      for (const p of owner.interfaces ?? []) visit(classes.get(p)!, false);
    }
    const root = classes.get(type);
    if (root) visit(root, true);
    for (const sig of new Set(interfaces.map((m) => signature(m.method)))) {
      if (found.has(sig)) continue;
      const group = interfaces.filter((m) => signature(m.method) === sig);
      const specific = group.filter(
        (a) => !group.some((b) => a !== b && isSubtype(b.owner.name, a.owner.name)),
      );
      if (specific.length > 1 && specific.some((m) => !m.method.abstract)) reject();
      const chosen = specific.find((a) =>
        specific.every(
          (b) =>
            a.method.returns === b.method.returns || isSubtype(a.method.returns, b.method.returns),
        ),
      );
      if (!chosen) reject();
      found.set(sig, chosen);
    }
    return [...found.values()];
  }
  function assignable(from: string, to: string, loose = true): boolean {
    if (from === to && from !== 'void') return true;
    if (to === 'long' && from === 'int') return true;
    if (to === 'long' && from === 'Integer') return loose;
    if (from === 'null') return reference(to);
    if (
      loose &&
      ((from === 'int' && ['Integer', 'Object', 'Number'].includes(to)) ||
        (from === 'Integer' && to === 'int'))
    )
      return true;
    return reference(from) && reference(to) && isSubtype(from, to);
  }
  function resolve(
    type: string,
    name: string,
    args: string[],
    expected?: string,
    explicit?: string[],
  ) {
    const available = candidates(type, name);
    if (available.some((m) => m.method.typeParams?.length) && available.length > 1) reject(); // Generic overload inference is deliberately conservative.
    const all = available.map((entry) => {
      const parameters = entry.method.typeParams ?? [];
      if (!parameters.length) {
        if (explicit) reject();
        return entry;
      }
      if (explicit && explicit.length !== parameters.length) reject();
      const bindings = new Map<string, string>();
      function infer(pattern: string, actual: string) {
        if (parameters.some((p) => p.name === pattern)) {
          if (actual === 'null') return;
          actual = actual === 'int' ? 'Integer' : actual;
          if (!reference(actual)) reject();
          if (bindings.has(pattern) && bindings.get(pattern) !== actual) reject();
          bindings.set(pattern, actual);
          return;
        }
        const p = genericType(pattern),
          a = genericType(actual);
        if (p && a && p.base === a.base && p.args.length === a.args.length)
          p.args.forEach((t, i) => infer(t, a.args[i]));
      }
      if (explicit) parameters.forEach((p, i) => bindings.set(p.name, explicit[i]));
      else {
        entry.method.params.forEach((p, i) => {
          if (args[i]) infer(p.type, args[i]);
        });
        if (
          expected &&
          expected !== '$infer' &&
          parameters.some((p) => p.name === entry.method.returns) &&
          !bindings.has(entry.method.returns)
        )
          infer(entry.method.returns, expected);
      }
      for (const p of parameters) {
        // Without an argument/target constraint, an enclosing overloaded call (notably
        // println) can affect inference or be ambiguous. Do not invent Object here.
        if (!bindings.has(p.name) && entry.method.returns.includes(p.name)) reject();
        const value = bindings.get(p.name) ?? p.bound;
        validType(value, entry.owner);
        if (!reference(value) || !isSubtype(value, substituteType(p.bound, bindings))) reject();
        bindings.set(p.name, value);
      }
      return {
        ...entry,
        method: {
          ...entry.method,
          params: entry.method.params.map((p) => ({
            ...p,
            type: substituteType(p.type, bindings),
          })),
          returns: substituteType(entry.method.returns, bindings),
        },
      };
    });
    for (const loose of [false, true]) {
      const matches = all.filter(
        (m) =>
          m.method.params.length === args.length &&
          args.every((a, i) => assignable(a, m.method.params[i].type, loose)),
      );
      if (!matches.length) continue;
      const best = matches.filter((a) =>
        matches.every(
          (b) =>
            a === b ||
            a.method.params.every((p, i) => assignable(p.type, b.method.params[i].type, false)),
        ),
      );
      if (best.length !== 1) reject();
      return { method: best[0], overload: all.length > 1 };
    }
    reject();
  }
  function validType(type: string, owner: JClass) {
    if (variables.has(type)) return;
    if (type === 'NoSuchElementException' && !importedJavaName(type, program.imports)) reject();
    if (functionalType(type)) {
      for (const arg of genericType(type)?.args ?? []) validType(arg, owner);
      return;
    }
    const component = arrayComponent(type);
    if (component) {
      if (
        variables.has(component.replace(/\[\]/g, '')) ||
        genericType(component.replace(/\[\]/g, ''))
      )
        reject();
      if (component.replace(/\[\]/g, '') === 'long') reject(); // Count values are supported; long-array semantics stay outside this subset.
      if (type.split('[]').length > 4) reject();
      validType(component, owner);
      return;
    }
    if (isException(type)) return;
    if (
      !['int', 'long', 'boolean', 'String', 'Integer', 'Object', 'Number'].includes(type) &&
      !collectionType(type) &&
      !streamElement(type) &&
      !optionalElement(type) &&
      !functionalType(type)
    ) {
      const c = visibleClass(type, owner),
        generic = genericType(type),
        original = declared.get(rawJavaType(type))!;
      if ((original.typeParams?.length ?? 0) !== (generic?.args.length ?? 0)) reject();
      const bindings = new Map(original.typeParams?.map((p, i) => [p.name, generic!.args[i]]));
      for (const p of original.typeParams ?? []) {
        const arg = bindings.get(p.name)!;
        validType(arg, owner);
        if (!reference(arg) || !isSubtype(arg, substituteType(p.bound, bindings))) reject();
      }
    }
  }
  function customFunctional(type: string): FunctionalType | undefined {
    const c = classes.get(type);
    if (!c?.interface) return;
    const methods = allMethods(c).filter((m) => !m.method.static && m.method.abstract);
    if (
      methods.length !== 1 ||
      methods[0].method.typeParams?.length ||
      methods[0].method.throws.some(checkedException)
    )
      return;
    const m = methods[0].method;
    return { params: m.params.map((p) => p.type), returns: m.returns, method: m.name };
  }
  function allMethods(c: JClass): Method[] {
    const names = new Set<string>(),
      visited = new Set<string>();
    function visit(t: JClass) {
      if (visited.has(t.name)) return;
      visited.add(t.name);
      t.methods.forEach((m) => names.add(m.name));
      parents(t).forEach((p) => visit(classes.get(p)!));
    }
    visit(c);
    return [...names].flatMap((n) => candidates(c.name, n));
  }
  function binaryType(op: string, a: string, b: string): string {
    if (['&&', '||'].includes(op)) {
      if (a !== 'boolean' || b !== 'boolean') reject();
      return 'boolean';
    }
    if (['<', '<=', '>', '>='].includes(op)) {
      if (![a, b].every((t) => ['int', 'Integer'].includes(t))) reject();
      return 'boolean';
    }
    if (['==', '!='].includes(op)) {
      if (
        (a === 'null' && reference(b)) ||
        (b === 'null' && reference(a)) ||
        (a === 'null' && b === 'null') ||
        (a === 'boolean' && b === 'boolean') ||
        ((arrayComponent(a) || arrayComponent(b)) &&
          reference(a) &&
          reference(b) &&
          (isSubtype(a, b) || isSubtype(b, a))) ||
        ((a === 'int' || b === 'int') && [a, b].every((t) => ['int', 'Integer'].includes(t)))
      )
        return 'boolean';
      reject(); // Do not confuse String/boxed identity with value equality.
    }
    if (
      op === '+' &&
      (a === 'String' || b === 'String') &&
      [a, b].every((t) => ['int', 'long', 'Integer', 'String', 'boolean', 'null'].includes(t))
    )
      return 'String';
    if (![a, b].every((t) => ['int', 'Integer'].includes(t))) reject();
    return 'int';
  }
  function fieldType(name: string, type: string, scope: Scope, bare = false) {
    const f = lookupField(type, name);
    if (!f || (bare && scope.declared && f.owner === scope.owner && !scope.declared.has(name)))
      reject();
    return f.field.type;
  }
  function args(params: JParameter[], values: JExpr[], scope: Scope) {
    if (params.length !== values.length) reject();
    values.forEach((e, i) => {
      if (!assignable(typeOf(e, scope, params[i].type), params[i].type)) reject();
    });
  }
  function typeOf(e: JExpr, scope: Scope, expected?: string): string {
    const type = infer(e, scope, expected);
    types.set(e, type);
    return type;
  }
  function infer(e: JExpr, scope: Scope, expected?: string): string {
    switch (e.kind) {
      case 'methodRef': {
        if (!expected || scope.capture) reject();
        const fn = expectedFunction(expected) ?? customFunctional(expected);
        if (!fn) reject();
        const params = fn.params.map((type, i) => ({ name: `#ref${i}`, type }));
        const arguments_ = params.map((p): JExpr => ({ kind: 'name', name: p.name }));
        const local: Scope = {
          ...scope,
          locals: new Map(params.map((p) => [p.name, p.type])),
          thrown: new Set(),
          capture: undefined,
        };
        let expression: Extract<JExpr, { kind: 'lambda' }>;
        let receiver: JExpr | undefined,
          returned: string,
          pure = false;
        const printing =
          e.target.kind === 'member' &&
          e.target.name === 'out' &&
          e.target.target.kind === 'name' &&
          e.target.target.name === 'System';
        if (printing) {
          if (
            !['print', 'println'].includes(e.name) ||
            params.length !== 1 ||
            fn.returns !== 'void' ||
            !['int', 'long', 'boolean', 'Integer', 'String', 'Object'].includes(params[0].type)
          )
            reject();
          expression = {
            kind: 'lambda',
            params,
            body: [{ kind: 'print', value: arguments_[0], newline: e.name === 'println' }],
          };
          body(expression.body as JStmt[], local, 'void');
          returned = 'void';
        } else {
          const targetType = typeOf(e.target, scope);
          const classTarget = targetType.startsWith('#');
          const choices: { value: JExpr; returned: string; pure: boolean; receiver?: JExpr }[] = [];
          const check = (value: JExpr, mode: 'static' | 'bound' | 'unbound' | 'new') => {
            try {
              local.thrown = new Set();
              const result = typeOf(value, local, fn.returns === '$infer' ? undefined : fn.returns);
              const binding = calls.get(value);
              if (binding?.method && (mode === 'static') !== binding.method.method.static) reject();
              if ([...local.thrown].some(checkedException)) reject();
              if (
                fn.returns !== 'void' &&
                fn.returns !== '$infer' &&
                !assignable(result, fn.returns)
              )
                reject();
              // Only field-free, side-effect-free helpers may be used inside an elidable stream stage.
              const pureExpression = (node: JExpr, names: Set<string>): boolean =>
                node.kind === 'literal' ||
                (node.kind === 'name' && names.has(node.name)) ||
                (['negative', 'not'].includes(node.kind) &&
                  pureExpression((node as Extract<JExpr, { kind: 'negative' }>).value, names)) ||
                (node.kind === 'binary' &&
                  pureExpression(node.left, names) &&
                  pureExpression(node.right, names));
              const method = binding?.method?.method;
              const simpleHelper =
                method?.static &&
                method.body.length === 1 &&
                method.body[0].kind === 'return' &&
                !!method.body[0].value &&
                pureExpression(method.body[0].value, new Set(method.params.map((p) => p.name)));
              const safe =
                !!binding?.library &&
                ['String', 'Integer', '#String', '#Integer'].includes(binding.library.receiver);
              choices.push({
                value,
                returned: result,
                pure: safe || !!simpleHelper || !!binding?.optional?.receiver.startsWith('#'),
                ...(mode === 'bound' ? { receiver: e.target } : {}),
              });
            } catch {
              /* An inapplicable overload/reference form is not a supported binding. */
            }
          };
          if (e.name === 'new') {
            if (!classTarget) reject();
            check({ kind: 'new', type: targetType.slice(1), args: arguments_ }, 'new');
          } else if (classTarget) {
            check(
              {
                kind: 'call',
                target: { kind: 'member', target: e.target, name: e.name },
                args: arguments_,
              },
              'static',
            );
            if (
              params.length &&
              reference(params[0].type) &&
              isSubtype(params[0].type, targetType.slice(1))
            )
              check(
                {
                  kind: 'call',
                  target: {
                    kind: 'member',
                    target: { kind: 'cast', type: targetType.slice(1), value: arguments_[0] },
                    name: e.name,
                  },
                  args: arguments_.slice(1),
                },
                'unbound',
              );
          } else {
            local.locals.set('#receiver', targetType);
            check(
              {
                kind: 'call',
                target: {
                  kind: 'member',
                  target: { kind: 'name', name: '#receiver' },
                  name: e.name,
                },
                args: arguments_,
              },
              'bound',
            );
          }
          if (choices.length !== 1) reject();
          const choice = choices[0];
          receiver = choice.receiver;
          returned = choice.returned;
          pure = choice.pure;
          expression = { kind: 'lambda', params, body: choice.value };
        }
        let type = expected,
          returns = fn.returns;
        if (returns === '$infer') {
          returns = returned === 'int' ? 'Integer' : returned;
          if (!reference(returns)) reject();
          type = expected.replace('$infer', returns);
        }
        const info: LambdaInfo = {
          type,
          params,
          returns,
          captured: receiver ? ['#receiver'] : [],
          pure,
        };
        methodReferences.set(e, { expression, info, receiver });
        return type;
      }
      case 'lambda': {
        if (!expected || scope.capture) reject();
        const fn = expectedFunction(expected) ?? customFunctional(expected);
        if (!fn || fn.params.length !== e.params.length) reject();
        const local = childScope(scope);
        local.loop = false;
        local.thrown = new Set();
        local.capture = {
          outer: new Set(scope.locals.keys()),
          names: new Set(),
          effects: false,
          returns: new Set(),
        };
        local.readonly = new Set([...(scope.readonly ?? []), ...scope.locals.keys()]);
        const params = e.params.map((p, i) => {
          if (
            scope.locals.has(p.name) ||
            reservedNames.includes(p.name) ||
            (p.type && p.type !== fn.params[i])
          )
            reject();
          local.locals.set(p.name, fn.params[i]);
          return { name: p.name, type: fn.params[i] };
        });
        if (Array.isArray(e.body)) {
          const flow = body(e.body, local, fn.returns);
          if (fn.returns !== 'void' && flow.has('normal')) reject();
        } else {
          const returned = typeOf(e.body, local, fn.returns);
          if (fn.returns === 'void') {
            if (!['call', 'new', 'increment'].includes(e.body.kind)) reject();
          } else if (fn.returns !== '$infer' && !assignable(returned, fn.returns)) reject();
          local.capture.returns.add(returned);
        }
        if ([...local.thrown].some(checkedException)) reject();
        let type = expected,
          returns = fn.returns;
        if (returns === '$infer') {
          const candidates = [
            ...new Set([...local.capture.returns].map((t) => (t === 'int' ? 'Integer' : t))),
          ];
          if (candidates.length !== 1 || !reference(candidates[0])) reject();
          returns = candidates[0];
          type = expected.replace('$infer', returns);
        }
        lambdas.set(e, {
          type,
          params,
          returns,
          captured: [...local.capture.names],
          pure: !local.capture.effects,
        });
        return type;
      }
      case 'literal':
        return e.value === null
          ? 'null'
          : typeof e.value === 'number'
            ? 'int'
            : typeof e.value === 'boolean'
              ? 'boolean'
              : 'String';
      case 'name': {
        if (scope.locals.has(e.name)) {
          if (scope.unready?.has(e.name)) reject();
          if (scope.capture?.outer.has(e.name)) {
            if (
              scope.written?.has(e.name) ||
              !['int', 'long', 'boolean', 'String', 'Integer'].includes(scope.locals.get(e.name)!)
            )
              reject();
            scope.capture.names.add(e.name);
          }
          return scope.locals.get(e.name)!;
        }
        if (e.name === 'this') {
          if (scope.capture) reject();
          if (scope.static) reject();
          return scope.owner.name;
        }
        if (e.name === 'super') {
          if (scope.capture) reject();
          if (scope.static || !scope.owner.parent || scope.owner.parent === 'Object') reject();
          return scope.owner.parent;
        }
        if (lookupField(scope.owner.name, e.name)) {
          if (scope.capture) reject();
          if (scope.static) reject();
          return fieldType(e.name, scope.owner.name, scope, true);
        }
        if (classes.has(e.name)) return '#' + visibleClass(e.name, scope.owner).name;
        if (['Integer', 'String', 'Object', 'Number', ...exceptionNames].includes(e.name))
          return '#' + e.name;
        if (reservedNames.includes(e.name) && importedJavaName(e.name, program.imports))
          return '#' + e.name;
        reject();
      }
      case 'negative':
        if (!['int', 'Integer'].includes(typeOf(e.value, scope))) reject();
        return 'int';
      case 'not':
        if (typeOf(e.value, scope) !== 'boolean') reject();
        return 'boolean';
      case 'increment': {
        const t = lvalue(e.target, scope);
        if (!['int', 'Integer'].includes(t)) reject();
        return t;
      }
      case 'binary':
        return binaryType(e.op, typeOf(e.left, scope), typeOf(e.right, scope));
      case 'member': {
        if (e.typeArgs) reject();
        const type = typeOf(e.target, scope);
        if (arrayComponent(type) && e.name === 'length') return 'int';
        if (!classes.has(type)) reject();
        return fieldType(e.name, type, scope);
      }
      case 'cast': {
        if (variables.has(e.type) || genericType(e.type)?.args.some((t) => variables.has(t)))
          reject();
        if (genericType(e.type) && classes.has(e.type)) reject(); // Avoid inventing unchecked/reified generic cast behavior.
        validType(e.type, scope.owner);
        const from = typeOf(e.value, scope, e.type);
        if (e.value.kind === 'name' && e.value.name === 'super') reject();
        if (
          from !== 'null' &&
          !(from === 'int' && e.type === 'Integer') &&
          (!reference(from) || (!isSubtype(from, e.type) && !isSubtype(e.type, from)))
        )
          reject();
        return e.type;
      }
      case 'new': {
        let type = e.type;
        if (type === 'String') {
          if (e.args.length > 1 || (e.args.length && typeOf(e.args[0], scope) !== 'String'))
            reject();
          return type;
        }
        if (isException(type)) {
          if (
            e.args.length > 1 ||
            (e.args.length === 1 && !['String', 'null'].includes(typeOf(e.args[0], scope)))
          )
            reject();
          if (
            e.args.length &&
            typeOf(e.args[0], scope) === 'null' &&
            [
              'Throwable',
              'Exception',
              'RuntimeException',
              'IllegalArgumentException',
              'IllegalStateException',
            ].includes(type)
          )
            reject();
          return type;
        }
        if (type.endsWith('<>')) {
          const generic = expected && genericType(expected);
          const base = declared.get(type.slice(0, -2));
          if (base?.typeParams?.length) {
            const bindings = new Map<string, string>();
            const bind = (pattern: string, actual: string) => {
              if (base.typeParams!.some((p) => p.name === pattern)) {
                if (actual === 'null') return;
                actual = actual === 'int' ? 'Integer' : actual;
                const known = bindings.get(pattern);
                if (known && !assignable(actual, known)) reject();
                if (!known) bindings.set(pattern, actual);
                return;
              }
              const p = genericType(pattern),
                a = genericType(actual);
              if (p && a && p.base === a.base && p.args.length === a.args.length)
                p.args.forEach((t, i) => bind(t, a.args[i]));
            };
            if (generic) {
              const self = `${base.name}<${base.typeParams.map((p) => p.name).join(',')}>`;
              for (const target of [self, ...parents(base)])
                if (rawJavaType(target) === generic.base) bind(target, expected!);
            }
            base.params.forEach((p, i) => {
              if (e.args[i]) bind(p.type, typeOf(e.args[i], scope));
            });
            type = `${base.name}<${base.typeParams.map((p) => bindings.get(p.name) ?? p.bound).join(',')}>`;
          } else {
            const target = expected && collectionType(expected);
            if (!target) reject();
            type = type.slice(0, -2) + `<${target.args.join(',')}>`;
          }
        }
        const c = collectionType(type);
        if (c) {
          if (['List', 'Set', 'Map'].includes(c.base) || e.args.length > 1) reject();
          if (e.args.length) {
            const from = collectionType(typeOf(e.args[0], scope));
            if (
              !from ||
              (from.kind === 'map') !== (c.kind === 'map') ||
              from.args.join(',') !== c.args.join(',')
            )
              reject();
          }
          return type;
        }
        const owner = visibleClass(type, scope.owner);
        validType(type, scope.owner);
        if (owner.interface || variables.has(e.type)) reject();
        owner.throws.forEach((t) => scope.thrown.add(t));
        args(owner.params, e.args, scope);
        return owner.name;
      }
      case 'call': {
        let type: string, name: string;
        if (e.target.kind === 'name') {
          type = (scope.static ? '#' : '') + scope.owner.name;
          name = e.target.name;
        } else if (e.target.kind === 'member') {
          type = typeOf(e.target.target, scope);
          name = e.target.name;
        } else reject();
        const typeArgs = e.target.kind === 'member' ? e.target.typeArgs : undefined;
        if (typeArgs && !classes.has(type.replace(/^#/, ''))) {
          if (
            type !== '#Optional' ||
            !['empty', 'of', 'ofNullable'].includes(name) ||
            typeArgs.length !== 1 ||
            !['String', 'Integer', 'Object'].includes(typeArgs[0])
          )
            reject();
          expected = `Optional<${typeArgs[0]}>`;
        }
        const optional = optionalSignature(
          type,
          name,
          e.args.length,
          (i, wanted) => typeOf(e.args[i], scope, wanted),
          expected,
        );
        if (optional) {
          if (scope.capture && !type.startsWith('#')) reject();
          e.args.forEach((arg, i) => {
            if (!assignable(typeOf(arg, scope, optional.params[i]), optional.params[i])) reject();
          });
          if (name === 'orElseThrow' && optional.params.length)
            scope.thrown.add(functionalType(optional.params[0])!.returns);
          calls.set(e, { optional, overload: false });
          return optional.returns;
        }
        const functional = functionalType(type);
        if (functional && name === functional.method) {
          if (scope.capture || functional.params.length !== e.args.length) reject();
          e.args.forEach((arg, i) => {
            if (!assignable(typeOf(arg, scope, functional.params[i]), functional.params[i]))
              reject();
          });
          calls.set(e, { functional, overload: false });
          return functional.returns;
        }
        const stream = streamSignature(
          type,
          name,
          e.args.length,
          (i, expected) => typeOf(e.args[i], scope, expected),
          expected,
        );
        if (stream) {
          if (scope.capture) reject();
          e.args.forEach((arg, i) => {
            if (!assignable(typeOf(arg, scope, stream.params[i]), stream.params[i])) reject();
          });
          calls.set(e, { stream, overload: false });
          return stream.returns;
        }
        const inputs = e.args.map((a) => typeOf(a, scope));
        const library = librarySignature(bound(type), name, inputs, expected);
        if (library) {
          if (scope.capture && !['String', 'Integer', '#Integer', '#String'].includes(type))
            reject();
          if (library.params.some((t, i) => !assignable(inputs[i], t))) reject();
          calls.set(e, {
            library,
            overload: name === 'remove' && collectionType(type)?.kind === 'list',
          });
          return library.returns;
        }
        if (scope.capture) reject();
        const resolved = resolve(type.replace(/^#/, ''), name, inputs, expected, typeArgs);
        if (type.startsWith('#') && !resolved.method.method.static) reject();
        if (
          resolved.method.owner.interface &&
          resolved.method.method.static &&
          !type.startsWith('#')
        )
          reject();
        calls.set(e, resolved);
        resolved.method.method.throws.forEach((t) => scope.thrown.add(t));
        return resolved.method.method.returns;
      }
      case 'array': {
        const type = e.type ?? expected;
        if (!type) reject();
        validType(type, scope.owner);
        const component = arrayComponent(type);
        if (!component || component.includes('<')) reject();
        if (e.dimensions)
          for (const d of e.dimensions)
            if (d && !['int', 'Integer'].includes(typeOf(d, scope))) reject();
        if (e.items)
          for (const item of e.items)
            if (!assignable(typeOf(item, scope, component), component)) reject();
        return type;
      }
      case 'index': {
        const component = arrayComponent(typeOf(e.target, scope));
        if (!component || !['int', 'Integer'].includes(typeOf(e.index, scope))) reject();
        return component;
      }
    }
  }
  function lvalue(e: JExpr, scope: Scope) {
    if (e.kind !== 'name' && e.kind !== 'member' && e.kind !== 'index') reject();
    if (e.kind === 'name' && scope.readonly?.has(e.name)) reject();
    if (e.kind === 'member' && arrayComponent(typeOf(e.target, scope)) && e.name === 'length')
      reject();
    if (e.kind === 'name' && ['this', 'super'].includes(e.name)) reject();
    const t = typeOf(e, scope);
    if (t.startsWith('#') || t === '$args') reject();
    return t;
  }
  const childScope = (s: Scope): Scope => ({ ...s, locals: new Map(s.locals) });
  function body(stmts: JStmt[], scope: Scope, returns = 'void'): Flow {
    let flow: Flow = new Set(['normal']);
    for (const stmt of stmts) {
      if (!flow.has('normal')) reject();
      flow.delete('normal');
      let next: Flow = new Set(['normal']);
      switch (stmt.kind) {
        case 'print': {
          if (scope.capture) scope.capture.effects = true;
          const t = bound(typeOf(stmt.value, scope));
          if (
            !['int', 'long', 'Integer', 'boolean', 'String', 'Object'].includes(t) &&
            !collectionType(t)
          )
            reject();
          break;
        }
        case 'declare': {
          if (
            scope.locals.has(stmt.name) ||
            reservedNames.includes(stmt.name) ||
            stmt.name === 'Integer'
          )
            reject();
          validType(stmt.type, scope.owner);
          scope.locals.set(stmt.name, stmt.type);
          scope.unready = new Set([stmt.name]);
          if (!assignable(typeOf(stmt.value, scope, stmt.type), stmt.type)) reject();
          scope.unready.clear();
          if (stmt.final) scope.readonly = new Set([...(scope.readonly ?? []), stmt.name]);
          break;
        }
        case 'assign': {
          const t = lvalue(stmt.target, scope),
            r = typeOf(stmt.value, scope, t);
          if (!assignable(stmt.op === '=' ? r : binaryType(stmt.op[0], t, r), t)) reject();
          break;
        }
        case 'call':
          typeOf(stmt.value, scope);
          break;
        case 'return':
          if (returns === '$infer') {
            if (!stmt.value || !scope.capture) reject();
            scope.capture.returns.add(typeOf(stmt.value, scope));
            next = new Set(['return']);
            break;
          }
          if (
            returns === 'void'
              ? !!stmt.value
              : !stmt.value || !assignable(typeOf(stmt.value, scope, returns), returns)
          )
            reject();
          next = new Set(['return']);
          break;
        case 'break':
        case 'continue':
          if (!scope.loop) reject();
          next = new Set([stmt.kind]);
          break;
        case 'throw': {
          const type = typeOf(stmt.value, scope);
          if (type !== 'null' && !isException(type)) reject();
          scope.thrown.add(type === 'null' ? 'NullPointerException' : type);
          next = new Set(['throw']);
          break;
        }
        case 'try': {
          const pending = new Set<string>();
          const sub = body(stmt.body, { ...childScope(scope), thrown: pending }, returns);
          const caught: string[] = [];
          next = new Set(sub);
          const outgoing = new Set<string>();
          for (const handler of stmt.catches) {
            if (
              scope.locals.has(handler.name) ||
              classes.has(handler.name) ||
              collectionNames.includes(handler.name) ||
              exceptionNames.includes(handler.name) ||
              handler.name === 'Integer'
            )
              reject();
            if (
              handler.types.some(
                (t, i) =>
                  handler.types.some(
                    (other, j) => i !== j && (isSubtype(t, other) || isSubtype(other, t)),
                  ) || caught.some((c) => isSubtype(t, c)),
              )
            )
              reject();
            if (
              handler.types.some(
                (t) =>
                  checkedException(t) &&
                  !['Exception', 'Throwable'].includes(t) &&
                  ![...pending].some((p) => isSubtype(p, t) || isSubtype(t, p)),
              )
            )
              reject();
            let common = handler.types[0];
            while (!handler.types.every((t) => isSubtype(t, common)))
              common =
                common === 'RuntimeException'
                  ? 'Exception'
                  : common === 'Exception'
                    ? 'Throwable'
                    : 'RuntimeException';
            const local = childScope(scope);
            local.thrown = outgoing;
            local.locals.set(handler.name, common);
            if (handler.types.length > 1)
              local.readonly = new Set([...(scope.readonly ?? []), handler.name]);
            for (const f of body(handler.body, local, returns)) next.add(f);
            caught.push(...handler.types);
          }
          for (const t of pending) if (!caught.some((c) => isSubtype(t, c))) outgoing.add(t);
          if (stmt.final) {
            const finalThrown = new Set<string>(),
              flow = body(stmt.final, { ...childScope(scope), thrown: finalThrown }, returns);
            if (!flow.has('normal')) {
              next = flow;
              outgoing.clear();
            } else for (const f of flow) if (f !== 'normal') next.add(f);
            for (const t of finalThrown) outgoing.add(t);
          }
          for (const t of outgoing) scope.thrown.add(t);
          break;
        }
        case 'block':
          next = body(stmt.body, childScope(scope), returns);
          break;
        case 'if': {
          if (typeOf(stmt.condition, scope) !== 'boolean') reject();
          next = new Set([
            ...body(stmt.yes, childScope(scope), returns),
            ...body(stmt.no, childScope(scope), returns),
          ]);
          break;
        }
        case 'loop': {
          const local = childScope(scope);
          local.loop = true;
          if (stmt.init) body([stmt.init], local);
          if (stmt.condition && typeOf(stmt.condition, local) !== 'boolean') reject();
          const test = stmt.condition ? constantValue(stmt.condition) : true;
          if (stmt.form !== 'do' && test === false) reject();
          const sub = body(stmt.body, childScope(local), returns);
          if (stmt.update) body([stmt.update], local);
          next = new Set();
          if (sub.has('return')) next.add('return');
          if (sub.has('throw')) next.add('throw');
          if (
            sub.has('break') ||
            (test !== true && (stmt.form !== 'do' || sub.has('normal') || sub.has('continue')))
          )
            next.add('normal');
          break;
        }
        case 'foreach': {
          const iterableType = typeOf(stmt.iterable, scope),
            iterable = collectionType(iterableType),
            element = arrayComponent(iterableType) ?? iterable?.args[0];
          if (
            !element ||
            iterable?.kind === 'map' ||
            !assignable(element, stmt.type) ||
            scope.locals.has(stmt.name) ||
            collectionNames.includes(stmt.name) ||
            stmt.name === 'Integer'
          )
            reject();
          validType(stmt.type, scope.owner);
          const local = childScope(scope);
          local.loop = true;
          local.locals.set(stmt.name, stmt.type);
          const sub = body(stmt.body, local, returns);
          next = new Set(['normal']);
          if (sub.has('return')) next.add('return');
          if (sub.has('throw')) next.add('throw');
          break;
        }
        case 'super':
          reject();
      }
      for (const f of next) flow.add(f);
    }
    return flow;
  }
  const scopeFor = (
    owner: JClass,
    params: JParameter[],
    isStatic = false,
    statements: JStmt[] = [],
  ): Scope => ({
    owner,
    static: isStatic,
    locals: new Map(params.map((p) => [p.name, p.type])),
    thrown: new Set(),
    written: writesIn(statements),
  });
  function validateParams(owner: JClass, params: JParameter[]) {
    for (const p of params) {
      validType(p.type, owner);
      if (reservedNames.includes(p.name) || exceptionNames.includes(p.name) || p.name === 'Integer')
        reject();
    }
  }
  for (const owner of classes.values()) {
    for (const p of owner.typeParams ?? []) {
      validType(p.bound, owner);
      if (!reference(p.bound)) reject();
    }
    for (const p of parents(owner)) validType(p, owner);
    const declaredSignatures = new Set<string>();
    for (const m of owner.methods) {
      const sig = m.name + '(' + erasedSignatures.get(m.body) + ')';
      if (declaredSignatures.has(sig)) reject();
      declaredSignatures.add(sig);
      if (m.static && (owner.typeParams ?? []).some((p) => JSON.stringify(m).includes(p.name)))
        reject();
      for (const p of m.typeParams ?? []) {
        validType(p.bound, owner);
        if (!reference(p.bound)) reject();
      }
    }
    validateParams(owner, owner.params);
    const declared = new Set<string>();
    for (const entry of owner.initializers) {
      if (Array.isArray(entry)) body(entry, { ...scopeFor(owner, []), declared });
      else {
        validType(entry.type, owner);
        if (
          classes.has(entry.name) ||
          reservedNames.includes(entry.name) ||
          entry.name === 'Integer' ||
          exceptionNames.includes(entry.name)
        )
          reject();
        if (
          entry.initial &&
          (!constantArray(entry.initial) ||
            !assignable(typeOf(entry.initial, scopeFor(owner, []), entry.type), entry.type))
        )
          reject();
        declared.add(entry.name);
      }
    }
    const parent = owner.parent ? classes.get(owner.parent) : undefined,
      first = owner.constructor[0];
    const constructorScope = scopeFor(owner, owner.params, false, owner.constructor);
    args(parent?.params ?? [], first?.kind === 'super' ? first.args : [], {
      ...constructorScope,
      static: true,
    });
    for (const t of parent?.throws ?? []) constructorScope.thrown.add(t);
    body(
      owner.constructor.filter((s) => s.kind !== 'super'),
      constructorScope,
    );
    checkThrows(constructorScope.thrown, owner.throws);
    for (const method of owner.methods) {
      validateParams(owner, method.params);
      if (method.returns !== 'void') validType(method.returns, owner);
      const inheritedMethods = parents(owner)
        .flatMap((p) => candidates(p, method.name))
        .filter((m) => !m.method.static || !m.owner.interface);
      const inherited = inheritedMethods.find((m) => signature(m.method) === signature(method));
      if (method.override && (!inherited || inherited.method.static)) reject();
      if (
        inherited &&
        (method.static !== inherited.method.static ||
          (method.returns !== inherited.method.returns &&
            !isSubtype(method.returns, inherited.method.returns)) ||
          (inherited.method.public && !method.public))
      )
        reject();
      const erased = erasedSignatures.get(method.body);
      if (
        inheritedMethods.some(
          (m) =>
            signature(m.method) !== signature(method) &&
            erasedSignatures.get(m.method.body) === erased,
        )
      )
        reject();
      if (method.abstract) continue;
      if (
        inherited &&
        method.throws.some(
          (t) => checkedException(t) && !inherited.method.throws.some((p) => isSubtype(t, p)),
        )
      )
        reject();
      const methodScope = scopeFor(owner, method.params, method.static, method.body);
      const flow = body(method.body, methodScope, method.returns);
      if (method.returns !== 'void' && flow.has('normal')) reject();
      checkThrows(methodScope.thrown, method.throws);
    }
    const effective = allMethods(owner);
    if (!owner.interface && effective.some((m) => m.method.abstract)) reject();
    // A class method must satisfy every inherited declaration, including visibility/throws.
    for (const ancestor of parents(owner))
      for (const required of allMethods(classes.get(ancestor)!)) {
        if (required.method.static) continue;
        const actual = lookupMethod(
          owner.name,
          required.method.name,
          required.method.params.map((p) => p.type),
        );
        if (
          !actual ||
          actual.method.static ||
          (required.method.public && !actual.method.public) ||
          (actual.method.returns !== required.method.returns &&
            !isSubtype(actual.method.returns, required.method.returns)) ||
          actual.method.throws.some(
            (t) => checkedException(t) && !required.method.throws.some((p) => isSubtype(t, p)),
          )
        )
          reject();
      }
    if (owner.functional && !customFunctional(owner.name)) reject();
  }
  const mainOwner = classes.get(program.outer)!;
  if (
    reservedNames.includes(program.argument) ||
    exceptionNames.includes(program.argument) ||
    program.argument === 'Integer'
  )
    reject();
  const mainScope: Scope = {
    owner: mainOwner,
    static: true,
    locals: new Map([[program.argument, '$args']]),
    thrown: new Set(),
    written: writesIn(program.main),
  };
  body(program.main, mainScope);
  checkThrows(mainScope.thrown, program.throws);
  function checkThrows(thrown: Set<string>, declared: string[]) {
    if ([...thrown].some((t) => checkedException(t) && !declared.some((d) => isSubtype(t, d))))
      reject();
  }
  return {
    classes,
    mainOwner,
    lookupField,
    lookupMethod,
    lookupGenericMethod,
    isSubtype,
    types,
    calls,
    lambdas,
    methodReferences,
    bound,
    customFunctional,
  };
}
