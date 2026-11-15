import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { definition, reviewLesson, teachingNotes } from '../src/teaching';
import { generate, makeRequest } from '../src/provider';
import { checkSyntax } from '../src/languages';
import type { LearningRequest, Lesson } from '../src/types';
import { learningCases } from './quality/cases';

const saved = JSON.parse(readFileSync('tests/quality/groq-2026-11-14.json', 'utf8')).results as {
  id: string;
  request: LearningRequest;
  lesson?: Lesson;
}[];
const blank = (summary: string): Lesson => ({
  title: 'Explanation',
  summary,
  steps: [],
  concepts: [],
  example: { code: '', explanation: '' },
  checks: [],
  predictions: [],
});
const request = (
  code: string,
  language = 'Python',
  task: LearningRequest['task'] = 'walkthrough',
): LearningRequest => ({ code, language, task, mode: 'standalone', audience: 'beginner' });
const observed = (id: string) => {
  const item = saved.find((x) => x.id === id && x.lesson)!;
  return reviewLesson(item.request, item.lesson!);
};

describe('recorded Groq teaching failures', () => {
  it.each(saved.filter((x) => x.lesson).map((x) => [x.id, x] as const))(
    'replays %s without retaining unverified quiz answers or worked outputs',
    (id, item) => {
      const result = reviewLesson(item.request, item.lesson!);
      if (item.request.task === 'walkthrough') {
        const notes = teachingNotes(item.request);
        expect(result.checks).toEqual(notes.practice ? [notes.practice.question] : []);
        expect(result.example.code).toBe(notes.practice?.code ?? '');
        expect(result.summary).toBeTruthy();
        expect(result.steps.length).toBeLessThanOrEqual(20);
      }
      expect(JSON.stringify(result)).not.toMatch(
        /Invalid reasoning|I will guess|ellipsis.*keyword/i,
      );
    },
  );
  it('corrects the C# comparison boundary, not just the wording', () => {
    const result = observed('csharp-linq');
    expect(result.checks[0]).toContain('Only 5 >= 5');
    expect(result.example.explanation).toContain('prints 8');
    expect(result.checks.join(' ')).not.toContain('contains 5 and 8');
  });
  it('keeps async promises distinct from their values', () => {
    const result = observed('js-async');
    expect(result.steps.join(' ')).toContain('returns a Promise');
    expect(result.checks[0]).toContain('Promise that resolves to 6');
    expect(result.steps.join(' ')).not.toContain('result is now that string');
  });
  it('corrects HTTP/JSON, shadowing, Java library types, and numeric examples', () => {
    expect(JSON.stringify(observed('python-web-app'))).not.toContain('non-200');
    expect(observed('python-web-app').steps.join(' ')).toContain('400–599');
    expect(observed('shadowed-library').summary).toContain('inside the function');
    expect(observed('java-list').steps.join(' ')).not.toContain('built-in list for numbers');
    expect(observed('python-library').example.code).toContain('round(length, 2)');
    expect(observed('python-easy-short').summary).toContain('total becomes 9');
    expect(observed('ts-local-module-short').summary).toContain('unknown');
    expect(observed('rust-ownership').steps.join(' ')).toContain('last use');
  });
  it('does not invent operations for incomplete Python or obey hostile comments', () => {
    const incomplete = observed('python-incomplete');
    expect(incomplete.summary).toContain('incomplete');
    expect(JSON.stringify(incomplete)).not.toMatch(/assertion|ellipsis/);
    const hostile = observed('hostile-comment');
    expect(hostile.summary).toContain('count becomes 5');
    expect(JSON.stringify(hostile)).not.toMatch(/BANANA|numpy|const/);
  });
});

