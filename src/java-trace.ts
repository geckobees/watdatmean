import { languageId } from './languages';
import { definition } from './teaching';
import { literalLesson } from './literal-lesson';
import type { LearningRequest, Lesson } from './types';
import {
  javaTokens,
  parseJavaTrace,
  reject,
  type JClass,
  type JExpr,
  type JParameter,
  type JStmt,
} from './java-trace-parser';
import { javaModel, type Field, type Method } from './java-trace-model';
import { arrayComponent, arrayText, type JArray } from './java-arrays';
import { JavaThrown, javaRaise, isException, type JException } from './java-exceptions';
import {
  collectionType,
  collectionText,
  collectionVersion,
  elements,
  isNull,
  makeCollection,
  runLibrary,
  type JCollection,
} from './java-collections';

type Scalar =
  | { kind: 'int'; value: number }
  | { kind: 'Integer'; value: number | null }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'String'; value: string | null }
  | { kind: 'null'; value: null };
type JObject = { actual: string; label: string; fields: Map<string, Value> };
type Reference = { kind: 'ref'; type: string; object?: JObject; direct?: boolean };
export type Value =
  | Scalar
  | Reference
  | { kind: 'array'; type: string; array?: JArray }
  | { kind: 'exception'; type: string; exception?: JException }
  | { kind: 'collection'; type: string; collection?: JCollection }
  | { kind: 'class'; type: string }
  | { kind: 'void' };
type Slot = { type: string; value: Value };
type Scope = {
  owner: JClass;
  object?: JObject;
  locals: Map<string, Slot>;
  label: string;
  pendingFinally?: boolean;
  returns?: string;
};
type Event = { text: string; printed: string | null; object?: JObject; breakAfter?: boolean };
type Completion = { kind: 'normal' | 'return' | 'break' | 'continue'; value?: Value };
const int = (value: number): Scalar => ({ kind: 'int', value: value | 0 });
const display = (v: Value): string =>
  v.kind === 'array'
    ? !v.array
      ? 'null'
      : (() => {
          try {
            const text = arrayText(v, true);
            if (text.length <= 160) return `${v.array!.type} ${text}`;
          } catch {
            /* Some object displays depend on identity. */
          }
          return `${v.array!.type} (${v.array!.items.length} items)`;
        })()
    : v.kind === 'exception'
      ? v.exception
        ? `${v.exception.type}${v.exception.message !== undefined && v.exception.message !== null ? `(${JSON.stringify(v.exception.message)})` : ''}`
        : 'null'
      : v.kind === 'int' || v.kind === 'Integer' || v.kind === 'boolean' || v.kind === 'null'
        ? String(v.value)
        : v.kind === 'String'
          ? JSON.stringify(v.value)
          : v.kind === 'collection'
            ? !v.collection
              ? 'null'
              : (() => {
                  const c = v.collection,
                    size = c.kind === 'map' ? c.entries.length : elements(c).length;
                  return c.ordered && size <= 8
                    ? collectionText(v)
                    : `${size} ${c.kind === 'map' ? 'entries' : 'items'} in ${c.type}`;
                })()
            : v.kind === 'ref'
              ? v.object
                ? `the ${v.object.actual} object ${v.object.label}`
                : 'null'
              : reject();
function source(e: JExpr): string {
  switch (e.kind) {
    case 'literal':
      return JSON.stringify(e.value);
    case 'name':
      return e.name;
    case 'member':
      return `${e.target.kind === 'cast' ? `(${source(e.target)})` : source(e.target)}.${e.name}`;
    case 'call':
      return `${source(e.target)}(${e.args.map(source).join(', ')})`;
    case 'new':
      return `new ${e.type}(${e.args.map(source).join(', ')})`;
    case 'array':
      return e.dimensions
        ? `new ${e.type!.replace(/\[\]/g, '')}${e.dimensions.map((d) => `[${d ? source(d) : ''}]`).join('')}`
        : `${e.type ? `new ${e.type}` : ''}{${e.items!.map(source).join(', ')}}`;
    case 'index':
      return `${source(e.target)}[${source(e.index)}]`;
    case 'cast':
      return `(${e.type}) ${source(e.value)}`;
    case 'negative':
      return `-(${source(e.value)})`;
    case 'not':
      return `!(${source(e.value)})`;
    case 'increment':
      return e.prefix
        ? `${e.delta > 0 ? '++' : '--'}${source(e.target)}`
        : `${source(e.target)}${e.delta > 0 ? '++' : '--'}`;
    case 'binary':
      return `(${source(e.left)} ${e.op} ${source(e.right)})`;
  }
}

