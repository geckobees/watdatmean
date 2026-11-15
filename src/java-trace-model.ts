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
};
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
  const classes = new Map(program.classes.map((c) => [c.name, c]));
  const types = new WeakMap<JExpr, string>();
  const calls = new WeakMap<JExpr, { method?: Method; library?: LibraryCall; overload: boolean }>();
  const signature = (m: JMethod) => m.params.map((p) => p.type).join(',');
  const reference = (t: string) =>
    ['String', 'Integer', 'Object'].includes(t) ||
    classes.has(t) ||
    !!collectionType(t) ||
    !!arrayComponent(t) ||
    isException(t);
  function visibleClass(name: string, owner: JClass): JClass {
    const c = classes.get(name);
    if (!c || (c.enclosing && c.enclosing !== owner.name && c.enclosing !== owner.enclosing))
      reject();
    return c;
  }
  for (const owner of classes.values()) {
    const seen = new Set<string>();
    let c: JClass | undefined = owner;
    while (c) {
      if (seen.has(c.name) || seen.size >= 8) reject();
      seen.add(c.name);
      c = c.parent && c.parent !== 'Object' ? visibleClass(c.parent, c) : undefined;
    }
  }
  function isSubtype(from: string, to: string): boolean {
    if (from === to) return true;
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
    const parent = classes.get(from)?.parent;
    return !!parent && parent !== 'Object' && isSubtype(parent, to);
  }
  function lookupField(type: string, name: string): Field | undefined {
    const owner = classes.get(type);
    if (!owner) return;
    const field = owner.fields.find((f) => f.name === name);
    return field
      ? { owner, field, key: `${owner.name}.${name}` }
      : owner.parent
        ? lookupField(owner.parent, name)
        : undefined;
  }
  function lookupMethod(type: string, name: string, params?: string[]): Method | undefined {
    const owner = classes.get(type);
    if (!owner) return;
    const method = owner.methods.find(
      (m) => m.name === name && (!params || signature(m) === params.join(',')),
    );
    return method
      ? { owner, method }
      : owner.parent
        ? lookupMethod(owner.parent, name, params)
        : undefined;
  }
  function candidates(type: string, name: string) {
    const found = new Map<string, Method>();
    for (
      let owner = classes.get(type);
      owner;
      owner = owner.parent ? classes.get(owner.parent) : undefined
    )
      for (const method of owner.methods)
        if (method.name === name && !found.has(signature(method)))
          found.set(signature(method), { owner, method });
    return [...found.values()];
  }
  function assignable(from: string, to: string, loose = true): boolean {
    if (from === to && from !== 'void') return true;
    if (from === 'null') return reference(to);
    if (
      loose &&
      ((from === 'int' && ['Integer', 'Object'].includes(to)) ||
        (from === 'Integer' && to === 'int'))
    )
      return true;
    return reference(from) && reference(to) && isSubtype(from, to);
  }
  function resolve(type: string, name: string, args: string[]) {
    const all = candidates(type, name);
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
    const component = arrayComponent(type);
    if (component) {
      if (type.split('[]').length > 4) reject();
      validType(component, owner);
      return;
    }
    if (isException(type)) return;
    if (!['int', 'boolean', 'String', 'Integer', 'Object'].includes(type) && !collectionType(type))
      visibleClass(type, owner);
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
      [a, b].every((t) => ['int', 'Integer', 'String', 'boolean', 'null'].includes(t))
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
          return scope.locals.get(e.name)!;
        }
        if (e.name === 'this') {
          if (scope.static) reject();
          return scope.owner.name;
        }
        if (e.name === 'super') {
          if (scope.static || !scope.owner.parent || scope.owner.parent === 'Object') reject();
          return scope.owner.parent;
        }
        if (lookupField(scope.owner.name, e.name)) {
          if (scope.static) reject();
          return fieldType(e.name, scope.owner.name, scope, true);
        }
        if (classes.has(e.name)) return '#' + visibleClass(e.name, scope.owner).name;
        if (['Integer', 'String', 'Object'].includes(e.name)) return '#' + e.name;
        if (
          collectionNames.includes(e.name) &&
          (program.imports.includes(e.name) || program.imports.includes('*'))
        )
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
        const type = typeOf(e.target, scope);
        if (arrayComponent(type) && e.name === 'length') return 'int';
        if (!classes.has(type)) reject();
        return fieldType(e.name, type, scope);
      }
      case 'cast': {
        validType(e.type, scope.owner);
        const from = typeOf(e.value, scope);
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
          const target = expected && collectionType(expected);
          if (!target) reject();
          type = type.slice(0, -2) + `<${target.args.join(',')}>`;
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
        const inputs = e.args.map((a) => typeOf(a, scope));
        const library = librarySignature(type, name, inputs, expected);
        if (library) {
          if (library.params.some((t, i) => !assignable(inputs[i], t))) reject();
          calls.set(e, {
            library,
            overload: name === 'remove' && collectionType(type)?.kind === 'list',
          });
          return library.returns;
        }
        const resolved = resolve(type.replace(/^#/, ''), name, inputs);
        if (type.startsWith('#') && !resolved.method.method.static) reject();
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
          const t = typeOf(stmt.value, scope);
          if (!['int', 'Integer', 'boolean', 'String', 'Object'].includes(t) && !collectionType(t))
            reject();
          break;
        }
        case 'declare': {
          if (
            scope.locals.has(stmt.name) ||
            collectionNames.includes(stmt.name) ||
            stmt.name === 'Integer'
          )
            reject();
          validType(stmt.type, scope.owner);
          scope.locals.set(stmt.name, stmt.type);
          scope.unready = new Set([stmt.name]);
          if (!assignable(typeOf(stmt.value, scope, stmt.type), stmt.type)) reject();
          scope.unready.clear();
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
  const scopeFor = (owner: JClass, params: JParameter[], isStatic = false): Scope => ({
    owner,
    static: isStatic,
    locals: new Map(params.map((p) => [p.name, p.type])),
    thrown: new Set(),
  });
  function validateParams(owner: JClass, params: JParameter[]) {
    for (const p of params) {
      validType(p.type, owner);
      if (
        collectionNames.includes(p.name) ||
        exceptionNames.includes(p.name) ||
        p.name === 'Integer'
      )
        reject();
    }
  }
  for (const owner of classes.values()) {
    validateParams(owner, owner.params);
    const declared = new Set<string>();
    for (const entry of owner.initializers) {
      if (Array.isArray(entry)) body(entry, { ...scopeFor(owner, []), declared });
      else {
        if (
          classes.has(entry.name) ||
          collectionNames.includes(entry.name) ||
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
    const constructorScope = scopeFor(owner, owner.params);
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
      const inherited = owner.parent
        ? lookupMethod(
            owner.parent,
            method.name,
            method.params.map((p) => p.type),
          )
        : undefined;
      if (method.override && (!inherited || inherited.method.static)) reject();
      if (
        inherited &&
        (method.static !== inherited.method.static ||
          method.returns !== inherited.method.returns ||
          (inherited.method.public && !method.public))
      )
        reject();
      const erased = signature(method).replace(/<[^>]*>/g, '');
      if (
        owner.parent &&
        candidates(owner.parent, method.name).some(
          (m) =>
            signature(m.method) !== signature(method) &&
            signature(m.method).replace(/<[^>]*>/g, '') === erased,
        )
      )
        reject();
      if (
        inherited &&
        method.throws.some(
          (t) => checkedException(t) && !inherited.method.throws.some((p) => isSubtype(t, p)),
        )
      )
        reject();
      const methodScope = scopeFor(owner, method.params, method.static);
      const flow = body(method.body, methodScope, method.returns);
      if (method.returns !== 'void' && flow.has('normal')) reject();
      checkThrows(methodScope.thrown, method.throws);
    }
  }
  const mainOwner = classes.get(program.outer)!;
  if (
    collectionNames.includes(program.argument) ||
    exceptionNames.includes(program.argument) ||
    program.argument === 'Integer'
  )
    reject();
  const mainScope: Scope = {
    owner: mainOwner,
    static: true,
    locals: new Map([[program.argument, '$args']]),
    thrown: new Set(),
  };
  body(program.main, mainScope);
  checkThrows(mainScope.thrown, program.throws);
  function checkThrows(thrown: Set<string>, declared: string[]) {
    if ([...thrown].some((t) => checkedException(t) && !declared.some((d) => isSubtype(t, d))))
      reject();
  }
  return { classes, mainOwner, lookupField, lookupMethod, isSubtype, types, calls };
}
