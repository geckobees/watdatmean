import ts from 'typescript';

// A small, file-local binding index. This describes declarations, not runtime
// values, and deliberately does not load imports or invoke a language service.
export function bindingLookup(source: ts.SourceFile) {
  const scopes = new Map<ts.Node, Map<string, ts.Node>>();
  function scopeFor(node: ts.Node, functionScoped = false): ts.Node {
    let scope = node.parent;
    while (scope && !ts.isSourceFile(scope)) {
      if (ts.isFunctionLike(scope)) break;
      if (
        !functionScoped &&
        (ts.isBlock(scope) ||
          ts.isCaseBlock(scope) ||
          ts.isCatchClause(scope) ||
          ts.isForStatement(scope) ||
          ts.isForInStatement(scope) ||
          ts.isForOfStatement(scope) ||
          ts.isClassLike(scope))
      )
        break;
      scope = scope.parent;
    }
    return scope ?? source;
  }
  function add(scope: ts.Node, name: ts.Node, declaration: ts.Node) {
    if (ts.isIdentifier(name)) {
      let names = scopes.get(scope);
      if (!names) scopes.set(scope, (names = new Map()));
      names.set(name.text, declaration);
    } else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      for (const element of name.elements)
        if (ts.isBindingElement(element)) add(scope, element.name, element);
    }
  }
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node)) {
      const isVar =
        ts.isVariableDeclarationList(node.parent) &&
        !(node.parent.flags & ts.NodeFlags.BlockScoped);
      add(scopeFor(node, isVar), node.name, node);
    } else if (ts.isParameter(node)) {
      add(node.parent, node.name, node);
    } else if (
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isEnumDeclaration(node)
    ) {
      if (node.name) add(scopeFor(node), node.name, node);
    } else if (ts.isFunctionExpression(node) || ts.isClassExpression(node)) {
      if (node.name) add(node, node.name, node);
    } else if (
      ts.isImportSpecifier(node) ||
      ts.isNamespaceImport(node) ||
      ts.isImportClause(node) ||
      ts.isImportEqualsDeclaration(node)
    ) {
      if (node.name) add(source, node.name, node);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return (identifier: ts.Identifier): ts.Node | undefined => {
    for (let scope: ts.Node | undefined = identifier; scope; scope = scope.parent) {
      const declaration = scopes.get(scope)?.get(identifier.text);
      if (declaration) return declaration;
    }
  };
}
