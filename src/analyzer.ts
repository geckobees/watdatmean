import ts from 'typescript';
import type { Part, Snippet } from './types';
import { statementParts } from './syntax';

const glossary: Record<string, [string, string]> = {
  const: [
    'Creates a binding you cannot reassign.',
    'Use const when this name should keep referring to the same value. An object or array stored in it can still be changed.',
  ],
  let: [
    'Creates a block-scoped, reassignable variable.',
    'A block is usually code inside { }. You can assign a new value later, but the name is only available within its block.',
  ],
  var: [
    'Creates a function-scoped or script-global variable.',
    'In TypeScript, var follows JavaScript rules: it is not block-scoped. Its declaration is hoisted and reads before assignment produce undefined. Prefer let or const for clearer scope.',
  ],
  private: [
    'Limits access to this class during type checking.',
    'TypeScript checks private access at compile time. Unlike #private fields, this modifier does not enforce runtime privacy.',
  ],
  public: [
    'Allows access from outside the class.',
    'Public members can be accessed wherever the object is available. This is the default visibility in TypeScript.',
  ],
  protected: [
    'Allows access inside this class and subclasses.',
    'Subclasses inherit from this class. TypeScript checks this restriction during compilation.',
  ],
  readonly: [
    'Prevents reassignment after initialization.',
    'TypeScript enforces this at compile time. This is shallow: nested objects may still be mutable.',
  ],
  static: [
    'Belongs to the class itself.',
    'Access this member on the class, rather than on an instance created with new.',
  ],
  number: [
    'Stores a JavaScript number.',
    'TypeScript number includes integers and decimals, such as 0 and 3.5. There is no separate int type.',
  ],
  string: ['Stores text.', 'A string is a sequence of characters, such as "hello".'],
  boolean: [
    'Stores true or false.',
    'Booleans represent yes/no conditions and are often used in if statements.',
  ],
  any: [
    'Turns off most type checks for this value.',
    'Prefer a specific type or unknown when possible so TypeScript can catch mistakes.',
  ],
  unknown: [
    'Accepts any value, but requires checking before use.',
    'Narrow the type with checks such as typeof value === "string" before using string operations.',
  ],
  ':': [
    'Introduces a type annotation.',
    'The type after the colon describes the values allowed here. Type annotations are removed when TypeScript compiles to JavaScript.',
  ],
  '=': [
    'Assigns the initial value.',
    'This initializes the variable. It does not compare values; comparisons use === or ==.',
  ],
  ';': [
    'Ends the declaration.',
    'Semicolons mark statement boundaries. JavaScript can insert them automatically in many cases.',
  ],
  export: [
    'Makes this declaration available to other modules.',
    'Other files can import an exported name. Exporting does not execute the code in a different process.',
  ],
  import: [
    'Loads a value or type from another module.',
    'The module system resolves the path or package, loads that module (or reuses its loaded instance), then makes the requested export available under this local name. The exact file chosen depends on the project’s module and build settings. An `import type` is used only for TypeScript checking and is removed from the JavaScript output.',
  ],
  declare: [
    'Describes a value supplied elsewhere.',
    'An ambient declaration provides type information without generating JavaScript for this declaration.',
  ],
};

