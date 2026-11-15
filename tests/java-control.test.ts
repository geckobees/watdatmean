import { describe, expect, it, vi } from 'vitest';
import { javaTraceLesson } from '../src/java-trace';
import { generate } from '../src/provider';
import { BridgeCore } from '../src/bridge/core';
import { javaControlCases } from './quality/java-control-cases';
import { wombRequest } from './quality/depth-cases';
const request = (code: string) => ({ ...wombRequest, code });
const program = (body: string, members = '') =>
  `import java.util.*; public class Demo { ${members} public static void main(String[] args) { ${body} } }`;
const lesson = (id: string) =>
  javaTraceLesson(request(javaControlCases.find((c) => c.id === id)!.code))!;

describe('Java loops, collections and overloads', () => {
  it.each(javaControlCases)(
    '$id produces complete exact output through both editors without AI',
    async ({ code, expected }) => {
      const transport = vi.fn(() => {
        throw new Error('Local Java should not call AI');
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
  it('keeps repeated work compact without hiding final values or loop control', () => {
    const long = lesson('many-passes');
    expect([long.summary, ...long.steps, long.note].join(' ').split(/\s+/).length).toBeLessThan(
      180,
    );
    expect(long.steps.join(' ')).toContain('100 iterations');
    expect(long.steps.join(' ')).toContain('total=5050');
    expect(long.steps.join(' ')).toContain('i starts at 1');
    expect(lesson('for-zero').steps.join(' ')).toContain('body never runs');
    expect(lesson('for-break-continue').steps.join(' ')).toContain('then run the update');
    expect(lesson('for-break-continue').steps.join(' ')).toContain('break exits this loop');
    expect(lesson('do-first').steps.join(' ')).toContain('body runs before testing');
  });
  it('explains the selected overload and the actual override separately', () => {
    expect(lesson('overload-then-override').steps.join(' ')).toContain(
      'Declared argument types select Parent.pick(Base)',
    );
    expect(lesson('overload-then-override').steps.join(' ')).toContain('runs Child.pick(n)');
    const text = lesson('list-remove-overloads').steps.join(' ');
    expect(text).toContain('zero-based index (int)');
    expect(text).toContain('first matching value (Object)');
    expect(text).not.toContain('nums=[10, 20, 10]');
    expect(text).not.toContain('nums=[10, 10]');
    expect(lesson('list-remove-overloads').note).toContain('java.util');
  });
  it.each([
    ['infinite loop', 'while(true) { int n=1; }'],
    ['iteration bound', 'for(int n=0;n<257;n++) System.out.print(n);'],
    ['collection bound', 'List<Integer> a=new ArrayList<>(); for(int n=0;n<129;n++) a.add(n);'],
    ['out-of-bounds', 'List<Integer> a=List.of(1); System.out.println(a.get(1));'],
    ['immutable mutation', 'List<Integer> a=List.of(1); a.add(2);'],
    ['immutable null query', 'List<String> a=List.of("a"); System.out.println(a.contains(null));'],
    ['set duplicate factory', 'Set<Integer> a=Set.of(1,1); System.out.println(a.size());'],
    [
      'map duplicate factory',
      'Map<String,Integer> a=Map.of("a",1,"a",2); System.out.println(a.size());',
    ],
    ['null factory', 'List<String> a=List.of(null); System.out.println(a);'],
    ['null unboxing', 'Integer n=null; System.out.println(n+1);'],
    ['null numeric equality', 'Integer n=null; System.out.println(n==0);'],
    ['boxed identity', 'Integer a=128; Integer b=128; System.out.println(a==b);'],
    ['string identity', 'String a="x"; System.out.println(a=="x");'],
    [
      'unordered set iteration',
      'Set<Integer> a=new HashSet<>(); a.add(1); a.add(2); for(int n:a) System.out.print(n);',
    ],
    ['unordered map output', 'Map<String,Integer> a=Map.of("a",1,"b",2); System.out.println(a);'],
    ['iterator mutation', 'List<Integer> a=new ArrayList<>(List.of(1,2)); for(int n:a) a.add(3);'],
    [
      'key view mutation',
      'Map<String,Integer> a=new LinkedHashMap<>(); a.put("a",1); for(String k:a.keySet()) a.put("b",2);',
    ],
    ['wrong generic', 'List<String> a=new ArrayList<Integer>(); System.out.println(a);'],
    ['wrong element', 'List<String> a=new ArrayList<>(); a.add(1);'],
    ['loop variable scope', 'for(int i=0;i<3;i++) System.out.print(i); System.out.println(i);'],
    ['unreachable body', 'while(false) System.out.println(1);'],
    ['break outside loop', 'break;'],
    ['continue outside loop', 'continue;'],
    ['uninitialized loop local', 'for(int n=n;n<3;n++) System.out.println(n);'],
    ['nonboolean condition', 'while(1) System.out.println(1);'],
    ['invalid skipped branch', 'if(false) System.out.println(missing);'],
    [
      'ambiguous null',
      'System.out.println(pick(null));',
      'static int pick(String n) { return 1; } static int pick(Integer n) { return 2; }',
    ],
    [
      'erased signatures',
      'System.out.println(1);',
      'static int pick(List<String> n) { return 1; } static int pick(List<Integer> n) { return 2; }',
    ],
    [
      'missing return path',
      'System.out.println(pick(2));',
      'static int pick(int n) { if(n>1) return n; }',
    ],
    [
      'unreachable after do return',
      'System.out.println(pick());',
      'static int pick() { do { return 1; } while(false); return 2; }',
    ],
    [
      'bad unused overload',
      'System.out.println(pick(1));',
      'static int pick(int n) { return n; } static int pick(String n) { return missing; }',
    ],
  ])('declines %s instead of claiming a normal result', (_label, body, members?: string) => {
    expect(javaTraceLesson(request(program(body, members)))).toBeUndefined();
  });
  it('does not fill in missing loop or collection context', () => {
    for (const code of [
      'for(int n:items) System.out.println(n);',
      'for(int i=0;i<limit;i++) total+=i;',
      'List<Integer> a=new ArrayList<>(); a.add(1);',
      'if(true) return;',
    ])
      expect(javaTraceLesson(request(code))).toBeUndefined();
  });
});
