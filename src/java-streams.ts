import { reject } from './java-trace-parser';
import type { Value } from './java-trace';
import { collectionType, elements, equalElement, isNull } from './java-collections';
import { arrayComponent } from './java-arrays';
import { javaRaise } from './java-exceptions';

export const streamNames = ['Stream', 'IntStream', 'Collectors'];
export const functionalNames = [
  'Predicate',
  'Function',
  'Consumer',
  'Supplier',
  'UnaryOperator',
  'BinaryOperator',
  'ToIntFunction',
  'IntPredicate',
  'IntUnaryOperator',
  'IntBinaryOperator',
  'IntConsumer',
  'IntSupplier',
  'IntFunction',
];
export const importedJavaName = (name: string, imports: string[]) => {
  const prefix = streamNames.includes(name)
    ? 'stream.'
    : functionalNames.includes(name)
      ? 'function.'
      : '';
  return imports.includes(prefix + name) || imports.includes(prefix + '*');
};
export const streamElement = (type: string): string | undefined =>
  type === 'IntStream' ? 'int' : /^Stream<(String|Integer)>$/.exec(type)?.[1];
export type FunctionalType = { params: string[]; returns: string; method: string };
export function genericType(type: string): { base: string; args: string[] } | undefined {
  const start = type.indexOf('<');
  if (start < 1 || !type.endsWith('>')) return;
  const args: string[] = [];
  let depth = 0,
    last = start + 1;
  for (let i = last; i < type.length - 1; i++) {
    if (type[i] === '<' && ++depth > 4) return;
    if (type[i] === '>' && --depth < 0) return;
    if (type[i] === ',' && !depth) {
      args.push(type.slice(last, i));
      last = i + 1;
    }
  }
  if (depth) return;
  args.push(type.slice(last, -1));
  return { base: type.slice(0, start), args };
}
export function expectedFunction(type: string): FunctionalType | undefined {
  const fn = functionalType(type);
  if (fn) return fn;
  const g = genericType(type);
  if (g?.base === 'Function' && g.args.length === 2 && g.args[1] === '$infer')
    return { params: [g.args[0]], returns: '$infer', method: 'apply' };
  if (type === 'IntFunction<$infer>')
    return { params: ['int'], returns: '$infer', method: 'apply' };
  if (type === 'Supplier<$infer>') return { params: [], returns: '$infer', method: 'get' };
}
export function functionalType(type: string): FunctionalType | undefined {
  const fixed: Record<string, FunctionalType> = {
    Runnable: { params: [], returns: 'void', method: 'run' },
    IntPredicate: { params: ['int'], returns: 'boolean', method: 'test' },
    IntUnaryOperator: { params: ['int'], returns: 'int', method: 'applyAsInt' },
    IntBinaryOperator: { params: ['int', 'int'], returns: 'int', method: 'applyAsInt' },
    IntConsumer: { params: ['int'], returns: 'void', method: 'accept' },
    IntSupplier: { params: [], returns: 'int', method: 'getAsInt' },
  };
  if (Object.hasOwn(fixed, type)) return fixed[type];
  const g = genericType(type);
  if (
    !g ||
    !functionalNames.includes(g.base) ||
    g.args.length !== (g.base === 'Function' ? 2 : 1) ||
    g.args.some((t) => !/^[A-Z][\w<>,\[\]]*$/.test(t))
  )
    return;
  const [a, b] = g.args;
  switch (g.base) {
    case 'Predicate':
      return { params: [a], returns: 'boolean', method: 'test' };
    case 'Function':
      return { params: [a], returns: b, method: 'apply' };
    case 'Consumer':
      return { params: [a], returns: 'void', method: 'accept' };
    case 'Supplier':
      return { params: [], returns: a, method: 'get' };
    case 'UnaryOperator':
      return { params: [a], returns: a, method: 'apply' };
    case 'BinaryOperator':
      return { params: [a, a], returns: a, method: 'apply' };
    case 'ToIntFunction':
      return { params: [a], returns: 'int', method: 'applyAsInt' };
    case 'IntFunction':
      return { params: ['int'], returns: a, method: 'apply' };
  }
}
export type StreamPlan = { receiver: string; op: string; params: string[]; returns: string };
// The model supplies target types for lambdas before checking their bodies.
export function streamSignature(
  receiver: string,
  op: string,
  count: number,
  input: (index: number, expected?: string) => string,
  expected?: string,
): StreamPlan | undefined {
  const plan = (params: string[], returns: string): StreamPlan => ({
    receiver,
    op,
    params,
    returns,
  });
  if (receiver === '#IntStream') {
    if (op === 'empty' && !count) return plan([], 'IntStream');
    if (op === 'of')
      return plan(
        count === 1 && input(0) === 'int[]' ? ['int[]'] : Array(count).fill('int'),
        'IntStream',
      );
    if (['range', 'rangeClosed'].includes(op) && count === 2)
      return plan(['int', 'int'], 'IntStream');
  }
  if (receiver === '#Stream' && op === 'of' && count) {
    const types = Array.from({ length: count }, (_, i) => input(i));
    const array = count === 1 && arrayComponent(types[0]);
    const items = array ? [array] : types.map((t) => (t === 'int' ? 'Integer' : t));
    const known = [...new Set(items.filter((t) => t !== 'null'))];
    const element = known.length === 1 ? known[0] : expected && streamElement(expected);
    if (!element || !['String', 'Integer'].includes(element) || known.some((t) => t !== element))
      reject();
    return plan(array ? [types[0]] : Array(count).fill(element), `Stream<${element}>`);
  }
  if (receiver === '#Arrays' && op === 'stream' && count === 1) {
    const array = input(0),
      element = arrayComponent(array);
    if (element && ['String', 'Integer', 'int'].includes(element))
      return plan([array], element === 'int' ? 'IntStream' : `Stream<${element}>`);
  }
  const collection = collectionType(receiver);
  if (collection && collection.kind !== 'map' && op === 'stream' && !count)
    return plan([], `Stream<${collection.args[0]}>`);
  if (receiver === '#Collectors') {
    if (op === 'toList' && !count) return plan([], '$listCollector');
    if (op === 'joining' && count <= 1)
      return plan(Array(count).fill('String'), '$joiningCollector');
  }
  const element = streamElement(receiver);
  if (!element) return;
  const primitive = element === 'int';
  if (
    ['filter', 'takeWhile', 'dropWhile', 'anyMatch', 'allMatch', 'noneMatch'].includes(op) &&
    count === 1
  )
    return plan(
      [primitive ? 'IntPredicate' : `Predicate<${element}>`],
      op.endsWith('Match') ? 'boolean' : receiver,
    );
  if (['forEach', 'forEachOrdered'].includes(op) && count === 1)
    return plan([primitive ? 'IntConsumer' : `Consumer<${element}>`], 'void');
  if (op === 'map' && primitive && count === 1) return plan(['IntUnaryOperator'], receiver);
  if (op === 'mapToInt' && !primitive && count === 1)
    return plan([`ToIntFunction<${element}>`], 'IntStream');
  if (((op === 'map' && !primitive) || (op === 'mapToObj' && primitive)) && count === 1) {
    const signature = input(0, primitive ? 'IntFunction<$infer>' : `Function<${element},$infer>`);
    const fn = functionalType(signature);
    if (!fn || fn.params[0] !== element || !['String', 'Integer'].includes(fn.returns)) reject();
    return plan([signature], `Stream<${fn.returns}>`);
  }
  if (['skip', 'limit'].includes(op) && count === 1) return plan(['long'], receiver);
  if (['distinct', 'sorted'].includes(op) && !count) return plan([], receiver);
  if (op === 'boxed' && primitive && !count) return plan([], 'Stream<Integer>');
  if (op === 'count' && !count) return plan([], 'long');
  if (op === 'sum' && primitive && !count) return plan([], 'int');
  if (op === 'findFirst' && !count)
    return plan([], primitive ? 'OptionalInt' : `Optional<${element}>`);
  if (['min', 'max'].includes(op) && primitive && !count) return plan([], 'OptionalInt');
  if (op === 'reduce' && count === 1)
    return plan(
      [primitive ? 'IntBinaryOperator' : `BinaryOperator<${element}>`],
      primitive ? 'OptionalInt' : `Optional<${element}>`,
    );
  if (op === 'toList' && !primitive && !count) return plan([], `List<${element}>`);
  if (op === 'toArray' && !count) return plan([], primitive ? 'int[]' : 'Object[]');
  if (op === 'reduce' && count === 2)
    return plan([element, primitive ? 'IntBinaryOperator' : `BinaryOperator<${element}>`], element);
  if (op === 'collect' && !primitive && count === 1) {
    const collector = input(0);
    if (collector === '$listCollector') return plan([collector], `List<${element}>`);
    if (collector === '$joiningCollector' && element === 'String')
      return plan([collector], 'String');
  }
}

