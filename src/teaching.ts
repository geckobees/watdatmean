import ts from 'typescript';
import { parser as pythonParser } from '@lezer/python';
import { parse } from './analyzer';
import { inspectCode, languageId } from './languages';
import { pythonErrors } from './python-check';
import type { LearningRequest, Lesson } from './types';
import { uniqueConcepts } from './concepts';
import { explainableFragment } from './selection-fragment';
import { javaSyntaxHelp } from './java-syntax-help';

type Practice = { code: string; explanation: string; question: string };
export interface TeachingNotes {
  facts: string[];
  connections: string[];
  concepts: Lesson['concepts'];
  practice?: Practice;
  incomplete: boolean;
  explainableFragment: boolean;
  unknownCall: boolean;
  topics: Set<string>;
  names: Set<string>;
  trace: { name: string; value: number }[];
}
const definitions: Record<string, string> = {
  variable: 'A name that refers to a value, such as a score or a list of prices.',
  parameter: 'A name for an input that a function receives when you call it.',
  argument: 'The value you give a function when you call it.',
  function: 'A reusable set of instructions. Its body runs when you call it.',
  return: 'Sends a result back to the code that called the function.',
  import:
    'Makes code from another module available here. The written path does not prove the file is installed.',
  module:
    'A reusable unit of code. Its name alone does not prove which file or package is installed.',
  library:
    'Reusable code that other programs can use. An import is a clue to its source, not proof of its version.',
  initializer: "The expression that supplies a variable's starting value.",
  operator: 'A symbol that does a job, such as + for adding numbers or > for comparing them.',
  list: 'An ordered collection of items. Counting the items is different from adding their values.',
  array: 'An ordered collection whose items can be accessed by position.',
  string: 'Text, such as a player name or a message. Quotes mark text written directly in code.',
  boolean:
    'A yes/no value, written as true or false in many languages and True or False in Python.',
  'standard library':
    'Reusable tools that come with a programming language, rather than an extra downloaded package.',
  filter:
    'Keep only the items that pass a test. It does not change the test or automatically sort the items.',
  JSON: 'A text format for sharing data. It can describe objects, lists, text, numbers, true, false, or null.',
  HTTP: 'Rules that a program and a web server use to exchange requests and replies.',
  Promise: 'A JavaScript object representing work that may finish later with a value or an error.',
  const:
    'Creates a name you cannot assign a different value to. An object or array held by it can still change.',
  'square root':
    'A number that, when multiplied by itself, gives the starting number. The square root of 9 is 3.',
  shadowing:
    'A local name hides an outer name inside its own scope. It does not replace the outer name everywhere.',
  borrowing: 'In Rust, use a reference to access a value without taking ownership of it.',
};
// Java-specific meanings must not leak into languages with different dispatch rules.
const javaDefinitions: Record<string, string> = {
  inheritance:
    'A subclass builds on a superclass. It can use inherited behavior and override eligible instance methods, while each class can also declare its own fields.',
  'static method':
    'A method belonging to a class rather than a particular object. Java selects it using the compile-time type; it does not use instance-method overriding.',
  'method override':
    'A subclass supplies a new version of an inherited instance method. The actual object class chooses the implementation at runtime.',
  'super()':
    'An explicit call to the superclass constructor as part of constructing this same object. It is the call that starts superclass construction, not a second call after that construction has already finished.',
  constructor:
    'Setup code for a new object. A superclass constructor can run before the subclass fields receive their written starting values.',
  polymorphism:
    "For an overridden instance method, Java chooses the version using the real class of the object at runtime. A variable typed A can hold a B object and call B's version. Fields and static methods follow different rules.",
  overriding:
    'A subclass supplies a new version of an inherited instance method. Calls can use this version even through a superclass reference.',
  'field hiding':
    'A subclass declares a field with the same name as a superclass field. Both fields still exist; the type of the expression decides which one a field access names.',
  'static method hiding':
    "A subclass declares a static method with the same signature as an inherited static method. The expression's compile-time type chooses the method; the object's runtime class does not.",
  'static nested class':
    'A class declared static inside another class. It does not need an instance of the enclosing class. It is nested, but is not a non-static inner class.',
  'instance initializer':
    "A block that runs while each object is being initialized. After superclass construction, it runs in source order with that class's field initializers, before the rest of its constructor body.",
  cast: 'An explicit type view of a reference, such as (B) x. It does not create or change the object. An incompatible checked reference cast can fail at runtime.',
};

// Local trace terms do not enlarge the schema sent with every model-backed request.
const javaTraceDefinitions: Record<string, string> = {
  'java generics':
    'A type parameter such as T is a placeholder for a type. Box<String> lets the compiler check that its values are strings. A bound such as T extends Number limits allowed types. Box<String> is not a subtype of Box<Object>. Generic bodies are checked using their declared bounds; type arguments do not create separate runtime classes.',
  'java interface':
    'An interface is a contract naming methods an object must provide. A class implements the contract with public methods. Calls use the actual object’s implementation; a default method supplies inherited behavior when there is no class override. Interface static methods belong to the interface itself.',
  'method reference':
    'The :: syntax saves an existing method or constructor as a function. It runs when that function is called. An object::method reference saves and checks its receiver immediately; Type::instanceMethod gets its receiver from the first argument.',
  optional:
    'A java.util.Optional holds one non-null value or is empty. It helps callers handle a missing result. orElse evaluates its fallback immediately; orElseGet calls its supplier only when empty. An empty Optional is different from a null reference.',
  'java stream':
    'A one-use pipeline from java.util.stream. Steps such as filter and map wait until a terminal operation asks for a result; they do not change the source collection.',
  'lambda expression':
    'A small function written with ->. Parameters on the left receive inputs; the expression or block on the right runs when called. Captured local values must not be reassigned.',
  'java array':
    'A fixed number of slots of one component type. Index 0 is the first slot. Assigning the array to another variable shares the same slots.',
  'exception handling':
    'A thrown exception skips ordinary statements until a matching catch handles it. A finally block runs before leaving the try/catch, including on return; a new return or throw there can replace what was pending.',
  loop: 'Repeats a block of code. The condition or items decide when to stop; break exits the loop and continue skips the rest of one pass.',
  collection:
    'A container for several items. A list keeps positions, a set keeps distinct values, and a map connects keys to values.',
  'method overloading':
    'Methods share a name but accept different parameter types or counts. Java picks a signature from declared types first; an override can then supply that signature’s implementation at runtime.',
};
export function definition(term: string, language: string) {
  const javaAliases: Record<string, string> = {
    'polymorphism (dynamic dispatch)': 'polymorphism',
    'dynamic (virtual) dispatch': 'polymorphism',
    'dynamic dispatch': 'polymorphism',
    'static method dispatch': 'static method',
    'instance initializers': 'instance initializer',
  };
  const lower = term.toLowerCase();
  const javaTerm = Object.hasOwn(javaAliases, lower) ? javaAliases[lower] : lower;
  if (language === 'java' && Object.hasOwn(javaTraceDefinitions, javaTerm))
    return javaTraceDefinitions[javaTerm];
  if (language === 'java' && Object.hasOwn(javaDefinitions, javaTerm))
    return javaDefinitions[javaTerm];
  const key = Object.keys(definitions).find((k) => k.toLowerCase() === term.toLowerCase());
  if (!key || (key === 'const' && !/^(typescript|javascript)/.test(language))) return;
  return definitions[key];
}

