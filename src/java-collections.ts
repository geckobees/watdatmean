import { reject } from './java-trace-parser';
import type { Value } from './java-trace';
import { arrayComponent } from './java-arrays';
import { isException, javaRaise } from './java-exceptions';

export function collectionType(type: string) {
  const match =
    /^(List|ArrayList|Set|LinkedHashSet|HashSet|Map|LinkedHashMap|HashMap)<(String|Integer)(?:,(String|Integer))?>$/.exec(
      type,
    );
  if (!match || !!match[3] !== match[1].endsWith('Map')) return;
  return {
    base: match[1],
    args: match.slice(2).filter(Boolean),
    kind: match[1].endsWith('Map') ? 'map' : match[1].endsWith('Set') ? 'set' : 'list',
  } as const;
}
export type LibraryCall = {
  receiver: string;
  op: string;
  params: string[];
  returns: string;
  type?: string;
};
export type JCollection = {
  type: string;
  kind: 'list' | 'set' | 'map';
  ordered: boolean;
  mutable: boolean;
  version: number;
  items: Value[];
  entries: [Value, Value][];
  viewOf?: JCollection;
};
export const isNull = (v: Value) =>
  (v.kind === 'array' && !v.array) ||
  (v.kind === 'exception' && !v.exception) ||
  v.kind === 'null' ||
  ((v.kind === 'String' || v.kind === 'Integer') && v.value === null) ||
  (v.kind === 'ref' && !v.object) ||
  (v.kind === 'collection' && !v.collection);
export const equalElement = (a: Value, b: Value) =>
  isNull(a) || isNull(b)
    ? isNull(a) && isNull(b)
    : a.kind === b.kind &&
      ['String', 'Integer', 'int', 'boolean'].includes(a.kind) &&
      (a as any).value === (b as any).value;
export const elements = (c: JCollection) =>
  c.viewOf ? c.viewOf.entries.map((e) => e[0]) : c.items;
