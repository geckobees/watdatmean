import { parser } from '@lezer/python';

type Node = ReturnType<typeof parser.parse>['topNode'];
const children = (node: Node) => {
  const result: Node[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child);
  return result;
};

/** Editor grammars recover from invalid code. Add structural Python 3 checks before offering Apply.
 * This is deliberately static: no interpreter, imports, user code, or project tools are executed.
 * It does not replace a Python compiler, type checker, or runtime tests.
 */
export function pythonErrors(source: string): string[] {
  const code = source.replace(/\r\n?/g, '\n');
  const starts = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') starts.push(i + 1);
  const line = (offset: number) => {
    let low = 0,
      high = starts.length;
    while (low + 1 < high) {
      const mid = (low + high) >>> 1;
      if (starts[mid] <= offset) low = mid;
      else high = mid;
    }
    return low;
  };
  const errors: string[] = [];
  const fail = (node: Node, message: string) => {
    const error = `Line ${line(node.from) + 1}: ${message}`;
    if (errors.length < 8 && !errors.includes(error)) errors.push(error);
  };
  const text = (node: Node) => code.slice(node.from, node.to);
  // Python compares normal tab columns and alternative columns to reject ambiguous tab/space mixes.
  const indent = (node: Node) => {
    const prefix = code.slice(starts[line(node.from)], node.from);
    if (!/^[ \t\f\uFEFF]*$/.test(prefix)) return undefined; // inline suite, continuation, or semicolon
    let columns = 0,
      alternate = 0;
    for (const char of prefix) {
      if (char === '\f') {
        columns = alternate = 0;
      } else if (char === '\t') {
        columns += 8 - (columns % 8);
        alternate++;
      } else if (char !== '\uFEFF') {
        columns++;
        alternate++;
      }
    }
    return { columns, alternate };
  };
  const tree = parser.parse(code);
  const nodes: Node[] = [];
  const cursor = tree.cursor();
  let nesting = 0;
  do {
    if (['(', '[', '{'].includes(cursor.name) && ++nesting > 200)
      return [
        'This expression is nested too deeply for a reliable Python preview. Split it into smaller steps.',
      ];
    if ([')', ']', '}'].includes(cursor.name)) nesting--;
    if (cursor.type.isError) fail(cursor.node, 'Check the Python syntax here.');
    nodes.push(cursor.node);
  } while (errors.length < 8 && cursor.next());
  if (errors.length) return errors;
  if (code.includes('\0')) return ['Python source cannot contain a null character.'];

  const sameIndent = (node: Node, expected: { columns: number; alternate: number }) => {
    const actual = indent(node);
    if (!actual) return;
    if (actual.columns !== expected.columns)
      fail(node, 'Indentation does not match this block. Line up statements in the same block.');
    else if (actual.alternate !== expected.alternate)
      fail(
        node,
        'Tabs and spaces give different indentation. Use consistent spacing in this block.',
      );
  };
  const functionScope = (node: Node): Node | undefined => {
    for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
      if (parent.name === 'ClassDefinition' && child.name === 'Body') return undefined;
      if (parent.name === 'FunctionDefinition' && child.name === 'Body') return parent;
      if (parent.name === 'LambdaExpression' && child.name !== 'ParamList') return parent;
    }
    return undefined;
  };
  const insideLoop = (node: Node) => {
    for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
      if (/^(FunctionDefinition|ClassDefinition|LambdaExpression)$/.test(parent.name)) return false;
      if (
        /^(ForStatement|WhileStatement)$/.test(parent.name) &&
        child.name === 'Body' &&
        child.prevSibling?.name !== 'else'
      )
        return true;
    }
    return false;
  };
  const target = (node: Node, unpack: boolean, stars: boolean): boolean => {
    if (node.name === 'VariableName') return text(node) !== '__debug__';
    if (node.name === 'MemberExpression') return true;
    if (node.name === 'ParenthesizedExpression')
      return targets(children(node), unpack, stars, false);
    if (unpack && /^(TupleExpression|ArrayExpression)$/.test(node.name))
      return targets(children(node), true, stars, true);
    return false;
  };
  const targets = (items: Node[], unpack = true, stars = true, container = false): boolean => {
    let starCount = 0,
      count = 0;
    for (const item of items) {
      if (['(', ')', '[', ']', ','].includes(item.name)) continue;
      if (text(item) === '*') {
        if (!stars || ++starCount > 1) return false;
        continue;
      }
      if (!target(item, unpack, stars)) return false;
      count++;
    }
    if (!unpack && (count !== 1 || items.some((n) => n.name === ','))) return false;
    return !starCount || container || items.some((n) => n.name === ',');
  };

  for (const node of nodes) {
    if (errors.length >= 8) break;
    const c = children(node);
    if (['Script', 'Body', 'MatchBody'].includes(node.name)) {
      const statements = c.filter((n) =>
        /Statement$|Definition$|StatementGroup$|MatchClause$/.test(n.name),
      );
      if (node.name === 'Script')
        statements.forEach((n) => sameIndent(n, { columns: 0, alternate: 0 }));
      else if (statements.length) {
        const expected = indent(statements[0]);
        const owner = node.parent && indent(node.parent);
        if (expected && owner) {
          if (expected.columns <= owner.columns || expected.alternate <= owner.alternate)
            fail(
              statements[0],
              'Indent the body farther than the line that opens it, using consistent tabs or spaces.',
            );
          statements.forEach((n) => sameIndent(n, expected));
        }
      }
    }
    if (
      /^(IfStatement|ForStatement|WhileStatement|TryStatement|DecoratedStatement)$/.test(node.name)
    ) {
      const expected = indent(node);
      if (expected)
        for (const child of c) {
          if (
            /^(elif|else|except|finally|Decorator|FunctionDefinition|ClassDefinition)$/.test(
              child.name,
            )
          )
            sameIndent(child, expected);
        }
    }
    if (node.name === 'ReturnStatement' && !functionScope(node))
      fail(node, 'return belongs inside a function.');
    if (/^(YieldStatement|YieldExpression)$/.test(node.name) && !functionScope(node))
      fail(node, 'yield belongs inside a function.');
    if (/^(BreakStatement|ContinueStatement)$/.test(node.name) && !insideLoop(node))
      fail(node, `${c[0]?.name ?? 'This statement'} belongs inside a loop body.`);
    if (
      node.name === 'AwaitExpression' ||
      (/^(ForStatement|WithStatement)$/.test(node.name) && c[0]?.name === 'async')
    ) {
      if (functionScope(node)?.firstChild?.name !== 'async')
        fail(
          node,
          'await and async loops/resources belong inside an async function in a Python file.',
        );
    }
    if (node.name === 'ScopeStatement' && c[0]?.name === 'nonlocal' && !functionScope(node))
      fail(node, 'nonlocal needs an enclosing function binding.');
    if (node.name === 'PrintStatement') fail(node, 'Python 3 uses print(value) with parentheses.');
    if (node.name === 'Number' && /^0[0-9_]*[1-9][0-9_]*$/.test(text(node)))
      fail(node, 'A decimal integer cannot start with an extra zero.');
    if (node.name === 'TryStatement') {
      if (!c.some((n) => ['except', 'finally'].includes(n.name)))
        fail(node, 'A try block needs except or finally.');
      if (c.some((n) => n.name === 'else') && !c.some((n) => n.name === 'except'))
        fail(node, 'A try/else block also needs except.');
      let bare = false;
      for (let i = 0; i < c.length; i++)
        if (c[i].name === 'except') {
          if (bare) fail(c[i], 'A bare except must be the last except branch.');
          bare = c[i + 1]?.name === 'Body';
        }
    }
    if (node.name === 'ParamList') {
      const groups: Node[][] = [[]];
      for (const item of c) {
        if (['(', ')'].includes(item.name)) continue;
        if (item.name === ',') groups.push([]);
        else groups.at(-1)!.push(item);
      }
      const names = new Set<string>();
      let defaultSeen = false,
        keywordOnly = false,
        kwargs = false;
      for (const group of groups) {
        if (!group.length) continue;
        if (kwargs) fail(group[0], 'No parameter can follow the ** keyword-argument parameter.');
        const first = text(group[0]);
        if (first === '*' || first === '**') {
          keywordOnly = true;
          kwargs = first === '**';
        }
        const name = group.find((n) => n.name === 'VariableName');
        if (!name) continue;
        if (names.has(text(name))) fail(name, 'Each function parameter needs a different name.');
        names.add(text(name));
        if (!keywordOnly) {
          if (group.some((n) => n.name === 'AssignOp')) defaultSeen = true;
          else if (defaultSeen)
            fail(name, 'A required positional parameter cannot follow one with a default value.');
        }
      }
    }
    if (node.name === 'AssignStatement') {
      let start = 0;
      for (let i = 0; i < c.length; i++) {
        if (c[i].name === 'AssignOp' || c[i].name === 'TypeDef') {
          if (i > start && !targets(c.slice(start, i), c[i].name !== 'TypeDef'))
            fail(
              node,
              'Assign to a name, an item, or an attribute; not to a literal or calculation.',
            );
          start = i + 1;
        }
      }
    }
    if (
      node.name === 'UpdateStatement' &&
      !targets(
        c.slice(
          0,
          c.findIndex((n) => n.name === 'UpdateOp'),
        ),
        false,
      )
    )
      fail(node, 'Update one name, item, or attribute.');
    if (node.name === 'DeleteStatement' && !targets(c.slice(1), true, false))
      fail(node, 'del needs a name, item, or attribute; not a literal.');
    if (node.name === 'ForStatement') {
      const begin = c.findIndex((n) => n.name === 'for') + 1,
        end = c.findIndex((n) => n.name === 'in');
      if (end > begin && !targets(c.slice(begin, end)))
        fail(node, 'The loop needs a valid name or unpacking target before in.');
    }
    if (node.name === 'NamedExpression' && c[0]?.name !== 'VariableName')
      fail(node, 'The := operator must assign to a simple name.');
  }
  return errors;
}