/** Advertise names only; reviewed definitions are inserted locally after the reply. */
export function definitionTerms(language: string): string[] {
  return [
    ...Object.keys(definitions),
    ...(language === 'java' ? Object.keys(javaDefinitions) : []),
  ].filter((term) => definition(term, language) !== undefined);
}

/** A contextual expansion of a reviewed Java rule, not a repeated one-line definition.
 * Only use it for one unambiguous, visible superclass-typed construction. Other concepts
 * and structures still use the provider; no output or arbitrary program behavior is inferred.
 */
export function contextualConcept(request: LearningRequest): Lesson | undefined {
  if (
    request.task !== 'concept' ||
    languageId(request.language ?? '') !== 'java' ||
    !/^(polymorphism(?:\s*\(dynamic dispatch\))?|dynamic(?: \(virtual\))? dispatch)$/i.test(
      request.concept ?? '',
    )
  )
    return;
  const clean = mask(request.code, 'java');
  const classes = [
    ...clean.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)\s+extends\s+([A-Za-z_$][\w$]*)\b/g),
  ];
  const bindings = [
    ...clean.matchAll(
      /\b([A-Za-z_$][\w$]*)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+([A-Za-z_$][\w$]*)\s*\(/g,
    ),
  ].filter((m) => classes.some((c) => c[1] === m[3] && c[2] === m[1]));
  if (bindings.length !== 1) return;
  const [, base, name, child] = bindings[0];
  return {
    title: 'How polymorphism applies here',
    summary: `${name} is declared as ${base}, but new ${child}() creates a ${child} object.`,
    steps: [
      `For an overridden instance method called through ${name}, Java chooses ${child}'s version using the real object's class. This is dynamic dispatch: one shared type can support different behavior, such as different screen items drawing themselves.`,
      `A superclass constructor can also call an overridden method before the subclass's field initializers run. Fields declared by the subclass may still hold defaults such as null or 0 during that earlier call.`,
      `Fields and static methods use the expression's compile-time type instead. If both classes declare the same field, ${name} selects the ${base} field; a cast to ${child} can select the ${child} field without changing the object.`,
    ],
    note: '@Override lets the compiler check an override; it does not cause runtime dispatch. Constructors themselves are not overridden.',
    concepts: [{ term: 'polymorphism', explanation: javaDefinitions.polymorphism }],
    example: { code: '', explanation: '' },
    predictions: [],
    checks: [],
    local: true,
    notice: 'Reviewed Java rules applied to the declarations in this selection.',
  };
}

/** A narrow, reviewed constructor pattern with missing declarations. Do not extrapolate field
 * types, values or output, or replace explanations backed by actual surrounding code. */
export function fragmentLesson(request: LearningRequest): Lesson | undefined {
  if (
    !['explain', 'walkthrough'].includes(request.task) ||
    languageId(request.language ?? '') !== 'java' ||
    (request.mode === 'project' && (request.context?.trim() || request.evidence?.length))
  )
    return;
  const clean = mask(request.code, 'java');
  const match =
    /^\s*(?:(?:public|protected|private)\s+)?(?<owner>[A-Za-z_$][\w$]*)\s*\(\s*\)\s*\{\s*super\s*\(\s*\)\s*;\s*(?<method>[A-Za-z_$][\w$]*)\s*\(\s*\)\s*;\s*(?<field>[A-Za-z_$][\w$]*)\s*\+=\s*(?<amount>\d+)\s*;\s*\}\s*@Override\s*(?:(?:public|protected|private)\s+)?void\s+\k<method>\s*\(\s*\)\s*\{\s*System\s*\.\s*out\s*\.\s*print\s*\((?<expression>[^();{}]+)\)\s*;\s*\}\s*$/d.exec(
      clean,
    );
  if (!match?.groups || !match.indices?.groups) return;
  const [start, end] = match.indices.groups.expression;
  const expression = request.code.slice(start, end);
  // Require the visible four field accesses and trailing space, rather than assuming
  // anything about arbitrary expressions, calls, comments or string contents.
  if (
    !/^\s*([A-Za-z_$][\w$]*)\s*\+\s*([A-Za-z_$][\w$]*)\s*\+\s*super\.\1\s*\+\s*super\.\2\s*\+\s*" "\s*$/.test(
      expression,
    )
  )
    return;
  const { owner, method, field, amount } = match.groups;
  return {
    title: 'Constructor and method, together',
    summary: `${owner} calls its superclass constructor, calls ${method}(), then updates ${field}.`,
    steps: [
      `super() runs the superclass (parent) constructor. After it returns, ${owner}'s field initializers and initializer blocks (its setup code) run before ${method}().`,
      `${method}() calls an instance method, which a subclass can override. The shown method prints field values: super selects parent fields. The bare names may be inherited; their declarations are not shown.`,
      `${field} += ${amount} runs after ${method}(). For a numeric ${field}, it adds ${amount} to its existing value, rather than setting it to ${amount}.`,
    ],
    note: 'An override called inside the parent constructor could run earlier, before subclass setup. Also, + can add numbers before it starts joining text; it inserts no spaces of its own.',
    output: {
      text: '',
      explanation:
        'Exact values and output need the field types, initializers and superclass constructor. Missing declarations do not mean zero or null.',
    },
    concepts: [
      { term: 'super()', explanation: javaDefinitions['super()'] },
      {
        term: '@Override',
        explanation:
          'Asks the compiler to check that this method overrides or implements an eligible method. The annotation does not cause runtime dispatch.',
      },
    ],
    example: { code: '', explanation: '' },
    predictions: [],
    checks: [],
    local: true,
  };
}

