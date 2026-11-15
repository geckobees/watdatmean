import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { generate, makeRequest, parseLesson } from '../src/provider';
import { definition, reviewLesson, teachingNotes } from '../src/teaching';
import { BridgeCore } from '../src/bridge/core';
import { depthCases, wombLesson, wombOutput, wombRequest } from './quality/depth-cases';

const transportFor = (lesson: unknown) =>
  vi.fn().mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(lesson) } }],
          usage: { prompt_tokens: 800, completion_tokens: 1300, total_tokens: 2100 },
        }),
      ),
  );

describe('complete plain-language teaching', () => {
  it('resolves the constructor definition without inheriting object prototype properties', () => {
    expect(definition('constructor', 'java')).toContain('Setup code');
    expect(definition('__proto__', 'java')).toBeUndefined();
    expect(definition('toString', 'java')).toBeUndefined();
  });
  const live = JSON.parse(readFileSync('tests/quality/groq-depth-2026-11-14.json', 'utf8')).results;
  it.each(['java-construction-explain', 'java-construction-walkthrough'])(
    'retains the correct observed Groq trace and assembled output for %s',
    (id) => {
      const item = live.find((r: any) => r.id === id && r.raw);
      const result = reviewLesson(item.request, parseLesson(item.raw));
      expect(result.output?.text).toBe(wombOutput);
      expect(result.steps.length).toBeGreaterThanOrEqual(9);
      expect(teachingNotes(item.request).connections.join(' ')).toContain('static nested class');
      expect(teachingNotes(item.request).connections.join(' ')).toContain('B extends A');
      expect(result.local).not.toBe(true);
    },
  );
  it('retains the saved real Python closure trace after fixing uncertain local scope handling', () => {
    const earlier = JSON.parse(
      readFileSync('tests/quality/groq-depth-earlier-2026-11-14.json', 'utf8'),
    ).results;
    const item = earlier.find((r: any) => r.id === 'python-closure-depth');
    const result = reviewLesson(item.request, parseLesson(item.raw));
    expect(result.steps).toHaveLength(14);
    expect(result.output?.text.trim()).toBe('[2, 2, 2]\n[0, 1, 2]');
    expect(result.local).not.toBe(true);
  });
  it('keeps a complete Python closure explanation when calls use locally bound comprehension names', () => {
    const request = depthCases.find((c) => c.id === 'python-closure-depth')!.request;
    expect(teachingNotes(request).unknownCall).toBe(false);
    const steps = [
      'Create functions sharing the loop variable.',
      'Store separate default argument values.',
      'Call each function after the loop finishes.',
    ];
    const result = reviewLesson(request, {
      ...wombLesson,
      summary: 'Compare shared names with stored defaults.',
      steps,
      concepts: [],
      connections: [],
      pitfalls: [],
      output: {
        text: '[2, 2, 2]\n[0, 1, 2]\n',
        explanation: 'The first group reads the final n; the second uses separate defaults.',
      },
    });
    expect(result.steps).toEqual(steps);
    expect(result.local).not.toBe(true);
    expect(teachingNotes({ ...request, code: 'print(missing_helper())' }).unknownCall).toBe(true);
  });
  it('assembles output from the same print events as the trace, preserving spaces and newlines', () => {
    const result = parseLesson(
      JSON.stringify({
        summary: 'Build and display one object.',
        steps: [
          { explanation: 'Call the override during superclass construction.', printed: 'null0A1 ' },
          { explanation: 'Add ten to the superclass field.', printed: null },
          { explanation: 'Initialize and display the subclass fields.', printed: 'B6A11 ' },
          { explanation: 'Display the completed object.', printed: 'B106A11 ' },
          { explanation: 'Print fields and static call results.', printed: 'A11B106aa\n' },
        ],
        output: {
          complete: true,
          explanation: 'Three print calls followed by one println.',
          text: 'A conflicting independent guess is ignored.',
        },
      }),
    );
    expect(result.output?.text).toBe(wombOutput);
    expect(result.stepOutput?.[1]).toBeNull();
    expect(result.stepOutput?.[4]).toBe('A11B106aa\n');
  });
  it('does not present a partial or malformed trace as complete output', () => {
    const partial = {
      summary: 'Depends on input.',
      steps: [{ explanation: 'Print the first value.', printed: 'start\n' }],
      output: { complete: false, explanation: 'The later input is unknown.' },
    };
    expect(parseLesson(JSON.stringify(partial)).output?.text).toBe('');
    expect(() => parseLesson(JSON.stringify({ ...partial, output: { complete: 'yes' } }))).toThrow(
      'output.complete',
    );
    expect(() =>
      parseLesson(
        JSON.stringify({
          ...partial,
          steps: [{ explanation: 'Print.', printed: 'x'.repeat(8001) }],
        }),
      ),
    ).toThrow('steps[].printed');
    expect(() =>
      parseLesson(JSON.stringify({ ...partial, steps: Array(41).fill(partial.steps[0]) })),
    ).toThrow('steps');
  });
  it.each(['explain', 'walkthrough'] as const)(
    'preserves a model trace for an explicitly contextual Java %s outside the local grammar',
    async (task) => {
      const transport = transportFor({
        ...wombLesson,
        concepts: [
          ...wombLesson.concepts.filter((c) => c.term !== 'polymorphism'),
          {
            term: 'polymorphism',
            explanation: 'The type of the variable decides which method runs.',
          },
        ],
      });
      const result = await generate(
        'groq',
        'qwen/qwen3.8-27b',
        'key',
        {
          ...wombRequest,
          task,
          learningContext: 'Explain how to use this in a larger application.',
        },
        undefined,
        transport,
      );
      expect(result.steps).toEqual(wombLesson.steps);
      expect(result.connections).toEqual(expect.arrayContaining(wombLesson.connections!));
      const sent = JSON.parse(makeRequest('groq', 'qwen/qwen3.8-27b', 'key', wombRequest).body);
      expect(JSON.parse(sent.messages[1].content).codeFacts).toContain('B extends A');
      expect(JSON.parse(sent.messages[1].content).codeFacts).toContain('java.io.PrintStream');
      expect(result.output?.text).toBe(wombOutput);
      expect(result.pitfalls).toEqual(wombLesson.pitfalls);
      expect(result.concepts.find((c) => c.term === 'polymorphism')?.explanation).toContain(
        'runtime',
      );
      expect(result.local).not.toBe(true);
      expect(result.usage?.total).toBe(2100);
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it('preserves full trace, connections, and exact whitespace through the IntelliJ bridge and cache', async () => {
    const transport = transportFor(wombLesson);
    const core = new BridgeCore(transport);
    const input = {
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      key: 'test-key',
      request: {
        ...wombRequest,
        task: 'walkthrough',
        mode: 'project',
        context: '',
        evidence: [],
        learningContext: 'Explain how to use this in a larger application.',
      },
    };
    const first = (await core.dispatch(1, 'request', input)) as any;
    const second = (await core.dispatch(2, 'request', input)) as any;
    expect(first.lesson.steps).toEqual(wombLesson.steps);
    expect(first.lesson.connections).toEqual(expect.arrayContaining(wombLesson.connections!));
    expect(first.lesson.output.text).toBe(wombOutput);
    expect(second.cached).toBe(true);
    expect(second.lesson).toEqual(first.lesson);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('supplements a detailed Python walkthrough without replacing its execution order', () => {
    const steps = [
      'Create a list of prices.',
      'Call sum with that list.',
      'Store the returned total.',
      'Display the total after the call returns.',
      'In a receipt app this supplies the total before tax.',
    ];
    const result = reviewLesson(
      {
        ...wombRequest,
        language: 'Python',
        task: 'walkthrough',
        code: 'prices=[2,3]\ntotal=sum(prices)\nprint(total)',
      },
      {
        ...wombLesson,
        summary: 'Add the prices for a receipt.',
        steps,
        output: { text: '5\n', explanation: '2 + 3 is 5.' },
      },
    );
    expect(result.steps).toEqual(steps);
    expect(result.output?.text).toBe('5\n');
    expect(result.checks[0]).toContain('Answer:');
  });
  it('allows deeper arithmetic and concept requests to reach AI instead of repeating a local summary', async () => {
    const transport = transportFor({
      summary: 'The object is B, so the instance call uses B.show.',
      steps: [
        'A calls the override before the B initializers run.',
        'Static who uses the declared A type instead.',
      ],
    });
    const conceptRequest = { ...wombRequest, task: 'concept' as const, concept: 'constructor' };
    const result = await generate(
      'groq',
      'qwen/qwen3.8-27b',
      'key',
      conceptRequest,
      undefined,
      transport,
    );
    expect(result.steps).toHaveLength(2);
    expect(
      JSON.parse(makeRequest('groq', 'qwen/qwen3.8-27b', 'key', conceptRequest).body).messages[1]
        .content,
    ).toContain('Setup code for a new object');
    await generate(
      'groq',
      'qwen/qwen3.8-27b',
      'key',
      {
        ...wombRequest,
        language: 'TypeScript',
        task: 'walkthrough',
        code: 'const x=2; const y=x*3;',
      },
      undefined,
      transport,
    );
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it('gives a full reviewed Java dispatch expansion using the actual declarations at zero API cost', async () => {
    const transport = vi.fn();
    for (const code of [
      wombRequest.code,
      wombRequest.code
        .replace(/\bA\b/g, 'Parent')
        .replace(/\bB\b/g, 'Child')
        .replace(/\bx\b/g, 'item'),
    ]) {
      const result = await generate(
        'groq',
        'qwen/qwen3.8-27b',
        'key',
        { ...wombRequest, code, task: 'concept', concept: 'polymorphism' },
        undefined,
        transport,
      );
      expect(result.steps).toHaveLength(3);
      expect(result.steps.join(' ')).toContain('before the subclass');
      expect(result.note).toContain('does not cause runtime dispatch');
      expect(result.note).toContain('Constructors themselves are not overridden');
      expect(result.summary).toContain(
        code.includes('Parent') ? 'item is declared as Parent' : 'x is declared as A',
      );
      expect(result.usage?.total).toBe(0);
      expect(result.local).toBe(true);
    }
    expect(transport).not.toHaveBeenCalled();
  });
  it('requests one compact walkthrough without sample-specific answers or guessed defaults', () => {
    const body = JSON.parse(makeRequest('groq', 'qwen/qwen3.8-27b', 'key', wombRequest).body);
    const prompt = body.messages[0].content;
    expect(prompt).toContain('ONE compact walkthrough');
    expect(prompt).toContain('field initializers and instance initializer blocks');
    expect(prompt).toContain('mean unknown, NOT zero/null, default values');
    expect(prompt).not.toMatch(
      /Under 110 words|under 60 words|up to 3 short steps|null0A1|A11B106aa|Womb/,
    );
    expect(JSON.parse(body.messages[1].content).code).toBe(wombRequest.code);
  });
  it('does not discard a valid trace merely because a step ends with a one-letter class name', () => {
    const result = reviewLesson(wombRequest, {
      ...wombLesson,
      steps: ['The superclass is A', ...wombLesson.steps],
    });
    expect(result.steps).toHaveLength(12);
    expect(result.local).not.toBe(true);
  });
  it.each(['connections', 'pitfalls', 'note', 'output'] as const)(
    'validates the added %s field without exposing content',
    (field) => {
      expect(() => parseLesson(JSON.stringify({ summary: 'Explain it.', [field]: 7 }))).toThrow(
        field,
      );
    },
  );
});