export type JStream = {
  used: boolean;
  element: string;
  source?: () => Value[];
  range?: { start: number; end: number };
  previous?: JStream;
  stage?: { op: string; fn?: Value; amount?: bigint };
};
export type StreamContext = {
  tick(): void;
  call(fn: Value, args: Value[]): Value;
  pure(fn: Value): boolean;
  makeArray(type: string, items: Value[]): Value;
  display(value: Value): string;
  describe(fn: Value): string;
  explain(text: string): void;
};
const bool = (v: Value) => {
  if (v.kind !== 'boolean') reject();
  return v.value;
};
const integer = (v: Value) => {
  if ((v.kind !== 'int' && v.kind !== 'Integer') || v.value === null) reject();
  return v.value;
};
const callback = (v: Value) => {
  if (isNull(v)) javaRaise('NullPointerException');
  if (v.kind !== 'lambda' || !v.lambda) reject();
};
const valueList = (items: Value[], ctx: StreamContext) =>
  '[' + items.slice(0, 6).map(ctx.display).join(', ') + (items.length > 6 ? ', …' : '') + ']';

export function runStream(
  plan: StreamPlan,
  target: Value,
  args: Value[],
  ctx: StreamContext,
): Value {
  const { receiver, op, returns } = plan;
  const asStream = (stream: JStream): Value => ({ kind: 'stream', type: returns, stream });
  const from = (source: () => Value[]): Value =>
    asStream({ used: false, element: streamElement(returns)!, source });
  const arraySource = (value: Value) => {
    if (isNull(value)) javaRaise('NullPointerException');
    if (value.kind !== 'array' || !value.array) reject();
    return () => value.array!.items;
  };
  if (receiver === '#Collectors') {
    if (args.some(isNull)) javaRaise('NullPointerException');
    return {
      kind: 'collector',
      type: returns,
      delimiter: args[0]?.kind === 'String' ? args[0].value! : '',
    };
  }
  if (receiver === '#IntStream' && (op === 'range' || op === 'rangeClosed'))
    return asStream({
      used: false,
      element: 'int',
      range: { start: integer(args[0]), end: integer(args[1]) + (op === 'rangeClosed' ? 1 : 0) },
    });
  if (
    receiver === '#Arrays' ||
    (['#IntStream', '#Stream'].includes(receiver) && args[0]?.kind === 'array')
  )
    return from(arraySource(args[0]));
  if (receiver === '#IntStream' || receiver === '#Stream') return from(() => args);
  if (collectionType(receiver)) {
    if (isNull(target)) javaRaise('NullPointerException');
    if (target.kind !== 'collection' || !target.collection) reject();
    const collection = target.collection;
    return from(() => {
      const items = elements(collection);
      if (!collection.ordered && items.length > 1) reject();
      return items;
    });
  }
  if (isNull(target)) javaRaise('NullPointerException');
  if (target.kind !== 'stream' || !target.stream) reject();
  const pipeline = target.stream;
  const functional = args.filter((_, i) => !!functionalType(plan.params[i]));
  for (const fn of functional) callback(fn);
  // Intermediate and matching/reducing functions must be stateless and non-interfering.
  // Observable side effects in these callbacks may legally be elided by Java.
  if (!['forEach', 'forEachOrdered'].includes(op) && functional.some((fn) => !ctx.pure(fn)))
    reject();
  if (['skip', 'limit'].includes(op)) {
    if (args[0].kind !== 'long') reject();
    if (args[0].value < 0n) javaRaise('IllegalArgumentException');
  }
  if (pipeline.used)
    javaRaise('IllegalStateException', undefined, 'A stream pipeline can be used only once.');
  pipeline.used = true;
  if (streamElement(returns)) {
    return asStream({
      used: false,
      element: streamElement(returns)!,
      previous: pipeline,
      stage: {
        op,
        fn: functional[0],
        amount: args[0]?.kind === 'long' ? args[0].value : undefined,
      },
    });
  }
  let visited = 0;
  const samples: Value[] = [];
  function size(stream: JStream): bigint | undefined {
    if (!stream.previous)
      return BigInt(
        stream.range ? Math.max(0, stream.range.end - stream.range.start) : stream.source!().length,
      );
    const n = size(stream.previous),
      stage = stream.stage!;
    if (n === undefined || ['filter', 'distinct', 'takeWhile', 'dropWhile'].includes(stage.op))
      return;
    if (stage.op === 'skip') return n > stage.amount! ? n - stage.amount! : 0n;
    if (stage.op === 'limit') return n < stage.amount! ? n : stage.amount!;
    return n;
  }
  function* values(stream: JStream): Generator<Value> {
    if (!stream.previous) {
      if (stream.range) {
        for (let n = stream.range.start; n < stream.range.end; n++) {
          ctx.tick();
          visited++;
          yield { kind: 'int', value: n };
        }
      } else
        for (const item of stream.source!()) {
          ctx.tick();
          visited++;
          yield item;
        }
      return;
    }
    const stage = stream.stage!,
      previous = stream.previous;
    if (stage.op === 'limit' && stage.amount === 0n) return;
    if (stage.op === 'sorted') {
      const all: Value[] = [];
      for (const v of values(previous)) {
        if (all.length >= 128) reject();
        all.push(v);
      }
      if (all.some(isNull) && all.length > 1) javaRaise('NullPointerException');
      all.sort((a, b) =>
        a.kind === 'String' && b.kind === 'String'
          ? a.value! < b.value!
            ? -1
            : a.value! > b.value!
              ? 1
              : 0
          : integer(a) - integer(b),
      );
      yield* all;
      return;
    }
    let seen = 0n,
      dropping = true;
    const distinct: Value[] = [];
    for (const item of values(previous)) {
      ctx.tick();
      switch (stage.op) {
        case 'filter':
          if (bool(ctx.call(stage.fn!, [item]))) yield item;
          break;
        case 'map':
        case 'mapToInt':
        case 'mapToObj':
          yield ctx.call(stage.fn!, [item]);
          break;
        case 'boxed':
          yield { kind: 'Integer', value: integer(item) };
          break;
        case 'skip':
          if (seen++ >= stage.amount!) yield item;
          break;
        case 'limit':
          yield item;
          if (++seen >= stage.amount!) return;
          break;
        case 'takeWhile':
          if (!bool(ctx.call(stage.fn!, [item]))) return;
          yield item;
          break;
        case 'dropWhile':
          if (dropping && bool(ctx.call(stage.fn!, [item]))) break;
          dropping = false;
          yield item;
          break;
        case 'distinct':
          if (!distinct.some((v) => equalElement(v, item))) {
            if (distinct.length >= 128) reject();
            distinct.push(item);
            yield item;
          }
          break;
        default:
          reject();
      }
    }
  }
  const stages: string[] = [];
  for (let stream = pipeline; stream.previous; stream = stream.previous) {
    const { op, fn, amount } = stream.stage!;
    const meaning: Record<string, string> = {
      filter: 'keeps matching items',
      map: 'transforms each item',
      mapToInt: 'turns each item into an int',
      mapToObj: 'turns each int into an object value',
      distinct: 'removes repeated values',
      sorted: 'puts values in natural order',
      boxed: 'wraps each int as Integer',
      takeWhile: 'keeps the matching prefix',
      dropWhile: 'skips the matching prefix',
      limit: `takes at most ${amount}`,
      skip: `skips the first ${amount}`,
    };
    stages.unshift(`${op} ${meaning[op]}${fn ? ` using ${ctx.describe(fn)}` : ''}`);
  }
  let result: Value,
    produced = 0,
    short = false;
  const knownSize = op === 'count' ? size(pipeline) : undefined;
  if (knownSize !== undefined) {
    result = { kind: 'long', value: knownSize };
    ctx.explain(
      `count finishes the lazy pipeline${stages.length ? ` (${stages.join('; ')})` : ''}. Its size is already known: ${knownSize}; Java can skip visiting items and running mapping functions.`,
    );
    return result;
  }
  let total = 0,
    sumOverflow = false,
    accumulated: Value | undefined = op === 'reduce' && args.length === 2 ? args[0] : undefined;
  const collected: Value[] = [];
  let matched = op !== 'anyMatch';
  for (const item of values(pipeline)) {
    if (samples.length < 6) samples.push(item);
    produced++;
    if (op === 'sum') {
      const next = total + integer(item);
      total = next | 0;
      sumOverflow ||= next !== total;
    } else if (op === 'reduce')
      accumulated = accumulated ? ctx.call(args[args.length - 1], [accumulated, item]) : item;
    else if (op === 'findFirst') {
      accumulated = item;
      short = true;
      break;
    } else if (op === 'min' || op === 'max') {
      if (
        !accumulated ||
        (op === 'min' ? integer(item) < integer(accumulated) : integer(item) > integer(accumulated))
      )
        accumulated = item;
    } else if (['forEach', 'forEachOrdered'].includes(op)) ctx.call(args[0], [item]);
    else if (op.endsWith('Match')) {
      const test = bool(ctx.call(args[0], [item]));
      if ((op === 'allMatch' && !test) || (op !== 'allMatch' && test)) {
        matched = op === 'anyMatch';
        short = true;
        break;
      }
    } else if (['toList', 'toArray', 'collect'].includes(op)) {
      if (collected.length >= 128) reject();
      collected.push(item);
    } else if (op !== 'count') reject();
  }
  if (op === 'sum') result = { kind: 'int', value: total };
  else if (op === 'count') result = { kind: 'long', value: BigInt(produced) };
  else if (returns === 'OptionalInt' || returns.startsWith('Optional<')) {
    if (accumulated && isNull(accumulated)) javaRaise('NullPointerException');
    result = {
      kind: 'optional',
      type: returns,
      optional: accumulated ? { value: accumulated } : {},
    };
  } else if (op === 'reduce') result = accumulated!;
  else if (op.endsWith('Match')) result = { kind: 'boolean', value: matched };
  else if (op === 'toArray') result = ctx.makeArray(returns, collected);
  else if (
    op === 'toList' ||
    (op === 'collect' && args[0].kind === 'collector' && args[0].type === '$listCollector')
  )
    result = {
      kind: 'collection',
      type: returns,
      collection: {
        type: returns,
        kind: 'list',
        ordered: true,
        mutable: false,
        mutableUnknown: op === 'collect',
        version: 0,
        items: collected,
        entries: [],
      },
    };
  else if (op === 'collect' && args[0].kind === 'collector') {
    const text = collected
      .map((v) => {
        if (isNull(v)) return 'null';
        if (v.kind !== 'String') reject();
        return v.value;
      })
      .join(args[0].delimiter);
    if (text.length > 2000) reject();
    result = { kind: 'String', value: text };
  } else result = { kind: 'void' };
  ctx.explain(
    `${op} starts the lazy pipeline${stages.length ? `: ${stages.join('; ')}` : ''}. It visits ${visited} source item${visited === 1 ? '' : 's'} and reaches ${produced} result${produced === 1 ? '' : 's'}${produced ? ` (${valueList(samples, ctx)}${produced > 6 ? ', …' : ''})` : ''}.${short ? ' It stops as soon as the answer is decided.' : ''}${op === 'reduce' ? ` reduce ${args.length === 2 ? `starts at ${ctx.display(args[0])}` : 'uses the first item as its starting value, or returns empty if there are no items'} and combines later items using ${ctx.describe(args[args.length - 1])}.` : op === 'sum' ? ' sum adds those ints.' + (sumOverflow ? ' The int total overflows and wraps within 32 bits.' : '') : op.endsWith('Match') && !produced ? ' With no items, anyMatch is false; allMatch and noneMatch are true.' : ['forEach', 'forEachOrdered'].includes(op) ? ` It runs ${ctx.describe(args[0])} for each reached item in order.` : ''}${result.kind !== 'void' ? ` Result: ${ctx.display(result)}.` : ''}`,
  );
  return result;
}