// Remove comments and quoted contents before topic matching. Text in a comment or string is never
// evidence that the program imports a library or uses an operation. Preserve offsets and newlines.
function mask(code: string, language: string) {
  const ranges: [number, number][] = [];
  if (language === 'python') {
    const cursor = pythonParser.parse(code).cursor();
    do {
      if (/^(Comment|String|FormatString)$/.test(cursor.name))
        ranges.push([cursor.from, cursor.to]);
    } while (cursor.next());
  } else {
    const scanner = ts.createScanner(
      ts.ScriptTarget.Latest,
      false,
      ts.LanguageVariant.Standard,
      code,
    );
    for (
      let token = scanner.scan();
      token !== ts.SyntaxKind.EndOfFileToken;
      token = scanner.scan()
    ) {
      if (
        [
          ts.SyntaxKind.SingleLineCommentTrivia,
          ts.SyntaxKind.MultiLineCommentTrivia,
          ts.SyntaxKind.StringLiteral,
          ts.SyntaxKind.NoSubstitutionTemplateLiteral,
          ts.SyntaxKind.TemplateHead,
          ts.SyntaxKind.TemplateMiddle,
          ts.SyntaxKind.TemplateTail,
        ].includes(token)
      )
        ranges.push([scanner.getTokenPos(), scanner.getTextPos()]);
    }
  }
  const chars = code.split('');
  for (const [start, end] of ranges)
    for (let i = start; i < end; i++) if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
  return chars.join('');
}

type Value = number | number[];
// A deliberately small arithmetic reader. It only handles numeric literals, known local names,
// lists and + - * /. No eval, VM, function execution, getters, module imports, or user tools.
function arithmetic(
  expression: string,
  values: Map<string, Value>,
  python: boolean,
  mathAliases = new Set<string>(),
): Value | undefined {
  // JavaScript ++/-- update an assignable target; they are not two unary signs.
  if (!python && /\+\+|--/.test(expression)) return;
  const tokens = expression.match(/\d+(?:\.\d+)?|[A-Za-z_]\w*|\/\/|[+*/()[\],-]|\S/g) ?? [];
  if (tokens.length > 80) return;
  let at = 0,
    depth = 0;
  const safe = (n: number) =>
    Number.isFinite(n) &&
    Math.abs(n) <= 1e9 &&
    (Number.isInteger(n) ? Number.isSafeInteger(n) : true);
  function atom(): Value | undefined {
    if (++depth > 16) return;
    const token = tokens[at++];
    let result: Value | undefined;
    if (token === '(') {
      result = sum();
      if (tokens[at++] !== ')') result = undefined;
    } else if (
      python &&
      mathAliases.has(token) &&
      !values.has(token) &&
      tokens[at++] === '.' &&
      tokens[at++] === 'sqrt' &&
      tokens[at++] === '('
    ) {
      const value = sum();
      if (typeof value === 'number' && value >= 0 && tokens[at++] === ')')
        result = Math.sqrt(value);
    } else if (python && token === 'sum' && !values.has('sum') && tokens[at++] === '(') {
      const items = sum();
      if (Array.isArray(items) && tokens[at++] === ')') result = items.reduce((a, b) => a + b, 0);
    } else if (token === '[') {
      const list: number[] = [];
      while (at < tokens.length && tokens[at] !== ']' && list.length < 32) {
        const item = sum();
        if (typeof item !== 'number') return;
        list.push(item);
        if (tokens[at] !== ',') break;
        at++;
      }
      if (tokens[at++] === ']') result = list;
    } else if (token === '+' || token === '-') {
      const value = atom();
      if (typeof value === 'number') result = token === '-' ? -value : value;
    } else if (/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(token ?? '')) result = Number(token);
    else if (token && values.has(token)) result = values.get(token);
    depth--;
    return typeof result === 'number' && !safe(result) ? undefined : result;
  }
  function product(): Value | undefined {
    let left = atom();
    while (['*', '/', '//'].includes(tokens[at])) {
      const op = tokens[at++],
        right = atom();
      if (
        typeof left !== 'number' ||
        typeof right !== 'number' ||
        (op !== '*' && right === 0) ||
        // Python float floor division has additional rounding rules (1.0 // 0.1 is 9).
        (op === '//' && (!python || !Number.isInteger(left) || !Number.isInteger(right)))
      )
        return;
      left = op === '*' ? left * right : op === '//' ? Math.floor(left / right) : left / right;
      if (!safe(left)) return;
    }
    return left;
  }
  function sum(): Value | undefined {
    let left = product();
    while (['+', '-'].includes(tokens[at])) {
      const op = tokens[at++],
        right = product();
      if (typeof left !== 'number' || typeof right !== 'number') return;
      left = op === '+' ? left + right : left - right;
      if (!safe(left)) return;
    }
    return left;
  }
  const value = sum();
  return at === tokens.length ? value : undefined;
}

