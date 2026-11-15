import { parser } from '@lezer/java';
import type { SyntaxNode, Tree } from '@lezer/common';
import type { Lesson } from './types';

const members = parser.configure({ top: 'ClassContent' });
// The grammar's line-comment token stops at LF. Java also ends comments at a lone
// CR. Normalize only for parsing, preserving every UTF-16 offset in the actual code.
const parseTree = (p: typeof parser, text: string) => p.parse(text.replace(/\r(?!\n)/g, '\n'));
type Problem = { at: number; message: string; node?: SyntaxNode };
type Fix = { at: number; originalAt?: number; token: string; reason: string; boundary: boolean };
const children = (node: SyntaxNode) => {
  const items: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) items.push(child);
  return items;
};
const errors = (tree: Tree): Problem[] => {
  const items: Problem[] = [];
  const cursor = tree.cursor();
  do {
    if (cursor.type.isError)
      items.push({
        at: cursor.from,
        message:
          'This syntax could not be verified. Include the complete statement or check it with your Java compiler.',
        node: cursor.node,
      });
    // The editor grammar allows a bare try block. Java requires a handler unless resources exist.
    if (
      cursor.name === 'TryStatement' &&
      !children(cursor.node).some((n) => /^(CatchClause|FinallyClause)$/.test(n.name))
    )
      items.push({
        at: cursor.to,
        message:
          'A try block needs catch or finally here. If the handler is outside your selection, include it; its exception type and behavior cannot be guessed.',
      });
    if (cursor.name === 'ArrayCreationExpression') {
      const parts = children(cursor.node),
        dimensions = parts.filter((n) => n.name === 'Dimension');
      const sized = dimensions.map((n) =>
        children(n).some(
          (c) => c.name !== '[' && c.name !== ']' && !/Annotation|Comment/.test(c.name),
        ),
      );
      const initialized = parts.some((n) => n.name === 'ArrayInitializer');
      if (
        (!initialized && !sized.some(Boolean)) ||
        (initialized && sized.some(Boolean)) ||
        sized.some((size, i) => size && sized.slice(0, i).includes(false))
      )
        items.push({
          at: cursor.from,
          message:
            'An array creation needs lengths in its leading brackets or an initializer containing its items. The intended size or items cannot be guessed.',
        });
    }
  } while (cursor.next() && items.length < 20);
  return items;
};

// Java processes Unicode escapes before lexing, including in comments. We deliberately
// abstain for those sources instead of changing offsets or repairing a different program.
function lexicalProblem(code: string): Problem | undefined {
  for (let at = 0; at < code.length;) {
    if (code.startsWith('//', at)) {
      const end = code.slice(at).search(/[\r\n]/);
      at = end < 0 ? code.length : at + end;
    } else if (code.startsWith('/*', at)) {
      const end = code.indexOf('*/', at + 2);
      if (end < 0)
        return {
          at,
          message:
            'This block comment has no closing */ in the selection. Include the rest of the comment; adding a closing marker could change which code runs.',
        };
      at = end + 2;
    } else if (code[at] === '"' || code[at] === "'") {
      const start = at;
      const quote = code.startsWith('"""', at) ? '"""' : code[at];
      at += quote.length;
      let closed = false;
      while (at < code.length) {
        if (code.startsWith(quote, at)) {
          at += quote.length;
          closed = true;
          break;
        }
        if (quote.length === 1 && /[\r\n]/.test(code[at])) break;
        if (code[at] === '\\') at++;
        at++;
      }
      if (!closed)
        return {
          at: start,
          message: `This ${quote.length === 3 ? 'text block' : quote === "'" ? 'character literal' : 'string'} is unfinished in the selection. Its missing text and closing quote cannot be guessed.`,
        };
    } else at++;
  }
}

