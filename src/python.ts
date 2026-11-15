import { parser } from '@lezer/python';
import type { Part, Snippet } from './types';
type Node = ReturnType<typeof parser.parse>['topNode'];
const scopes =
  /^(Script|FunctionDefinition|ClassDefinition|LambdaExpression|.*ComprehensionExpression)$/;
const compact = (text: string) => text.replace(/[\r\n\t]+/g, ' ').slice(0, 130);
const builtins: Record<string, string> = {
  print: 'print displays values, such as a score, in the output window.',
  sum: 'sum adds the numbers in a collection. For example, sum([2, 3]) is 5.',
  len: 'len counts items. For example, len([2, 3]) is 2, not 5.',
  range: 'range supplies a sequence of integers. range(3) gives 0, 1, and 2 when you loop over it.',
  input: 'input reads one line of text typed by the user.',
  str: 'str makes a text representation of a value.',
  int: 'int converts a suitable value to a whole number; an invalid conversion raises an error.',
  list: 'list creates a list, an ordered collection of items.',
  dict: 'dict creates a dictionary, which connects keys to values.',
  open: 'open opens a file. A with block can arrange for the file to close afterward.',
};
const words: Record<string, [string, string]> = {
  def: [
    'Creates a function: a named set of instructions.',
    'Its body runs when you call it. Parameters are names for the inputs you give it.',
  ],
  return: [
    'Sends a result back to the caller.',
    'For example, return 2 + 3 gives the caller 5 and ends this function call.',
  ],
  for: [
    'Repeats the body for each item.',
    'For example, for price in [2, 3] runs once with price set to 2, then again with 3.',
  ],
  in: [
    'Takes items from a collection, or checks membership.',
    'In a for loop it supplies the items. In an expression, item in collection asks whether the item is present.',
  ],
  if: [
    'Runs this branch when its test is true.',
    'For example, if score >= 10 can unlock a game level. Zero, None, and empty collections count as false.',
  ],
  else: [
    'Provides an alternative branch.',
    'After if, this runs when the test is false. After a loop, it runs when the loop ends without break.',
  ],
  elif: [
    'Checks another condition.',
    'Python checks this condition when earlier if or elif branches did not run.',
  ],
  while: [
    'Repeats while the test stays true.',
    'Change something that affects the test so the loop can eventually stop.',
  ],
  import: [
    'Makes code from a module available here.',
    'A module is a file or collection of reusable Python code. Importing can run its setup code; WatDatMean only reads this statement.',
  ],
  from: [
    'Names the module that supplies an imported item.',
    'For example, from math import sqrt brings in sqrt from the module named math. A local file can shadow that module name.',
  ],
  as: [
    'Gives an imported item a local nickname.',
    'For example, import math as m lets this file write m.sqrt(9).',
  ],
  class: [
    'Defines a kind of object.',
    'A class groups data and functions. For example, a game can create many Player objects from one Player class.',
  ],
  '=': [
    'Stores a value under a name.',
    'The right side is worked out first. The name on the left then refers to that value; this is not an equality test.',
  ],
  '+': [
    'Adds numbers or joins compatible sequences.',
    '2 + 3 is 5. "hi" + "!" joins text. The values must support the operation.',
  ],
  '*': [
    'Multiplies numbers or repeats a sequence.',
    '3 * 4 is 12. "ha" * 2 is "haha". Here the surrounding values determine which meaning applies.',
  ],
  '/': [
    'Divides and returns a floating-point result.',
    '7 / 2 is 3.5. Dividing by zero raises an error.',
  ],
  '//': [
    'Divides and rounds down.',
    '7 // 2 is 3; -7 // 2 is -4. It rounds toward negative infinity.',
  ],
  '==': [
    'Checks whether two values compare equal.',
    'The result is True or False. This differs from =, which assigns a value.',
  ],
  is: [
    'Checks whether two names refer to the same object.',
    'Use is None to check for None. To compare contents, usually use ==.',
  ],
  and: [
    'Checks the left side before the right.',
    'If the left value counts as false, Python returns it without checking the right side. Otherwise it returns the right value.',
  ],
  or: [
    'Uses the first value that counts as true.',
    'Python skips the right side when the left counts as true. The result need not be a boolean.',
  ],
  not: [
    'Reverses a truth test.',
    'not True is False. It also works with truthy or falsey values such as nonempty or empty lists.',
  ],
  None: [
    'Means there is no value here.',
    'A function without a return value gives back None. None differs from 0 or an empty string.',
  ],
  True: ['The boolean value for yes.', 'A boolean stores a yes/no result, such as 3 > 2.'],
  False: ['The boolean value for no.', 'A boolean stores a yes/no result, such as 3 < 2.'],
  await: [
    'Waits for an asynchronous operation to finish.',
    'It lets other asynchronous work proceed while this operation is waiting.',
  ],
  async: [
    'Defines asynchronous behavior.',
    'An async function returns a coroutine: work that must be awaited or scheduled to run.',
  ],
  try: [
    'Starts a block that may raise an error.',
    'An except block can handle matching errors; finally can perform cleanup.',
  ],
  except: [
    'Handles a matching error.',
    'For example, a program can show a friendly message when reading a missing file raises an error.',
  ],
  with: [
    'Enters and later exits a managed resource.',
    'For example, with open(...) as file arranges to close the file when the block exits.',
  ],
  ':': [
    'Starts an indented body, annotation, or mapping entry.',
    'After if, for, def, or class, indent the following body. A dictionary uses key: value pairs.',
  ],
};
function children(node: Node) {
  const result: Node[] = [];
  for (let n = node.firstChild; n; n = n.nextSibling) result.push(n);
  return result;
}
function lineLookup(code: string) {
  const starts = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') starts.push(i + 1);
  return (offset: number) => {
    let low = 0,
      high = starts.length;
    while (low + 1 < high) {
      const mid = (low + high) >>> 1;
      if (starts[mid] <= offset) low = mid;
      else high = mid;
    }
    return low + 1;
  };
}
function scopeOf(node: Node): Node {
  let n = node.parent;
  while (n?.parent && !scopes.test(n.name)) n = n.parent;
  return n ?? node;
}
const scopeKey = (node: Node) => `${node.name}:${node.from}:${node.to}`;