export function parse(code: string) {
  return ts.createSourceFile('source.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function contains(node: ts.Node, offset: number, source: ts.SourceFile) {
  return node.getStart(source) <= offset && offset < node.end;
}

function isTarget(node: ts.Node) {
  return (
    ts.isVariableStatement(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isStatement(node)
  );
}

export function syntaxParts(node: ts.Node, source: ts.SourceFile): Part[] {
  if (!ts.isVariableStatement(node) && !ts.isPropertyDeclaration(node))
    return statementParts(node, source, glossary);
  const declarations = ts.isVariableStatement(node)
    ? [...node.declarationList.declarations]
    : [node];
  const special = new Map<number, Part>();
  for (const declaration of declarations) {
    const name = declaration.name;
    special.set(name.getStart(source), {
      token: name.getText(source),
      brief: ts.isBindingPattern(name) ? 'Unpacks values into these names.' : 'The variable or property’s name.',
      detail: ts.isBindingPattern(name)
        ? 'Destructuring extracts selected properties or items into separate variables.'
        : ts.isPrivateIdentifier(name)
          ? 'A #private field is accessible only inside its declaring class. JavaScript enforces this at runtime.'
          : 'Use this name to read the stored value elsewhere in its scope.',
    });
    if (declaration.type)
      special.set(declaration.type.getStart(source), {
        token: declaration.type.getText(source),
        brief: glossary[declaration.type.getText(source)]?.[0] ?? 'The allowed type of this value.',
        detail:
          glossary[declaration.type.getText(source)]?.[1] ??
          'This annotation is checked by TypeScript and removed from the JavaScript output.',
      });
    if (declaration.initializer)
      special.set(declaration.initializer.getStart(source), {
        token: declaration.initializer.getText(source),
        brief: 'The starting value or expression.',
        detail:
          'This expression is evaluated when the declaration runs. Its result becomes the initial value.',
      });
  }
  const parts: Part[] = [];
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    source.text,
  );
  scanner.setTextPos(node.getStart(source));
  while (scanner.getTextPos() < node.end) {
    const kind = scanner.scan();
    if (kind === ts.SyntaxKind.EndOfFileToken) break;
    const start = scanner.getTokenPos();
    if (start >= node.end) break;
    const part = special.get(start);
<<<<<<< HEAD
    // TypeScript inserts zero-width nodes for missing syntax while the user types.
    // Rewinding to one of those nodes repeats the same token forever and exhausts memory.
    if (part && part.token.length > 0) {
      parts.push(part);
      scanner.setTextPos(Math.max(scanner.getTextPos(), start + part.token.length));
=======
    if (part) {
      const initializer = declarations.find(
        (d) => d.initializer?.getStart(source) === start,
      )?.initializer;
      if (
        initializer &&
        !ts.isLiteralExpression(initializer) &&
        !ts.isObjectLiteralExpression(initializer) &&
        !ts.isArrayLiteralExpression(initializer) &&
        !ts.isNewExpression(initializer) &&
        !ts.isIdentifier(initializer)
      )
        parts.push(...statementParts(initializer, source, glossary));
      else parts.push({ ...part, start, end: start + part.token.length });
      scanner.setTextPos(start + part.token.length);
>>>>>>> cesar-branch
      continue;
    }
    const token = scanner.getTokenText();
    const entry = glossary[token];
    parts.push({
      token,
      start,
      end: scanner.getTextPos(),
      brief:
        entry?.[0] ??
        (token === ','
          ? 'Separates declarations.'
          : token === '?'
            ? 'Marks this property as optional.'
            : 'Part of this TypeScript declaration.'),
      detail:
        entry?.[1] ?? 'This punctuation or modifier contributes to the declaration’s structure.',
    });
  }
  return parts;
}

export function inspect(code: string, offset: number, selectionEnd = offset): Snippet {
  const source = parse(code);
  let target: ts.Node | undefined;
  let identifier: ts.Identifier | undefined;
  function visit(node: ts.Node) {
    if (!contains(node, offset, source)) return;
    if (isTarget(node)) target = node;
    if (ts.isIdentifier(node)) identifier = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  let start =
    target?.getStart(source) ?? Math.max(0, code.lastIndexOf('\n', Math.max(0, offset - 1)) + 1);
  let end = target?.end ?? code.indexOf('\n', offset);
  if (end < 0) end = code.length;
  if (selectionEnd > offset) {
    start = offset;
    end = selectionEnd;
  }
  // Follow a declared symbol, even when the cursor is over its keyword or punctuation.
  let name: ts.Node | undefined;
  if (target && ts.isVariableStatement(target))
    name =
      target.declarationList.declarations.find((d) => contains(d, offset, source))?.name ??
      target.declarationList.declarations[0]?.name;
  else if (target && 'name' in target) name = (target as ts.NamedDeclaration).name;
  if (
    identifier &&
    (!name ||
      (identifier.getStart(source) >= start && identifier.end <= end && !ts.isIdentifier(name)))
  )
    name = identifier;
  const symbolNode = name && ts.isIdentifier(name) ? name : identifier;
  return {
    code: code.slice(start, end),
    start,
    end,
    symbol: symbolNode?.getText(source) ?? '',
    symbolOffset: symbolNode?.getStart(source) ?? offset,
    parts:
      target && start === target.getStart(source) && end === target.end
        ? syntaxParts(target, source)
        : [],
  };
}

export function syntaxErrors(code: string): string[] {
  const source = parse(code) as ts.SourceFile & { parseDiagnostics: ts.Diagnostic[] };
  return source.parseDiagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}
