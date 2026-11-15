import ts from 'typescript';
import { parse } from './analyzer';
import { checkSyntax, languageId } from './languages';
import { explainableFragment } from './selection-fragment';
import type { Lesson } from './types';
import { javaSyntaxHelp } from './java-syntax-help';

// A bounded, local punctuation repair. Never invent an expression, identifier or value.
export function syntaxHelp(code: string, label: string): Lesson['syntax'] {
  if (code.length > 50000) return;
  const language = languageId(label);
  if (language === 'java') return javaSyntaxHelp(code);
  if (/^(typescript|javascript)/.test(language)) {
    const diagnostics = (text: string) =>
      (parse(text, language) as ts.SourceFile & { parseDiagnostics: ts.Diagnostic[] })
        .parseDiagnostics;
    const initial = diagnostics(code);
    // Class members are valid selections even though they aren't standalone programs.
    if (
      !initial.length ||
      !diagnostics(`class __Wdm { ${code}\n}`).length ||
      !diagnostics(`function __Wdm() { ${code}\n}`).length
    )
      return;
    const partial = explainableFragment(code, language);
    const issues = initial.slice(0, 4).map((d) => {
      const source = parse(code, language);
      const at = source.getLineAndCharacterOfPosition(d.start ?? 0);
      return `Selection line ${at.line + 1}, column ${at.character + 1}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
    });
    let corrected = code;
    const changes: string[] = [];
    for (let i = 0; i < 4; i++) {
      const errors = diagnostics(corrected);
      if (!errors.length) break;
      const error = errors[0];
      const token = /^'([}\]);,:])' expected\.$/.exec(
        ts.flattenDiagnosticMessageText(error.messageText, ' '),
      )?.[1];
      if (!token || error.start === undefined) break;
      const at = error.start;
      corrected = corrected.slice(0, at) + token + corrected.slice(at);
      changes.push(token);
    }
    const repaired = corrected !== code && !diagnostics(corrected).length;
    return {
      issues,
      partial,
      ...(repaired ? { corrected } : {}),
      explanation: repaired
        ? `Suggested completion: added ${changes.map((c) => '`' + c + '`').join(', ')}. ${partial ? 'Closing punctuation may already exist outside your selection. The walkthrough explains the visible operations; exact results remain unknown.' : 'The walkthrough below explains this corrected version.'} Syntax was checked locally; the code was not run.`
        : 'This selection has a syntax issue. A reliable automatic fix needs more context; no values or expressions were invented.',
    };
  }
  if (language === 'python') {
    const checked = checkSyntax(code, language);
    if (!checked.checked || !checked.errors.length) return;
    const nested = code
      .split('\n')
      .map((line) => '        ' + line)
      .join('\n');
    if (
      !checkSyntax('async def __wdm():\n    for __item in []:\n' + nested, language).errors.length
    )
      return;
    // Only a missing colon on a visible compound header with an indented body.
    // Other parse errors (including an unfinished call) need the author's intent.
    const lines = code.split('\n');
    let changed = false;
    const corrected = lines
      .map((line, i) => {
        if (
          !/'''|"""/.test(code) &&
          /^\s*(?:(?:async )?(?:def|for|with)|class|if|elif|while|except)\b[^#\n]*[^:\s]\s*$/.test(
            line,
          ) &&
          i + 1 < lines.length &&
          lines[i + 1].trim() &&
          /^\s*/.exec(lines[i + 1])![0].length > /^\s*/.exec(line)![0].length
        ) {
          changed = true;
          return line.trimEnd() + ':';
        }
        return line;
      })
      .join('\n');
    const repaired = changed && !checkSyntax(corrected, language).errors.length;
    return {
      issues: checked.errors.slice(0, 4),
      partial: false,
      ...(repaired ? { corrected } : {}),
      explanation: repaired
        ? 'Added the missing colon at the end of the block header. The walkthrough explains the corrected version. Syntax was checked locally; the code was not run.'
        : 'This selection has a syntax issue. Include the missing surrounding code or expression so it can be corrected without guessing.',
    };
  }
}