export const collectionVersion = (c: JCollection) => (c.viewOf ?? c).version;
export function collectionText(value: Value): string {
  if (isNull(value)) return 'null';
  if (
    value.kind === 'String' ||
    value.kind === 'Integer' ||
    value.kind === 'int' ||
    value.kind === 'boolean'
  )
    return String(value.value);
  if (value.kind !== 'collection' || !value.collection) reject();
  const c = value.collection;
  const length = c.kind === 'map' ? c.entries.length : elements(c).length;
  if (!c.ordered && length > 1) reject(); // Hash/immutable set-map iteration order is not promised.
  return c.kind === 'map'
    ? '{' + c.entries.map(([k, v]) => collectionText(k) + '=' + collectionText(v)).join(', ') + '}'
    : '[' + elements(c).map(collectionText).join(', ') + ']';
}
export function librarySignature(
  receiver: string,
  op: string,
  args: string[],
  expected?: string,
): LibraryCall | undefined {
  const result = (params: string[], returns: string, type?: string): LibraryCall => ({
    receiver,
    op,
    params,
    returns,
    type,
  });
  if (receiver === '#Integer' && op === 'valueOf' && args.length === 1)
    return result(['int'], 'Integer');
  if (receiver === 'Integer' && op === 'intValue' && !args.length) return result([], 'int');
  if (isException(receiver) && ['getMessage', 'toString'].includes(op) && !args.length)
    return result([], 'String');
  if (arrayComponent(receiver) && op === 'clone' && !args.length) return result([], receiver);
  if (receiver === '#Arrays' && args.length && arrayComponent(args[0])) {
    if (args.length === 1 && op === 'toString') return result([args[0]], 'String');
    if (
      args.length === 1 &&
      op === 'deepToString' &&
      !['int', 'boolean'].includes(arrayComponent(args[0])!)
    )
      return result([args[0]], 'String');
    if (args.length === 2 && op === 'copyOf') return result([args[0], 'int'], args[0]);
  }
  if (receiver === 'String') {
    if (op === 'equals' && args.length === 1) return result(['Object'], 'boolean');
    if (op === 'length' && !args.length) return result([], 'int');
    if (op === 'isEmpty' && !args.length) return result([], 'boolean');
  }
  if (receiver.startsWith('#') && op === 'of' && ['#List', '#Set', '#Map'].includes(receiver)) {
    const base = receiver.slice(1),
      count = base === 'Map' ? 2 : 1;
    if (count === 2 && args.length % 2) reject();
    const wanted = expected ? collectionType(expected) : undefined;
    const types = Array.from({ length: count }, (_, slot) => {
      const input = args
        .filter((_, i) => i % count === slot)
        .map((t) => (t === 'int' ? 'Integer' : t));
      const nonNull = [...new Set(input.filter((t) => t !== 'null'))];
      const inferred = nonNull.length === 1 ? nonNull[0] : wanted?.args[slot];
      if (
        !inferred ||
        !['String', 'Integer'].includes(inferred) ||
        nonNull.some((t) => t !== inferred)
      )
        reject();
      return inferred;
    });
    const type = `${base}<${types.join(',')}>`;
    return result(
      args.map((_, i) => types[i % count]),
      type,
      type,
    );
  }
  const c = collectionType(receiver);
  if (!c) return;
  if (!args.length && ['size', 'isEmpty', 'clear'].includes(op))
    return result([], op === 'size' ? 'int' : op === 'isEmpty' ? 'boolean' : 'void');
  if (c.kind === 'map') {
    if (op === 'put' && args.length === 2) return result(c.args, c.args[1]);
    if (['get', 'remove', 'containsKey', 'containsValue'].includes(op) && args.length === 1)
      return result(['Object'], op.startsWith('contains') ? 'boolean' : c.args[1]);
    if (op === 'getOrDefault' && args.length === 2) return result(['Object', c.args[1]], c.args[1]);
    if (op === 'keySet' && !args.length) return result([], `Set<${c.args[0]}>`);
  } else {
    if (op === 'add' && args.length === 1) return result([c.args[0]], 'boolean');
    if (op === 'contains' && args.length === 1) return result(['Object'], 'boolean');
    if (op === 'remove' && args.length === 1)
      return c.kind === 'list' && args[0] === 'int'
        ? result(['int'], c.args[0])
        : result(['Object'], 'boolean');
    if (c.kind === 'list') {
      if (op === 'get' && args.length === 1) return result(['int'], c.args[0]);
      if (op === 'set' && args.length === 2) return result(['int', c.args[0]], c.args[0]);
      if (op === 'add' && args.length === 2) return result(['int', c.args[0]], 'void');
    }
  }
}
export function makeCollection(type: string, values: Value[] = [], factory = false): Value {
  const info = collectionType(type);
  if (!info) reject();
  if (!factory && ['List', 'Set', 'Map'].includes(info.base)) reject();
  const data: JCollection = {
    type,
    kind: info.kind,
    ordered: info.kind === 'list' || info.base.startsWith('LinkedHash'),
    mutable: !factory,
    version: 0,
    items: [],
    entries: [],
  };
  if (factory) {
    if (values.some(isNull)) javaRaise('NullPointerException');
    if (info.kind === 'map') {
      for (let i = 0; i < values.length; i += 2) {
        if (data.entries.some(([k]) => equalElement(k, values[i])))
          javaRaise('IllegalArgumentException');
        data.entries.push([values[i], values[i + 1]]);
      }
    } else {
      if (
        info.kind === 'set' &&
        values.some((v, i) => values.slice(0, i).some((p) => equalElement(v, p)))
      )
        javaRaise('IllegalArgumentException');
      data.items = [...values];
    }
  } else if (values.length) {
    if (values.length === 1 && isNull(values[0])) javaRaise('NullPointerException');
    if (values.length !== 1 || values[0].kind !== 'collection' || !values[0].collection) reject();
    const original = values[0].collection;
    if (
      !original.ordered &&
      (original.kind === 'map' ? original.entries.length : elements(original).length) > 1
    )
      reject();
    if (info.kind === 'map') data.entries = original.entries.map((pair) => [...pair]);
    else
      for (const value of elements(original))
        if (info.kind === 'list' || !data.items.some((v) => equalElement(v, value)))
          data.items.push(value);
  }
  return { kind: 'collection', type, collection: data };
}
export function runLibrary(plan: LibraryCall, target: Value, args: Value[]): Value {
  const integer = (v: Value) => {
    if (isNull(v)) javaRaise('NullPointerException');
    if (v.kind !== 'int' && v.kind !== 'Integer') reject();
    return (v as { value: number }).value;
  };
  if (plan.receiver === '#Integer') return { kind: 'Integer', value: integer(args[0]) };
  if (plan.receiver === 'Integer') return { kind: 'int', value: integer(target) };
  if (plan.receiver === 'String') {
    if (isNull(target)) javaRaise('NullPointerException');
    if (target.kind !== 'String' || target.value === null) reject();
    return plan.op === 'length'
      ? { kind: 'int', value: target.value.length }
      : {
          kind: 'boolean',
          value:
            plan.op === 'isEmpty'
              ? !target.value.length
              : args[0].kind === 'String' && args[0].value === target.value,
        };
  }
  if (plan.receiver.startsWith('#')) return makeCollection(plan.type!, args, true);
  if (isNull(target)) javaRaise('NullPointerException');
  if (target.kind !== 'collection' || !target.collection) reject();
  const c = target.collection,
    items = elements(c),
    size = c.kind === 'map' ? c.entries.length : items.length;
  if (!c.mutable && !c.viewOf && args.some(isNull)) reject(); // Factory collections disallow nulls; do not invent normal query results.
  const change = () => {
    if (c.viewOf) reject();
    if (!c.mutable) javaRaise('UnsupportedOperationException');
  };
  const bound = (v: Value, allowEnd = false) => {
    const i = integer(v);
    if (i < 0 || i > items.length || (!allowEnd && i === items.length)) {
      // Factory-list implementations can throw different subclasses. Do not invent
      // which specific catch runs when that detail is outside the modeled contract.
      if (!c.mutable) reject();
      javaRaise('IndexOutOfBoundsException');
    }
    return i;
  };
  const bump = () => {
    c.version++;
    if (c.items.length > 128 || c.entries.length > 128) reject();
  };
  switch (plan.op) {
    case 'size':
      return { kind: 'int', value: size };
    case 'isEmpty':
      return { kind: 'boolean', value: size === 0 };
    case 'clear':
      change();
      c.items = [];
      c.entries = [];
      bump();
      return { kind: 'void' };
    case 'keySet':
      return {
        kind: 'collection',
        type: plan.returns,
        collection: {
          type: plan.returns,
          kind: 'set',
          ordered: c.ordered,
          mutable: false,
          version: 0,
          items: [],
          entries: [],
          viewOf: c,
        },
      };
    case 'contains':
      return { kind: 'boolean', value: items.some((v) => equalElement(v, args[0])) };
    case 'containsKey':
      return { kind: 'boolean', value: c.entries.some(([k]) => equalElement(k, args[0])) };
    case 'containsValue':
      return { kind: 'boolean', value: c.entries.some(([, v]) => equalElement(v, args[0])) };
    case 'getOrDefault':
      return c.entries.find(([k]) => equalElement(k, args[0]))?.[1] ?? args[1];
    case 'get':
      return c.kind === 'map'
        ? (c.entries.find(([k]) => equalElement(k, args[0]))?.[1] ?? { kind: 'null', value: null })
        : items[bound(args[0])];
    case 'set': {
      change();
      const i = bound(args[0]),
        old = items[i];
      items[i] = args[1];
      return old;
    }
    case 'put': {
      change();
      const existing = c.entries.find(([k]) => equalElement(k, args[0]));
      if (existing) {
        const old = existing[1];
        existing[1] = args[1];
        return old;
      }
      c.entries.push([args[0], args[1]]);
      bump();
      return { kind: 'null', value: null };
    }
    case 'add': {
      change();
      if (args.length === 2) {
        items.splice(bound(args[0], true), 0, args[1]);
        bump();
        return { kind: 'void' };
      }
      if (c.kind === 'set' && items.some((v) => equalElement(v, args[0])))
        return { kind: 'boolean', value: false };
      items.push(args[0]);
      bump();
      return { kind: 'boolean', value: true };
    }
    case 'remove': {
      change();
      if (c.kind === 'map') {
        const i = c.entries.findIndex(([k]) => equalElement(k, args[0]));
        if (i < 0) return { kind: 'null', value: null };
        const old = c.entries.splice(i, 1)[0][1];
        bump();
        return old;
      }
      if (plan.params[0] === 'int') {
        const old = items.splice(bound(args[0]), 1)[0];
        bump();
        return old;
      }
      const i = items.findIndex((v) => equalElement(v, args[0]));
      if (i < 0) return { kind: 'boolean', value: false };
      items.splice(i, 1);
      bump();
      return { kind: 'boolean', value: true };
    }
  }
  reject();
}
