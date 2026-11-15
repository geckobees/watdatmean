import { reject } from './java-trace-parser';
import { isException, javaRaise, JavaThrown } from './java-exceptions';
import { isNull, equalElement } from './java-collections';
import { functionalType, type StreamContext, type StreamPlan } from './java-streams';
import type { Value } from './java-trace';

export const optionalNames = ['Optional', 'OptionalInt'];
export const optionalElement = (type: string): string | undefined =>
  type === 'OptionalInt' ? 'int' : /^Optional<(String|Integer|Object)>$/.exec(type)?.[1];
export type JOptional = { value?: Value };

export function optionalSignature(
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
  if (receiver === '#OptionalInt') {
    if (op === 'of' && count === 1) return plan(['int'], 'OptionalInt');
    if (op === 'empty' && !count) return plan([], 'OptionalInt');
  }
  if (receiver === '#Optional') {
    const desired = expected && optionalElement(expected);
    if (op === 'empty' && !count) return plan([], `Optional<${desired || 'Object'}>`);
    if (['of', 'ofNullable'].includes(op) && count === 1) {
      const actual = input(0),
        type = desired || (actual === 'int' ? 'Integer' : actual === 'null' ? 'Object' : actual);
      if (!['String', 'Integer', 'Object'].includes(type)) reject();
      return plan([type], `Optional<${type}>`);
    }
  }
  const element = optionalElement(receiver);
  if (!element) return;
  const primitive = element === 'int';
  if (['isPresent', 'isEmpty'].includes(op) && !count) return plan([], 'boolean');
  if (op === (primitive ? 'getAsInt' : 'get') && !count) return plan([], element);
  if (op === 'orElse' && count === 1) return plan([element], element);
  if (op === 'orElseGet' && count === 1)
    return plan([primitive ? 'IntSupplier' : `Supplier<${element}>`], element);
  if (op === 'orElseThrow') {
    if (!count) return plan([], element);
    if (count === 1) {
      const type = input(0, 'Supplier<$infer>'),
        fn = functionalType(type);
      if (!fn || fn.params.length || !isException(fn.returns)) reject();
      return plan([type], element);
    }
  }
  if (op === 'ifPresent' && count === 1)
    return plan([primitive ? 'IntConsumer' : `Consumer<${element}>`], 'void');
  if (op === 'ifPresentOrElse' && count === 2)
    return plan([primitive ? 'IntConsumer' : `Consumer<${element}>`, 'Runnable'], 'void');
  if (op === 'filter' && !primitive && count === 1)
    return plan([`Predicate<${element}>`], receiver);
  if (['map', 'flatMap'].includes(op) && !primitive && count === 1) {
    const wanted = expected && optionalElement(expected);
    const target =
      wanted && op === 'map'
        ? wanted
        : wanted && op === 'flatMap'
          ? `Optional<${wanted}>`
          : '$infer';
    const type = input(0, `Function<${element},${target}>`),
      fn = functionalType(type);
    if (!fn || fn.params[0] !== element) reject();
    if (op === 'flatMap') {
      if (!fn.returns.startsWith('Optional<') || !optionalElement(fn.returns)) reject();
      return plan([type], fn.returns);
    }
    if (!['String', 'Integer', 'Object'].includes(fn.returns)) reject();
    return plan([type], `Optional<${fn.returns}>`);
  }
  if (op === 'or' && !primitive && count === 1) return plan([`Supplier<${receiver}>`], receiver);
  if (op === 'stream' && !count) {
    if (element === 'Object') reject();
    return plan([], primitive ? 'IntStream' : `Stream<${element}>`);
  }
  if (op === 'equals' && count === 1) return plan(['Object'], 'boolean');
}

