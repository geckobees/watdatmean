import ts from 'typescript';
import { parse } from './analyzer';

// A selection can stop before closing punctuation even when its source file is valid.
// Recognize visible complete operations without adding code, inferring values or running it.
export function explainableFragment(code: string, language: string): boolean {
  if (!/^(typescript|javascript)/.test(language)) return false;
  const source = parse(code, language) as ts.SourceFile & { parseDiagnostics: ts.Diagnostic[] };
  const boundary = code.trimEnd().length;
  if (
    !source.parseDiagnostics.length ||
    !source.parseDiagnostics.every(
      (diagnostic) =>
        (diagnostic.start ?? -1) >= boundary &&
        /^'[}\])]' expected\.$/.test(ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')),
    )
  )
    return false;
  let found = false;
  let remaining = 3000;
  const visit = (node: ts.Node) => {
    if (found || --remaining < 0) return;
    if (
      ts.isVariableStatement(node) ||
      ts.isExpressionStatement(node) ||
      ts.isReturnStatement(node)
    ) {
      const text = node.getText(source);
      if (
        text.trim() &&
        !(parse(text, language) as ts.SourceFile & { parseDiagnostics: unknown[] }).parseDiagnostics
          .length
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
