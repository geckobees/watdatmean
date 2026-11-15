import ts from 'typescript';
import { bindingLookup } from './bindings';

// Hover is a short reading of the code. The panel retains the individual syntax
// pieces. Source text only enters Markdown through ref(), never as raw markup.
export function hoverExplanation(target: ts.Node, source: ts.SourceFile, offset: number): string {
  const text = (node: ts.Node) => node.getText(source);
  function ref(value: ts.Node | string): string {
    const raw = (typeof value === 'string' ? value : text(value)).replace(/[\r\n\t]/g, ' ');
    const short = raw.length > 70 ? `${raw.slice(0, 67)}…` : raw;
    const fence = '`'.repeat(Math.max(0, ...(short.match(/`+/g) ?? []).map((s) => s.length)) + 1);
    const pad = /^[` ]|[` ]$/.test(short) ? ' ' : '';
    return `${fence}${pad}${short}${pad}${fence}`;
  }
  const unwrap = (node: ts.Expression): ts.Expression =>
    ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node;
  const focused = (node: ts.Node) => node.getStart(source) <= offset && offset < node.end;
  const has = (node: ts.Node, kind: ts.SyntaxKind) =>
    ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m) => m.kind === kind);
  const exported = (node: ts.Node) =>
    has(node, ts.SyntaxKind.ExportKeyword)
      ? ` ${ref('export')} lets other files import it${has(node, ts.SyntaxKind.DefaultKeyword) ? ' as the default export' : ''}.`
      : '';
  const list = (values: string[]) =>
    values.length < 3
      ? values.join(' and ')
      : `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
  function typeMeaning(type: ts.TypeNode): string {
    switch (type.kind) {
      case ts.SyntaxKind.NumberKeyword:
        return 'a number';
      case ts.SyntaxKind.StringKeyword:
        return `text (${ref('string')})`;
      case ts.SyntaxKind.BooleanKeyword:
        return `${ref('true')} or ${ref('false')}`;
      case ts.SyntaxKind.VoidKeyword:
        return 'no usable return value';
      case ts.SyntaxKind.NeverKeyword:
        return 'no normal return to the caller';
      default:
        return `a value of type ${ref(type)}`;
    }
  }
  let lookup: ReturnType<typeof bindingLookup> | undefined;
  const binding = (name: ts.Identifier) => (lookup ??= bindingLookup(source))(name);
  function receiver(node: ts.Expression): string {
    if (ts.isIdentifier(node)) {
      const declaration = binding(node);
      if (
        declaration &&
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer &&
        ts.isNewExpression(declaration.initializer)
      )
        return `${ref(node)} (initially a ${ref(declaration.initializer.expression)} object)`;
    }
    return ref(node);
  }
  function isConsoleLog(call: ts.CallExpression): boolean {
    const callee = call.expression;
    return (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === 'console' &&
      callee.name.text === 'log' &&
      !binding(callee.expression)
    );
  }
  function value(node: ts.Expression): string {
    const expression = unwrap(node);
    if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return 'a function';
    if (ts.isCallExpression(expression)) return `the result of ${ref(expression)}`;
    if (ts.isNewExpression(expression)) return `a new ${ref(expression.expression)} object`;
    return ref(expression);
  }
  const callLabel = (call: ts.CallExpression) =>
    call.arguments.some((arg) => ts.isCallExpression(unwrap(arg))) || text(call).length > 70
      ? ref(`${text(call.expression)}(…)`)
      : ref(call);
  function callAction(call: ts.CallExpression, nestedResult = false): string {
    const inputs = nestedResult
      ? 'that result'
      : call.arguments.length > 3
        ? `${call.arguments.length} inputs`
        : list(call.arguments.map(value));
    if (isConsoleLog(call))
      return call.arguments.length
        ? `uses the built-in ${ref('console')} object's ${ref('log')} method to display ${inputs}`
        : `uses ${ref('console.log')} to write an empty line to the console`;
    const callee = call.expression;
    const action = ts.isPropertyAccessExpression(callee)
      ? `runs ${ref(callee.name)}, a function on ${receiver(callee.expression)},`
      : `runs ${ref(callee)}`;
    return `${action} ${
      !call.arguments.length
        ? 'with no inputs (empty parentheses)'
        : `with ${inputs}${call.arguments.length > 3 ? '' : call.arguments.length === 1 ? ' as its input' : ' as inputs'}`
    }`;
  }
  function simpleName(node: ts.Expression): boolean {
    return (
      ts.isIdentifier(node) ||
      node.kind === ts.SyntaxKind.ThisKeyword ||
      (ts.isPropertyAccessExpression(node) && !node.questionDotToken && simpleName(node.expression))
    );
  }
  function containsCall(node: ts.Node): boolean {
    if (ts.isFunctionLike(node)) return false; // Passing a callback does not run its body.
    return (
      ts.isCallExpression(node) ||
      ts.isNewExpression(node) ||
      !!ts.forEachChild(node, (child) => containsCall(child) || undefined)
    );
  }
  function explainCall(call: ts.CallExpression): string {
    const calls: ts.CallExpression[] = [];
    function visit(current: ts.CallExpression): boolean {
      if (current.questionDotToken || !simpleName(current.expression)) return false;
      for (const argument of current.arguments) {
        const input = unwrap(argument);
        if (ts.isCallExpression(input)) {
          if (!visit(input)) return false;
        } else if (ts.isSpreadElement(input) || containsCall(input)) return false;
      }
      calls.push(current);
      return calls.length <= 4;
    }
    if (visit(call) && calls.length > 1) {
      return calls
        .map((item, index) => {
          const prefix =
            calls.length === 2
              ? `The ${index ? 'outer' : 'inner'} call, `
              : index === 0
                ? 'First, '
                : index === calls.length - 1
                  ? 'Finally, '
                  : 'Then, ';
          const singleResult = calls.length === 2 && index === 1 && item.arguments.length === 1;
          return `${prefix}${callLabel(item)}${calls.length === 2 ? ',' : ''} ${callAction(item, singleResult)}.`;
        })
        .join(' ');
    }
    // Conditional, optional, and complex calls still get prose, without claiming
    // every nested function runs or flattening branches into an execution order.
    let optional: ts.Node | undefined;
    function findOptional(node: ts.Node | undefined) {
      if (!node) return;
      if (
        (ts.isPropertyAccessExpression(node) ||
          ts.isElementAccessExpression(node) ||
          ts.isCallExpression(node)) &&
        node.questionDotToken
      )
        optional = node;
      if ('expression' in node) findOptional((node as ts.CallExpression).expression);
    }
    findOptional(call);
    let result = optional
      ? `${callLabel(call)} makes a call using ${ref('?.')}: if the value just before ${ref('?.')} is ${ref('null')} or ${ref('undefined')}, the rest of that chain is skipped.`
      : `${callLabel(call)} ${callAction(call)}.`;
    if (call.arguments.length > 3) {
      const index = call.arguments.findIndex(focused);
      if (index >= 0)
        result += ` ${ref(call.arguments[index])} is input ${index + 1} to ${ref(call.expression)}.`;
    }
    if (call.arguments.some(ts.isSpreadElement))
      result += ` ${ref('...')} passes the items from its value as separate inputs.`;
    return result;
  }
  function parameters(node: ts.SignatureDeclarationBase): string {
    if (!node.parameters.length) return 'takes no inputs';
    if (node.parameters.length > 3) {
      const parameter = node.parameters.find(focused);
      return `takes ${node.parameters.length} parameters (named inputs)${parameter ? `, including ${ref(parameter.name)}${parameter.type ? ` for ${typeMeaning(parameter.type)}` : ''}` : ''}`;
    }
    return `takes ${list(
      node.parameters.map((p) => {
        if (p.dotDotDotToken) return `extra inputs collected in ${ref(p.name)}`;
        const base = `${ref(p.name)}${p.type ? ` (${typeMeaning(p.type)})` : ''}`;
        return (
          base +
          (p.initializer
            ? `, using ${ref(p.initializer)} when no value is supplied`
            : p.questionToken
              ? ', which can be left out'
              : '')
        );
      }),
    )}`;
  }
  function functionMeaning(node: ts.SignatureDeclarationBase): string {
    const output = node.type
      ? node.type.kind === ts.SyntaxKind.NeverKeyword
        ? ' and never returns normally'
        : ` and is declared to return ${typeMeaning(node.type)}`
      : '';
    return `${parameters(node)}${output}`;
  }
  function declaration(node: ts.VariableDeclaration | ts.PropertyDeclaration): string {
    const name = ref(node.name);
    const initializer = node.initializer && unwrap(node.initializer);
    const property = ts.isPropertyDeclaration(node);
    const flags = ts.isVariableDeclarationList(node.parent) ? node.parent.flags : 0;
    const constant = !!(flags & ts.NodeFlags.Const);
    let result: string;
    const destructured = !ts.isIdentifier(node.name) && !property;
    if (destructured) {
      result = `${name} picks out properties or items from ${initializer ? value(initializer) : 'the supplied value'} and gives them their own variable names.`;
    } else if (initializer && ts.isNewExpression(initializer)) {
      const constructor = `${text(initializer.expression)}(${initializer.arguments?.map(text).join(', ') ?? ''})`;
      result = `${ref('new')} creates a ${ref(initializer.expression)} object by calling its constructor, ${ref(constructor)}. ${name} holds a reference to that object.`;
    } else if (
      initializer &&
      (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
    ) {
      result = `${name} holds a function that ${functionMeaning(initializer)}. The function runs when you call ${name}.`;
    } else {
      result = `${name} ${property ? `is a property${has(node, ts.SyntaxKind.StaticKeyword) ? ' on the class itself' : ' on each object created from this class'} and ` : ''}${initializer ? `starts with ${value(initializer)}` : 'is declared without a starting value'}.`;
    }
    if (node.type)
      result += ` ${ref(`: ${text(node.type)}`)} means TypeScript expects ${typeMeaning(node.type)}.`;
    if (constant)
      result += destructured
        ? ` ${ref('const')} prevents reassigning these variable names.`
        : ` ${ref('const')} prevents assigning a different value to ${name}${initializer && (ts.isNewExpression(initializer) || ts.isObjectLiteralExpression(initializer) || ts.isArrayLiteralExpression(initializer)) ? ', though its contents can still change' : ''}.`;
    else if (!property)
      result += ` You can assign ${destructured ? 'different values to these variables' : `a different value to ${name}`} later.`;
    if (property && has(node, ts.SyntaxKind.PrivateKeyword))
      result += ` ${ref('private')} limits access to this class during TypeScript checking.`;
    if (property && has(node, ts.SyntaxKind.ReadonlyKeyword))
      result += ` ${ref('readonly')} prevents assigning a different value after initialization during TypeScript checking.`;
    return result;
  }
  function expressionMeaning(node: ts.Expression): string {
    const expression = unwrap(node);
    if (ts.isCallExpression(expression)) return explainCall(expression);
    if (ts.isBinaryExpression(expression)) {
      const kind = expression.operatorToken.kind;
      const left = ref(expression.left),
        right = value(expression.right),
        operator = ref(expression.operatorToken);
      if (kind === ts.SyntaxKind.EqualsToken)
        return `${operator} assigns ${right} to ${left}, replacing its previous value.`;
      if (
        kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken ||
        kind === ts.SyntaxKind.BarBarEqualsToken ||
        kind === ts.SyntaxKind.QuestionQuestionEqualsToken
      )
        return `${operator} assigns ${right} to ${left} only when its current value ${kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken ? 'counts as true' : kind === ts.SyntaxKind.BarBarEqualsToken ? 'counts as false' : `is ${ref('null')} or ${ref('undefined')}`}. Otherwise, it keeps the current value without evaluating the right side.`;
      if (
        kind >= ts.SyntaxKind.FirstCompoundAssignment &&
        kind <= ts.SyntaxKind.LastCompoundAssignment
      )
        return `${operator} updates ${left} using its current value and ${right}, then stores the result back in ${left}.`;
      if (
        kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        kind === ts.SyntaxKind.BarBarToken ||
        kind === ts.SyntaxKind.QuestionQuestionToken
      )
        return `${operator} checks ${left} first and only evaluates ${ref(expression.right)} if the left side ${kind === ts.SyntaxKind.AmpersandAmpersandToken ? 'counts as true' : kind === ts.SyntaxKind.BarBarToken ? 'counts as false' : `is ${ref('null')} or ${ref('undefined')}`}.`;
      return `${operator} combines or compares ${left} and ${right} to produce a value.`;
    }
    if (ts.isAwaitExpression(expression))
      return `${ref('await')} pauses this part of the code until ${ref(expression.expression)} settles, then uses its result or raises its error.`;
    if (ts.isPostfixUnaryExpression(expression) || ts.isPrefixUnaryExpression(expression)) {
      if (
        expression.operator === ts.SyntaxKind.PlusPlusToken ||
        expression.operator === ts.SyntaxKind.MinusMinusToken
      )
        return `${ref(expression)} ${expression.operator === ts.SyntaxKind.PlusPlusToken ? 'adds 1 to' : 'subtracts 1 from'} ${ref(expression.operand)} and stores the updated value.`;
    }
    if (ts.isNewExpression(expression))
      return `${ref('new')} calls the ${ref(expression.expression)} constructor to create an object.`;
    if (ts.isPropertyAccessExpression(expression))
      return `${ref(expression)} reads ${ref(expression.name)}, a member of ${ref(expression.expression)}. The dot selects that member.`;
    return `${ref(expression)} is an expression: code evaluated to produce a value.`;
  }
  const errors = (source as ts.SourceFile & { parseDiagnostics?: ts.Diagnostic[] })
    .parseDiagnostics;
  if (
    errors?.some(
      (error) =>
        error.start !== undefined &&
        error.start >= target.getStart(source) &&
        error.start <= target.end,
    )
  )
    return 'This code is incomplete or has a syntax error. The learning panel can help you explore the pieces already here.';
  if (ts.isVariableStatement(target)) {
    const declarations = target.declarationList.declarations;
    if (!declarations.length)
      return 'This declaration is incomplete. Add a name and a starting value to see its explanation.';
    return declaration(declarations.find(focused) ?? declarations[0]) + exported(target);
  }
  if (ts.isPropertyDeclaration(target)) return declaration(target);
  if (ts.isFunctionDeclaration(target) || ts.isMethodDeclaration(target)) {
    const name = target.name ? ref(target.name) : 'This function';
    const role = ts.isMethodDeclaration(target)
      ? `a method (a function on ${has(target, ts.SyntaxKind.StaticKeyword) ? 'the class itself' : ts.isObjectLiteralExpression(target.parent) ? 'this object' : 'objects made from this class'})`
      : 'a reusable function';
    return `${name} is ${role} that ${functionMeaning(target)}.${has(target, ts.SyntaxKind.AsyncKeyword) ? ` ${ref('async')} makes each call return a Promise, which represents its eventual result.` : ''}${exported(target)}`;
  }
  if (ts.isConstructorDeclaration(target))
    return `This constructor sets up a new object when you use ${ref('new')} with the class name. It ${parameters(target)}.`;
  if (ts.isGetAccessorDeclaration(target))
    return `${ref(target.name)} is a getter: its function runs when you read this property${target.type ? ` and is declared to return ${typeMeaning(target.type)}` : ''}.`;
  if (ts.isSetAccessorDeclaration(target))
    return `${ref(target.name)} is a setter: its function runs when you assign to this property. It ${parameters(target)}.`;
  if (ts.isClassDeclaration(target)) {
    const base = target.heritageClauses?.find(
      (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword,
    )?.types[0];
    return `${target.name ? ref(target.name) : 'This class'} defines a class: a blueprint for objects that share properties (stored values) and methods (functions).${base ? ` ${ref('extends')} builds on ${ref(base)}, inheriting its members.` : ''}${exported(target)}`;
  }
  if (ts.isInterfaceDeclaration(target))
    return `${ref(target.name)} describes the properties and methods a matching value must have. This ${ref('interface')} is checked by TypeScript; it does not create an object.${exported(target)}`;
  if (ts.isTypeAliasDeclaration(target))
    return `${ref('type')} gives the name ${ref(target.name)} to ${ref(target.type)}, so you can reuse this type description. It describes allowed values without creating one.${exported(target)}`;
  if (ts.isExpressionStatement(target)) return expressionMeaning(target.expression);
  if (ts.isReturnStatement(target))
    return `${ref('return')} ends this function${target.expression ? ` and sends ${value(target.expression)} back to the code that called it` : ' without sending back a value'}.`;
  if (ts.isIfStatement(target))
    return `${ref('if')} checks ${ref(target.expression)}. When it counts as true, the first branch runs${target.elseStatement ? `; otherwise, the ${ref('else')} branch runs` : ''}.`;
  if (ts.isForOfStatement(target) || ts.isForInStatement(target)) {
    const name = ts.isVariableDeclarationList(target.initializer)
      ? (target.initializer.declarations[0]?.name ?? target.initializer)
      : target.initializer;
    return `${ref(ts.isForOfStatement(target) ? 'for...of' : 'for...in')} goes through ${ref(target.expression)}, assigning ${ts.isForOfStatement(target) ? 'each value' : 'each enumerable property name'} to ${ref(name)} and running the loop body for each one.`;
  }
  if (ts.isWhileStatement(target) || ts.isDoStatement(target))
    return `This loop repeats its body while ${ref(target.expression)} counts as true.${ts.isDoStatement(target) ? ' It runs the body once before checking.' : ' It checks before each repetition.'}`;
  if (ts.isForStatement(target))
    return `This ${ref('for')} loop runs ${target.initializer ? ref(target.initializer) : 'its setup'} once, repeats ${target.condition ? `while ${ref(target.condition)} counts as true` : 'without a built-in stopping condition'}, and ${target.incrementor ? `runs ${ref(target.incrementor)} after each completed repetition` : 'has no automatic update step'}.`;
  if (ts.isSwitchStatement(target))
    return `${ref('switch')} compares ${ref(target.expression)} with the ${ref('case')} values and starts at a match, or at ${ref('default')} if present. Execution continues until a ${ref('break')}, return, or the end.`;
  if (ts.isBreakStatement(target))
    return `${ref('break')} exits ${target.label ? `the statement labeled ${ref(target.label)}` : 'the nearest loop or switch'} so execution can continue after it.`;
  if (ts.isContinueStatement(target))
    return `${ref('continue')} skips the rest of this repetition and moves to the next step of ${target.label ? `the loop labeled ${ref(target.label)}` : 'the nearest loop'}.`;
  if (ts.isThrowStatement(target))
    return `${ref('throw')} raises ${value(target.expression)} as an error and stops normal execution here. A surrounding ${ref('catch')} can handle it.`;
  if (ts.isTryStatement(target))
    return `${ref('try')} runs the enclosed code${target.catchClause ? `; ${ref('catch')} handles an error if one is thrown` : ''}.${target.finallyBlock ? ` ${ref('finally')} runs when leaving this code, whether it succeeds or throws.` : ''}`;
  if (ts.isImportDeclaration(target))
    return target.importClause
      ? `${ref(target.importClause)} brings ${target.importClause.isTypeOnly ? 'type names' : 'names'} from ${ref(target.moduleSpecifier)} into this file.${target.importClause.isTypeOnly ? ' These names are only used for TypeScript checking.' : ' You can use them here to refer to the exported values or types.'}`
      : `${ref('import')} loads ${ref(target.moduleSpecifier)} so its setup code can run, without creating local names for its exports.`;
  if (ts.isExportDeclaration(target))
    return `${ref('export')} makes ${target.exportClause ? ref(target.exportClause) : 'the named exports'}${target.moduleSpecifier ? ` from ${ref(target.moduleSpecifier)}` : ''} available for other files to import.`;
  if (ts.isExportAssignment(target))
    return `${ref(target.expression)} becomes ${target.isExportEquals ? 'the value exported by this module' : 'this file’s default export'}, which other files can import.`;
  if (ts.isEnumDeclaration(target))
    return `${ref(target.name)} groups named constants in an ${ref('enum')}, so code can use meaningful names for a set of values.${exported(target)}`;
  if (ts.isBlock(target))
    return `${ref('{ … }')} groups these statements into a block. The surrounding function, condition, or loop determines when the block runs.`;
  if (ts.isEmptyStatement(target))
    return `This ${ref(';')} is an empty statement; it performs no action.`;
  if (ts.isDebuggerStatement(target))
    return `${ref('debugger')} asks an attached debugger to pause here so you can inspect the program.`;
  return 'This statement is an instruction in your TypeScript program. Open the learning panel to explore its individual pieces.';
}