function numericTrace(code: string, language: string): TeachingNotes['trace'] {
  const assignments: { name: string; expression: string }[] = [];
  const mathAliases = new Set<string>();
  if (/^(typescript|javascript)/.test(language)) {
    const names = new Set<string>();
    for (const statement of parse(code, language).statements) {
      if (!ts.isVariableStatement(statement)) return [];
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) return [];
        if (names.has(declaration.name.text)) return [];
        names.add(declaration.name.text);
        assignments.push({
          name: declaration.name.text,
          expression: declaration.initializer.getText(),
        });
      }
    }
  } else if (language === 'python') {
    const tree = pythonParser.parse(code);
    for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
      if (node.name === 'Comment') continue;
      if (node.name === 'ImportStatement') {
        const math = /^import\s+math(?:\s+as\s+([A-Za-z_]\w*))?$/.exec(
          code.slice(node.from, node.to),
        );
        if (!math || assignments.length) return [];
        mathAliases.add(math[1] ?? 'math');
        continue;
      }
      if (node.name === 'ExpressionStatement') {
        const printed = /^print\(([^\r\n]*)\)$/.exec(code.slice(node.from, node.to));
        if (!printed) return [];
        assignments.push({ name: '', expression: printed[1] });
        continue;
      }
      if (node.name !== 'AssignStatement') return [];
      const name = node.firstChild,
        op = name?.nextSibling,
        value = op?.nextSibling;
      if (name?.name !== 'VariableName' || op?.name !== 'AssignOp' || !value || value.nextSibling)
        return [];
      assignments.push({
        name: code.slice(name.from, name.to),
        expression: code.slice(value.from, value.to),
      });
    }
  } else return [];
  if (assignments.length > 20) return [];
  const values = new Map<string, Value>(),
    trace: TeachingNotes['trace'] = [];
  for (const item of assignments) {
    const value = arithmetic(item.expression, values, language === 'python', mathAliases);
    if (value === undefined || (!item.name && values.has('print'))) return [];
    if (!item.name) continue;
    values.set(item.name, value);
    const old = trace.findIndex((f) => f.name === item.name);
    if (old >= 0) trace.splice(old, 1);
    if (typeof value === 'number') trace.push({ name: item.name, value });
  }
  return trace.slice(-3);
}

function missingHelper(code: string, language: string, request: LearningRequest) {
  const declared = new Set<string>(),
    imported = new Set<string>(),
    calls: ts.CallExpression[] = [];
  const provided = new Set<string>();
  if (request.mode === 'project')
    for (const evidence of request.evidence ?? []) {
      if (evidence.kind !== 'definition') continue;
      const source = parse(evidence.code, language) as ts.SourceFile & {
        parseDiagnostics: unknown[];
      };
      if (source.parseDiagnostics.length) continue;
      for (const statement of source.statements) {
        if (ts.isFunctionDeclaration(statement) && statement.name && statement.body)
          provided.add(statement.name.text);
        if (ts.isVariableStatement(statement))
          for (const item of statement.declarationList.declarations)
            if (
              ts.isIdentifier(item.name) &&
              item.initializer &&
              (ts.isArrowFunction(item.initializer) || ts.isFunctionExpression(item.initializer))
            )
              provided.add(item.name.text);
      }
    }
  const pending: ts.Node[] = [parse(code, language)];
  let remaining = 5000;
  while (pending.length && remaining-- > 0) {
    const node = pending.pop()!;
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name)
    )
      declared.add(node.name.text);
    if (ts.isImportSpecifier(node) || ts.isImportClause(node) || ts.isNamespaceImport(node)) {
      if (node.name) imported.add(node.name.text);
    }
    if (ts.isCallExpression(node)) calls.push(node);
    ts.forEachChild(node, (child) => {
      pending.push(child);
    });
  }
  const standard = new Set([
    'console',
    'Math',
    'Number',
    'String',
    'Boolean',
    'Array',
    'Object',
    'JSON',
    'Promise',
    'fetch',
    'parseInt',
    'parseFloat',
    'setTimeout',
  ]);
  return calls.some((call) => {
    let owner = call.expression;
    while (ts.isPropertyAccessExpression(owner) || ts.isElementAccessExpression(owner))
      owner = owner.expression;
    return (
      ts.isIdentifier(owner) &&
      !provided.has(owner.text) &&
      (imported.has(owner.text) || (!declared.has(owner.text) && !standard.has(owner.text)))
    );
  });
}
const numberText = (value: number) =>
  Number.isInteger(value) ? String(value) : `about ${Number(value.toPrecision(6))}`;