describe('source-based teaching boundaries', () => {
  it.each([
    ['const points = 4 * (2 + 1);', 'TypeScript', 'points', 12],
    ['value = -7 // 2', 'Python', 'value', -4],
    ['prices = [4, 5]\ntotal = sum(prices)\nprint(total)', 'Python', 'total', 9],
    ['value = 3\nvalue = value * 2', 'Python', 'value', 6],
  ])('calculates only literal arithmetic: %s', (code, language, name, value) => {
    expect(teachingNotes(request(String(code), String(language))).trace).toContainEqual({
      name,
      value,
    });
  });
  it.each([
    'x = dangerous()',
    'x = 1\nx = change()',
    'sum = custom\ntotal = sum([1,2])',
    'x = 1 / 0',
    'x = 1.0 // 0.1',
    'x = 1000000000 * 1000000000',
    'if flag:\n x = 3',
    'x=1\nprint(dangerous())',
    'print=custom\nx=1\nprint(x)',
  ])('does not execute or guess %s', (code) =>
    expect(teachingNotes(request(code)).trace).toEqual([]),
  );
  it('does not mistake comments, strings, a variable named async, or a mutable borrow for semantic facts', () => {
    expect(
      teachingNotes(
        request('# import requests\ntext = "response.raise_for_status(); response.json()"'),
      ).topics.has('requests'),
    ).toBe(false);
    expect(teachingNotes(request('const async = 3;', 'JavaScript')).topics.has('async')).toBe(
      false,
    );
    expect(
      teachingNotes(request('async function* items() { yield 1; }', 'JavaScript')).topics.has(
        'async',
      ),
    ).toBe(false);
    expect(teachingNotes(request('let borrowed = &mut name;', 'Rust')).topics.has('rust')).toBe(
      false,
    );
  });
  it.each(['let value = ++1;', 'var value = 010;'])(
    'does not read JavaScript update operators or legacy octal as decimal arithmetic: %s',
    (code) => expect(teachingNotes(request(code, 'JavaScript')).trace).toEqual([]),
  );
  it('defines const accurately and keeps it out of Python lessons', () => {
    expect(definition('const', 'typescript')).toContain('can still change');
    expect(definition('const', 'python')).toBeUndefined();
    expect(
      reviewLesson(
        request('const items = [1, 2];', 'TypeScript'),
        blank('const freezes the array so its contents never change.'),
      ).summary,
    ).not.toContain('freezes');
  });
  it('does not mark a valid selected class member as unfinished code', () => {
    expect(teachingNotes(request('private score: number = 3;', 'TypeScript')).incomplete).toBe(
      false,
    );
    expect(teachingNotes(request('return value;', 'TypeScript')).incomplete).toBe(false);
    expect(teachingNotes(request('return value', 'Python')).incomplete).toBe(false);
    expect(teachingNotes(request('value = 02', 'Python')).incomplete).toBe(true);
    expect(teachingNotes(request('if True:\n    x=1\n  y=2', 'Python')).incomplete).toBe(true);
  });
  it('distinguishes visible helpers and standard globals from unresolved imported helpers', () => {
    expect(
      teachingNotes(
        request('function double(x) { return x*2; }\nconst value=double(3);', 'JavaScript'),
      ).unknownCall,
    ).toBe(false);
    expect(teachingNotes(request('console.log(3);', 'JavaScript')).unknownCall).toBe(false);
    expect(
      teachingNotes(request('import {double} from "./score"; double(3);', 'TypeScript'))
        .unknownCall,
    ).toBe(true);
    const project = {
      ...request('import {double} from "./score"; double(3);', 'TypeScript'),
      mode: 'project' as const,
      evidence: [
        {
          id: 'E1',
          file: 'score.ts',
          line: 1,
          kind: 'definition' as const,
          test: false,
          code: 'export function other(x) { return x; }',
        },
      ],
    };
    expect(teachingNotes(project).unknownCall).toBe(true);
    project.evidence[0].code = 'export function double(x) { return x * 2; }';
    expect(teachingNotes(project).unknownCall).toBe(false);
  });
  it('calculates a standard-math example only with an explicit assumption and does not follow shadowed aliases', () => {
    const req = request('import math as m\nside=3\ndiagonal=m.sqrt(side*side+side*side)');
    expect(reviewLesson(req, blank('A diagonal.')).summary).toContain('about 4.24264');
    expect(reviewLesson(req, blank('A diagonal.')).summary).toContain('assumes the standard math');
    expect(teachingNotes(request('import math as m\nm = custom\nvalue=m.sqrt(9)')).trace).toEqual(
      [],
    );
    expect(teachingNotes(request('value=m.sqrt(9)\nimport math as m')).trace).toEqual([]);
  });
  it('does not turn arbitrary generated quiz answers into trusted material', () => {
    const result = reviewLesson(request('SELECT mystery(value) FROM data', 'SQL'), {
      ...blank('Calls a database function.'),
      checks: ['Answer: definitely 99.'],
      example: { code: 'DROP TABLE data;', explanation: 'Prints 99.' },
    });
    expect(result.checks).toEqual([]);
    expect(result.example.code).toBe('');
  });
  it.each(
    learningCases.filter((x) =>
      ['Python', 'TypeScript', 'JavaScript'].includes(x.request.language!),
    ),
  )('supplies syntactically valid separate practice for $id', (item) => {
    const practice = teachingNotes(item.request).practice;
    if (practice)
      expect(checkSyntax(practice.code, item.request.language!.toLowerCase()).errors).toEqual([]);
  });
  it('bounds facts sent to the model without clipping the selected source', () => {
    const req = request('const value = 3;\n'.repeat(300), 'TypeScript');
    const body = JSON.parse(makeRequest('groq', 'qwen/qwen3.8-27b', 'key', req).body);
    const sent = JSON.parse(body.messages[1].content);
    expect(sent.code).toBe(req.code);
    expect(sent.codeFacts?.length ?? 0).toBeLessThanOrEqual(1000);
    expect(body.max_completion_tokens).toBe(3648);
    expect(body.response_format.json_schema.schema.required).toEqual([
      'summary',
      'steps',
      'note',
      'concepts',
      'output',
    ]);
  });
  it('uses zero tokens and zero network calls for incomplete selections and reviewed examples', async () => {
    const transport = vi.fn();
    for (const req of [
      request('def total(prices):\n return sum('),
      request('values=[2,3]\nprint(sum(values))', 'Python', 'example'),
      request('const price=3; const total=price*4;', 'TypeScript', 'explain'),
      request('prices=[2,3,4]\ntotal=sum(prices)\nprint(total)', 'Python', 'explain'),
    ]) {
      const result = await generate('groq', 'qwen/qwen3.8-27b', 'key', req, undefined, transport);
      expect(result.local).toBe(true);
      expect(result.usage?.total).toBe(0);
    }
    expect(transport).not.toHaveBeenCalled();
  });
  it('keeps real usage when an incorrect AI answer is replaced, without a second call', async () => {
    const transport = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            { message: { content: JSON.stringify(blank('I will guess the result is 3.')) } },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
        }),
      ),
    );
    const result = await generate(
      'groq',
      'qwen/qwen3.8-27b',
      'key',
      request('const points = score(3);', 'TypeScript'),
      undefined,
      transport,
    );
    expect(result.notice).toContain('did not match');
    expect(result.usage?.total).toBe(140);
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