export function inspectPython(code: string, offset: number, selectionEnd = offset): Snippet {
  const tree = parser.parse(code);
  const text = (node: Node) => code.slice(node.from, node.to);
  const lineAt = lineLookup(code);
  const line = (node: Node) => lineAt(node.from);
  type Binding = { at: number; description: string };
  const bindings = new Map<string, Map<string, Binding[]>>();
  const uncertain = new Set<string>();
  const add = (name: Node, description: string, scope = scopeOf(name)) => {
    const key = scopeKey(scope);
    let names = bindings.get(key);
    if (!names) bindings.set(key, (names = new Map()));
    const entries = names.get(text(name)) ?? [];
    entries.push({ at: name.from, description: `Line ${line(name)}: ${description}` });
    names.set(text(name), entries);
  };
  // Build once, iteratively, so deeply nested or malformed input cannot overflow our call stack.
  const nodes: Node[] = [];
  const cursor = tree.cursor();
  let count = 0;
  do {
    if (++count > 40000) break;
    nodes.push(cursor.node);
  } while (cursor.next());
  for (const n of nodes) {
    const c = children(n);
    if (n.name === 'AssignStatement') {
      const equals = c.findIndex((x) => x.name === 'AssignOp');
      for (const target of c.slice(0, equals)) {
        if (target.name === 'VariableName')
          add(
            target,
            `assigned by ${compact(text(n))}. This describes an assignment, not the value right now.`,
          );
        else if (/Tuple|Array/.test(target.name))
          for (const leaf of children(target))
            if (leaf.name === 'VariableName')
              add(leaf, 'takes one of the values unpacked by this assignment.');
      }
    } else if (n.name === 'ParamList') {
      let first = true;
      for (const item of c) {
        if (item.name === ',') first = true;
        else if (first && item.name === 'VariableName') {
          add(item, 'a parameter, meaning an input supplied to this function.');
          first = false;
        }
      }
    } else if (n.name === 'ImportStatement') {
      const clean = text(n)
        .replace(/#[^\r\n]*/g, '')
        .replace(/[()\r\n]/g, ' ')
        .trim();
      const from = /^from\s+([\w.]+)\s+import\s+(.+)$/u.exec(clean);
      const imports = from?.[2] ?? /^import\s+(.+)$/u.exec(clean)?.[1];
      if (imports?.includes('*')) uncertain.add(scopeKey(scopeOf(n)));
      for (const item of imports?.split(',') ?? []) {
        const m = /^\s*([\w.]+)(?:\s+as\s+(\w+))?\s*$/u.exec(item);
        if (!m) continue;
        const name = m[2] ?? (from ? m[1] : m[1].split('.')[0]);
        const leaf = c
          .slice()
          .reverse()
          .find((x) => x.name === 'VariableName' && text(x) === name);
        if (leaf)
          add(
            leaf,
            `imported ${from ? m[1] + ' from ' + from[1] : m[1]}${m[2] ? ' with the nickname ' + m[2] : ''}. This is the written module path; the installed package or a local file has not been verified.`,
          );
      }
    } else if (n.name === 'ForStatement') {
      const split = c.findIndex((x) => x.name === 'in');
      for (const name of c.slice(1, split))
        if (name.name === 'VariableName')
          add(
            name,
            `receives each item from ${compact(c[split + 1] ? text(c[split + 1]) : 'the loop source')}. The loop may run zero times.`,
          );
    } else if (n.name === 'FunctionDefinition' || n.name === 'ClassDefinition') {
      const name = c.find((x) => x.name === 'VariableName');
      if (name)
        add(
          name,
          `the ${n.name === 'FunctionDefinition' ? 'function' : 'class'} defined here.`,
          scopeOf(n),
        );
    } else if (
      /ScopeStatement|NamedExpression|.*ComprehensionExpression|WithStatement|TryStatement/.test(
        n.name,
      )
    ) {
      // Do not invent a binding when this lightweight index cannot establish Python's scope semantics.
      uncertain.add(scopeKey(scopeOf(n)));
    }
  }
  const origin = (node: Node): string => {
    if (count > 40000)
      return 'This file has too many syntax elements to establish every name safely. Inspect a smaller file for origin details.';
    let initialScope = scopeOf(node);
    // Defaults are evaluated outside the function, even inside a nested default expression.
    for (
      let parent = node.parent;
      parent && scopeKey(parent) !== scopeKey(initialScope);
      parent = parent.parent
    ) {
      if (parent.name === 'ParamList') {
        if (
          !bindings
            .get(scopeKey(initialScope))
            ?.get(text(node))
            ?.some((b) => b.at === node.from)
        )
          initialScope = scopeOf(initialScope);
        break;
      }
    }
    const firstScope = scopeKey(initialScope);
    for (
      let scope: Node | null = initialScope;
      scope;
      scope = scope.parent ? scopeOf(scope) : null
    ) {
      if (scope.name === 'ClassDefinition' && scopeKey(scope) !== firstScope) continue;
      if (uncertain.has(scopeKey(scope)))
        return 'The origin is not established by this local breakdown. Use project context for more help.';
      const candidates = bindings.get(scopeKey(scope))?.get(text(node));
      if (candidates?.length) {
        const earlier = candidates.filter((x) => x.at <= node.from).at(-1);
        if (earlier) return earlier.description;
        if (scope.name === 'FunctionDefinition')
          return 'This function assigns this local name later. Reading it before it receives a value can raise UnboundLocalError.';
      }
    }
    return builtins[text(node)]
      ? `Normally a built-in Python function: ${builtins[text(node)]} No extra library is needed. This is not a check of live runtime values.`
      : 'No local declaration or import for this name was established. Its spelling alone does not prove its source.';
  };
  let selected = tree.resolveInner(Math.min(offset, Math.max(0, code.length - 1)), 1);
  const leaf = selected;
  while (selected.parent && !/Statement$|Definition$/.test(selected.name))
    selected = selected.parent;
  let start =
    selected.name === 'Script'
      ? Math.max(0, code.lastIndexOf('\n', offset - 1) + 1)
      : selected.from;
  let end =
    selected.name === 'Script'
      ? code.indexOf('\n', offset) < 0
        ? code.length
        : code.indexOf('\n', offset)
      : selected.to;
  if (selectionEnd > offset) {
    start = offset;
    end = selectionEnd;
  }
  const parts: Part[] = [];
  for (const n of nodes) {
    if (parts.length >= 80) break;
    if (n.from < start || n.to > end || n.firstChild || /Comment|⚠/.test(n.name) || n.from === n.to)
      continue;
    const token = text(n);
    let description = words[token];
    if (n.name === 'VariableName') description = ['A name used by this code.', origin(n)];
    else if (n.name === 'PropertyName')
      description = [
        'A member of the object or module before the dot.',
        'The dot picks a named item, such as math.sqrt. Its owner determines what it does; the name alone does not prove which library supplies it.',
      ];
    else if (n.name === 'Number')
      description = [
        'A number written directly in the code.',
        `The value ${compact(token)} is written here instead of being read from a variable.`,
      ];
    else if (n.name === 'String')
      description = [
        'Text written directly in the code.',
        'Quotes mark where the text starts and ends. Text is also called a string.',
      ];
    else if (/^[()[\]{},.]$/.test(token))
      description = [
        'Punctuation that groups or separates code.',
        'Parentheses group expressions or function inputs. Square brackets hold list items or indexes; commas separate items. The surrounding code determines its role.',
      ];
    if (description)
      parts.push({
        token: compact(token),
        brief: description[0],
        detail: description[1],
        start: n.from,
        end: n.to,
      });
  }
  return {
    code: code.slice(start, end),
    start,
    end,
    symbol: leaf.name === 'VariableName' ? text(leaf) : '',
    symbolOffset: leaf.from,
    parts,
  };
}

export { pythonErrors } from './python-check';