// Read a checked, bounded subset as data. Never execute a selection or invoke external code.
// Unsupported syntax/types/context, resource limits and uncaught failures discard the ENTIRE result.
export function javaTraceLesson(request: LearningRequest): Lesson | undefined {
  if (
    languageId(request.language ?? '') !== 'java' ||
    !['explain', 'walkthrough'].includes(request.task) ||
    request.learningContext?.trim() ||
    request.replacement?.trim() ||
    request.evidence?.length
  )
    return;
  try {
    if (request.context?.trim()) {
      const tokens = (code: string) => javaTokens(code).map((t) => t.text);
      if (JSON.stringify(tokens(request.context)) !== JSON.stringify(tokens(request.code))) return;
    }
    let program,
      statementsOnly = false;
    try {
      program = parseJavaTrace(request.code);
    } catch {
      // Preserve the existing reviewed literal-print lesson. Other self-contained primitive
      // statements can share this type checker without inventing surrounding declarations.
      if (literalLesson(request)) return;
      program = parseJavaTrace(
        `class WdmLocalSnippet { public static void main(String[] args) { ${request.code}\n } }`,
      );
      const owner = program.classes[0];
      const hasReturn = (body: JStmt[]): boolean =>
        body.some(
          (s) =>
            s.kind === 'return' ||
            (s.kind === 'if' && (hasReturn(s.yes) || hasReturn(s.no))) ||
            (s.kind === 'try' &&
              (hasReturn(s.body) ||
                s.catches.some((c) => hasReturn(c.body)) ||
                (!!s.final && hasReturn(s.final)))) ||
            (['block', 'loop', 'foreach'].includes(s.kind) &&
              hasReturn((s as Extract<JStmt, { body: JStmt[] }>).body)),
        );
      if (
        hasReturn(program.main) ||
        program.classes.length !== 1 ||
        owner.fields.length ||
        owner.methods.length ||
        owner.params.length ||
        owner.constructor.length ||
        owner.parent ||
        program.main.some(
          (s) =>
            ![
              'declare',
              'assign',
              'print',
              'call',
              'if',
              'loop',
              'block',
              'foreach',
              'try',
              'throw',
            ].includes(s.kind) ||
            (s.kind === 'declare' &&
              !['int', 'String', 'boolean', 'Integer'].includes(s.type) &&
              !arrayComponent(s.type) &&
              !isException(s.type)),
        )
      )
        return;
      statementsOnly = true;
    }
    const { classes, mainOwner, lookupField, lookupMethod, isSubtype, types, calls } =
      javaModel(program);
    const objects: JObject[] = [],
      events: Event[] = [];
    let reads: string[] = [],
      operations = 0,
      depth = 0,
      prints = 0,
      outputLength = 0;
    let stringJoin = false,
      staticUsed = false,
      castUsed = false,
      dispatchUsed = false,
      parameterUsed = false,
      localUsed = false,
      overflow = false,
      division = false,
      loopUsed = false,
      collectionUsed = false,
      overloadUsed = false,
      arrayUsed = false,
      exceptionUsed = false;
    let arrayAllocations = 0,
      arrayCells = 0,
      exceptionAllocations = 0;
    let iterations = 0,
      allocations = 0;
    type Capture = { samples: string[]; printed: string | null; recording: boolean };
    const captures: Capture[] = [];
    const constructing = new Set<JObject>();
    let virtualDuringConstruction = false;
    const tick = () => {
      if (++operations > 20000) reject();
    };
    const append = (event: Event) => {
      const capture = captures.at(-1);
      if (capture) {
        if (capture.recording && capture.samples.length < 3) capture.samples.push(event.text);
        if (event.printed !== null) capture.printed = (capture.printed ?? '') + event.printed;
      } else {
        if (events.length >= 80 || event.text.length > 3000) reject();
        events.push(event);
      }
    };
    const emit = (text: string, printed: string | null = null, object?: JObject) => {
      if (printed !== null) {
        outputLength += printed.length;
        if (++prints > 256 || outputLength > 8000) reject();
      }
      append({ text, printed, object });
    };
    const read = (text: string) => {
      if (!reads.includes(text)) reads.push(text);
    };
    const scalar = (v: Value): Scalar => {
      if (!['int', 'Integer', 'boolean', 'String', 'null'].includes(v.kind)) reject();
      return v as Scalar;
    };
    function convert(type: string, value: Value): Value {
      if (['String', 'Integer'].includes(type) && isNull(value))
        return { kind: type, value: null } as Scalar;
      if (type === 'Integer' && value.kind === 'int')
        return { kind: 'Integer', value: value.value };
      if (type === 'int' && value.kind === 'Integer') {
        if (value.value === null)
          javaRaise(
            'NullPointerException',
            undefined,
            'Java needs an int here, but the Integer value is null.',
          );
        return int(value.value);
      }
      if (type === 'Object') {
        if (value.kind === 'int') return { kind: 'Integer', value: value.value };
        if (
          ['String', 'Integer', 'ref', 'null', 'collection', 'array', 'exception'].includes(
            value.kind,
          )
        )
          return value;
        reject();
      }
      if (collectionType(type)) {
        if (isNull(value)) return { kind: 'collection', type };
        if (value.kind !== 'collection' || !isSubtype(value.type, type)) reject();
        return { kind: 'collection', type, collection: value.collection };
      }
      if (arrayComponent(type)) {
        if (isNull(value)) return { kind: 'array', type };
        if (value.kind !== 'array' || !isSubtype(value.type, type)) reject();
        return { ...value, type };
      }
      if (isException(type)) {
        if (isNull(value)) return { kind: 'exception', type };
        if (value.kind !== 'exception' || !isSubtype(value.type, type)) reject();
        return { ...value, type };
      }
      if (classes.has(type)) {
        if (isNull(value)) return { kind: 'ref', type };
        if (value.kind !== 'ref' || !isSubtype(value.type, type)) reject();
        return { kind: 'ref', type, object: value.object };
      }
      if (value.kind !== type) reject();
      return value;
    }
    const number = (v: Value): number => {
      const n = convert('int', v);
      if (n.kind !== 'int') reject();
      return n.value;
    };
    const truth = (v: Value): boolean => {
      if (v.kind !== 'boolean') reject();
      return v.value;
    };
    function defaultValue(type: string): Value {
      if (type === 'int') return int(0);
      if (type === 'boolean') return { kind: 'boolean', value: false };
      return convert(type, { kind: 'null', value: null });
    }
    function makeArray(type: string, items: Value[]): Value {
      if (++arrayAllocations > 64 || (arrayCells += items.length) > 512 || items.length > 128)
        reject();
      arrayUsed = true;
      return { kind: 'array', type, array: { type, items } };
    }
    function arrayData(value: Value): JArray {
      if (isNull(value))
        javaRaise(
          'NullPointerException',
          undefined,
          'The array reference is null; it has no length or elements.',
        );
      if (value.kind !== 'array' || !value.array) reject();
      return value.array;
    }
    function binary(op: string, a: Value, b: Value): Scalar {
      if (['==', '!='].includes(op)) {
        const equal =
          isNull(a) || isNull(b)
            ? isNull(a) && isNull(b)
            : a.kind === 'array' || b.kind === 'array'
              ? a.kind === 'array' && b.kind === 'array' && a.array === b.array
              : a.kind === 'boolean' && b.kind === 'boolean'
                ? a.value === b.value
                : number(a) === number(b);
        return { kind: 'boolean', value: op === '==' ? equal : !equal };
      }
      if (['<', '<=', '>', '>='].includes(op)) {
        const a1 = number(a),
          b1 = number(b);
        return {
          kind: 'boolean',
          value: op === '<' ? a1 < b1 : op === '<=' ? a1 <= b1 : op === '>' ? a1 > b1 : a1 >= b1,
        };
      }
      const left = scalar(a),
        right = scalar(b);
      if (op === '+' && (left.kind === 'String' || right.kind === 'String')) {
        const value = String(left.value) + String(right.value);
        if (value.length > 2000) reject();
        stringJoin = true;
        return { kind: 'String', value };
      }
      const lv = number(left),
        rv = number(right);
      let value: number;
      if (op === '/' || op === '%') {
        if (rv === 0)
          javaRaise(
            'ArithmeticException',
            undefined,
            `Integer ${op === '/' ? 'division' : 'remainder'} by zero is undefined.`,
          );
        division = true;
        value = op === '/' ? Math.trunc(lv / rv) : lv % rv;
      } else value = op === '+' ? lv + rv : op === '-' ? lv - rv : lv * rv;
      if (value < -2147483648 || value > 2147483647) overflow = true;
      return int(op === '*' ? Math.imul(lv, rv) : value);
    }
    function fieldTarget(expr: JExpr, scope: Scope): { object: JObject; field: Field } {
      let type: string, object: JObject | undefined, name: string;
      if (expr.kind === 'name') {
        type = scope.owner.name;
        object = scope.object;
        name = expr.name;
      } else if (expr.kind === 'member') {
        const target = evaluate(expr.target, scope);
        if (target.kind !== 'ref') reject();
        type = target.type;
        object = target.object;
        name = expr.name;
      } else reject();
      const field = lookupField(type, name);
      if (!object) javaRaise('NullPointerException');
      if (!field) reject();
      return { object, field };
    }
    function callTarget(expr: JExpr, scope: Scope): Value {
      if (expr.kind === 'name') {
        return scope.object
          ? { kind: 'ref', type: scope.owner.name, object: scope.object }
          : { kind: 'class', type: scope.owner.name };
      } else if (expr.kind === 'member') {
        return evaluate(expr.target, scope);
      } else reject();
    }
    function localsFor(params: JParameter[], values: Value[]): Map<string, Slot> {
      if (params.length !== values.length) reject();
      return new Map(
        params.map((p, i) => [p.name, { type: p.type, value: convert(p.type, values[i]) }]),
      );
    }
    function evaluate(expr: JExpr, scope: Scope, label?: string, discard = false): Value {
      tick();
      switch (expr.kind) {
        case 'literal':
          return typeof expr.value === 'number'
            ? int(expr.value)
            : ({
                kind:
                  expr.value === null
                    ? 'null'
                    : typeof expr.value === 'boolean'
                      ? 'boolean'
                      : 'String',
                value: expr.value,
              } as Scalar);
        case 'name': {
          const local = scope.locals.get(expr.name);
          if (local) {
            if (local.value.kind !== 'ref') read(`${expr.name}=${display(local.value)}`);
            return local.value;
          }
          if (expr.name === 'this' && scope.object)
            return { kind: 'ref', type: scope.owner.name, object: scope.object };
          if (expr.name === 'super' && scope.object && scope.owner.parent)
            return { kind: 'ref', type: scope.owner.parent, object: scope.object, direct: true };
          if (classes.has(expr.name)) return { kind: 'class', type: expr.name };
          if (types.get(expr)?.startsWith('#'))
            return { kind: 'class', type: types.get(expr)!.slice(1) };
          break;
        }
        case 'negative': {
          const value = number(evaluate(expr.value, scope));
          if (value === -2147483648) overflow = true;
          return int(-value);
        }
        case 'not':
          return { kind: 'boolean', value: !truth(evaluate(expr.value, scope)) };
        case 'increment': {
          const slot = targetSlot(expr.target, scope),
            old = slot.get();
          const value = convert(slot.type, binary('+', old, int(expr.delta)));
          slot.set(value);
          emit(
            `${source(expr)} changes ${source(expr.target)}: ${display(old)} → ${display(value)}${discard ? '' : `; ${expr.prefix ? 'uses the new value' : 'uses the old value'}`}.`,
          );
          return expr.prefix ? value : old;
        }
        case 'binary': {
          let left = evaluate(expr.left, scope);
          if (expr.op === '&&' || expr.op === '||')
            return {
              kind: 'boolean',
              value:
                expr.op === '&&'
                  ? truth(left) && truth(evaluate(expr.right, scope))
                  : truth(left) || truth(evaluate(expr.right, scope)),
            };
          const numeric =
            !['String'].includes(types.get(expr.left)!) &&
            !['String'].includes(types.get(expr.right)!) &&
            (['+', '-', '*', '/', '%', '<', '<=', '>', '>='].includes(expr.op) ||
              (['==', '!='].includes(expr.op) &&
                [types.get(expr.left), types.get(expr.right)].includes('int')));
          if (numeric && types.get(expr.left) === 'Integer') left = int(number(left));
          const right = evaluate(expr.right, scope);
          if (
            ['==', '!='].includes(expr.op) &&
            [types.get(expr.left), types.get(expr.right)].includes('int')
          )
            return binary(expr.op, int(number(left)), int(number(right)));
          return binary(expr.op, left, right);
        }
        case 'cast': {
          castUsed = true;
          const value = evaluate(expr.value, scope);
          if (isNull(value)) return defaultValue(expr.type);
          if (expr.type === 'Object') return convert('Object', value);
          if (value.kind === 'int' && expr.type === 'Integer') return convert('Integer', value);
          const actual =
            value.kind === 'array'
              ? value.array!.type
              : value.kind === 'exception'
                ? value.exception!.type
                : value.kind === 'ref'
                  ? value.object!.actual
                  : value.kind;
          if (!isSubtype(actual, expr.type))
            javaRaise(
              'ClassCastException',
              undefined,
              `The actual ${actual} object cannot be viewed as ${expr.type}.`,
            );
          if (arrayComponent(expr.type) && value.kind === 'array')
            return { ...value, type: expr.type };
          if (isException(expr.type) && value.kind === 'exception')
            return { ...value, type: expr.type };
          if (['String', 'Integer'].includes(expr.type)) return convert(expr.type, value);
          if (value.kind !== 'ref') reject();
          const object = value.object;
          return { kind: 'ref', type: expr.type, object };
        }
        case 'array': {
          const type = types.get(expr)!;
          if (expr.items)
            return makeArray(
              type,
              expr.items.map((e) => convert(arrayComponent(type)!, evaluate(e, scope))),
            );
          const dims = expr.dimensions!.map((d) => (d ? number(evaluate(d, scope)) : null));
          if (dims.some((d) => d !== null && d < 0))
            javaRaise(
              'NegativeArraySizeException',
              undefined,
              'An array length cannot be negative.',
            );
          if (dims.some((d) => d !== null && d > 128)) reject();
          const allocate = (t: string, at: number): Value =>
            makeArray(
              t,
              Array.from({ length: dims[at]! }, () =>
                dims[at + 1] !== undefined && dims[at + 1] !== null
                  ? allocate(arrayComponent(t)!, at + 1)
                  : defaultValue(arrayComponent(t)!),
              ),
            );
          return allocate(type, 0);
        }
        case 'index': {
          const slot = targetSlot(expr, scope),
            value = slot.get();
          read(`${source(expr)}=${display(value)}`);
          return value;
        }
        case 'new': {
          const values = expr.args.map((e, i) => {
            const value = evaluate(e, scope),
              param = classes.get(expr.type)?.params[i];
            return param ? convert(param.type, value) : value;
          });
          if (isException(expr.type)) {
            if (++exceptionAllocations > 128) reject();
            exceptionUsed = true;
            return {
              kind: 'exception',
              type: expr.type,
              exception: {
                type: expr.type,
                message: values.length
                  ? (values[0] as Extract<Value, { kind: 'String' }>).value
                  : null,
              },
            };
          }
          if (collectionType(types.get(expr)!)) {
            if (++allocations > 16) reject();
            collectionUsed = true;
            return makeCollection(types.get(expr)!, values);
          }
          if (objects.length >= 6) reject();
          const owner = classes.get(expr.type)!;
          const object: JObject = {
            actual: expr.type,
            label:
              label && !objects.some((o) => o.label === label)
                ? label
                : `${label ?? expr.type}#${objects.length + 1}`,
            fields: new Map(),
          };
          for (
            let c: JClass | undefined = owner;
            c;
            c = c.parent ? classes.get(c.parent) : undefined
          )
            for (const field of c.fields)
              object.fields.set(`${c.name}.${field.name}`, defaultValue(field.type));
          objects.push(object);
          constructing.add(object);
          const defaults = [...new Set([...object.fields.values()].map((v) => v.kind))]
            .map((kind) =>
              kind === 'String'
                ? 'String fields start null'
                : kind === 'boolean'
                  ? 'boolean fields start false'
                  : kind === 'array'
                    ? 'array fields start null'
                    : 'int fields start at 0',
            )
            .join('; ');
          emit(
            `${source(expr)} creates ${object.label}${defaults ? '; ' + defaults : ''}.`,
            null,
            object,
          );
          try {
            construct(owner, object, values);
          } finally {
            constructing.delete(object);
          }
          return { kind: 'ref', type: expr.type, object };
        }
        case 'call':
          return invoke(expr, scope);
        case 'member':
          if (expr.name === 'length' && arrayComponent(types.get(expr.target)!))
            return int(arrayData(evaluate(expr.target, scope)).items.length);
          break;
      }
      const { object, field } = fieldTarget(expr, scope),
        value = object.fields.get(field.key)!;
      read(`${source(expr)} → ${field.key}=${display(value)}`);
      return value;
    }
    function invoke(expr: Extract<JExpr, { kind: 'call' }>, scope: Scope): Value {
      if (++depth > 12) reject();
      // Receiver/argument reads describe the call's inputs, not the state after it mutates them.
      // Keep earlier reads from the enclosing expression without reusing stale receiver values.
      const parentReads = reads;
      try {
        reads = [];
        const target = callTarget(expr.target, scope),
          binding = calls.get(expr);
        if (!binding) reject();
        const values = expr.args.map((e, i) =>
          convert(
            binding.library?.params[i] ?? binding.method!.method.params[i].type,
            evaluate(e, scope),
          ),
        );
        reads = [];
        if (binding.library) {
          const plan = binding.library;
          if (plan.type || plan.op === 'keySet') {
            if (++allocations > 16) reject();
          }
          collectionUsed ||= !!collectionType(plan.receiver) || !!plan.type;
          let special: Value | undefined;
          if (isException(plan.receiver)) {
            if (isNull(target)) javaRaise('NullPointerException');
            if (target.kind !== 'exception' || !target.exception) reject();
            const e = target.exception;
            if (e.message === undefined) reject();
            special = {
              kind: 'String',
              value:
                plan.op === 'getMessage'
                  ? e.message
                  : `java.lang.${e.type}${e.message === null ? '' : ': ' + e.message}`,
            };
          } else if (plan.receiver === '#Arrays' || arrayComponent(plan.receiver)) {
            const value = plan.receiver === '#Arrays' ? values[0] : target;
            if (plan.op === 'toString' || plan.op === 'deepToString')
              special = { kind: 'String', value: arrayText(value, plan.op === 'deepToString') };
            else {
              const length =
                plan.op === 'clone' ? arrayData(value).items.length : number(values[1]);
              // copyOf overloads can test null and a negative length in different orders.
              if (plan.op === 'copyOf' && isNull(value) && length < 0) reject();
              if (length < 0) javaRaise('NegativeArraySizeException');
              if (length > 128) reject();
              const data = arrayData(value),
                component = arrayComponent(data.type)!;
              special = makeArray(
                data.type,
                Array.from({ length }, (_, i) =>
                  i < data.items.length ? data.items[i] : defaultValue(component),
                ),
              );
            }
          }
          const result = convertResult(
            plan.returns,
            special ??
              runLibrary(
                plan,
                target,
                values.map((v, i) => convert(plan.params[i], v)),
              ),
          );
          const detail = binding.overload
            ? plan.params[0] === 'int'
              ? ' removes by zero-based index (int)'
              : ' removes the first matching value (Object)'
            : '';
          emit(
            `${source(expr)}${detail}${result.kind === 'void' ? '' : ` → ${display(result)}`}${['add', 'remove', 'put', 'set', 'clear'].includes(plan.op) ? `; collection now ${display(target)}` : ''}.`,
          );
          reads = parentReads;
          return result;
        }
        const resolved = binding.method!;
        if (target.kind !== 'ref' && target.kind !== 'class') reject();
        let chosen = resolved,
          object: JObject | undefined;
        if (!resolved.method.static) {
          if (isNull(target)) javaRaise('NullPointerException');
          if (target.kind !== 'ref' || !target.object) reject();
          object = target.object;
          chosen = target.direct
            ? resolved
            : lookupMethod(
                object.actual,
                resolved.method.name,
                resolved.method.params.map((p) => p.type),
              )!;
          dispatchUsed ||= chosen.owner !== resolved.owner;
          if (constructing.has(object) && chosen.owner !== resolved.owner)
            virtualDuringConstruction = true;
        } else staticUsed = target.kind === 'ref' || staticUsed;
        overloadUsed ||= binding.overload;
        const locals = localsFor(chosen.method.params, values);
        const label = `${chosen.owner.name}.${chosen.method.name}(${chosen.method.params.map((p) => p.name).join(', ')})`;
        const bindings = chosen.method.params
          .map((p) => `${p.name}=${display(locals.get(p.name)!.value)}`)
          .join(', ');
        parameterUsed ||= !!bindings;
        // Literal static return helpers need only one binding in the consuming print.
        const literalStatic =
          !binding.overload &&
          chosen.method.static &&
          chosen.method.params.length === 0 &&
          chosen.method.body.length === 1 &&
          chosen.method.body[0].kind === 'return' &&
          chosen.method.body[0].value?.kind === 'literal';
        if (!literalStatic)
          emit(
            `${binding.overload ? `Declared argument types select ${resolved.owner.name}.${resolved.method.name}(${resolved.method.params.map((p) => p.type).join(', ')}). ` : ''}${source(expr)} runs ${label}${object ? (target.kind === 'ref' && target.direct ? ' via super' : ` because the actual object is ${object.actual}`) : ' (static)'}${object && constructing.has(object) ? ', even during construction' : ''}${bindings ? `; arguments become ${bindings}` : ''}.`,
            null,
            object,
          );
        const result = runBody(
          chosen.method.body,
          { owner: chosen.owner, object, locals, label, returns: chosen.method.returns },
          literalStatic,
        );
        reads = parentReads;
        if (chosen.method.returns === 'void') return { kind: 'void' };
        if (result.kind !== 'return' || !result.value) reject();
        const value = convert(chosen.method.returns, result.value);
        read(
          `${source(expr)} ${chosen.method.static ? 'uses static ' : 'returns from '}${label}=${display(value)}${target.kind === 'ref' && !target.object && chosen.method.static ? ' (no null dereference)' : ''}`,
        );
        return value;
      } finally {
        reads = parentReads;
        depth--;
      }
    }
    function convertResult(type: string, value: Value): Value {
      return type === 'void' ? value : convert(type, value);
    }
    function targetSlot(expr: JExpr, scope: Scope) {
      if (expr.kind === 'index') {
        const value = evaluate(expr.target, scope),
          index = number(evaluate(expr.index, scope));
        const type = types.get(expr)!;
        const data = () => {
          const d = arrayData(value);
          if (index < 0 || index >= d.items.length)
            javaRaise(
              'ArrayIndexOutOfBoundsException',
              undefined,
              `${source(expr)} requests index ${index}; ${d.items.length ? `valid indexes are 0 through ${d.items.length - 1}` : 'this empty array has no valid index'}.`,
            );
          return d;
        };
        return {
          type,
          name: `element ${source(expr)}`,
          object: undefined,
          get: () => convert(type, data().items[index]),
          set: (item: Value) => {
            const d = data(),
              actualComponent = arrayComponent(d.type)!;
            const actual =
              item.kind === 'ref'
                ? item.object?.actual
                : item.kind === 'array'
                  ? item.array?.type
                  : item.kind === 'exception'
                    ? item.exception?.type
                    : item.kind;
            if (!isNull(item) && actual && !isSubtype(actual, actualComponent))
              javaRaise(
                'ArrayStoreException',
                undefined,
                `The actual array stores ${actualComponent}; it cannot store ${actual}.`,
              );
            d.items[index] = item;
          },
        };
      }
      const local = expr.kind === 'name' ? scope.locals.get(expr.name) : undefined;
      let field: { object?: JObject; field: Field } | undefined;
      if (!local) {
        const target =
          expr.kind === 'member'
            ? evaluate(expr.target, scope)
            : ({ kind: 'ref', type: scope.owner.name, object: scope.object } as Reference);
        if (target.kind !== 'ref') reject();
        const resolved = lookupField(
          target.type,
          expr.kind === 'member' ? expr.name : expr.kind === 'name' ? expr.name : reject(),
        );
        if (!resolved) reject();
        field = { object: target.object, field: resolved };
      }
      const fieldObject = () => {
        if (!field?.object) javaRaise('NullPointerException');
        return field.object;
      };
      return {
        type: local?.type ?? field!.field.field.type,
        object: field?.object,
        name: local ? `local ${source(expr)}` : field!.field.key,
        get: () => (local ? local.value : fieldObject().fields.get(field!.field.key)!),
        set: (value: Value) => {
          if (local) local.value = value;
          else fieldObject().fields.set(field!.field.key, value);
        },
      };
    }
    const childScope = (scope: Scope): Scope => ({ ...scope, locals: new Map(scope.locals) });
    function snapshot(scope: Scope): Map<string, string> {
      const result = new Map([...scope.locals].map(([name, slot]) => [name, display(slot.value)]));
      for (const object of objects)
        for (const [name, value] of object.fields)
          result.set(`${object.label}.${name}`, display(value));
      return result;
    }
    function runLoop(
      stmt: Extract<JStmt, { kind: 'loop' | 'foreach' }>,
      parent: Scope,
    ): Completion {
      loopUsed = true;
      const scope = childScope(parent),
        capture: Capture = { samples: [], printed: null, recording: true };
      captures.push(capture);
      let data: JCollection | undefined,
        array: JArray | undefined,
        version = 0,
        count = 0,
        skipped = 0,
        stopped = 'condition became false',
        completion: Completion = { kind: 'normal' };
      let fault: JavaThrown | undefined,
        initialization = '',
        before = snapshot(scope);
      try {
        if (stmt.kind === 'loop' && stmt.init) runBody([stmt.init], scope);
        if (stmt.kind === 'foreach') {
          const value = evaluate(stmt.iterable, scope);
          if (isNull(value)) javaRaise('NullPointerException');
          if (value.kind === 'array') array = arrayData(value);
          else {
            if (value.kind !== 'collection' || !value.collection) reject();
            data = value.collection;
            if (!data.ordered && elements(data).length > 1) reject();
            version = collectionVersion(data);
          }
        }
        initialization = capture.samples.join(' ');
        before = snapshot(scope);
        capture.samples = [];
        reads = [];
        while (true) {
          capture.recording = count === 0;
          if (stmt.kind === 'foreach') {
            const items = array?.items ?? elements(data!);
            if (count >= items.length) {
              stopped = 'all items were visited';
              break;
            }
            scope.locals.set(stmt.name, {
              type: stmt.type,
              value: convert(stmt.type, items[count]),
            });
          } else if (
            (stmt.form !== 'do' || count > 0) &&
            stmt.condition &&
            !truth(evaluate(stmt.condition, scope))
          )
            break;
          if (++count > 256 || ++iterations > 2048) reject();
          const result = runBody(stmt.body, childScope(scope));
          if (data && collectionVersion(data) !== version) reject(); // Iterator modification cannot be safely summarized as a normal result.
          if (result.kind === 'return') {
            completion = result;
            stopped = 'return exits the method';
            break;
          }
          if (result.kind === 'break') {
            stopped = 'break exits this loop';
            break;
          }
          if (result.kind === 'continue') skipped++;
          if (stmt.kind === 'loop' && stmt.update) runBody([stmt.update], scope);
        }
      } catch (error) {
        if (!(error instanceof JavaThrown)) throw error;
        fault = error;
        stopped = `${error.exception.type} interrupts the loop`;
      }
      const after = snapshot(scope),
        changed = [...after]
          .filter(([key, value]) => before.get(key) !== value)
          .map(([key, value]) => `${key}=${value}`);
      const initial =
        stmt.kind === 'loop' && stmt.init?.kind === 'declare' && stmt.init.value.kind === 'literal'
          ? `${stmt.init.name} starts at ${before.get(stmt.init.name)}. `
          : initialization
            ? `Before the loop: ${initialization} `
            : '';
      const header =
        stmt.kind === 'foreach'
          ? `for (${stmt.type} ${stmt.name} : ${source(stmt.iterable)})`
          : stmt.form === 'for'
            ? `for loop${stmt.condition ? ` with ${source(stmt.condition)}` : ''}${stmt.update ? `; update: ${stmt.update.kind === 'call' ? source(stmt.update.value) : stmt.update.kind === 'assign' ? `${source(stmt.update.target)} ${stmt.update.op} ${source(stmt.update.value)}` : ''}` : ''}`
            : `${stmt.form === 'do' ? 'do-while' : 'while'} ${stmt.condition ? source(stmt.condition) : ''}`;
      const text = `${initial}${header}: ${count} iteration${count === 1 ? '' : 's'}${count === 0 ? ' (the body never runs)' : ''}. ${capture.samples.length ? `${count ? 'First pass' : 'Condition check'}: ${capture.samples.join(' ')} ` : ''}${changed.length ? `Final values: ${changed.join(', ')}. ` : ''}${skipped ? `${skipped} continue${skipped === 1 ? '' : 's'} skip the rest of a pass${stmt.kind === 'loop' && stmt.form === 'for' ? ', then run the update' : ''}. ` : ''}${stmt.kind === 'loop' && stmt.form === 'do' ? 'The body runs before testing the condition. ' : ''}Stops because ${stopped}.`;
      captures.pop();
      append({ text, printed: capture.printed, breakAfter: true });
      reads = [];
      if (fault) throw fault;
      return completion;
    }
    function runTry(stmt: Extract<JStmt, { kind: 'try' }>, scope: Scope): Completion {
      exceptionUsed = true;
      let completion: Completion = { kind: 'normal' },
        fault: JavaThrown | undefined;
      const local = () => ({
        ...childScope(scope),
        pendingFinally: !!stmt.final || scope.pendingFinally,
      });
      try {
        completion = runBody(stmt.body, local());
      } catch (error) {
        if (!(error instanceof JavaThrown)) throw error;
        const handler = stmt.catches.find((c) =>
          c.types.some((t) => isSubtype(error.exception.type, t)),
        );
        reads = [];
        if (handler) {
          emit(
            `${error.exception.detail ? error.exception.detail + ' ' : ''}${error.exception.type} interrupts try; catch (${handler.types.join(' | ')} ${handler.name}) handles it. Remaining try statements are skipped.`,
          );
          const caught = local();
          caught.locals.set(handler.name, {
            type: handler.types[0],
            value: { kind: 'exception', type: error.exception.type, exception: error.exception },
          });
          try {
            completion = runBody(handler.body, caught);
          } catch (next) {
            if (!(next instanceof JavaThrown)) throw next;
            fault = next;
          }
        } else {
          fault = error;
          emit(
            `${error.exception.type} has no matching catch here; it propagates to the caller or an outer try.`,
          );
        }
      }
      if (stmt.final) {
        const pending = fault
          ? 'exception'
          : completion.kind === 'normal'
            ? 'normal completion'
            : completion.kind;
        emit(
          `finally runs before ${pending}${completion.kind === 'return' && completion.value ? ` (saved value ${display(completion.value)})` : ''} continues.`,
        );
        try {
          const result = runBody(stmt.final, childScope(scope));
          if (result.kind !== 'normal') {
            emit(`finally's ${result.kind} replaces the pending ${pending}.`);
            completion = result;
            fault = undefined;
          }
        } catch (next) {
          if (!(next instanceof JavaThrown)) throw next;
          emit(`finally throws ${next.exception.type}, replacing the pending ${pending}.`);
          fault = next;
        }
      }
      reads = [];
      if (fault) throw fault;
      return completion;
    }
    function runBody(body: JStmt[], scope: Scope, quietReturn = false): Completion {
      for (const stmt of body) {
        tick();
        if (stmt.kind === 'print') {
          const value = evaluate(stmt.value, scope);
          emit(
            `${reads.length ? reads.join('; ') + '. ' : ''}${stmt.newline ? 'println ends the line.' : 'print adds no newline.'}`,
            collectionText(value) + (stmt.newline ? '\n' : ''),
            scope.object,
          );
        } else if (stmt.kind === 'declare') {
          const printsBefore = prints;
          const value = convert(stmt.type, evaluate(stmt.value, scope, stmt.name));
          scope.locals.set(stmt.name, { type: stmt.type, value });
          localUsed ||= value.kind !== 'ref';
          emit(
            stmt.value.kind === 'new' && value.kind === 'ref'
              ? `Construction finishes; ${stmt.name} (declared ${stmt.type}) holds this ${value.object!.actual} object.`
              : `${stmt.name} (declared ${stmt.type}) stores ${source(stmt.value)} → ${display(value)}.`,
          );
          if (stmt.value.kind === 'new' && printsBefore === prints && !captures.length)
            events.at(-1)!.breakAfter = true;
        } else if (stmt.kind === 'assign') {
          const slot = targetSlot(stmt.target, scope);
          let old = stmt.op === '=' && stmt.target.kind !== 'name' ? undefined : slot.get();
          if (stmt.op !== '=' && slot.type === 'Integer') old = convert('int', old!);
          const right = evaluate(stmt.value, scope);
          const value = convert(
            slot.type,
            stmt.op === '=' ? right : binary(stmt.op[0], old!, right),
          );
          old ??= slot.get();
          slot.set(value);
          emit(
            `${source(stmt.target)} ${stmt.op} ${source(stmt.value)} changes ${slot.name}: ${display(old)} → ${display(value)}.`,
            null,
            slot.object,
          );
        } else if (stmt.kind === 'call') evaluate(stmt.value, scope, undefined, true);
        else if (stmt.kind === 'return') {
          const value = stmt.value
            ? convertResult(scope.returns ?? 'void', evaluate(stmt.value, scope))
            : ({ kind: 'void' } as Value);
          if (!quietReturn && stmt.value)
            emit(
              scope.pendingFinally
                ? `${scope.label} prepares return ${source(stmt.value)} → ${display(value)}; the value is saved while finally runs.`
                : `${scope.label} returns ${source(stmt.value)} → ${display(value)} to its caller.`,
            );
          reads = [];
          return { kind: 'return', value };
        } else if (stmt.kind === 'throw') {
          const value = evaluate(stmt.value, scope);
          if (isNull(value)) javaRaise('NullPointerException');
          if (value.kind !== 'exception' || !value.exception) reject();
          emit(`throw sends ${display(value)} to a matching catch, if one exists.`);
          throw new JavaThrown(value.exception);
        } else if (stmt.kind === 'try') {
          const result = runTry(stmt, scope);
          if (result.kind !== 'normal') return result;
        } else if (stmt.kind === 'block') {
          const result = runBody(stmt.body, childScope(scope), quietReturn);
          if (result.kind !== 'normal') return result;
        } else if (stmt.kind === 'if') {
          const condition = truth(evaluate(stmt.condition, scope));
          emit(
            `${source(stmt.condition)} is ${condition}; ${condition ? 'run the if branch' : stmt.no.length ? 'run the else branch' : 'skip its body'}.`,
          );
          const result = runBody(condition ? stmt.yes : stmt.no, childScope(scope), quietReturn);
          if (result.kind !== 'normal') return result;
        } else if (stmt.kind === 'loop' || stmt.kind === 'foreach') {
          const result = runLoop(stmt, scope);
          if (result.kind !== 'normal') return result;
        } else if (stmt.kind === 'break' || stmt.kind === 'continue') {
          return { kind: stmt.kind };
        } else reject();
        reads = [];
      }
      return { kind: 'normal' };
    }
    function construct(owner: JClass, object: JObject, values: Value[]) {
      if (++depth > 12) reject();
      try {
        const locals = localsFor(owner.params, values),
          label = `${owner.name}(${owner.params.map((p) => p.name).join(', ')})`;
        const bindings = owner.params
          .map((p) => `${p.name}=${display(locals.get(p.name)!.value)}`)
          .join(', ');
        if (bindings) {
          parameterUsed = true;
          emit(
            `${label} receives ${bindings}${owner.params.some((p) => lookupField(owner.name, p.name)) ? '; parameters are separate from fields' : ''}.`,
            null,
            object,
          );
        }
        const parent = owner.parent ? classes.get(owner.parent) : undefined;
        const first = owner.constructor[0];
        const parentValues =
          first?.kind === 'super'
            ? first.args.map((e, i) =>
                convert(parent!.params[i].type, evaluate(e, { owner, locals, label })),
              )
            : [];
        reads = [];
        if (parent) {
          emit(
            `${label} calls ${parent.name}(${parentValues.map(display).join(', ')}) through super() first.`,
            null,
            object,
          );
          construct(parent, object, parentValues);
        }
        const hasInitializers = owner.initializers.some((i) =>
          Array.isArray(i) ? i.length : i.initial,
        );
        if (hasInitializers)
          emit(
            `${owner.name}'s field initializers and initializer blocks run in source order before its constructor body${parent ? ' resumes after super()' : ' (after Object construction)'}.`,
            null,
            object,
          );
        const scope: Scope = { owner, object, locals: new Map(), label };
        const initialized: string[] = [];
        for (const entry of owner.initializers) {
          if (Array.isArray(entry)) {
            if (initialized.length) emit(initialized.splice(0).join(', ') + '.', null, object);
            runBody(entry, scope);
          } else if (entry.initial) {
            const value = convert(entry.type, evaluate(entry.initial, scope));
            object.fields.set(`${owner.name}.${entry.name}`, value);
            initialized.push(`${owner.name}.${entry.name}=${display(value)}`);
          }
        }
        if (initialized.length) emit(initialized.join(', ') + '.', null, object);
        reads = [];
        runBody(
          owner.constructor.filter((s) => s.kind !== 'super'),
          { owner, object, locals, label },
        );
      } finally {
        depth--;
      }
    }
    const mainScope: Scope = {
      owner: mainOwner,
      locals: new Map(),
      label: `${mainOwner.name}.main()`,
    };
    runBody(program.main, mainScope);
    if (!events.length) return;
    const hidden = [
      ...new Set(
        objects.flatMap((object) => {
          const names = new Set<string>(),
            result: string[] = [];
          for (
            let c = classes.get(object.actual);
            c;
            c = c.parent ? classes.get(c.parent) : undefined
          )
            for (const f of c.fields) {
              if (names.has(f.name)) result.push(f.name);
              names.add(f.name);
            }
          return result;
        }),
      ),
    ];
    const rules = [
      hidden.length
        ? `Hidden fields (${hidden.join(', ')}) remain separate: fields follow the reference's declared type, not the object's class. super selects parent members on the same object.`
        : '',
      staticUsed ? 'Static calls follow the reference type; hiding is not overriding.' : '',
      castUsed ? 'A cast changes the reference type, not the object.' : '',
      stringJoin
        ? '+ works left to right: it adds ints until a String is involved, then joins text (including "null").'
        : '',
      overflow ? 'Java int overflow wraps around within 32 bits.' : '',
      division
        ? 'Integer division drops the fractional part toward zero; % keeps the remainder.'
        : '',
      arrayUsed
        ? 'Array indexes start at 0; length is fixed. New slots start at 0, false or null. Assigning an array shares it; clone/copyOf make a new outer array.'
        : '',
    ]
      .filter(Boolean)
      .join(' ');
    const compact: Event[] = [];
    let pending: string[] = [],
      lastObject: JObject | undefined;
    for (const event of events) {
      const prefix =
        objects.length > 1 && event.object && event.object !== lastObject
          ? `For ${event.object.label}: `
          : '';
      pending.push(prefix + event.text);
      if (event.object) lastObject = event.object;
      if (event.printed !== null || event.breakAfter) {
        compact.push({ text: pending.join(' '), printed: event.printed });
        pending = [];
        lastObject = undefined;
      }
    }
    if (pending.length) compact.push({ text: pending.join(' '), printed: null });
    // Keep one walkthrough even for a sequence of print statements, with every print retained.
    while (compact.length > 6) {
      const last = compact.pop()!,
        previous = compact.at(-1)!;
      previous.text += ' ' + last.text;
      previous.printed =
        previous.printed === null && last.printed === null
          ? null
          : (previous.printed ?? '') + (last.printed ?? '');
    }
    const selected =
      request.task === 'walkthrough'
        ? events.map((e) => ({
            ...e,
            text: e.text + (objects.length > 1 && e.object ? ` (object ${e.object.label})` : ''),
          }))
        : compact;
    if (selected.length > 40) return;
    if (rules) selected.at(-1)!.text += ' ' + rules;
    const nested = program.classes.filter((c) => c.enclosing === mainOwner.name);
    const ancestry = [
      ...new Set(
        objects.flatMap((o) => {
          const result: string[] = [];
          for (
            let c = classes.get(o.actual);
            c?.parent && c.parent !== 'Object';
            c = classes.get(c.parent)
          )
            result.push(`${c.name} extends ${c.parent}`);
          return result;
        }),
      ),
    ];
    const summary = [
      nested.length
        ? `${mainOwner.name} contains ${nested.length} static nested class${nested.length === 1 ? '' : 'es'}; no outer object is needed.`
        : '',
      ancestry.length ? ancestry.join('; ') + '.' : '',
      objects.length === 1
        ? `This creates one ${objects[0].actual} object${ancestry.length ? " with its classes' separate fields" : ''}.`
        : objects.length
          ? `main creates ${objects.length} independent objects; each keeps its own field values.`
          : (statementsOnly
              ? 'These statements compute local values in order'
              : 'main computes local values in order') +
            (prints ? ' and print' + (statementsOnly ? '' : 's') + ' the results.' : '.'),
    ]
      .filter(Boolean)
      .join(' ');
    const terms = [
      hidden.length ? 'field hiding' : '',
      exceptionUsed ? 'exception handling' : '',
      arrayUsed ? 'Java array' : '',
      overloadUsed ? 'method overloading' : '',
      loopUsed ? 'loop' : '',
      collectionUsed ? 'collection' : '',
      dispatchUsed ? 'polymorphism' : '',
      parameterUsed ? 'parameter' : '',
      objects.length ? 'constructor' : '',
      localUsed ? 'variable' : '',
      stringJoin ? 'string' : '',
    ]
      .filter(Boolean)
      .slice(0, 3);
    const firstReference = [...mainScope.locals.entries()].find(
      ([, slot]) => slot.value.kind === 'ref' && slot.value.object,
    );
    const checks = firstReference
      ? (() => {
          const [name, slot] = firstReference,
            value = slot.value as Reference;
          return [
            `Does declaring ${name} as ${slot.type} change the created object? Answer: No. It remains a ${value.object!.actual}; the declared type controls field selection and static calls.`,
          ];
        })()
      : [];
    return {
      title: 'Explanation',
      summary,
      steps: selected.map((e) => e.text),
      stepOutput: selected.map((e) => e.printed),
      output: { text: events.map((e) => e.printed ?? '').join(''), explanation: '' },
      note: `${virtualDuringConstruction ? 'In an app, calling an override during construction can display unfinished child fields. Prefer calling it after construction. ' : ''}${objects.length || program.classes.some((c) => c.methods.length) ? 'These classes/helpers are defined here. ' : ''}${arrayUsed ? 'Arrays are built into Java; Arrays helpers come from java.util. ' : ''}${exceptionUsed ? 'These exception classes come from java.lang; catch can recover from a matching failure. ' : ''}${collectionUsed ? 'Collections come from java.util; use them for groups of items or key-value lookups. ' : ''}String/System come from java.lang; System.out is java.io.PrintStream.`,
      concepts: terms.map((term) => ({ term, explanation: definition(term, 'java')! })),
      example: { code: '', explanation: '' },
      predictions: [],
      checks,
      local: true,
      usage: { input: 0, output: 0, total: 0 },
      notice: statementsOnly
        ? 'Derived locally from these self-contained Java statements, assuming standard Java output. No code was executed and no AI request was needed.'
        : 'Derived locally from the complete supported Java program using standard Java library behavior. No code was executed and no AI request was needed.',
    };
  } catch {
    return;
  }
}
