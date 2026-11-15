import { describe, expect, it, vi } from 'vitest';
import { javaTraceLesson } from '../src/java-trace';
import { generate } from '../src/provider';
import { BridgeCore } from '../src/bridge/core';
import { javaGeneralCases } from './quality/java-general-cases';
import { wombRequest } from './quality/depth-cases';

const request = (code: string) => ({ ...wombRequest, code });
const program = (body: string, members = '') =>
  `public class Demo { ${members} public static void main(String[] args) { ${body} } }`;
describe('general Java explanations', () => {
  it.each(javaGeneralCases)(
    '$id has independently specified complete output in both editor paths, at zero tokens',
    async ({ code, expected }) => {
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
      const core = new BridgeCore(transport);
      const params = {
        provider: 'groq',
        model: 'qwen/qwen3.8-27b',
        key: 'unused',
        request: request(code),
      };
      const reply = (await core.dispatch(1, 'request', params)) as any;
      expect(reply.lesson).toEqual(direct);
      expect(direct.output?.text).toBe(expected);
      expect(direct.stepOutput?.join('')).toBe(expected);
      expect(direct.steps.length).toBeLessThanOrEqual(6);
      expect(direct.usage?.total).toBe(0);
      expect(direct.local).toBe(true);
      expect(direct.concepts.every((c) => !!c.explanation)).toBe(true);
      expect(direct.steps.join(' ')).not.toMatch(/\bWomb\b|A11B106aa/);
      expect(await core.dispatch(2, 'request', params)).toMatchObject({ cached: true });
      expect(transport).not.toHaveBeenCalled();
    },
  );
  it('keeps simple programs compact and definitions relevant', () => {
    for (const id of [
      'local-receipt',
      'static-helper',
      'integer-division',
      'mixed-numeric-string',
    ]) {
      const lesson = javaTraceLesson(request(javaGeneralCases.find((c) => c.id === id)!.code))!;
      expect(
        [lesson.summary, ...lesson.steps, lesson.note].join(' ').split(/\s+/).length,
      ).toBeLessThan(150);
      expect(lesson.concepts.map((c) => c.term)).not.toContain('constructor');
      expect(lesson.summary).not.toContain('nested');
    }
  });
  it('distinguishes arguments, local variables, fields and separate objects', () => {
    const lesson = (id: string) =>
      javaTraceLesson(request(javaGeneralCases.find((c) => c.id === id)!.code))!;
    expect(lesson('parameter-shadowing').steps.join(' ')).toContain(
      'this.price = price changes Ticket.price: 2 → 4',
    );
    expect(lesson('parameter-shadowing').steps.join(' ')).toContain('arguments become count=3');
    expect(lesson('parameter-shadowing').steps.join(' ')).toContain(
      'Ticket(price) receives price=4',
    );
    expect(lesson('parameter-shadowing').steps.join(' ')).toContain('Ticket.cost(count)');
    expect(lesson('super-arguments').steps.join(' ')).toContain('Child(start) calls Parent(5)');
    expect(lesson('local-shadows-field').steps.join(' ')).toContain('this.value → Score.value=3');
    expect(lesson('two-independent-objects').summary).toContain('2 independent objects');
    expect(lesson('two-independent-objects').steps).toHaveLength(3);
    expect(lesson('two-independent-objects').steps.join(' ')).toContain('For first:');
    expect(lesson('reference-alias').summary).toContain('one Box object');
    expect(lesson('three-level-construction').summary).toContain(
      'Leaf extends Middle; Middle extends Root',
    );
  });
  it.each([
    [
      'argument type',
      program('System.out.println(square("x"));', 'static int square(int n) { return n*n; }'),
    ],
    [
      'argument count',
      program('System.out.println(square());', 'static int square(int n) { return n*n; }'),
    ],
    [
      'return type',
      program('System.out.println(square(2));', 'static int square(int n) { return "x"; }'),
    ],
    [
      'missing return',
      program('System.out.println(square(2));', 'static int square(int n) { n *= n; }'),
    ],
    [
      'unused invalid method',
      program('System.out.println("ok");', 'static int bad() { return missing; }'),
    ],
    ['unreachable statement', program('return; System.out.println("bad");')],
    ['duplicate local', program('int n=1; int n=2; System.out.println(n);')],
    ['uninitialized local', program('int n=n; System.out.println(n);')],
    [
      'local shadows field in initializer',
      program(
        'Demo item=new Demo(); item.bad();',
        'int n=1; void bad() { int n=n; System.out.println(n); }',
      ),
    ],
    [
      'duplicate parameter',
      program('System.out.println("ok");', 'int bad(int n, int n) { return n; }'),
    ],
    ['duplicate argument name', program('int args=3; System.out.println(args);')],
    ['static instance field', program('System.out.println(n);', 'int n=1;')],
    ['static instance method', program('System.out.println(get());', 'int get() { return 1; }')],
    ['this from static method', program('System.out.println(this.n);', 'int n=1;')],
    ['instance call on class', program('Demo.show();', 'void show() { System.out.println(1); }')],
    ['assignment to this', program('Demo d=new Demo(); d.bad();', 'void bad() { this = null; }')],
    [
      'bad constructor argument',
      program(
        'Demo d=new Demo("bad"); System.out.println(d.n);',
        'int n; Demo(int value) { n=value; }',
      ),
    ],
    [
      'bad super argument',
      'class Parent { Parent(int n) {} } public class Demo extends Parent { Demo() { super("bad"); } public static void main(String[] args) { Demo d=new Demo(); System.out.println("done"); } }',
    ],
    [
      'missing required super argument',
      'class Parent { Parent(int n) {} } public class Demo extends Parent { public static void main(String[] args) { Demo d=new Demo(); System.out.println("done"); } }',
    ],
    [
      'instance read before super',
      'class Parent { Parent(int n) {} } public class Demo extends Parent { int n=2; Demo() { super(n); } public static void main(String[] args) { Demo d=new Demo(); System.out.println("done"); } }',
    ],
    [
      'ambiguous method overload',
      program(
        'System.out.println(value(null));',
        'static int value(Integer n) { return n; } static int value(String n) { return 1; }',
      ),
    ],
    [
      'invalid inherited overload call',
      'class Parent { int value(int n) { return n; } } public class Demo extends Parent { int value(String s) { return 1; } public static void main(String[] args) { Demo d=new Demo(); System.out.println(d.value(true)); } }',
    ],
    [
      'invalid field access before inheritance',
      'class Parent { int n=1; } class Child extends Parent { int extra=2; } public class Demo { public static void main(String[] args) { Parent p=new Child(); System.out.println(p.extra); } }',
    ],
    [
      'incompatible assignment',
      'class Parent {} class Child extends Parent {} public class Demo { public static void main(String[] args) { Child p=new Parent(); System.out.println("done"); } }',
    ],
    [
      'bad dynamic cast',
      'class Parent {} class Child extends Parent { int n=1; } public class Demo { public static void main(String[] args) { Parent p=new Parent(); System.out.println(((Child)p).n); } }',
    ],
    [
      'unrelated cast',
      'class One {} class Two { int n=1; } public class Demo { public static void main(String[] args) { One one=new One(); System.out.println(((Two)one).n); } }',
    ],
    [
      'null call',
      program('Demo d=null; System.out.println(d.value());', 'int value() { return 2; }'),
    ],
    ['null field', program('Demo d=null; System.out.println(d.n);', 'int n=2;')],
    ['division by zero', program('int n=0; System.out.println(10/n);')],
    ['remainder by zero', program('System.out.println(1%0);')],
    [
      'recursion',
      program('System.out.println(repeat(1));', 'static int repeat(int n) { return repeat(n+1); }'),
    ],
    [
      'recursive construction',
      program(
        'Demo d=new Demo(); System.out.println("done");',
        'Demo() { Demo another=new Demo(); }',
      ),
    ],
    [
      'external dependency',
      'import java.time.LocalDate; ' + program('System.out.println(LocalDate.now());'),
    ],
    [
      'loop with missing state',
      program('int n=0; for(int i=0;i<limit;i++) { n+=i; } System.out.println(n);'),
    ],
    ['branch with missing state', program('int n=2; if(n>limit) { System.out.println(n); }')],
    [
      'static initialization',
      program('System.out.println("done");', 'static { System.out.println("init"); }'),
    ],
    ['non-static inner class', program('System.out.println("done");', 'class Inner { int n=2; }')],
    [
      'nested name outside scope',
      'class Container { static class Inner {} } public class Demo { public static void main(String[] args) { Inner item=new Inner(); System.out.println("done"); } }',
    ],
    [
      'multiple public classes',
      'public class One {} public class Demo { public static void main(String[] args) { System.out.println("done"); } }',
    ],
    [
      'inheritance cycle',
      'class One extends Two {} class Two extends One {} public class Demo { public static void main(String[] args) { System.out.println("done"); } }',
    ],
    ['missing variable declaration', 'System.out.println(total);'],
    ['partial constructor', 'Demo(int n) { this.n = n; }'],
    ['return needs an enclosing method type', 'System.out.println(3); return;'],
  ])('declines %s instead of reporting a fabricated normal output', (_name, code) => {
    expect(javaTraceLesson(request(code))).toBeUndefined();
  });
  it.each([
    ['int total = 7 * 3; System.out.println(total);', '21\n'],
    ['String label = "item"; int n = 2; n += 3; System.out.println(label + n);', 'item5\n'],
    ['System.out.print(2); System.out.println(3);', '23\n'],
  ])(
    'explains complete primitive statements without guessing an enclosing method: %s',
    async (code, output) => {
      const transport = vi.fn();
      const direct = await generate(
        'groq',
        'qwen/qwen3.8-27b',
        'unused',
        request(code),
        undefined,
        transport,
      );
      const reply = (await new BridgeCore(transport).dispatch(1, 'request', {
        provider: 'groq',
        model: 'qwen/qwen3.8-27b',
        key: 'unused',
        request: request(code),
      })) as any;
      expect(reply.lesson).toEqual(direct);
      expect(direct.output?.text).toBe(output);
      expect(direct.summary).not.toMatch(/main|WdmLocalSnippet|nested/);
      expect(direct.steps.join(' ')).not.toContain('WdmLocalSnippet');
      expect(direct.usage?.total).toBe(0);
      expect(transport).not.toHaveBeenCalled();
    },
  );
  it('keeps unsupported Java available through the shared AI path without local verification claims', async () => {
    const code = program(
      'int total=java.util.stream.IntStream.rangeClosed(1,3).sum(); System.out.println(total);',
    );
    const transport = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: 'Add the integers from one through three.',
                    steps: [
                      { explanation: 'The loop adds 1, then 2, then 3 to total.', printed: '6\n' },
                    ],
                    output: { complete: true, explanation: '' },
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 },
          }),
        ),
    );
    const direct = await generate(
      'groq',
      'qwen/qwen3.8-27b',
      'fixture',
      request(code),
      undefined,
      transport,
    );
    const bridge = (await new BridgeCore(transport).dispatch(1, 'request', {
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      key: 'fixture',
      request: request(code),
    })) as any;
    expect(bridge.lesson).toEqual(direct);
    expect(direct.local).not.toBe(true);
    expect(direct.output?.text).toBe('6\n');
    expect(direct.usage?.total).toBe(1200); // Mock usage tests accounting, not a live benchmark.
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
