import { describe, expect, it } from 'vitest';
import { inspectCode, checkSyntax, learningContext, languageLabel } from '../src/languages';
const pythonPart = (source: string, token: string) => {
  const start = source.lastIndexOf(token);
  return inspectCode(source, start, start + token.length, 'python').parts.find(
    (p) => p.token === token,
  )!;
};
describe('language-aware learning, easy through difficult cases', () => {
  it.each(['typescript', 'javascript', 'typescriptreact', 'javascriptreact'])(
    'inspects %s using its parser',
    (language) => {
      const code = language.endsWith('react')
        ? 'const view = <button>Hi</button>;'
        : 'const score = 3;';
      expect(inspectCode(code, 7, 7, language).parts.length).toBeGreaterThan(0);
      expect(checkSyntax(code, language)).toEqual({ errors: [], checked: true });
      expect(checkSyntax('const score = ;', language).errors.length).toBeGreaterThan(0);
    },
  );
  it.each(['java', 'kotlin', 'csharp', 'cpp', 'go', 'rust', 'ruby', 'sql', 'plaintext'])(
    'preserves exact %s code without pretending it was TypeScript',
    (language) => {
      const code = 'first line\n  selected code\nlast line';
      expect(inspectCode(code, 13, 21, language).code).toBe(code.slice(13, 21));
      expect(inspectCode(code, 13, 13, language).code).toBe('  selected code');
      expect(checkSyntax(code, language).checked).toBe(false);
      expect(languageLabel(language)).not.toBe('TypeScript');
    },
  );
  it('explains Python assignments and real module aliases without promising installed libraries', () => {
    expect(pythonPart('price = 3\ntotal = price * 2\nprint(total)', 'total').detail).toContain(
      'total = price * 2',
    );
    const part = pythonPart('import math as m\nprint(m.sqrt(9))', 'm');
    expect(part.detail).toContain('imported math with the nickname m');
    expect(part.detail).toContain('not been verified');
    expect(pythonPart('from pathlib import Path as P\nprint(P("data.txt"))', 'P').detail).toContain(
      'Path from pathlib',
    );
  });
  it('does not confuse a shadowing Python parameter, later local, or sibling scope', () => {
    expect(pythonPart('value = 1\ndef f(value):\n return value', 'value').detail).toContain(
      'parameter',
    );
  });
  it('keeps Python scopes separate', () => {
    const later = 'value = 1\ndef f():\n print(value)\n value = 2';
    const offset = later.indexOf('value)');
    expect(inspectCode(later, offset, offset + 5, 'python').parts[0].detail).toContain(
      'UnboundLocalError',
    );
    expect(
      pythonPart('def a():\n secret = 7\ndef b():\n return secret', 'secret').detail,
    ).toContain('No local declaration');
    expect(
      pythonPart('class C:\n value = 7\n def f(self):\n  return value', 'value').detail,
    ).toContain('No local declaration');
    expect(
      pythonPart('value = 1\ndef f():\n global value\n return value', 'value').detail,
    ).toContain('not established');
  });
  it('handles built-ins, shadows, defaults, lambdas, and uncertain dynamic bindings', () => {
    expect(pythonPart('print(sum([2,3]))', 'sum').detail).toContain('built-in Python');
    expect(pythonPart('def f(sum):\n return sum([2,3])', 'sum').detail).toContain('parameter');
    expect(pythonPart('value=7\nf = lambda value: value', 'value').detail).toContain('parameter');
    const defaults = 'value=7\ndef f(value=value):\n return value';
    const at = defaults.indexOf('value)');
    expect(inspectCode(defaults, at, at + 5, 'python').parts[0].detail).toContain('value=7');
    const expression = 'value=7\ndef f(value=value+1):\n return value';
    const nestedAt = expression.indexOf('value+1');
    expect(inspectCode(expression, nestedAt, nestedAt + 5, 'python').parts[0].detail).toContain(
      'value=7',
    );
    expect(pythonPart('from module import *\nprint(1)', 'print').detail).toContain(
      'not established',
    );
    expect(
      pythonPart('value=7\ndef f():\n if (value := 3):\n  print(value)', 'value').detail,
    ).toContain('not established');
    expect(
      checkSyntax('x=' + '('.repeat(400) + '1' + ')'.repeat(400), 'python').errors.length,
    ).toBeGreaterThan(0);
  });
  it('keeps quoted hostile content as text and does not index comments as assignments', () => {
    const code = '# password = 7\ntext = "<script>bad()</script>"\nprint(password)';
    expect(pythonPart(code, 'password').detail).toContain('No local declaration');
    expect(
      inspectCode(code, code.indexOf('text'), code.indexOf('\nprint'), 'python').parts.some((p) =>
        p.token.includes('<script>'),
      ),
    ).toBe(true);
  });
  it.each(['x =', 'def f(:\n pass', 'value = (', 'if True\n print(1)'])(
    'rejects malformed Python %s without running it',
    (code) => {
      expect(checkSyntax(code, 'python').errors.length).toBeGreaterThan(0);
      expect(() => inspectCode(code, 0, 0, 'python')).not.toThrow();
    },
  );
  it.each(['', '# just a comment', 'π = 3\nprint(π)', 's = "😀"\nprint(s)', 'x = 1\r\nprint(x)'])(
    'handles empty, Unicode, and line endings: %s',
    (code) => {
      const snippet = inspectCode(code, 0, code.length, 'python');
      expect(snippet.code).toBe(code);
      expect(snippet.parts.every((p) => p.start! >= 0 && p.end! <= code.length)).toBe(true);
    },
  );
  it('reports written imports as bounded context, never an installed package version', () => {
    const source = 'import { map as transform } from "some-library";\ntransform(items);';
    const snippet = inspectCode(source, source.indexOf('transform(items)'));
    expect(snippet.parts.find((p) => p.token === 'transform')?.detail).toContain('some-library');
    expect(learningContext(source, 'typescript', snippet)).toContain('Written import:');
    expect(
      learningContext('import x\n'.repeat(500), 'python', { ...snippet, parts: [] }).length,
    ).toBeLessThanOrEqual(2500);
  });
  it('bounds source size and validates selection offsets', () => {
    expect(() => inspectCode('x'.repeat(500001), 0)).toThrow('500,000');
    expect(() => inspectCode('abc', 4)).toThrow('range');
    expect(() => inspectCode('abc', -1)).toThrow('range');
    expect(() => inspectCode('abc', 0, NaN)).toThrow('range');
    expect(checkSyntax('x'.repeat(512001), 'python').checked).toBe(false);
  });
});
