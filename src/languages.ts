import { inspect, parse, syntaxErrors } from './analyzer';
import { inspectPython, pythonErrors } from './python';
import ts from 'typescript';
import type { Snippet } from './types';

const labels: Record<string, string> = {
  typescript: 'TypeScript',
  typescriptreact: 'TypeScript JSX',
  javascript: 'JavaScript',
  javascriptreact: 'JavaScript JSX',
  python: 'Python',
  java: 'Java',
  kotlin: 'Kotlin',
  csharp: 'C#',
  cpp: 'C++',
  c: 'C',
  go: 'Go',
  rust: 'Rust',
  ruby: 'Ruby',
  php: 'PHP',
  swift: 'Swift',
  sql: 'SQL',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  plaintext: 'Unknown (infer cautiously)',
};
export const languageLabel = (language: string) => labels[language] ?? language.slice(0, 100);
export const localLanguage = (language: string) =>
  ['typescript', 'typescriptreact', 'javascript', 'javascriptreact', 'python'].includes(language);
export function languageId(language: string) {
  return (
    Object.keys(labels).find((key) => labels[key].toLowerCase() === language.toLowerCase()) ??
    language.toLowerCase()
  );
}
function fallback(code: string, offset: number, end: number): Snippet {
  const start = end > offset ? offset : Math.max(0, code.lastIndexOf('\n', offset - 1) + 1);
  const stop =
    end > offset ? end : code.indexOf('\n', offset) < 0 ? code.length : code.indexOf('\n', offset);
  const words = Array.from(code.slice(start, stop).matchAll(/[\p{L}_][\p{L}\p{N}_]*/gu));
  const word = words.find(
    (m) => start + m.index! <= offset && start + m.index! + m[0].length >= offset,
  );
  return {
    code: code.slice(start, stop),
    start,
    end: stop,
    symbol: word?.[0] ?? '',
    symbolOffset: word ? start + word.index! : offset,
    parts: [],
  };
}
export function inspectCode(
  code: string,
  offset: number,
  end = offset,
  language = 'typescript',
): Snippet {
  if (code.length > 500000) throw new Error('Choose a source file under 500,000 characters.');
  if (
    !Number.isInteger(offset) ||
    !Number.isInteger(end) ||
    offset < 0 ||
    end < offset ||
    end > code.length
  )
    throw new Error('Invalid selection range.');
  try {
    if (language === 'python') return inspectPython(code, offset, end);
    if (localLanguage(language)) return inspect(code, offset, end, language);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
  return fallback(code, offset, end);
}
export function checkSyntax(code: string, language: string) {
  if (code.length > 512000)
    return { errors: ['Code is too large for a syntax preview.'], checked: false };
  try {
    if (language === 'python') return { errors: pythonErrors(code), checked: true };
    if (localLanguage(language))
      return { errors: syntaxErrors(code, language).slice(0, 8), checked: true };
  } catch {
    return {
      errors: ['The parser could not check this code. Try a smaller block.'],
      checked: false,
    };
  }
  return { errors: [], checked: false };
}
/** Only add this to an explicit project-context lesson. Module paths are clues, not verified package identities. */
export function learningContext(code: string, language: string, snippet: Snippet) {
  let imports: string[] = [];
  try {
    if (localLanguage(language) && language !== 'python')
      imports = parse(code, language)
        .statements.filter(ts.isImportDeclaration)
        .map((n) => n.getText());
    else if (language === 'python')
      imports = code
        .split(/\r?\n/)
        .filter((line) => /^(?:from\s+[\w.]+\s+import\s|import\s)/u.test(line));
  } catch {
    /* Deep or incomplete code has no reliable import clues. */
  }
  return [
    ...imports.slice(0, 12).map((x) => 'Written import: ' + x.slice(0, 180)),
    ...snippet.parts
      .filter((p) => /[Ll]ine \d|imported|initialized with/.test(p.detail))
      .slice(0, 10)
      .map((p) => p.token + ': ' + p.detail),
  ]
    .join('\n')
    .slice(0, 2500);
}