export function runOptional(
  plan: StreamPlan,
  target: Value,
  args: Value[],
  ctx: StreamContext,
): Value {
  const { receiver, op, returns } = plan;
  const make = (value?: Value): Value => {
    if (value && !['int', 'Integer', 'String', 'null'].includes(value.kind)) reject();
    return {
      kind: 'optional',
      type: returns,
      optional: { ...(value && !isNull(value) ? { value } : {}) },
    };
  };
  const invoke = (index: number, values: Value[] = []) => ctx.call(args[index], values);
  const requireFunction = (index: number) => {
    if (isNull(args[index])) javaRaise('NullPointerException');
  };
  if (receiver.startsWith('#')) {
    if (op === 'of' && isNull(args[0]))
      javaRaise('NullPointerException', undefined, 'Optional.of requires a non-null value.');
    const result = make(args[0]);
    ctx.explain(
      `${receiver.slice(1)}.${op} creates ${args[0] && !isNull(args[0]) ? `a present value (${ctx.display(args[0])})` : 'an empty Optional, not a null reference'}.`,
    );
    return result;
  }
  if (isNull(target))
    javaRaise(
      'NullPointerException',
      undefined,
      'The Optional reference itself is null, rather than an empty Optional.',
    );
  if (target.kind !== 'optional' || !target.optional) reject();
  const value = target.optional.value,
    present = value !== undefined;
  if (['filter', 'map', 'flatMap', 'or'].includes(op)) requireFunction(0);
  let result: Value;
  let detail = '';
  switch (op) {
    case 'isPresent':
    case 'isEmpty':
      result = { kind: 'boolean', value: op === 'isPresent' ? present : !present };
      break;
    case 'get':
    case 'getAsInt':
    case 'orElseThrow':
      if (present) {
        result = value;
        detail = op === 'orElseThrow' && args.length ? 'The exception supplier is not called.' : '';
      } else if (args.length) {
        const exception = invoke(0);
        if (isNull(exception)) javaRaise('NullPointerException');
        if (exception.kind !== 'exception' || !exception.exception) reject();
        ctx.explain(
          'orElseThrow calls its supplier because the Optional is empty, then throws the supplied exception.',
        );
        throw new JavaThrown(exception.exception);
      } else
        javaRaise(
          'NoSuchElementException',
          undefined,
          'The Optional is empty; there is no value to retrieve.',
        );
      break;
    case 'orElse':
      result = value ?? args[0];
      detail = `The fallback argument was evaluated before this call, even ${present ? 'though a value is present' : 'when empty'}.`;
      break;
    case 'orElseGet':
      result = present ? value : invoke(0);
      detail = present
        ? 'The supplier is not called.'
        : 'Only now is the fallback supplier called.';
      break;
    case 'ifPresent':
    case 'ifPresentOrElse':
      if (present) invoke(0, [value]);
      else if (op === 'ifPresentOrElse') invoke(1);
      result = { kind: 'void' };
      detail = present
        ? 'Only the value action runs.'
        : op === 'ifPresentOrElse'
          ? 'Only the empty action runs.'
          : 'The action is skipped.';
      break;
    case 'filter': {
      let keep = false;
      if (present) {
        const test = invoke(0, [value]);
        if (test.kind !== 'boolean') reject();
        keep = test.value;
      }
      result = make(keep ? value : undefined);
      detail = present
        ? `The predicate ${keep ? 'keeps' : 'removes'} the value.`
        : 'The predicate is not called.';
      break;
    }
    case 'map':
      result = make(present ? invoke(0, [value]) : undefined);
      detail = present
        ? 'The mapper runs once; a null mapping result becomes empty.'
        : 'The mapper is not called.';
      break;
    case 'flatMap':
    case 'or':
      if (op === 'or' && present) result = target;
      else if (op === 'flatMap' && !present) result = make();
      else {
        result = invoke(0, op === 'flatMap' ? [value!] : []);
        if (isNull(result))
          javaRaise(
            'NullPointerException',
            undefined,
            `${op} requires the callback to return an Optional, not null.`,
          );
        if (result.kind !== 'optional' || !result.optional) reject();
      }
      detail =
        op === 'flatMap'
          ? 'The mapper returns the replacement Optional directly, without an extra Optional wrapper.'
          : present
            ? 'The alternative supplier is skipped.'
            : 'The alternative supplier provides the replacement Optional.';
      break;
    case 'stream':
      result = {
        kind: 'stream',
        type: returns,
        stream: {
          used: false,
          element: optionalElement(receiver)!,
          source: () => (present ? [value] : []),
        },
      };
      detail = `The stream has ${present ? 'one item' : 'no items'}; an Optional can create another fresh stream later.`;
      break;
    case 'equals': {
      const other = args[0];
      result = {
        kind: 'boolean',
        value:
          other.kind === 'optional' &&
          !!other.optional &&
          (receiver === 'OptionalInt') === (other.type === 'OptionalInt') &&
          (!present
            ? !other.optional.value
            : !!other.optional.value && equalElement(value, other.optional.value)),
      };
      detail = 'Optional equality compares presence and contained values, not object identity.';
      break;
    }
    default:
      reject();
  }
  ctx.explain(
    `${op}: the Optional is ${present ? `present (${ctx.display(value)})` : 'empty'}. ${detail}${result.kind !== 'void' ? ` Result: ${ctx.display(result)}.` : ''}`,
  );
  return result;
}