const samples: Record<string, Practice> = {
  python: {
    code: 'price = 3\nquantity = 4\ntotal = price * quantity\nprint(total)',
    explanation:
      'A shop works out the cost of four items. 3 × 4 is 12, so this separate example prints 12.',
    question:
      'In this example, what is total if quantity becomes 5? Answer: 15, because 3 × 5 = 15.',
  },
  typescript: {
    code: 'const price = 3;\nconst quantity = 4;\nconst total = price * quantity;\nconsole.log(total);',
    explanation:
      'A shop works out the cost of four items. 3 × 4 is 12, so this separate example prints 12.',
    question:
      'In this example, what is total if quantity becomes 5? Answer: 15, because 3 × 5 = 15.',
  },
  calls: {
    code: 'function double(points) { return points * 2; }\nconst result = double(3);\nconsole.log(result);',
    explanation:
      'A game doubles a score. This separate example includes the helper, so its result is known: 3 × 2 = 6.',
    question:
      'Can a function name alone tell you its result? Answer: No. You need its instructions and inputs.',
  },
  sum: {
    code: 'prices = [2, 3, 4]\ntotal = sum(prices)\nprint(total)',
    explanation:
      'Add three prices for a receipt. With the normal Python built-in sum, 2 + 3 + 4 = 9, so this separate example prints 9.',
    question:
      'In this example, would len(prices) also give 9? Answer: No. len counts 3 items; sum adds their values to get 9.',
  },
  sqrt: {
    code: 'import math\nlength = math.sqrt(2 * 2 + 3 * 3)\nprint(round(length, 2))',
    explanation:
      'Find the diagonal distance across a 2-by-3 game map. With the standard math module, it is about 3.61. round(..., 2) makes this separate example print 3.61.',
    question:
      'What number multiplied by itself gives 9? Answer: 3. The nonnegative square root of 9 is 3.',
  },
  requests: {
    code: 'import json\nitems = json.loads("[2, 3]")\nprint(len(items))',
    explanation:
      'A shopping app can read item IDs from JSON text. This separate standard-library example uses fixed text instead of a network call and prints 2.',
    question:
      'Must a JSON reply be a dictionary? Answer: No. For example, [2, 3] becomes a Python list.',
  },
  async: {
    code: 'async function double(points) { return points * 2; }\ndouble(3).then(value => console.log(value));',
    explanation:
      'A game uses a result when it is ready. double(3) returns a Promise. It resolves to 6; the callback then prints 6.',
    question:
      'Does double(3) return the number 6 immediately? Answer: No. It returns a Promise that resolves to 6.',
  },
  java: {
    code: 'import java.util.ArrayList;\nclass Basket {\n  public static void main(String[] args) {\n    var items = new ArrayList<String>();\n    items.add("apple");\n    items.add("pear");\n    System.out.println(items.size());\n  }\n}',
    explanation:
      'A shopping basket counts two items. With the standard Java ArrayList, this separate example prints 2. size counts items, not the lengths of their names.',
    question:
      'Can an ArrayList store text rather than numbers? Answer: Yes. This example uses String as its item type.',
  },
  csharp: {
    code: 'using System.Linq;\nint[] scores = { 2, 5, 8 };\nvar passed = scores.Where(score => score > 5).ToArray();\nSystem.Console.WriteLine(string.Join(", ", passed));',
    explanation:
      'A score board keeps scores strictly above 5. With standard LINQ, this separate example prints 8. The score 5 does not pass > 5.',
    question:
      'For the number 5, which test is true: 5 > 5 or 5 >= 5? Answer: Only 5 >= 5. The equals part includes the boundary.',
  },
  go: {
    code: 'package main\nimport "fmt"\nfunc main() {\n    boxes := 3\n    perBox := 4\n    fmt.Println(boxes * perBox)\n}',
    explanation:
      'A warehouse counts items in three boxes. With the standard fmt package, this separate example prints 12.',
    question: 'In this example, what if boxes becomes 5? Answer: 20, because 5 × 4 = 20.',
  },
  rust: {
    code: 'fn main() {\n    let name = String::from("Ada");\n    let borrowed = &name;\n    println!("{}", borrowed);\n}',
    explanation:
      'A game displays a player name without copying the text or moving its ownership. This separate standard-library example prints Ada.',
    question: 'Does &name copy the text? Answer: No. It borrows access to the existing value.',
  },
  shadow: {
    code: 'import math\ndef calculate(number):\n    return math.sqrt(number)\nprint(calculate(9))',
    explanation:
      'For a distance calculation, give the input a different name from the module. With the standard math module, this separate example prints 3.0.',
    question:
      'If an input is named math, does it replace the imported name everywhere? Answer: No. It hides that name only inside that function.',
  },
};

