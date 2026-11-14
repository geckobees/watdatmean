import { expect, it } from 'vitest';
import { Cache, fingerprint } from '../src/cache';

it('reuses equivalent inputs and invalidates relevant changes', () => {
  const input = {
    code: 'const x = 1',
    context: 'caller(1)',
    provider: 'groq',
    model: 'a',
    audience: 'beginner',
    mode: 'project',
    task: 'explain',
  };
  const cache = new Cache<string>();
  cache.set(fingerprint(input), 'explanation');
  expect(cache.get(fingerprint({ ...input }))).toBe('explanation');
  for (const key of Object.keys(input))
    expect(cache.get(fingerprint({ ...input, [key]: 'changed' }))).toBeUndefined();
});
it('evicts least recently used entries and clears memory', () => {
  const cache = new Cache<number>(2);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.get('a');
  cache.set('c', 3);
  expect(cache.get('b')).toBeUndefined();
  expect(cache.get('a')).toBe(1);
  cache.clear();
  expect(cache.get('a')).toBeUndefined();
});
