import ts from 'typescript';

const declaredTypes = new WeakMap<ts.SourceFile, Set<string>>();

// Without a project type checker, a locally declared/imported name must not be
// assumed to be TypeScript's built-in utility. Be conservative across scopes.
export function standardTypeReference(type: ts.TypeReferenceNode, source: ts.SourceFile) {
  if (!ts.isIdentifier(type.typeName)) return false;
  let names = declaredTypes.get(source);
  if (!names) {
    names = new Set<string>();
    const pending: ts.Node[] = [source];
    while (pending.length) {
      const node = pending.pop()!;
      if (
        (ts.isTypeAliasDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isClassLike(node) ||
          ts.isEnumDeclaration(node) ||
          ts.isTypeParameterDeclaration(node) ||
          ts.isImportSpecifier(node) ||
          ts.isImportClause(node) ||
          ts.isImportEqualsDeclaration(node)) &&
        node.name &&
        ts.isIdentifier(node.name)
      )
        names.add(node.name.text);
      ts.forEachChild(node, (child) => {
        pending.push(child);
      });
    }
    declaredTypes.set(source, names);
  }
  return !names.has(type.typeName.text);
}

// Keep nested type descriptions short; callers choose plain text or safe Markdown.
export function describeType(
  type: ts.TypeNode,
  source: ts.SourceFile,
  reference: (text: string) => string = (text) => text,
  depth = 0,
): string {
  const label = (node: ts.Node) => {
    const text = node.getText(source).replace(/\s+/g, ' ');
    return reference(text.length > 90 ? text.slice(0, 87) + '…' : text);
  };
  const nested = (node: ts.TypeNode) => describeType(node, source, reference, depth + 1);
  if (depth > 3) return `a value of type ${label(type)}`;
  switch (type.kind) {
    case ts.SyntaxKind.StringKeyword:
      return 'text';
    case ts.SyntaxKind.NumberKeyword:
      return 'a number';
    case ts.SyntaxKind.BooleanKeyword:
      return 'true or false';
    case ts.SyntaxKind.VoidKeyword:
      return 'no usable return value';
    case ts.SyntaxKind.NeverKeyword:
      return 'no normal return to the caller';
  }
  if (ts.isParenthesizedTypeNode(type)) return nested(type.type);
  if (ts.isTupleTypeNode(type)) {
    if (
      type.elements.length === 2 &&
      type.elements.every((t) => t.kind === ts.SyntaxKind.StringKeyword)
    )
      return 'a pair of text values';
    if (
      type.elements.some(
        (t) =>
          ts.isOptionalTypeNode(t) ||
          ts.isRestTypeNode(t) ||
          (ts.isNamedTupleMember(t) && (t.questionToken || t.dotDotDotToken)),
      )
    )
      return `a list with the required and optional entries shown in ${label(type)}`;
    return `a list with exactly ${type.elements.length} entries in the order shown by ${label(type)}`;
  }
  if (ts.isArrayTypeNode(type))
    return `an array (a list) where each item is ${nested(type.elementType)}`;
  if (ts.isUnionTypeNode(type) && type.types.length <= 3)
    return type.types.map(nested).join(' or ');
  if (ts.isFunctionTypeNode(type)) return 'a function with the inputs and result described here';
  if (
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    standardTypeReference(type, source)
  ) {
    const args = type.typeArguments ?? [];
    if (type.typeName.text === 'Record' && args.length === 2)
      return args[0].kind === ts.SyntaxKind.StringKeyword
        ? `an object whose text keys each hold ${nested(args[1])}`
        : `an object with keys from ${label(args[0])} and ${nested(args[1])} for each value`;
    if (
      (type.typeName.text === 'Array' || type.typeName.text === 'ReadonlyArray') &&
      args.length === 1
    )
      return `an array (a list) where each item is ${nested(args[0])}${type.typeName.text === 'ReadonlyArray' ? ', with items that cannot be changed through this type' : ''}`;
    if (type.typeName.text === 'Promise' && args.length === 1)
      return `a Promise that can finish with ${nested(args[0])}`;
    if (type.typeName.text === 'Readonly' && args.length === 1)
      return `${nested(args[0])}, with properties that cannot be reassigned through this type`;
    if (type.typeName.text === 'Partial' && args.length === 1)
      return `an object like ${label(args[0])}, where every property can be left out`;
  }
  return `a value of type ${label(type)}`;
}
