import ts from 'typescript';
import { parser as pythonParser } from '@lezer/python';
import type { SyntaxNode } from '@lezer/common';
import { parse } from './analyzer';
import { languageId } from './languages';
import { pythonErrors } from './python-check';
import { definition } from './teaching';
import type { LearningRequest, Lesson } from './types';

type Scalar = string | number | boolean | null;
type Value = { value: Scalar; operation: 'literal' | 'read' | 'join' | 'add'; source: string };
type Operation = { kind: 'assign' | 'print'; value: Value; name?: string; constant?: boolean };
const reserved = new Set([
  'console',
  'print',
  'undefined',
  'NaN',
  'Infinity',
  'eval',
  'arguments',
  'await',
  'yield',
  '__debug__',
]);

// Interpret only this small grammar as data; never eval, execute a selection or call a helper.
// Unknown syntax/context falls through to the existing AI path with reasoning enabled.
export function literalLesson(request: LearningRequest): Lesson | undefined {
  if (
    request.task !== 'explain' ||
    !request.code.trim() ||
    request.code.length > 800 ||
    request.learningContext?.trim() ||
    request.replacement?.trim() ||
    (request.context?.trim() && request.context.trim() !== request.code.trim()) ||
    request.evidence?.some((entry) => entry.code.trim())
  )
    return;
  const language = languageId(request.language ?? 'TypeScript');
  let operations: Operation[] | undefined;
  try {
    if (/^(typescript|javascript)/.test(language)) operations = typescript(request.code, language);
    else if (language === 'python') operations = python(request.code);
    else if (language === 'java') {
      const match =
        /^\s*(?:java\.lang\.)?System\s*\.\s*out\s*\.\s*println\s*\(\s*("(?:[^"\\\r\n]|\\["\\nrtbf])*")\s*\)\s*;\s*$/.exec(
          request.code,
        );
      if (match) {
        const value = quoted(match[1]);
        if (value !== undefined)
          operations = [
            { kind: 'print', value: { value, operation: 'literal', source: match[1] } },
          ];
      }
    }
  } catch {
    return;
  }
  if (!operations?.length) return;
  if (
    operations.some(
      (op) =>
        typeof op.value.value === 'string' &&
        [...op.value.value].some((ch) => {
          const point = ch.codePointAt(0)!;
          return point >= 0xd800 && point <= 0xdfff;
        }),
    )
  )
    return;
  const prints = operations.filter((op) => op.kind === 'print');
  const assignments = operations.filter((op) => op.kind === 'assign');
  const display = (value: Scalar): string =>
    typeof value === 'string'
      ? JSON.stringify(value)
      : language === 'python' && typeof value === 'boolean'
        ? value
          ? 'True'
          : 'False'
        : value === null
          ? language === 'python'
            ? 'None'
            : 'null'
          : String(value);
  const stepOutput = operations.map((op) =>
    op.kind === 'print'
      ? (typeof op.value.value === 'string' ? op.value.value : display(op.value.value)) + '\n'
      : null,
  );
  if (stepOutput.join('').length > 8000) return;
  const firstConstant = operations.findIndex((op) => op.constant);
  const steps = operations.map((op, index) => {
    const { value, operation, source } = op.value;
    const calculation =
      operation === 'join'
        ? source.length <= 80
          ? `Join the text in ${source}`
          : 'Join the text using +'
        : operation === 'add'
          ? source.length <= 80
            ? `Add the numbers in ${source}`
            : 'Add the numbers using +'
          : operation === 'read'
            ? `Read ${source}`
            : '';
    if (op.kind === 'print')
      return calculation
        ? `${calculation}, then print the result and end the line.`
        : 'Print the literal value and end the line.';
    const assign = calculation
      ? `${calculation} and store the result in ${op.name}.`
      : `Set ${op.name} to ${typeof value === 'string' ? 'the text ' : ''}${display(value)}.`;
    return (
      assign +
      (op.constant && index === firstConstant
        ? ` const prevents assigning a different value to ${op.name}.`
        : '')
    );
  });
  const terms = [
    ...new Set([
      ...(assignments.length ? ['variable'] : []),
      ...(operations.some((op) => typeof op.value.value === 'string') ? ['string'] : []),
      ...(operations.some((op) => op.constant) ? ['const'] : []),
      ...(operations.some((op) => ['join', 'add'].includes(op.value.operation))
        ? ['operator']
        : []),
    ]),
  ].slice(0, 3);
  return {
    title: 'Explanation',
    summary: prints.length
      ? assignments.length
        ? 'This code sets and prints values in the order shown.'
        : 'This code prints a value and ends the line.'
      : 'This code gives names their starting values.',
    steps,
    stepOutput,
    output: {
      text: stepOutput.join(''),
      explanation: prints.length ? '' : 'This snippet does not print anything.',
    },
    ...(prints.length
      ? {
          note:
            language === 'java'
              ? 'With Java’s standard classes, System.out is a java.io.PrintStream; println writes text and a newline.'
              : language === 'python'
                ? 'print is Python’s built-in output function.'
                : 'console.log is an output function provided by the JavaScript runtime, such as a browser or Node.js.',
        }
      : {}),
    concepts: terms.map((term) => ({ term, explanation: definition(term, language)! })),
    example: { code: '', explanation: '' },
    predictions: [],
    checks: [],
    local: true,
    notice: prints.length
      ? 'Derived locally, assuming the standard output function. No code was run or sent to AI.'
      : 'Derived locally from the supplied values. No code was run or sent to AI.',
    usage: { input: 0, output: 0, total: 0 },
  };
}

