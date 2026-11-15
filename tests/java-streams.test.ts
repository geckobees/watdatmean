import { describe, it, expect, vi } from 'vitest';
import { javaTraceLesson } from '../src/java-trace';
import { generate } from '../src/provider';
import { BridgeCore } from '../src/bridge/core';
import { wombRequest } from './quality/depth-cases';
import { javaStreamCases } from './quality/java-stream-cases';
const request = (code: string) => ({ ...wombRequest, code });
describe('Java streams and lambdas', () => {
  it.each([
    ['parallel stream', 'System.out.println(IntStream.of(1,2).parallel().sum());'],
    ['parallel collection', 'System.out.println(List.of(1,2).parallelStream().count());'],
    ['unordered source', 'System.out.println(Set.of(1,2,3).stream().toList());'],
    ['unbounded source', 'System.out.println(IntStream.iterate(0,n -> n+1).sum());'],
    ['work bound', 'System.out.println(IntStream.range(0,1000000000).filter(n -> n>0).sum());'],
    ['sorting bound', 'System.out.println(IntStream.range(0,1000).sorted().sum());'],
    [
      'side effect in filter',
      'System.out.println(IntStream.of(1,2).filter(n -> {System.out.println(n); return true;}).count());',
    ],
    [
      'side effect in map',
      'System.out.println(IntStream.of(1,2).map(n -> {System.out.println(n); return n;}).count());',
    ],
    [
      'side effect in match',
      'System.out.println(IntStream.of(1,2).anyMatch(n -> {System.out.println(n); return true;}));',
    ],
    [
      'peek optimization',
      'System.out.println(IntStream.of(1,2).peek(n -> System.out.println(n)).count());',
    ],
    [
      'captured reassignment after',
      'int x=1; IntSupplier f=() -> x; x=2; System.out.println(f.getAsInt());',
    ],
    ['final reassignment', 'final int x=1; x=2; System.out.println(x);'],
    [
      'captured reassignment before',
      'int x=1; x=2; IntSupplier f=() -> x; System.out.println(f.getAsInt());',
    ],
    [
      'captured modification within',
      'int x=1; IntSupplier f=() -> ++x; System.out.println(f.getAsInt());',
    ],
    [
      'captured mutable array',
      'int[] x={1}; IntSupplier f=() -> ++x[0]; System.out.println(f.getAsInt());',
    ],
    [
      'source interference',
      'List<Integer> a=new ArrayList<Integer>(); a.add(1); a.stream().forEach(n -> a.add(n));',
    ],
    ['duplicate lambda parameter', 'IntBinaryOperator f=(n,n) -> n;'],
    ['shadowing enclosing local', 'int n=1; IntUnaryOperator f=n -> n+1;'],
    ['mixed lambda parameter styles', 'IntBinaryOperator f=(int n,m) -> n+m;'],
    ['wrong parameter type', 'IntUnaryOperator f=(String n) -> 1;'],
    ['wrong arity', 'IntUnaryOperator f=() -> 1;'],
    ['wrong predicate result', 'System.out.println(IntStream.of(1).filter(n -> n+1).count());'],
    ['missing return path', 'IntUnaryOperator f=n -> { if(n>0) return n; };'],
    ['consumer value block', 'IntConsumer f=n -> {return n;};'],
    ['consumer non-statement expression', 'IntConsumer f=n -> n+1;'],
    ['break cannot exit outer loop', 'for(int i=0;i<2;i++){ IntConsumer f=n -> {break;}; }'],
    ['invalid dead lambda body', 'IntStream s=IntStream.of(1).map(n -> missing);'],
    ['invalid dead branch', 'IntUnaryOperator f=n -> {if(n>0) return n; return missing;};'],
    ['unhandled checked exception', 'IntUnaryOperator f=n -> {throw new Exception();};'],
    [
      'unknown collector mutability',
      'List<Integer> a=Stream.of(1).collect(Collectors.toList()); a.add(2); System.out.println(a);',
    ],
    ['unknown mapping helper', 'System.out.println(IntStream.of(1).map(n -> mystery(n)).sum());'],
    [
      'nested stream in callback',
      'System.out.println(IntStream.of(1).map(n -> IntStream.of(n).sum()).sum());',
    ],
    ['unmodeled collector', 'System.out.println(Stream.of(1,2).collect(Collectors.toSet()));'],
    [
      'null stream with unknown exception text',
      'IntStream s=null; try{s.sum();}catch(NullPointerException e){System.out.println(e.getMessage());}',
    ],
    ['count is long', 'int count=IntStream.of(1,2).count(); System.out.println(count);'],
    ['missing stream import', 'System.out.println(java.util.stream.IntStream.of(1,2).sum());'],
    ['uncaught stream reuse', 'IntStream s=IntStream.of(1,2); s.sum(); s.sum();'],
  ])('declines %s without guessing a local output', (_, body) => {
    const code = `import java.util.*; import java.util.stream.*; import java.util.function.*; public class Demo { public static void main(String[] args){${body}} }`;
    expect(javaTraceLesson(request(code))).toBeUndefined();
  });
  it('keeps an ordinary pipeline compact and explains laziness, captures and short-circuiting', () => {
    const lesson = (id: string) =>
      javaTraceLesson(request(javaStreamCases.find((c) => c.id === id)!.code))!;
    const trace = lesson('stream-filter-map-sum');
    expect(trace.steps.join(' ')).toContain('filter keeps matching items');
    expect(trace.steps.join(' ')).toContain('map transforms each item');
    expect(trace.steps.join(' ')).toContain('lazy');
    expect([trace.summary, ...trace.steps, trace.note].join(' ').split(/\s+/).length).toBeLessThan(
      220,
    );
    expect(lesson('stream-count-elision').steps.join(' ')).toContain('skip visiting items');
    expect(lesson('stream-early-match').steps.join(' ')).toContain('stops as soon');
    expect(lesson('lambda-capture').steps.join(' ')).toContain('captured bonus=3');
  });
  it.each(javaStreamCases)(
    '$id has exact output on both editor paths without AI',
    async ({ code, expected }) => {
      const local = javaTraceLesson(request(code));
      expect(local, code).toBeDefined();
      const transport = vi.fn(() => {
        throw new Error('Supported streams must not call AI');
      });
      const direct = await generate(
        'groq',
        'qwen/qwen3.8-27b',
        'unused',
        request(code),
        undefined,
        transport,
      );
      const bridge = (await new BridgeCore(transport).dispatch(1, 'request', {
        provider: 'groq',
        model: 'qwen/qwen3.8-27b',
        key: 'unused',
        request: request(code),
      })) as any;
      expect(bridge.lesson).toEqual(direct);
      expect(direct.output?.text).toBe(expected);
      expect(direct.stepOutput?.join('')).toBe(expected);
      expect(direct.local).toBe(true);
      expect(direct.usage?.total).toBe(0);
      expect(direct.steps.length).toBeLessThanOrEqual(6);
      expect(direct.concepts.every((c) => !!c.explanation)).toBe(true);
      expect(transport).not.toHaveBeenCalled();
    },
  );
});
