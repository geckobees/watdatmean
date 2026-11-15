import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { reasoningEffort } from '../src/reasoning';
import { literalLesson } from '../src/literal-lesson';
import { javaTraceLesson } from '../src/java-trace';
import { generate, makeRequest } from '../src/provider';
import { BridgeCore } from '../src/bridge/core';
import { reasoningCases } from './quality/reasoning-cases';
import { optimizationCases } from './quality/optimization-cases';
import type { LearningRequest } from '../src/types';

const base = reasoningCases[0].request;
describe('adaptive hidden reasoning', () => {
  it.each(reasoningCases.slice(0, 3))(
    'replaces the recorded incomplete $id reply with the complete local walkthrough',
    async ({ id, request, expectedOutput }) => {
      const records = JSON.parse(
        readFileSync('tests/quality/groq-reasoning-2026-11-14.json', 'utf8'),
      ).results;
      const failed = records.find(
        (r: any) => r.id === id && r.variant === 'candidate-no-reasoning',
      );
      const final = records.find((r: any) => r.id === id && r.variant === 'after');
      expect(JSON.parse(failed.raw).steps).toEqual([]);
      const transport = vi.fn().mockImplementation(() => {
        throw new Error('Do not send this snippet to the model.');
      });
      const lesson = await generate(
        'groq',
        'qwen/qwen3.8-27b',
        'fixture',
        request,
        undefined,
        transport,
      );
      expect(lesson).toEqual(final.lesson);
      expect(lesson.steps.length).toBeGreaterThan(0);
      expect(lesson.output?.text).toBe(expectedOutput);
      expect(lesson.concepts.every((c) => c.explanation)).toBe(true);
      expect(transport).not.toHaveBeenCalled();
    },
  );
  it.each(reasoningCases.slice(0, 3))(
    'uses no reasoning for the bounded $id form',
    ({ request }) => {
      expect(reasoningEffort(request)).toBe('none');
      const body = JSON.parse(makeRequest('groq', 'qwen/qwen3.8-27b', 'fixture', request).body);
      expect(body.reasoning_effort).toBe('none');
      // Keep the original completion ceiling; measured savings cannot be caused by truncation.
      expect(body.max_completion_tokens).toBe(2948);
    },
  );
  it.each([
    ['TypeScript', 'const x = 2; const y = x + 3; console.log(y);'],
    ['JavaScript', 'let greeting = "hello"; console.log(greeting);'],
    ['Python', 'x = 2\ny = x + 3\nprint(y)'],
    ['Python', 'x = True\nprint(x)'],
    ['Java', 'java.lang.System.out.println("Hello\\nWorld");'],
    [
      'TypeScript',
      '// classes and closures mentioned in a comment\nconst x = "show()"; console.log(x);',
    ],
  ])('recognizes supported %s syntax instead of counting lines', (language, code) => {
    expect(reasoningEffort({ ...base, language, code })).toBe('none');
  });
  it.each([
    ['TypeScript', 'const x = helper();'],
    ['TypeScript', 'console.log(missing);'],
    ['TypeScript', 'const x = 0.1 + 0.2; console.log(x);'],
    ['TypeScript', 'const x = "1" + 2; console.log(x);'],
    ['TypeScript', 'const x = 9007199254740992; console.log(x + 1);'],
    ['TypeScript', 'let x=1; x++; console.log(x);'],
    ['TypeScript', 'const console = something; console.log("hi");'],
    ['TypeScript', 'var x="hi"; console.log(x);'],
    ['TypeScript', 'const name: number = "Ada"; console.log(name);'],
    ['TypeScript', 'const x = {get value(){return 1}}; console.log(x.value);'],
    ['TypeScript', 'const x=()=>1; console.log(x());'],
    ['TypeScript', 'const x = await get();'],
    ['TypeScript', 'const x = `hi ${get()}`;'],
    ['TypeScript', 'const x = ;'],
    ['Python', 'name = input()\nprint(name)'],
    ['Python', 'name = "Ada"\nprint(f"hi {name}")'],
    ['Python', 'x=b"hello"\nprint(x + "there")'],
    ['Python', 'x=1\nx=2\nprint(x)'],
    ['Python', 'print = helper\nprint("hello")'],
    ['Python', 'print(value)'],
    ['Python', 'x=1/0\nprint(x)'],
    ['Python', 'x=0.1+0.2\nprint(x)'],
    ['Python', 'x = [lambda: n for n in range(3)]\nprint([f() for f in x])'],
    ['Python', 'if True:\n    print("hi")'],
    ['Python', 'x = "hello"\n  print(x)'],
    ['Java', 'A x = new B(); x.show();'],
    ['Java', 'B() { super(); show(); n += 100; }'],
    ['Java', 'System.out.println(x.s + x.who());'],
    ['Java', 'System.out.println("hello"); System.out.println("again");'],
    ['Java', 'System.out.println("\\u0022");'],
    ['Rust', 'let name = "Ada";'],
    ['Unknown', 'const x = "hello"; console.log(x);'],
  ])('retains reasoning for uncertain or complex %s: %s', (language, code) => {
    expect(reasoningEffort({ ...base, language, code })).toBe('low');
  });
  it.each(optimizationCases)(
    'retains reasoning for the existing $id quality fixture',
    ({ request }) => {
      expect(reasoningEffort(request)).toBe('low');
    },
  );
  it('examines task and supplied context even for a one-line selection', () => {
    for (const task of ['concept', 'impact', 'walkthrough'] as const)
      expect(reasoningEffort({ ...base, task })).toBe('low');
    for (const extra of [
      { context: 'function console() {}' },
      { learningContext: 'Explain the constructor dispatch.' },
      { replacement: 'new B()' },
      { code: '' },
      { code: 'const x = "hi";'.repeat(70) },
      { code: Array.from({ length: 13 }, (_, i) => `const v${i} = "hi";`).join('\n') },
      {
        evidence: [
          {
            id: 'E1',
            file: 'helper.ts',
            line: 1,
            kind: 'definition' as const,
            test: false,
            code: 'class B extends A {}',
          },
        ],
      },
    ])
      expect(reasoningEffort({ ...base, ...extra })).toBe('low');
    expect(reasoningEffort({ ...base, mode: 'project', context: base.code })).toBe('none');
    expect(reasoningEffort({ ...base, task: 'example' })).toBe('none');
  });
  it('changes only Qwen reasoning effort, leaving prompts, caps and other providers unchanged', () => {
    const before = JSON.parse(readFileSync('tests/quality/reasoning-before-requests.json', 'utf8'));
    for (const item of before) {
      const after = JSON.parse(
        makeRequest('groq', 'qwen/qwen3.8-27b', 'fixture', item.request).body,
      );
      expect({ ...after, reasoning_effort: item.body.reasoning_effort }).toEqual(item.body);
    }
    for (const model of ['openai/gpt-oss-20b', 'openai/gpt-oss-120b']) {
      expect(JSON.parse(makeRequest('groq', model, 'fixture', base).body).reasoning_effort).toBe(
        'low',
      );
    }
    for (const provider of ['openai', 'anthropic', 'groq'] as const)
      expect(JSON.parse(makeRequest(provider, 'custom', 'fixture', base).body)).not.toHaveProperty(
        'reasoning_effort',
      );
  });
  it.each(reasoningCases)(
    'sends the same reasoning policy through VS Code and IntelliJ for $id',
    async ({ request, expectedOutput }) => {
      const answer = {
        summary: 'Print the value from the selected code.',
        steps: [{ explanation: 'Read the value and print it.', printed: expectedOutput }],
        output: { complete: true, explanation: '' },
        concepts: ['string'],
      };
      const transport = () =>
        vi
          .fn()
          .mockImplementation(
            async () =>
              new Response(
                JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }),
              ),
          );
      const directTransport = transport(),
        bridgeTransport = transport();
      const direct = await generate(
        'groq',
        'qwen/qwen3.8-27b',
        'fixture',
        request,
        undefined,
        directTransport,
      );
      const core = new BridgeCore(bridgeTransport);
      const input = { provider: 'groq', model: 'qwen/qwen3.8-27b', key: 'fixture', request };
      const bridge = (await core.dispatch(1, 'request', input)) as any;
      expect(bridge.lesson).toEqual(direct);
      if (literalLesson(request) || javaTraceLesson(request)) {
        expect(direct.output?.text).toBe(expectedOutput);
        expect(direct.local).toBe(true);
        expect(direct.usage?.total).toBe(0);
        expect(directTransport).not.toHaveBeenCalled();
        expect(bridgeTransport).not.toHaveBeenCalled();
        return;
      }
      const bodies = [bridgeTransport, directTransport].map((transport) => {
        const body = JSON.parse(transport.mock.calls[0][1].body);
        body.messages[1].content = JSON.parse(body.messages[1].content);
        return body;
      });
      expect(bodies[0]).toEqual(bodies[1]);
      expect(await core.dispatch(2, 'request', input)).toMatchObject({ cached: true });
      expect(bridgeTransport).toHaveBeenCalledTimes(1);
    },
  );
  it('keeps local arithmetic free in both editors', async () => {
    const request: LearningRequest = { ...base, code: 'const total=2+3;' };
    const transport = vi.fn();
    expect(
      (await generate('groq', 'qwen/qwen3.8-27b', 'fixture', request, undefined, transport)).usage
        ?.total,
    ).toBe(0);
    const reply = (await new BridgeCore(transport).dispatch(1, 'request', {
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      key: 'fixture',
      request,
    })) as any;
    expect(reply.lesson.usage.total).toBe(0);
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([
    ['TypeScript', 'const flag = true; console.log(flag); console.log(null);', 'true\nnull\n'],
    ['Python', 'flag = False\nprint(flag)\nprint(None)', 'False\nNone\n'],
    ['TypeScript', 'const a = 12; const b = a + 5; console.log(b);', '17\n'],
    ['Python', 'a = 12\nb = a + 5\nprint(b)', '17\n'],
    ['Java', 'System.out.println("A\\tB\\nC");', 'A\tB\nC\n'],
    ['Python', "word = 'it\\'s'\nprint(word)", "it's\n"],
  ])('derives exact %s primitive output without executing code', (language, code, expected) => {
    expect(literalLesson({ ...base, language, code })?.output?.text).toBe(expected);
  });
  it('handles renamed variables, Unicode and escapes without fixture-specific answers', () => {
    const values = [
      'Ada',
      'Lin',
      'Zoë',
      '你好',
      '🙂',
      'a"b',
      "it's",
      'a\\b',
      'line\nnext',
      'tab\there',
    ];
    for (let i = 0; i < values.length; i++) {
      const name = 'person' + i,
        value = values[i],
        quoted = JSON.stringify(value);
      for (const [language, code] of [
        ['TypeScript', `const ${name}=${quoted}; console.log("Hi " + ${name});`],
        ['Python', `${name}=${quoted}\nprint("Hi " + ${name})`],
        ['Java', `System.out.println(${JSON.stringify('Hi ' + value)});`],
      ]) {
        const lesson = literalLesson({ ...base, language, code });
        expect(lesson?.output?.text).toBe('Hi ' + value + '\n');
        expect(lesson?.steps.length).toBeGreaterThan(0);
        expect(lesson?.concepts.every((c) => c.explanation)).toBe(true);
        expect(lesson?.notice).toContain('No code was run');
      }
    }
  });
  it('rejects unsupported escapes, output formatting, invalid bindings, and expansion limits', () => {
    for (const [language, code] of [
      ['Python', 'print("\\N{LATIN CAPITAL LETTER A}")'],
      ['Python', 'print("\\x41")'],
      ['Python', '__debug__ = False\nprint(__debug__)'],
      ['TypeScript', 'const eval = "hello"; console.log(eval);'],
      ['TypeScript', 'console.log("%s")'],
      ['TypeScript', 'console.log("\\ud800")'],
      [
        'TypeScript',
        'const a="' + 'x'.repeat(700) + '"; const b=a+a; const c=b+b; console.log(c);',
      ],
      [
        'TypeScript',
        'const a="' +
          'x'.repeat(100) +
          '"; const b=a+a+a+a; const c=b+b+b+b;' +
          'console.log(c);'.repeat(6),
      ],
    ])
      expect(literalLesson({ ...base, language, code })).toBeUndefined();
  });
  it('keeps terms, origins, print order and a single const rule in the compact local walkthrough', () => {
    const lesson = literalLesson({
      ...base,
      code: 'const first="Ada"; const last="Lovelace"; console.log(first); console.log(last);',
    })!;
    expect(lesson.output?.text).toBe('Ada\nLovelace\n');
    expect(lesson.steps.join(' ').match(/const prevents/g)).toHaveLength(1);
    expect(lesson.steps[0]).toContain('first');
    expect(lesson.steps[1]).toContain('last');
    expect(lesson.note).toContain('JavaScript runtime');
    expect(lesson.concepts.map((c) => c.term)).toContain('const');
  });
});
