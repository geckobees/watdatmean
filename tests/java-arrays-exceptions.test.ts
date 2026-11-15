import { describe, it, expect, vi } from 'vitest';
import { javaTraceLesson } from '../src/java-trace';
import { generate } from '../src/provider';
import { BridgeCore } from '../src/bridge/core';
import { wombRequest } from './quality/depth-cases';
import { javaArrayExceptionCases } from './quality/java-array-exception-cases';
const request = (code: string) => ({ ...wombRequest, code });
const program = (body: string, members = '') =>
  `import java.util.*; public class Demo { ${members} public static void main(String[] args) { ${body} } }`;
const lesson = (id: string) =>
  javaTraceLesson(request(javaArrayExceptionCases.find((c) => c.id === id)!.code))!;
describe('Java arrays and exception handling', () => {
  it.each(javaArrayExceptionCases)(
    '$id has exact output in both editors without AI',
    async ({ code, expected }) => {
      expect(javaTraceLesson(request(code)), code).toBeDefined();
      const transport = vi.fn(() => {
        throw new Error('Supported Java must not call AI');
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
  it('explains saved returns, overrides and skipped statements compactly', () => {
    expect(lesson('finally-saved-return').steps.join(' ')).toContain('saved value 1');
    expect(lesson('finally-return-replaces').steps.join(' ')).toContain(
      "finally's return replaces the pending return",
    );
    expect(lesson('array-bounds').steps.join(' ')).toContain(
      'Remaining try statements are skipped',
    );
    expect(lesson('array-bounds').steps.join(' ')).toContain('valid indexes are 0 through 0');
    expect(lesson('array-store-covariance').steps.join(' ')).toContain(
      'actual array stores String',
    );
    for (const id of [
      'array-sum',
      'try-divide',
      'finally-saved-return',
      'array-store-covariance',
    ]) {
      const l = lesson(id);
      expect([l.summary, ...l.steps, l.note].join(' ').split(/\s+/).length).toBeLessThan(230);
    }
  });
  it.each([
    [
      'factory-list exception subtype',
      'List<Integer> a=List.of(1,2,3); try { System.out.println(a.get(5)); } catch(ArrayIndexOutOfBoundsException e) { System.out.println("array"); } catch(IndexOutOfBoundsException e) { System.out.println("index"); }',
    ],
    [
      'copyOf competing errors',
      'String[] a=null; try { Arrays.copyOf(a,-1); } catch(NullPointerException e) { System.out.println("null"); } catch(NegativeArraySizeException e) { System.out.println("length"); }',
    ],
    ['unhandled checked', 'throw new Exception("bad");'],
    [
      'unhandled checked helper',
      'fail();',
      'static void fail() throws Exception { throw new Exception("bad"); }',
    ],
    [
      'undeclared checked helper',
      'try { fail(); } catch(Exception e) {}',
      'static void fail() { throw new Exception("bad"); }',
    ],
    [
      'wrong catch order',
      'try { throw new IllegalStateException(); } catch(Exception e) {} catch(RuntimeException e) {}',
    ],
    [
      'related multicatch',
      'try { throw new IllegalStateException(); } catch(RuntimeException | IllegalStateException e) {}',
    ],
    [
      'multicatch reassignment',
      'try { throw new IllegalStateException(); } catch(ArithmeticException | IllegalStateException e) { e=new RuntimeException(); }',
    ],
    [
      'catch variable scope',
      'try { throw new IllegalStateException(); } catch(RuntimeException e) {} System.out.println(e.getMessage());',
    ],
    [
      'missing return path',
      'System.out.println(f());',
      'static int f() { try { return 1; } catch(RuntimeException e) {} }',
    ],
    ['unreachable after throw', 'throw new IllegalStateException(); System.out.println("wrong");'],
    ['uncaught runtime', 'int[] a={1}; System.out.println(a[2]);'],
    [
      'unknown VM exception message',
      'int[] a=null; try { System.out.println(a.length); } catch(NullPointerException e) { System.out.println(e.getMessage()); }',
    ],
    ['invalid catch type', 'try { System.out.println(1); } catch(String e) {}'],
    ['invalid throw value', 'throw 3;'],
    ['ambiguous exception constructor', 'throw new Exception(null);'],
    [
      'invalid skipped catch',
      'try { System.out.println(1); } catch(RuntimeException e) { System.out.println(missing); }',
    ],
    ['invalid finally', 'try { System.out.println(1); } finally { System.out.println(missing); }'],
    ['wrong array element', 'int[] a={"x"};'],
    ['wrong array dimensions', 'int[] a=new int[true];'],
    ['wrong index type', 'int[] a={1}; System.out.println(a["x"]);'],
    ['array length assignment', 'int[] a={1}; a.length=4;'],
    ['initializer without array type', 'int a={1};'],
    ['initializer assignment shorthand', 'int[] a={1}; a={2};'],
    ['uninitialized array', 'int[] a; System.out.println(a.length);'],
    ['array identity output', 'int[] a={1}; System.out.println(a);'],
    ['shallow array identity text', 'int[][] a={{1}}; System.out.println(Arrays.toString(a));'],
    [
      'resource bound cannot be caught',
      'try { int[] a=new int[129]; } catch(Exception e) { System.out.println("caught"); }',
    ],
    [
      'resource bound cannot be suppressed',
      'System.out.println(f());',
      'static int f() { try { int[] a=new int[129]; } finally { return 1; } }',
    ],
    [
      'unsupported cannot be suppressed',
      'System.out.println(f());',
      'static int f() { try { int n=Math.abs(-1); } finally { return 1; } }',
    ],
    ['try resources', 'try(Demo d=new Demo()) { System.out.println(1); }'],
  ])('declines %s without claiming a verified output', (_label, body, members?: string) => {
    expect(javaTraceLesson(request(program(body, members)))).toBeUndefined();
  });
  it('handles self-contained array/try selections and keeps missing context unknown', () => {
    expect(javaTraceLesson(request('int[] a={2,3}; System.out.println(a[1]);'))?.output?.text).toBe(
      '3\n',
    );
    expect(
      javaTraceLesson(
        request(
          'try { int n=1/0; } catch(ArithmeticException e) { System.out.println("caught"); }',
        ),
      )?.output?.text,
    ).toBe('caught\n');
    for (const code of [
      'System.out.println(items[0]);',
      'try { missing(); } catch(Exception e) {}',
      'try { return 1; } finally { return 2; }',
    ])
      expect(javaTraceLesson(request(code))).toBeUndefined();
  });
});
