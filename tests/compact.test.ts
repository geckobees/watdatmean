import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { generate, makeRequest, parseLesson } from '../src/provider';
import { fragmentLesson, reviewLesson } from '../src/teaching';
import { BridgeCore } from '../src/bridge/core';
import { constructorCode, constructorRequest } from './quality/compact-cases';
import { wombOutput, wombRequest } from './quality/depth-cases';

describe('one compact walkthrough with missing context kept unknown', () => {
  it('preserves the final live five-step Java response and exact output', () => {
    const record = JSON.parse(
      readFileSync('tests/quality/groq-compact-final-2026-11-14.json', 'utf8'),
    ).results[0];
    const result = reviewLesson(record.request, parseLesson(record.raw));
    expect(result.steps).toHaveLength(5);
    expect(result.output?.text).toBe(wombOutput);
    expect(result.connections).toBeUndefined();
    expect(result.pitfalls).toBeUndefined();
  });
  it('withholds the recorded incomplete Java print rather than repairing it with a guess', () => {
    const record = JSON.parse(
      readFileSync('tests/quality/groq-compact-initial-2026-11-14.json', 'utf8'),
    ).results.find((r: any) => r.id === 'java-whole-program-compact');
    const parsed = parseLesson(record.raw);
    expect(parsed.output?.text).toBe('null0A1 B6A11 B106A11 A11B106a');
    const result = reviewLesson(record.request, parsed);
    expect(result.steps).toEqual(parsed.steps);
    expect(result.output?.text).toBe('');
    expect(result.output?.explanation).toContain('incomplete');
    expect(result.stepOutput).toBeUndefined();
  });

  it('does not reject a complete println or a print without a newline', () => {
    for (const [method, printed] of [
      ['println', 'hello\n'],
      ['print', 'hello'],
    ]) {
      const result = reviewLesson(
        { ...constructorRequest, code: `System.out.${method}("hello");` },
        parseLesson(
          JSON.stringify({
            summary: 'Display a greeting.',
            steps: [{ explanation: `Call ${method} to display a greeting.`, printed }],
            output: { complete: true, explanation: '' },
          }),
        ),
      );
      expect(result.output?.text).toBe(printed);
    }
  });

  it('does not repeat local arithmetic results as extra steps', async () => {
    const transport = vi.fn();
    const result = await generate(
      'groq',
      'qwen/qwen3.8-27b',
      'key',
      {
        ...constructorRequest,
        language: 'TypeScript',
        code: 'const price=3; const total=price*4;',
      },
      undefined,
      transport,
    );
    expect(result.summary).toContain('total becomes 12');
    expect(result.steps.join(' ')).not.toContain('total becomes 12');
    expect(transport).not.toHaveBeenCalled();
  });
  it.each(['explain', 'walkthrough'] as const)(
    'explains the selected constructor safely for %s',
    async (task) => {
      const transport = vi.fn();
      const lesson = await generate(
        'groq',
        'qwen/qwen3.8-27b',
        'key',
        { ...constructorRequest, task },
        undefined,
        transport,
      );
      expect(transport).not.toHaveBeenCalled();
      expect(lesson.usage?.total).toBe(0);
      expect(lesson.steps).toHaveLength(3);
      const prose = [lesson.summary, ...lesson.steps, lesson.note, lesson.output?.explanation].join(
        ' ',
      );
      expect(prose.split(/\s+/).length).toBeLessThan(220);
      expect(prose).toContain('After it returns');
      expect(prose).toContain('run before show()');
      expect(prose).toContain('bare names may be inherited');
      expect(prose).toContain('adds 100 to its existing value');
      expect(prose).toContain('field types, initializers and superclass constructor');
      expect(prose).toContain('Missing declarations do not mean zero or null');
      expect(prose).toContain('before it starts joining text');
      expect(lesson.output?.text).toBe('');
      expect(lesson.connections).toBeUndefined();
      expect(lesson.pitfalls).toBeUndefined();
      expect(lesson.checks).toEqual([]);
    },
  );

  it('replaces the user-reported overlong, incorrect response without guessing output', () => {
    const summary = readFileSync('tests/quality/constructor-overlong.txt', 'utf8');
    const lesson = reviewLesson(constructorRequest, {
      ...parseLesson(JSON.stringify({ summary })),
      usage: { input: 200, output: 1000, total: 1200 },
    });
    expect(lesson.summary).not.toBe(summary);
    expect(lesson.steps).toHaveLength(3);
    expect(lesson.output?.text).toBe('');
    expect(lesson.usage?.total).toBe(1200);
    expect(lesson.local).toBe(true);
  });

  it('uses actual identifiers and update amount instead of memorizing the sample', () => {
    const code = constructorCode
      .replace(/\bB\b/g, 'Child')
      .replace(/\bshow\b/g, 'display')
      .replace(/\bn\b/g, 'score')
      .replace(/\bs\b/g, 'label')
      .replace('100', '7');
    const lesson = fragmentLesson({ ...constructorRequest, code })!;
    expect(lesson.summary).toContain('Child');
    expect(lesson.steps.join(' ')).toContain('display()');
    expect(lesson.steps.join(' ')).toContain('adds 7 to its existing value');
    expect(lesson.output?.text).toBe('');
  });

  it.each([
    `/* ${constructorCode} */`,
    JSON.stringify(constructorCode),
    constructorCode.replace('n += 100;', 'n = helper();'),
    constructorCode.replace('n += 100;', 'n += 100; show();'),
    constructorCode.replace('void show()', 'void another()'),
    constructorCode.replace('" "', '"unknown"'),
    constructorCode + '\nint n = 2;',
    wombRequest.code,
  ])('does not apply the narrow guard to other structures: %s', (code) => {
    expect(fragmentLesson({ ...constructorRequest, code })).toBeUndefined();
  });

  it('uses supplied project declarations instead of treating them as missing', async () => {
    const request = { ...constructorRequest, mode: 'project' as const, context: wombRequest.code };
    expect(fragmentLesson(request)).toBeUndefined();
    expect(
      fragmentLesson({
        ...request,
        context: '',
        evidence: [
          {
            id: 'E1',
            file: 'Womb.java',
            line: 1,
            kind: 'definition',
            test: false,
            code: wombRequest.code,
          },
        ],
      }),
    ).toBeUndefined();
    const transport = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: 'Use the supplied field declarations.',
                  steps: [],
                }),
              },
            },
          ],
        }),
      ),
    );
    await generate('groq', 'qwen/qwen3.8-27b', 'key', request, undefined, transport);
    expect(transport).toHaveBeenCalledTimes(1);
    const body = JSON.parse(transport.mock.calls[0][1].body);
    expect(JSON.parse(body.messages[1].content).context).toBe(wombRequest.code);
  });

  it('gives IntelliJ the same compact safe lesson and cache behavior', async () => {
    const transport = vi.fn();
    const core = new BridgeCore(transport);
    const input = {
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      key: 'test',
      request: constructorRequest,
    };
    const first = (await core.dispatch(1, 'request', input)) as any;
    const second = (await core.dispatch(2, 'request', input)) as any;
    expect(first.lesson).toEqual({
      ...fragmentLesson(constructorRequest),
      usage: { input: 0, output: 0, total: 0 },
    });
    expect(second.cached).toBe(true);
    expect(transport).not.toHaveBeenCalled();
  });

  it.each(['Python', 'TypeScript', 'Java', 'C#'])(
    'keeps %s prompts compact and uncertainty explicit',
    (language) => {
      const body = JSON.parse(
        makeRequest('groq', 'qwen/qwen3.8-27b', 'key', {
          ...constructorRequest,
          language,
          code: 'unknown(input)',
        }).body,
      );
      const prompt = body.messages[0].content;
      expect(prompt).toContain('ONE compact walkthrough');
      expect(prompt).toContain(
        'Missing declarations, types, inputs, helpers or library identity mean unknown',
      );
      expect(body.response_format.json_schema.schema.required).not.toContain('connections');
      expect(body.response_format.json_schema.schema.required).not.toContain('pitfalls');
    },
  );
});
