import { describe, expect, it, vi } from 'vitest';
import { generate, parseLesson } from '../src/provider';
import { objectCreationLesson } from './fixtures/object-creation';

describe('resilient clickable definitions', () => {
  it.each([[], undefined, null])('restores common definitions when concepts is %j', (concepts) => {
    const result = parseLesson(JSON.stringify({ ...objectCreationLesson, concepts }));
    expect(result.concepts.map((concept) => concept.term)).toEqual([
      'new',
      'object',
      'class',
      'variable',
      'function',
      'type',
      'compiler',
    ]);
    expect(result.concepts.every((concept) => concept.explanation.trim())).toBe(true);
    expect({ ...result, concepts: [] }).toEqual(objectCreationLesson);
  });

  it('prefers valid model definitions, normalizes quoted terms, and fills missing ones', () => {
    const result = parseLesson(
      JSON.stringify({
        ...objectCreationLesson,
        concepts: [
          { term: '  `new`  ', explanation: '  Creates and initializes this Scoreboard.  ' },
          { term: 'NEW', explanation: 'Duplicate definition.' },
          { term: '"class"', explanation: 'Defines how Scoreboard instances work.' },
          { term: 'object', explanation: ' ' },
          { term: ' ', explanation: 'Invalid term.' },
          { term: 'Scoreboard', explanation: 'The class named in this code.' },
        ],
      }),
    );
    expect(result.concepts.filter((concept) => concept.term.toLowerCase() === 'new')).toEqual([
      { term: 'new', explanation: 'Creates and initializes this Scoreboard.' },
    ]);
    expect(result.concepts).toContainEqual({
      term: 'class',
      explanation: 'Defines how Scoreboard instances work.',
    });
    expect(result.concepts).toContainEqual({
      term: 'Scoreboard',
      explanation: 'The class named in this code.',
    });
    expect(result.concepts.find((concept) => concept.term === 'object')?.explanation).toContain(
      'named properties',
    );
    expect(
      result.concepts.some((concept) => !concept.term.trim() || !concept.explanation.trim()),
    ).toBe(false);
  });

  it('matches whole terms rather than substrings of ordinary words or identifiers', () => {
    const result = parseLesson(
      JSON.stringify({
        ...objectCreationLesson,
        summary:
          'Newspaper objectives classify variables. $new, new_value, object2 and λclass are names.',
        steps: [],
        example: { code: 'const x = 1;', explanation: '' },
      }),
    );
    expect(result.concepts).toEqual([]);
  });

  it('repairs the provider response locally without another request or changing usage', async () => {
    const transport = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(objectCreationLesson) } }],
          usage: { prompt_tokens: 400, completion_tokens: 200, total_tokens: 600 },
        }),
      ),
    );
    const result = await generate(
      'groq',
      'test',
      'key',
      {
        task: 'explain',
        audience: 'beginner',
        mode: 'standalone',
        code: 'const board = new Scoreboard();',
      },
      undefined,
      transport,
    );
    expect(result.lesson.concepts.find((concept) => concept.term === 'new')?.explanation).toContain(
      'constructor',
    );
    expect(result.usage).toEqual({ inputTokens: 400, outputTokens: 200, totalTokens: 600 });
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