function plus(
  left: Value | undefined,
  right: Value | undefined,
  source: string,
): Value | undefined {
  if (!left || !right) return;
  if (typeof left.value === 'string' && typeof right.value === 'string') {
    const value = left.value + right.value;
    if (value.length <= 2000) return { value, operation: 'join', source };
  }
  if (typeof left.value === 'number' && typeof right.value === 'number') {
    const value = left.value + right.value;
    if (Number.isSafeInteger(value)) return { value, operation: 'add', source };
  }
}
function quoted(source: string): string | undefined {
  const quote = source[0];
  if (!['"', "'"].includes(quote) || source.at(-1) !== quote || source.startsWith(quote.repeat(3)))
    return;
  const escapes: Record<string, string> = {
    '\\': '\\',
    "'": "'",
    '"': '"',
    n: '\n',
    r: '\r',
    t: '\t',
    b: '\b',
    f: '\f',
  };
  let result = '';
  for (let i = 1; i < source.length - 1; i++) {
    const ch = source[i];
    if (ch === quote || ch === '\r' || ch === '\n') return;
    if (ch === '\\') {
      const next = source[++i];
      if (i >= source.length - 1 || !Object.hasOwn(escapes, next)) return;
      result += escapes[next];
    } else result += ch;
  }
  return result;
}
function typescript(code: string, language: string): Operation[] | undefined {
  const source = parse(code, language);
  if (
    (source as ts.SourceFile & { parseDiagnostics: unknown[] }).parseDiagnostics.length ||
    !source.statements.length ||
    source.statements.length > 12
  )
    return;
  const names = new Map<string, Scalar>(),
    operations: Operation[] = [];
  function value(node: ts.Expression, depth = 0): Value | undefined {
    if (depth > 4) return;
    const sourceText = node.getText(source),
      literal = (value: Scalar): Value => ({ value, operation: 'literal', source: sourceText });
    if (ts.isStringLiteral(node)) return literal(node.text);
    if (ts.isNumericLiteral(node) && /^(0|[1-9]\d{0,5})$/.test(sourceText))
      return literal(Number(node.text));
    if (node.kind === ts.SyntaxKind.TrueKeyword) return literal(true);
    if (node.kind === ts.SyntaxKind.FalseKeyword) return literal(false);
    if (node.kind === ts.SyntaxKind.NullKeyword) return literal(null);
    if (ts.isIdentifier(node) && names.has(node.text))
      return { value: names.get(node.text)!, operation: 'read', source: node.text };
    if (ts.isParenthesizedExpression(node)) return value(node.expression, depth + 1);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken)
      return plus(value(node.left, depth + 1), value(node.right, depth + 1), sourceText);
  }
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) {
      if (
        statement.modifiers?.length ||
        !(statement.declarationList.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let))
      )
        return;
      for (const declaration of statement.declarationList.declarations) {
        if (
          !ts.isIdentifier(declaration.name) ||
          names.has(declaration.name.text) ||
          reserved.has(declaration.name.text) ||
          !declaration.initializer
        )
          return;
        const result = value(declaration.initializer);
        if (!result) return;
        if (
          declaration.type &&
          declaration.type.kind !==
            (
              {
                string: ts.SyntaxKind.StringKeyword,
                number: ts.SyntaxKind.NumberKeyword,
                boolean: ts.SyntaxKind.BooleanKeyword,
              } as Record<string, ts.SyntaxKind>
            )[typeof result.value]
        )
          return;
        names.set(declaration.name.text, result.value);
        operations.push({
          kind: 'assign',
          name: declaration.name.text,
          value: result,
          constant: !!(statement.declarationList.flags & ts.NodeFlags.Const),
        });
      }
    } else if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) {
      const call = statement.expression,
        target = call.expression;
      if (
        call.questionDotToken ||
        call.typeArguments?.length ||
        !ts.isPropertyAccessExpression(target) ||
        target.questionDotToken ||
        !ts.isIdentifier(target.expression) ||
        target.expression.text !== 'console' ||
        target.name.text !== 'log' ||
        call.arguments.length !== 1
      )
        return;
      const result = value(call.arguments[0]);
      if (!result) return;
      // Node/browser consoles may interpret percent placeholders in the first string argument.
      if (typeof result.value === 'string' && result.value.includes('%')) return;
      operations.push({ kind: 'print', value: result });
    } else return;
    if (operations.length > 12) return;
  }
  return operations;
}
function python(code: string): Operation[] | undefined {
  if (pythonErrors(code).length) return;
  const tree = pythonParser.parse(code),
    names = new Map<string, Scalar>(),
    operations: Operation[] = [];
  const cursor = tree.cursor();
  do {
    if (cursor.type.isError) return;
  } while (cursor.next());
  const text = (node: SyntaxNode) => code.slice(node.from, node.to);
  const children = (node: SyntaxNode) => {
    const result: SyntaxNode[] = [];
    for (let child = node.firstChild; child; child = child.nextSibling) result.push(child);
    return result;
  };
  function value(node: SyntaxNode, depth = 0): Value | undefined {
    if (depth > 4) return;
    const source = text(node),
      literal = (value: Scalar): Value => ({ value, operation: 'literal', source });
    if (node.name === 'String') {
      const decoded = quoted(source);
      if (decoded !== undefined) return literal(decoded);
    }
    if (node.name === 'Number' && /^(0|[1-9]\d{0,5})$/.test(source)) return literal(Number(source));
    if (node.name === 'Boolean') return literal(source === 'True');
    if (node.name === 'None') return literal(null);
    if (node.name === 'VariableName' && names.has(source))
      return { value: names.get(source)!, operation: 'read', source };
    if (node.name === 'BinaryExpression') {
      const parts = children(node);
      if (parts.length === 3 && text(parts[1]) === '+')
        return plus(value(parts[0], depth + 1), value(parts[2], depth + 1), source);
    }
  }
  for (const node of children(tree.topNode)) {
    if (node.name === 'Comment') continue;
    const parts = children(node);
    if (node.name === 'AssignStatement') {
      if (parts.length !== 3 || parts[0].name !== 'VariableName' || text(parts[1]) !== '=') return;
      const name = text(parts[0]),
        result = value(parts[2]);
      if (!result || names.has(name) || reserved.has(name)) return;
      names.set(name, result.value);
      operations.push({ kind: 'assign', name, value: result });
    } else if (
      node.name === 'ExpressionStatement' &&
      parts.length === 1 &&
      parts[0].name === 'CallExpression'
    ) {
      const call = children(parts[0]);
      if (
        call.length !== 2 ||
        call[0].name !== 'VariableName' ||
        text(call[0]) !== 'print' ||
        call[1].name !== 'ArgList'
      )
        return;
      const args = children(call[1]);
      if (args.length !== 3 || args[0].name !== '(' || args[2].name !== ')') return;
      const result = value(args[1]);
      if (!result) return;
      operations.push({ kind: 'print', value: result });
    } else return;
    if (operations.length > 12) return;
  }
  return operations.length ? operations : undefined;
}
