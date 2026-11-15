import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { javaTraceLesson } from '../src/java-trace';
import { generate } from '../src/provider';
import { BridgeCore } from '../src/bridge/core';
import { wombCode, wombOutput, wombRequest } from './quality/depth-cases';
import { javaTraceCases } from './quality/java-trace-cases';

describe('bounded Java construction trace', () => {
  it('explains separate field slots, constructor phases and dispatch in one compact walkthrough', () => {
    const lesson = javaTraceLesson(wombRequest)!;
    expect(lesson.output).toEqual({ text: wombOutput, explanation: '' });
    expect(lesson.steps).toHaveLength(4);
    expect(lesson.stepOutput).toEqual(['null0A1 ', 'B6A11 ', 'B106A11 ', 'A11B106aa\n']);
    const text = [lesson.summary, ...lesson.steps, lesson.note].join(' ');
    expect(text.split(/\s+/).length).toBeLessThan(340);
    for (const detail of [
      'static nested',
      'B extends A',
      'one B object',
      'B.s=null',
      'A.n: 1 → 11',
      'B.n: 2 → 6',
      'B.n: 6 → 106',
      'source order',
      'even during construction',
      'x.s → A.s="A"',
      'x.n → A.n=11',
      '((B) x).s → B.s="B"',
      'static A.who()',
      'no null dereference',
      'not overriding',
      'not the object',
      'left to right',
      'java.io.PrintStream',
      'after construction',
    ])
      expect(text).toContain(detail);
    expect(lesson.usage?.total).toBe(0);
    expect(lesson.local).toBe(true);
    expect(lesson.concepts.every((c) => c.explanation?.length)).toBe(true);
    expect(lesson.checks[0]).toContain('Answer: No');
  });
  it('keeps the full event sequence available with More detail', () => {
    const compact = javaTraceLesson(wombRequest)!;
    const detailed = javaTraceLesson({ ...wombRequest, task: 'walkthrough' })!;
    expect(detailed.steps.length).toBeGreaterThan(compact.steps.length);
    expect(detailed.steps.length).toBeLessThanOrEqual(40);
    expect(detailed.output).toEqual(compact.output);
    expect(detailed.stepOutput?.join('')).toBe(wombOutput);
  });
  it('does not claim an override ran when the child only inherited the parent method', () => {
    const code = javaTraceCases.find((c) => c.id === 'inherited-method')!.code;
    const lesson = javaTraceLesson({ ...wombRequest, code })!;
    expect(lesson.note).not.toContain('calling an override');
    expect(lesson.steps.join(' ')).toContain('x.show() runs A.show()');
    expect(lesson.output?.text).toBe('A1 A11 A11 A11B106aa\n');
  });
  it.each(javaTraceCases)(
    'derives $id without hardcoded names, values or source positions',
    ({ code }) => {
      const lesson = javaTraceLesson({ ...wombRequest, code });
      expect(lesson?.local).toBe(true);
      expect(lesson?.output?.text).toBe(lesson?.stepOutput?.join(''));
    },
  );
  it.each(['openai', 'anthropic', 'groq'] as const)(
    'uses the same zero-token lesson through VS Code and IntelliJ for %s',
    async (provider) => {
      const transport = vi.fn();
      const direct = await generate(
        provider,
        'fixture',
        'unused',
        wombRequest,
        undefined,
        transport,
      );
      const bridge = new BridgeCore(transport);
      const params = { provider, model: 'fixture', key: 'unused', request: wombRequest };
      const first = (await bridge.dispatch(1, 'request', params)) as any;
      const cached = (await bridge.dispatch(2, 'request', params)) as any;
      expect(first.lesson).toEqual(direct);
      expect(first.lesson.output.text).toBe(wombOutput);
      expect(first.lesson.usage.total).toBe(0);
      expect(cached.cached).toBe(true);
      expect(transport).not.toHaveBeenCalled();
    },
  );
  it('accepts duplicate context with comments and spacing but declines extra project information', () => {
    expect(
      javaTraceLesson({ ...wombRequest, context: '// Complete file\n' + wombCode })?.output?.text,
    ).toBe(wombOutput);
    for (const extra of [
      { context: wombCode + '\nclass System {}' },
      { context: 'String s = "unknown";' },
      { learningContext: 'Explain another call' },
      { replacement: 'new A()' },
      {
        evidence: [
          {
            id: 'E1',
            code: 'class System {}',
            file: 'System.java',
            line: 1,
            kind: 'definition' as const,
            test: false,
          },
        ],
      },
    ])
      expect(javaTraceLesson({ ...wombRequest, ...extra })).toBeUndefined();
  });
  it.each([
    ['missing class', 'B() { super(); show(); n += 100; }'],
    [
      'missing print body',
      wombCode.replace('System.out.print(s + n + super.s + super.n + " ");', 'missing();'),
    ],
    [
      'unused invalid superclass method',
      wombCode.replace('System.out.print(s + n + " ");', 'System.out.print(unknown);'),
    ],
    ['loop', wombCode.replace('n += 10;', 'while (true) { n += 10; }')],
    ['static field', wombCode.replace('int n = 1;', 'static int n = 1;')],
    ['private override', wombCode.replace('@Override void', '@Override private void')],
    [
      'reduced visibility',
      wombCode.replace(
        'void show() { System.out.print(s + n + " "); }',
        'public void show() { System.out.print(s + n + " "); }',
      ),
    ],
    [
      'invalid override annotation',
      wombCode.replace(
        'void show() { System.out.print(s + n + " "); }',
        '@Override void show() { System.out.print(s + n + " "); }',
      ),
    ],
    ['duplicate field', wombCode.replace('int n = 1;', 'int n = 1; int n = 2;')],
    [
      'initializer forward read',
      wombCode.replace('String s = "B";', '{ n *= 3; } String s = "B";'),
    ],
    ['helper initializer', wombCode.replace('int n = 2;', 'int n = helper();')],
    ['wrong field type', wombCode.replace('int n = 2;', 'int n = "two";')],
    ['decrement is not double negation', wombCode.replace('int n = 2;', 'int n = --2;')],
    ['post-decrement is not subtraction', wombCode.replace('int n = 2;', 'int n = 1--2;')],
    ['null instance call', wombCode.replace('x.show();', '((A) null).show();')],
    ['null field read', wombCode.replace('x.s + x.n', '((A) null).s + x.n')],
    ['unknown cast', wombCode.replace('((B) x).s', '((Unknown) x).s')],
    ['cast from int', wombCode.replace('((B) x).s', '((B) 1).s')],
    ['Object print', wombCode.replace('x.s + x.n', 'x + x.n')],
    ['ambiguous println null', wombCode.replace('x.show();', 'System.out.println(null);')],
    ['cycle', wombCode.replace('class A {', 'class A extends B {')],
    ['separate superclass', wombCode.replace('extends A', 'extends Missing')],
    ['keyword identifier', wombCode.replace(/\bx\b/g, 'assert')],
    [
      'Unicode escape preprocessing',
      wombCode.replace('int n = 1;', 'int n = 1; // \\u000a broken'),
    ],
    ['non-Java whitespace', wombCode.replace('public class', 'public\u00a0class')],
    ['parenthesized super', wombCode.replace('super.s', '(super).s')],
    ['argument shadows class qualifier', wombCode.replace('String[] args', 'String[] A')],
    ['class shadowed by field', wombCode.replace('int n = 1;', 'int n = 1; String A;')],
    ['late explicit super', wombCode.replace('super(); show();', 'show(); super();')],
    ['import dependency', 'import example.System;\n' + wombCode],
    ['truncated input', wombCode.slice(0, -2)],
    ['unclosed comment', wombCode + '/*'],
    ['oversized input', wombCode + ' '.repeat(12000)],
    [
      'deep expression',
      wombCode.replace('int n = 2;', 'int n = ' + '('.repeat(20) + '2' + ')'.repeat(20) + ';'),
    ],
  ])('declines %s without claiming any exact output', (_id, code) => {
    expect(javaTraceLesson({ ...wombRequest, code })).toBeUndefined();
  });
  it('replaces the recorded field-hiding error and uses fewer tokens than both prior live trials', async () => {
    const records = JSON.parse(
      readFileSync('tests/quality/groq-reasoning-2026-11-14.json', 'utf8'),
    ).results;
    const java = records.filter(
      (r: any) => r.id.includes('java') && r.request?.code.includes('class Womb'),
    );
    expect(java.length).toBeGreaterThan(0);
    for (const record of java) {
      const transport = vi.fn();
      const result = await generate(
        'groq',
        'qwen/qwen3.8-27b',
        'unused',
        record.request,
        undefined,
        transport,
      );
      expect(result.output?.text).toBe(wombOutput);
      expect(result.usage?.total).toBe(0);
      expect(result.usage!.total).toBeLessThan(record.lesson.usage.total);
      expect(transport).not.toHaveBeenCalled();
    }
  });
});