export function teachingNotes(request: LearningRequest): TeachingNotes {
  const notes: TeachingNotes = {
    facts: [],
    connections: [],
    concepts: [],
    incomplete: false,
    explainableFragment: false,
    unknownCall: false,
    topics: new Set(),
    names: new Set(),
    trace: [],
  };
  const language = languageId(request.language ?? 'TypeScript'),
    code = request.code;
  const add = (topic: string, facts: string[], terms: string[], practice?: Practice) => {
    notes.topics.add(topic);
    notes.facts.push(...facts);
    for (const term of terms) {
      const explanation = definition(term, language);
      if (explanation && !notes.concepts.some((c) => c.term === term))
        notes.concepts.push({ term, explanation });
    }
    if (practice) notes.practice = practice;
  };
  try {
    const clean = mask(code, language);
    if (language === 'java') {
      const nested = [
        ...clean.matchAll(
          /\bstatic\s+class\s+([A-Za-z_$][\w$]*)(?:\s+extends\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*))?/g,
        ),
      ].slice(0, 6);
      for (const match of nested) {
        notes.connections.push(
          `${match[1]} is declared as a static nested class. It is inside another class, but does not need an object of that enclosing class. Java distinguishes this from a non-static inner class.`,
        );
        if (match[2])
          notes.connections.push(
            `${match[1]} extends ${match[2]}: ${match[1]} is the subclass and ${match[2]} is its superclass. Nesting groups the classes in the source; inheritance connects their behavior. These are separate relationships.`,
          );
      }
      if (nested.length)
        notes.concepts.push({
          term: 'static nested class',
          explanation: javaDefinitions['static nested class'],
        });
      if (/\bSystem\.out\.print(?:ln)?\s*\(/.test(clean))
        notes.connections.push(
          'With the standard java.lang.System, System.out is a java.io.PrintStream for text output. print writes its text; println also ends the line. These are standard-library tools, while classes declared in this selection are your own code.',
        );
    }
    notes.names = new Set(clean.match(/[A-Za-z_]\w*/g) ?? []);
    if (language === 'java' && ['explain', 'walkthrough'].includes(request.task)) {
      const syntax = javaSyntaxHelp(code);
      notes.incomplete = !!syntax;
      notes.explainableFragment = !!syntax?.partial;
    } else if (language === 'python') {
      const cursor = pythonParser.parse(code).cursor();
      do {
        if (cursor.type.isError) {
          notes.incomplete = true;
          break;
        }
      } while (cursor.next());
      if (!notes.incomplete && pythonErrors(code).length) {
        const nested = code
          .split('\n')
          .map((line) => '        ' + line)
          .join('\n');
        notes.incomplete =
          pythonErrors('async def __wdm():\n    for __item in []:\n' + nested).length > 0;
      }
    } else if (/^(typescript|javascript)/.test(language)) {
      const invalid = (text: string) =>
        (parse(text, language) as ts.SourceFile & { parseDiagnostics: unknown[] }).parseDiagnostics
          .length > 0;
      // A selected class member or function-body fragment can be valid in its surrounding file.
      notes.incomplete =
        invalid(code) &&
        invalid(`class __Wdm { ${code}\n}`) &&
        invalid(`function __Wdm() { ${code}\n}`);
    }
    if (notes.incomplete) {
      notes.explainableFragment ||= explainableFragment(code, language);
      if (notes.explainableFragment) {
        notes.unknownCall = true;
        notes.facts.push(
          'This selection contains complete visible operations but stops before closing punctuation. Explain how those operations work together. The surrounding file may supply the closing code; do not call the whole file broken, invent missing values, or claim a complete result.',
        );
        return notes;
      }
      add(
        'incomplete',
        [
          'The selected text is incomplete on its own. Missing surrounding code may supply some parts.',
          'Finish the missing syntax before predicting a result. This selection has not been run.',
        ],
        [],
        language === 'python' ? samples.sum : language === 'java' ? undefined : samples.typescript,
      );
      return notes;
    }
    if (/^(typescript|javascript|python)/.test(language)) {
      const snippet = inspectCode(code, 0, code.length, language);
      const origin = snippet.parts.filter((p) =>
        /Line \d|Declared|declared|imported|parameter|initialized/.test(p.detail),
      );
      for (const part of origin.slice(0, 2))
        notes.facts.push(`${part.token}: ${part.detail.slice(0, 190)}`);
      if (language === 'python') {
        const cursor = pythonParser.parse(code).cursor();
        do {
          if (cursor.name !== 'CallExpression') continue;
          let owner = cursor.node.firstChild;
          while (owner?.name === 'MemberExpression') owner = owner.firstChild;
          const part =
            owner && snippet.parts.find((p) => p.start === owner.from && p.end === owner.to);
          // The bounded local index deliberately gives up on some complex scopes. That is
          // missing analyzer coverage, not evidence that a helper is absent from this code.
          if (part && /No local declaration|spelling alone/.test(part.detail))
            notes.unknownCall = true;
        } while (cursor.next());
      }
    }
    notes.trace = numericTrace(code, language);
    if (notes.trace.length) notes.unknownCall = false;
    if (notes.trace.length)
      add(
        'arithmetic',
        notes.trace.map(
          (x) =>
            `Using the written assignments, ${x.name} becomes ${numberText(x.value)}. This calculation assumes normal built-ins and any standard math import; the program has not been run.`,
        ),
        ['variable', 'operator'],
        language === 'python' ? samples.python : samples.typescript,
      );
    if (/^(typescript|javascript)/.test(language) && /\bconst\b/.test(clean))
      add('const', [definitions.const], ['const']);
    if (language === 'python' && /\bsum\s*\(/.test(clean))
      add(
        'sum',
        [
          'If sum refers to the normal Python built-in, it adds the items. For example, sum([2, 3, 4]) gives 9. A user-defined sum may do something else.',
        ],
        ['list', 'function'],
        samples.sum,
      );
    if (language === 'python' && /\.sqrt\s*\(/.test(clean))
      add(
        'sqrt',
        [
          'If this is the standard math.sqrt, it finds the nonnegative square root. A written module name is not proof of the installed file.',
        ],
        ['square root'],
        samples.sqrt,
      );
    if (language === 'python' && /\.raise_for_status\s*\(/.test(clean) && /\.json\s*\(/.test(clean))
      add(
        'requests',
        [
          'If this is a Requests response, raise_for_status raises an HTTPError for 400–599 statuses. It does not reject every status other than 200.',
          'JSON can describe a dictionary, list, string, number, boolean, or null. response.json() does not promise a dictionary. The server reply is unknown here.',
        ],
        ['HTTP', 'JSON'],
        samples.requests,
      );
    let asyncFunction = false;
    if (/^(typescript|javascript)/.test(language)) {
      const pending: ts.Node[] = [parse(code, language)];
      let remaining = 5000;
      while (pending.length && remaining-- > 0) {
        const node = pending.pop()!;
        if (
          ts.canHaveModifiers(node) &&
          ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) &&
          !('asteriskToken' in node && node.asteriskToken)
        ) {
          asyncFunction = true;
          break;
        }
        ts.forEachChild(node, (child) => {
          pending.push(child);
        });
      }
    }
    if (asyncFunction)
      add(
        'async',
        [
          'Calling an async function returns a Promise, not the final value directly. await waits for a Promise to finish; the function then continues.',
          'For a network reply, the actual data and its shape are unknown until the reply arrives. Reading user.name does not prove that it is text.',
        ],
        ['Promise'],
        samples.async,
      );
    if (language === 'java' && /\bArrayList\b/.test(clean))
      add(
        'java',
        [
          "If this is java.util.ArrayList, it is a resizable list class in Java's standard library. It can hold many item types; Integer chooses whole-number objects here only when that type is written.",
          'new creates a list object. add puts an item into it; size counts its items. The written import is a source clue, not a check of an installed library.',
        ],
        ['list', 'import'],
        samples.java,
      );
    if (language === 'csharp' && /\.Where\s*\(/.test(clean))
      add(
        'csharp',
        [
          'If this is standard System.Linq, Where keeps items whose test is true; ToArray stores the kept items in an array.',
          'For numbers, > means greater than; >= means greater than or equal to. 5 > 5 is false. 5 >= 5 is true.',
        ],
        ['filter', 'array'],
        samples.csharp,
      );
    if (language === 'go' && /\bfmt\.Println\s*\(/.test(clean))
      add(
        'go',
        [
          'If fmt is the standard Go package, fmt.Println displays its inputs. := declares at least one new local name and gives values to the names on its left.',
        ],
        ['variable'],
        samples.go,
      );
    if (language === 'rust' && /=\s*&\s*(?!mut\b)\w+/.test(clean))
      add(
        'rust',
        [
          '&name borrows access to name without moving its ownership or copying its contents. A shared reference allows reading.',
          'A shared borrow prevents conflicting mutation while it is in use. Its lifetime can end at its last use; a name still being in scope is not enough to decide.',
        ],
        ['borrowing'],
        samples.rust,
      );
    if (language === 'python') {
      const shadow = inspectCode(code, 0, code.length, language).parts.find(
        (p) =>
          /parameter/.test(p.detail) &&
          new RegExp(`\\b(?:import\\s+${p.token}\\b|as\\s+${p.token}\\b)`).test(clean) &&
          new RegExp(`\\b${p.token}\\.`).test(clean),
      );
      if (shadow)
        add(
          'shadow',
          [
            `${shadow.token} is a parameter: the caller supplies its value. Inside this function it hides the outer import; it does not hide the import globally.`,
            'The argument might be a module or another object with the required method. Without the call, its result or an error is not established.',
          ],
          ['parameter', 'shadowing'],
          samples.shadow,
        );
    }
    const imported = /\bimport\b/.test(clean);
    if (imported)
      add(
        'import',
        [
          'An import gives a written module path. It does not prove that a file exists, is installed, or has a particular version.',
        ],
        ['import'],
      );
    if (/^(typescript|javascript)/.test(language))
      notes.unknownCall = missingHelper(code, language, request);
    if (notes.unknownCall && !notes.topics.has('shadow')) {
      notes.facts.push(
        'A called helper or its inputs are not fully established here. Do not guess its result from its name; the exact result is unknown from this code.',
      );
      if (!notes.practice && /^(typescript|javascript)/.test(language))
        notes.practice = samples.calls;
    }
    // Keep the most relevant topic facts; generic origins must not crowd out semantic corrections.
    notes.facts = [...new Set(notes.facts)].slice(-6);
    notes.concepts = notes.concepts.slice(-3);
  } catch {
    notes.facts = [
      'The selected text does not establish every input or helper. Explain only what is visible; the exact result may be unknown.',
    ];
  }
  return notes;
}

export function localLesson(
  request: LearningRequest,
  notes: TeachingNotes,
  notice: string,
): Lesson {
  const deep = request.task === 'walkthrough' || request.task === 'explain';
  const facts = notes.facts.length
    ? notes.facts
    : [
        'This selection does not show enough detail to check the explanation. Follow each name to its declaration and each call to its definition before predicting a result.',
      ];
  const summaries: Record<string, string> = {
    shadow:
      'This function gets an input from its caller. Its input name hides the imported name inside the function, so the actual object and result are unknown here.',
    requests:
      'This code asks a server for data and reads its reply. The reply may contain different kinds of JSON data; its contents are unknown here.',
    async:
      'An async function returns a Promise: an object for a result that may arrive later. The caller uses await or .then(...) to receive that result.',
    java: "This code uses a list. If the name refers to Java's standard ArrayList, add puts items in it and size counts how many items it holds.",
    csharp:
      'If this is standard LINQ, the code keeps only items that pass a test. The > and >= tests differ at the boundary: only >= includes equality.',
    rust: 'This code borrows access to a value. A shared reference allows reading without copying the value or taking its ownership.',
    sqrt: 'The code calls a square-root function. If it is the standard math.sqrt, it finds the nonnegative number whose square gives the input.',
    go: 'With the standard fmt package, fmt.Println displays the values given to it. The := statement gives values to local names, including at least one new name.',
    sum: "With Python's normal built-in sum, this code adds the numbers in a collection. Counting the items with len is a different operation.",
  };
  const topic = Object.keys(summaries).find((key) => notes.topics.has(key));
  const summary = notes.incomplete
    ? 'This selection is incomplete on its own. It does not establish a result.'
    : topic
      ? summaries[topic]
      : notes.unknownCall
        ? 'This code calls a helper whose full behavior is not shown. The exact result is unknown from this code.'
        : facts[0];
  return {
    title: notes.explainableFragment
      ? 'About this partial selection'
      : notes.incomplete
        ? 'Finish the selected code first'
        : 'Read the code one step at a time',
    summary,
    steps: deep ? lessonSteps(notes).filter((step) => step !== summary) : [],
    concepts: deep ? notes.concepts : notes.concepts.slice(0, 2),
    example:
      request.task === 'walkthrough' && notes.practice
        ? { code: notes.practice.code, explanation: notes.practice.explanation }
        : { code: '', explanation: '' },
    predictions: [],
    checks: request.task === 'walkthrough' && notes.practice ? [notes.practice.question] : [],
    notice,
  };
}

function lessonSteps(notes: TeachingNotes) {
  const origin = notes.facts.find((f) => /Line \d|\bimported\b|\bDeclared\b/.test(f));
  const rest = notes.facts.filter((f) => f !== origin);
  return origin ? [origin, ...rest.slice(-3)] : rest.slice(-4);
}

/** Checks known failure modes; it is not a general proof that arbitrary model prose is true. */
export function reviewLesson(
  request: LearningRequest,
  lesson: Lesson,
  notes = teachingNotes(request),
): Lesson {
  const fragment = fragmentLesson(request);
  if (fragment) return { ...fragment, ...(lesson.usage ? { usage: lesson.usage } : {}) };
  const language = languageId(request.language ?? 'TypeScript');
  // Fix a known definition without throwing away an otherwise useful execution trace.
  lesson = {
    ...lesson,
    concepts: uniqueConcepts(lesson.concepts).map((c) => ({
      ...c,
      explanation: definition(c.term, language) ?? c.explanation,
    })),
  };
  // A concept expansion should teach that concept in context, not be replaced by a lesson
  // about some unrelated operation elsewhere in the selection.
  if (request.task === 'concept') return contextualConcept(request) ?? { ...lesson, checks: [] };
  // Reviewed dictionary text is already trusted here. In particular, its warning that
  // an import does NOT prove a file is installed must not trigger the positive-claim guard.
  const main = [
    lesson.summary,
    ...lesson.steps,
    ...lesson.concepts.filter((c) => !definition(c.term, language)).map((c) => c.explanation),
  ].join(' ');
  const reasons: string[] = [];
  if (notes.incomplete && !notes.explainableFragment) reasons.push('incomplete');
  if (/\b(?:I (?:will )?guess|Invalid reasoning)\b/i.test(main)) reasons.push('guess');
  if (/\b(?:quiz|answer\s*:)/i.test(main)) reasons.push('unverified quiz');
  if (
    language === 'python' &&
    /\b(?:const|undefined)\b/.test(main) &&
    !notes.names.has('const') &&
    !notes.names.has('undefined')
  )
    reasons.push('wrong language');
  if (notes.topics.has('async') && !/\bpromise\b/i.test(main)) reasons.push('async result');
  if (
    notes.topics.has('async') &&
    /function's result is now that string|returns? (?:the )?(?:number|string) .{0,20}immediately/i.test(
      main,
    )
  )
    reasons.push('async result');
  if (
    notes.topics.has('requests') &&
    (/non-200/i.test(main) ||
      /(?:into|becomes?|returns?) (?:a |an? Python )?dictionary/i.test(main))
  )
    reasons.push('HTTP/JSON');
  if (
    notes.topics.has('java') &&
    /(?:built-in list for numbers|only (?:holds?|stores?) numbers)/i.test(main)
  )
    reasons.push('list type');
  if (
    notes.topics.has('const') &&
    /(?:const|constant)[^.]{0,60}(?:freez|immutable|never changes|cannot (?:change|be changed))/i.test(
      main,
    )
  )
    reasons.push('const meaning');
  if (
    notes.topics.has('shadow') &&
    /globally|any valid call|causes an error|is undefined/i.test(main)
  )
    reasons.push('shadowing');
  if (
    notes.topics.has('import') &&
    /(?:file|library|module|package) (?:exists|is installed)|(?:proves?|confirms?) .{0,25}(?:exists|installed)/i.test(
      main,
    )
  )
    reasons.push('import existence');
  if (
    notes.unknownCall &&
    !notes.explainableFragment &&
    !/unknown|cannot (?:tell|know|determine)|not (?:shown|provided)|depends on|missing/i.test(main)
  )
    reasons.push('unknown result');
  if (
    /\b(?:assertion|ellipsis|numpy)\b/i.test(main) &&
    !/\b(?:assert|\.\.\.|numpy)\b/.test(mask(request.code, language))
  )
    reasons.push('absent operation');
  if (lesson.steps.some((s) => s.trim().split(/\s+/).length < 2) || /\bR\s+ust\b/.test(main))
    reasons.push('broken sentence');
  // A new arbitrary numeric claim about a traced name conflicts with the literal-only trace.
  for (const fact of notes.trace) {
    const claims = main.matchAll(
      new RegExp(
        `\\b${fact.name}\\b\\s+(?:is|holds|equals|starts (?:at|with))\\s+(-?\\d+(?:\\.\\d+)?)`,
        'gi',
      ),
    );
    for (const match of claims) if (Number(match[1]) !== fact.value) reasons.push('arithmetic');
  }
  const result = reasons.length
    ? {
        ...localLesson(
          request,
          notes,
          'The AI answer did not match the code. This explanation uses local code facts.',
        ),
        local: true,
      }
    : { ...lesson };
  if (notes.topics.has('shadow')) result.summary = localLesson(request, notes, '').summary;
  if (
    notes.trace.length &&
    !notes.unknownCall &&
    (request.task === 'explain' || request.task === 'walkthrough')
  ) {
    const numeric = notes.trace.map((f) => `${f.name} becomes ${numberText(f.value)}`).join('; ');
    result.summary =
      'Using these assignments, ' +
      numeric +
      '.' +
      (notes.topics.has('sum')
        ? ' This assumes the normal Python built-in sum, which adds the items.'
        : notes.topics.has('sqrt')
          ? ' This assumes the standard math module. The code has not been run.'
          : ' These values follow from the written arithmetic; the code has not been run.');
    // Local arithmetic facts already supply the summary; don't repeat the same values
    // in an additional walkthrough. Keep the remaining mechanism/origin details.
    if (!result.stepOutput)
      result.steps = result.steps.filter(
        (step) => !step.startsWith('Using the written assignments,'),
      );
  }
  if (!reasons.length) {
    result.concepts = lesson.concepts
      .slice(0, 8)
      .map((c) => ({ ...c, explanation: definition(c.term, language) ?? c.explanation }));
    if (request.task === 'walkthrough') {
      // Keep the ordered trace. Local facts already inform the prompt; appending them
      // as another section repeats the walkthrough and overwhelms short selections.
      if (!result.steps.length) result.steps = lessonSteps(notes);
      for (const concept of notes.concepts)
        if (!result.concepts.some((c) => c.term.toLowerCase() === concept.term.toLowerCase()))
          result.concepts.push(concept);
    }
  }
  if ((request.task === 'walkthrough' || request.task === 'explain') && notes.connections.length) {
    for (const concept of notes.concepts)
      if (!result.concepts.some((c) => c.term.toLowerCase() === concept.term.toLowerCase()))
        result.concepts.push(concept);
  }
  if (request.task === 'walkthrough') {
    result.example = notes.practice
      ? { code: notes.practice.code, explanation: notes.practice.explanation }
      : { code: '', explanation: '' };
    result.checks = notes.practice ? [notes.practice.question] : [];
  } else if (request.task !== 'impact') result.checks = [];
  if (notes.explainableFragment && ['explain', 'walkthrough'].includes(request.task)) {
    // Keep useful prose, but never promote a partial selection to a verified full result.
    // The local syntax notice states the limitation once above the walkthrough.
    result.output = { text: '', explanation: '' };
    if (result.stepOutput) result.stepOutput = result.steps.map(() => null);
  }
  if (request.task === 'example') {
    // A free-form example's output is not independently established. Use a reviewed practice case
    // when one matches, or explicitly describe the proposed example as unverified.
    if (notes.practice)
      result.example = { code: notes.practice.code, explanation: notes.practice.explanation };
    else {
      result.summary =
        'Here is a separate AI-proposed example to inspect. Its behavior has not been verified.';
      result.example = {
        code: lesson.example.code,
        explanation:
          'Its result has not been checked; run it in your own test setup before relying on an output.',
      };
      result.notice = 'Example output has not been verified.';
    }
  }
  // Reject a visibly incomplete print fragment, rather than guessing missing characters.
  // This is a consistency check, not an interpreter or proof of arbitrary AI output.
  let lastPrint = (result.stepOutput?.length ?? 0) - 1;
  while (lastPrint >= 0 && result.stepOutput![lastPrint] == null) lastPrint--;
  if (
    language === 'java' &&
    result.output?.text &&
    lastPrint >= 0 &&
    /\bSystem\s*\.\s*out\s*\.\s*println\s*\(/.test(mask(request.code, language)) &&
    /\bprintln\b/.test(result.steps[lastPrint] ?? '') &&
    !/[\r\n]$/.test(result.stepOutput![lastPrint]!)
  ) {
    result.output = {
      text: '',
      explanation: 'The proposed println output is incomplete, so its exact text is withheld.',
    };
    result.stepOutput = undefined;
  }
  return result;
}