function complete(node: SyntaxNode) {
  const cursor = node.toTree().cursor();
  do {
    if (cursor.type.isError) return false;
  } while (cursor.next());
  return true;
}
function proposal(problem: Problem, code: string): Fix | undefined {
  const error = problem.node,
    parent = error?.parent;
  let previous = error?.prevSibling;
  while (previous && /Comment$/.test(previous.name)) previous = previous.prevSibling;
  if (
    !error ||
    !parent ||
    !previous ||
    error.from !== error.to ||
    error.nextSibling ||
    !complete(previous)
  )
    return;
  let last = previous;
  while (last.lastChild) {
    let child: SyntaxNode | null = last.lastChild;
    while (child && /Comment$/.test(child.name)) child = child.prevSibling;
    if (!child) break;
    last = child;
  }
  const at = last.to;
  let token = '',
    reason = '';
  if (
    /^(LocalVariableDeclaration|FieldDeclaration|ExpressionStatement|ReturnStatement|ThrowStatement|ImportDeclaration|PackageDeclaration|ExplicitConstructorInvocation|YieldStatement)$/.test(
      parent.name,
    )
  ) {
    if (
      parent.name === 'ExpressionStatement' &&
      !/^(AssignmentExpression|UpdateExpression|MethodInvocation|ObjectCreationExpression)$/.test(
        previous.name,
      )
    )
      return;
    if (/^(return|throw|yield)$/.test(previous.name)) return;
    token = ';';
    reason = 'ends this declaration or statement; Java needs a semicolon here';
  } else if (
    /^(ArgumentList|FormalParameters|ParenthesizedExpression|CatchFormalParameter|RecordHeader|ResourceSpecification)$/.test(
      parent.name,
    )
  ) {
    if (/^[,(=]$/.test(previous.name)) return;
    token = ')';
    reason = 'closes the parentheses around the existing arguments, parameters or expression';
  } else if (/^(ArrayAccess|Dimension)$/.test(parent.name)) {
    if (previous.name === '[') return;
    token = ']';
    reason = 'closes the array brackets';
  } else if (
    /^(Block|ClassBody|ConstructorBody|InterfaceBody|EnumBody|RecordBody|ArrayInitializer|SwitchBlock)$/.test(
      parent.name,
    ) &&
    error.from >= code.trimEnd().length
  ) {
    // An empty unfinished block could still be awaiting its body. Do not invent one.
    if (previous.name === '{') return;
    token = '}';
    reason = `closes the ${/ClassBody|InterfaceBody|EnumBody|RecordBody/.test(parent.name) ? 'type body' : 'code block'} already shown; it may exist after your selection`;
  }
  if (!token) return;
  return { at: token === '}' ? code.length : at, token, reason, boundary: token === '}' };
}
function location(code: string, at: number) {
  const prefix = code.slice(0, Math.min(at, code.length));
  const lines = prefix.split(/\r\n|\r|\n/);
  return `Selection line ${lines.length}, column ${lines.at(-1)!.length + 1}`;
}

/** Shared, local syntax assistance; never a Java compiler or an execution engine. */
export function javaSyntaxHelp(code: string): Lesson['syntax'] {
  if (!code.trim() || code.length > 50000) return;
  if (/\\u+[a-fA-F\d]{4}/.test(code)) return; // defer Unicode preprocessing to the native compiler
  const lexical = lexicalProblem(code);
  if (lexical)
    return {
      issues: [`${location(code, lexical.at)}: ${lexical.message}`],
      partial: false,
      explanation:
        'No automatic change was made. Include the complete literal or comment before predicting its behavior.',
    };
  const candidates = [{ parser, problems: errors(parseTree(parser, code)) }];
  if (!candidates[0].problems.length) return;
  candidates.push({ parser: members, problems: errors(parseTree(members, code)) });
  if (!candidates[1].problems.length) return;
  // Constructor calls and handler/else clauses can be legitimate selections from
  // a larger body. Wrappers are validation context only; they are never proposed.
  if (!errors(parseTree(parser, `class __Wdm { __Wdm() { ${code}\n} }`)).length) return;
  if (/^\s*(catch|finally)\b/.test(code) && !errors(parseTree(parser, `try {} ${code}`)).length)
    return;
  if (/^\s*else\b/.test(code) && !errors(parseTree(parser, `if (true) {} ${code}`)).length) return;
  // This grammar doesn't cover switch expressions/patterns. Defer to the native
  // compiler instead of reporting newer, valid Java as a missing expression.
  if (/\bswitch\s*\(/.test(code)) return;
  // A name, expression or method reference is a legitimate editor selection on its own.
  if (!errors(parseTree(parser, `Object __wdm = (${code}\n);`)).length) return;
  const selected = candidates.sort((a, b) => a.problems.length - b.problems.length)[0];
  let corrected = code;
  const fixes: Fix[] = [];
  const offsets = Array.from({ length: code.length + 1 }, (_, i) => i);
  for (let attempt = 0; attempt < 4; attempt++) {
    const problems = errors(parseTree(selected.parser, corrected));
    if (!problems.length) break;
    const fix = proposal(problems[0], corrected);
    if (!fix) break;
    fix.originalAt = offsets[fix.at];
    fixes.push(fix);
    const insertion = fix.token === '}' ? '\n}' : fix.token;
    offsets.splice(fix.at, 0, ...Array(insertion.length).fill(fix.originalAt));
    corrected = corrected.slice(0, fix.at) + insertion + corrected.slice(fix.at);
  }
  const repaired = fixes.length > 0 && !errors(parseTree(selected.parser, corrected)).length;
  const partial = repaired && fixes.some((f) => f.boundary);
  const issues = repaired
    ? fixes.map((f) => `${location(code, f.originalAt!)}: Missing ${f.token}.`)
    : selected.problems.slice(0, 4).map((problem) => {
        const fix = proposal(problem, code);
        let message = fix ? `Missing ${fix.token}: ${fix.reason}.` : problem.message;
        if (
          problem.node?.parent?.name === 'VariableDeclarator' &&
          problem.node.prevSibling?.name === 'AssignOp' &&
          /^\s*[;,}]/.test(code.slice(problem.at))
        )
          message =
            'The assignment is missing a value or expression after =. Choose the intended value; it cannot be inferred from this code.';
        return `${location(code, fix?.at ?? problem.at)}: ${message}`;
      });
  return {
    issues: [...new Set(issues)],
    partial,
    ...(repaired ? { corrected } : {}),
    explanation: repaired
      ? fixes.map((f) => `Added ${f.token}: ${f.reason}.`).join(' ') +
        (partial
          ? ' This is a standalone completion; the walkthrough covers only visible code and cannot establish a full result.'
          : ' The walkthrough explains the corrected version.') +
        ' Rechecked locally; code was not run.'
      : 'No reliable punctuation-only fix was found. Missing values, statements and exception handlers were left unchanged. This may require surrounding code or syntax supported by your Java version.',
  };
}
