import { describe, it, expect, vi } from 'vitest';
import { javaTraceLesson } from '../src/java-trace';
import { generate } from '../src/provider';
import { BridgeCore } from '../src/bridge/core';
import { wombRequest } from './quality/depth-cases';
import { javaMethodOptionalCases } from './quality/java-method-optional-cases';
const request = (code: string) => ({ ...wombRequest, code });
describe('Java method references and Optional', () => {
  it.each(javaMethodOptionalCases)(
    '$id derives the complete Java output locally on both adapters',
    async (c) => {
      const lesson = javaTraceLesson(request(c.code));
      expect(lesson, c.id).toBeDefined();
      expect(lesson!.output?.text).toBe(c.expected);
      expect(lesson!.usage?.total).toBe(0);
      expect(lesson!.steps.length).toBeLessThanOrEqual(6);
      const transport = vi.fn(() => {
        throw new Error('Local examples must not request AI');
      });
      const direct = await generate(
        'groq',
        'qwen/qwen3.8-27b',
        'unused',
        request(c.code),
        undefined,
        transport,
      );
      const bridge = (await new BridgeCore(transport).dispatch(1, 'request', {
        provider: 'groq',
        model: 'qwen/qwen3.8-27b',
        key: 'unused',
        request: request(c.code),
      })) as any;
      expect(bridge.lesson).toEqual(direct);
      expect(direct.output?.text).toBe(c.expected);
      expect(direct.stepOutput?.join('')).toBe(c.expected);
      expect(direct.concepts.every((c) => !!c.explanation)).toBe(true);
      expect(transport).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['unknown reference', 'IntUnaryOperator f=Missing::twice;'],
    ['missing target type', 'System.out.println(String::length);'],
    ['wrong arity', 'IntSupplier f=Integer::sum;'],
    ['primitive unbound receiver', 'IntUnaryOperator f=Integer::intValue;'],
    ['wrong result', 'Supplier<String> f=String::length;'],
    ['missing receiver argument', 'Supplier<Integer> f=String::length;'],
    ['null literal receiver', 'Supplier<Integer> f=null::length;'],
    ['array constructor reference', 'IntFunction<String[]> f=String[]::new;'],
    [
      'unmodeled comparator',
      'System.out.println(Stream.of("a","b").min(String::compareTo).get());',
    ],
    ['unspecified findAny', 'System.out.println(IntStream.of(1,2).findAny().getAsInt());'],
    ['unsupported OptionalDouble', 'OptionalDouble o=OptionalDouble.of(2.5);'],
    ['invalid optional type', 'Optional<int> o=Optional.of(2);'],
    ['wrong optional element', 'Optional<String> o=Optional.of(2);'],
    ['wrong mapper type', 'System.out.println(Optional.of(2).map(String::trim).get());'],
    ['wrong flatMap result', 'System.out.println(Optional.of("x").flatMap(String::trim).get());'],
    ['unhandled checked throw', 'Optional.empty().orElseThrow(Exception::new);'],
    ['identity comparison', 'System.out.println(Optional.empty()==Optional.empty());'],
    ['unmodeled debug string', 'System.out.println(Optional.of(1));'],
    ['invalid dead callback', 'Optional<String> o=Optional.empty(); o.map(s -> missing);'],
    ['mutating callback capture', 'int n=1; Optional.of(2).map(x -> n++);'],
    ['wrong explicit generic arguments', 'System.out.println(Optional.<String>of(2).get());'],
    [
      'unmodeled explicit method type arguments',
      'System.out.println(Stream.of("x").<Integer>map(String::trim).toList());',
    ],
  ])('declines %s instead of guessing', (_, body) => {
    expect(
      javaTraceLesson(
        request(
          `import java.util.*; import java.util.stream.*; import java.util.function.*; public class Demo { public static void main(String[] args){${body}} }`,
        ),
      ),
    ).toBeUndefined();
  });
  it('uses the written reference type for unbound method lookup', () => {
    const code =
      'import java.util.function.*; public class Demo { static class A {} static class B extends A { int onlyB(){return 2;} } public static void main(String[] args){ToIntFunction<B> f=A::onlyB; System.out.println(f.applyAsInt(new B()));} }';
    expect(javaTraceLesson(request(code))).toBeUndefined();
  });
  it('declines ambiguous static/unbound references', () => {
    const code =
      'import java.util.function.*; public class Demo { static class A { static int get(A a){return 1;} int get(){return 2;} } public static void main(String[] args){ToIntFunction<A> f=A::get; System.out.println(f.applyAsInt(new A()));} }';
    expect(javaTraceLesson(request(code))).toBeUndefined();
  });
  it('keeps the eager/lazy distinction in one compact walkthrough', () => {
    const lesson = javaTraceLesson(
      request(javaMethodOptionalCases.find((c) => c.id === 'optional-eager-lazy')!.code),
    )!;
    const text = [lesson.summary, ...lesson.steps, lesson.note].join(' ');
    expect(text).toContain('evaluated before');
    expect(text).toContain('supplier is not called');
    expect(text.split(/\s+/).length).toBeLessThan(400);
  });
});
