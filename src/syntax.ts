import ts from 'typescript';
import { bindingLookup } from './bindings';
import type { Part } from './types';

type Explanation = [brief: string, detail: string];

const keywords: Record<string, string> = {
  function: 'Defines a function: reusable code that runs when called.',
  return: 'Ends this function and sends the following value back to its caller.',
  class: 'Defines a class, a blueprint for creating objects.',
  constructor: 'Initializes an instance when the class is called with new.',
  new: 'Creates an instance by calling a constructor.',
  this: 'Refers to the current receiver of this call; arrow functions inherit this from outside.',
  super: 'Accesses the parent class constructor or its members.',
  if: 'Runs the next branch when its condition is truthy.',
  else: 'Runs the alternative branch when the if condition is falsy.',
  for: 'Repeats code using the loop’s setup, condition, and update, or its sequence of items.',
  of: 'Takes each value from an iterable, such as an array.',
  in: 'Checks for a property; in a for loop, visits enumerable property names.',
  while: 'Repeats the loop while its condition is truthy.',
  do: 'Runs the loop body before checking its while condition.',
  break: 'Leaves the current loop, switch, or named block.',
  continue: 'Skips to the next iteration of the loop.',
  switch: 'Chooses a branch by comparing a value with the case values.',
  case: 'Names a value to match in this switch.',
  default: 'Marks the default export or the fallback branch of a switch.',
  throw: 'Raises an error or other value, interrupting normal execution.',
  try: 'Starts code whose thrown errors can be handled by catch.',
  catch: 'Handles a value thrown from the try block.',
  finally: 'Runs after try and catch, even when they return or throw.',
  async: 'Makes this function return a promise and allows await in its body.',
  await: 'Pauses this async execution until a value or promise settles.',
  yield: 'Produces a value from a generator, pausing until iteration resumes.',
  typeof: 'Gets a value’s runtime type name, or refers to its type in a type annotation.',
  instanceof: 'Tests whether a value belongs to a constructor’s instance chain.',
  delete: 'Removes a property from an object.',
  void: 'Discards a result, or describes no usable return value in a type.',
  interface: 'Names a shape that TypeScript checks; it creates no runtime object.',
  type: 'Introduces a type alias or marks an import/export as type-only.',
  enum: 'Defines a set of named values.',
  extends: 'Specifies a base class, inherited interface, or type constraint.',
  implements: 'Checks that this class satisfies the listed interfaces.',
  as: 'Introduces an import/export alias or a type assertion, depending on its position.',
  satisfies: 'Checks that the expression fits a type without replacing its inferred type.',
  from: 'Introduces the module path for this import or export.',
  get: 'Defines a getter that runs when this property is read.',
  set: 'Defines a setter that runs when this property is assigned.',
  abstract: 'Declares a class or member that must be implemented by a concrete subclass.',
  override: 'Checks that this member also exists on the base class.',
  debugger: 'Requests a breakpoint when a debugger is attached.',
};

const operators: Record<string, string> = {
  '=': 'Stores the right-hand value in the left-hand target.',
  '+=': 'Adds to the current value (or appends text), then stores the result.',
  '-=': 'Subtracts from the current value, then stores the result.',
  '*=': 'Multiplies the current value, then stores the result.',
  '/=': 'Divides the current value, then stores the result.',
  '%=': 'Stores the remainder after dividing the current value.',
  '**=': 'Raises the current value to a power, then stores the result.',
  '??=': 'Assigns only when the current value is null or undefined.',
  '||=': 'Assigns only when the current value is falsy.',
  '&&=': 'Assigns only when the current value is truthy.',
  '+': 'Adds numbers or joins strings.',
  '-': 'Subtracts the right value from the left.',
  '*': 'Multiplies the two values.',
  '/': 'Divides the left value by the right.',
  '%': 'Finds the remainder after division.',
  '**': 'Raises the left value to the power on the right.',
  '===': 'Checks equality without converting the values’ types.',
  '!==': 'Checks inequality without converting the values’ types.',
  '==': 'Checks equality, allowing type conversion.',
  '!=': 'Checks inequality, allowing type conversion.',
  '>': 'Checks whether the left value is greater than the right.',
  '<': 'Checks whether the left value is less than the right.',
  '>=': 'Checks whether the left value is greater than or equal to the right.',
  '<=': 'Checks whether the left value is less than or equal to the right.',
  '&&': 'Uses the right value only if the left is truthy; otherwise returns the left.',
  '||': 'Uses the right value only if the left is falsy; otherwise returns the left.',
  '??': 'Uses the right value only if the left is null or undefined.',
  '&': 'Combines corresponding bits using AND.',
  '|': 'Combines corresponding bits using OR.',
  '^': 'Combines corresponding bits using exclusive OR.',
  '<<': 'Shifts bits to the left.',
  '>>': 'Shifts bits to the right, preserving the sign.',
  '>>>': 'Shifts bits to the right, filling with zeroes.',
  ',': 'Evaluates the left expression, then returns the right expression’s value.',
};

function isCall(node: ts.Node): node is ts.CallExpression | ts.NewExpression {
  return ts.isCallExpression(node) || ts.isNewExpression(node);
}

export function statementParts(
  target: ts.Node,
  source: ts.SourceFile,
  glossary: Record<string, Explanation>,
): Part[] {
  let lookup: ReturnType<typeof bindingLookup> | undefined;
  const binding = (node: ts.Identifier) => (lookup ??= bindingLookup(source))(node);
  const text = (node: ts.Node) => {
    const value = node.getText(source).replace(/\s+/g, ' ');
    return value.length > 90 ? value.slice(0, 87) + '…' : value;
  };
  const explain = (brief: string, detail = brief): Explanation => [brief, detail];
  function argument(node: ts.Node): string | undefined {
    const parent = node.parent;
    if (!parent || !isCall(parent)) return;
    const index = parent.arguments?.indexOf(node as ts.Expression) ?? -1;
    if (index < 0) return;
    if (parent.arguments?.slice(0, index).some(ts.isSpreadElement))
      return `an argument to ${text(parent.expression)} after the spread values`;
    return `argument ${index + 1} to ${text(parent.expression)}`;
  }
  function result(node: ts.Node): string {
    const input = argument(node);
    return input ? ` Its result is passed as ${input}.` : '';
  }
  function identifier(node: ts.Identifier | ts.PrivateIdentifier): Explanation {
    const parent = node.parent;
    if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
      const called = isCall(parent.parent) && parent.parent.expression === parent;
      if (called && ts.isNewExpression(parent.parent))
        return explain(
          'The constructor accessed on this object.',
          'The new expression creates an instance using this member as its constructor.',
        );
      return explain(
        called
          ? `The method being called on ${text(parent.expression)}.`
          : `The property accessed on ${text(parent.expression)}.`,
        called
          ? `Looks up ${text(node)} on ${text(parent.expression)}. The parentheses call that member, with ${text(parent.expression)} as its receiver.${result(parent.parent)}`
          : 'Reading a member can retrieve a stored value or run a getter. Access alone does not call a method.',
      );
    }
    if (isCall(parent) && parent.expression === node)
      return explain(
        ts.isNewExpression(parent)
          ? `The constructor used to create an instance.${result(parent)}`
          : `The function being called.${result(parent)}`,
        `The parentheses supply the inputs and run ${text(node)}.${result(parent)}`,
      );
    if (ts.isParameter(parent) && parent.name === node)
      return explain(
        'A parameter: a local name for an input supplied by the caller.',
        'An argument is the value at the call site; a parameter is the name that receives it inside the function.',
      );
    if (ts.isShorthandPropertyAssignment(parent))
      return explain(
        `Uses ${text(node)} as both the property name and its value.`,
        `Shorthand for ${text(node)}: ${text(node)}; it reads the existing variable.`,
      );
    if (
      ts.isBinaryExpression(parent) &&
      parent.left === node &&
      parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    )
      return explain(`The variable being updated by ${parent.operatorToken.getText(source)}.`);
    if ('name' in parent && (parent as ts.NamedDeclaration).name === node) {
      if (ts.isFunctionLike(parent)) return explain('The name of this function or method.');
      if (ts.isClassLike(parent)) return explain('The name of this class.');
      if (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent))
        return explain('The name of this property.');
      if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent))
        return explain('The local name made available by this import.');
      if (ts.isVariableDeclaration(parent) || ts.isBindingElement(parent))
        return explain('The variable’s name.');
      return explain('The name introduced by this declaration.');
    }
    const declaration = ts.isIdentifier(node) ? binding(node) : undefined;
    let description = `Reads the value named ${text(node)}.`;
    if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
      const initial = declaration.initializer;
      description = ts.isNewExpression(initial)
        ? `${text(node)} is a variable initialized with a new ${text(initial.expression)} instance.`
        : `${text(node)} is a variable initialized with ${text(initial)}.`;
    } else if (declaration && ts.isParameter(declaration)) {
      description = `Reads ${text(node)}, a parameter supplied to this function.`;
    } else if (declaration && ts.isBindingElement(declaration)) {
      description = `Reads ${text(node)}, a variable unpacked by destructuring.`;
    } else if (ts.isIdentifier(node) && node.text === 'console' && !declaration) {
      description = 'The console object, commonly used to display messages and values.';
    }
    const input = argument(node);
    return explain(
      input ? `${description} Supplies ${input}.` : description,
      `${description} The local declaration describes where the value comes from, not its current runtime contents.`,
    );
  }
  function describe(node: ts.Node): Explanation {
    const token = node.getText(source);
    const parent = node.parent;
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) return identifier(node);
    if (ts.isTypeNode(node))
      return explain(
        glossary[token]?.[0] ?? 'The type TypeScript checks here.',
        glossary[token]?.[1] ??
          'This type describes allowed values. It is removed from the JavaScript output.',
      );
    if (
      ts.isStringLiteral(node) &&
      (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent))
    )
      return explain(
        'The module path or package to import from or re-export.',
        'The project’s module settings determine which file this path resolves to.',
      );
    if (
      ts.isLiteralExpression(node) ||
      node.kind === ts.SyntaxKind.TrueKeyword ||
      node.kind === ts.SyntaxKind.FalseKeyword ||
      node.kind === ts.SyntaxKind.NullKeyword
    ) {
      const input = argument(node);
      const value =
        ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
          ? 'A string value: the text inside the quotes.'
          : ts.isNumericLiteral(node) || ts.isBigIntLiteral(node)
            ? `The numeric value ${text(node)}.`
            : node.kind === ts.SyntaxKind.NullKeyword
              ? 'The value null, representing an intentional absence of a value.'
              : ts.isRegularExpressionLiteral(node)
                ? 'A regular expression used to match text.'
                : `The boolean value ${token}.`;
      return explain(
        input ? `Passes ${text(node)} as ${input}.` : value,
        input
          ? `${value} An argument is an input value; the function’s matching parameter receives it.`
          : value,
      );
    }
    if (ts.isBinaryExpression(parent) && parent.operatorToken === node)
      return explain(
        operators[token] ?? keywords[token] ?? 'Combines the expressions on either side.',
      );
    if (token === '.' || token === '?.') {
      const optional = token === '?.';
      return explain(
        optional
          ? 'Continues only if the value on the left is not null or undefined.'
          : 'Accesses a member of the value on the left.',
        optional
          ? 'Optional chaining skips this access or call and produces undefined when the value being checked is null or undefined.'
          : 'The dot selects a property or method. Parentheses after a member call it; the dot itself does not run it.',
      );
    }
    if (token === '(' || token === ')') {
      const open = token === '(';
      if (isCall(parent)) {
        const role = argument(parent)
          ? 'Inner'
          : parent.arguments?.some((input) => isCall(input))
            ? 'Outer'
            : '';
        const count = parent.arguments?.length ?? 0;
        const inputs = parent.arguments?.some(ts.isSpreadElement)
          ? 'arguments that include spread values'
          : count
            ? `${count} argument${count === 1 ? '' : 's'}`
            : 'no arguments';
        return explain(
          (role ? `${role} parenthesis: ` : '') +
            (open
              ? `Calls ${text(parent.expression)} with ${inputs}.`
              : `Ends the call to ${text(parent.expression)}.${result(parent)}`),
          `This parenthesis belongs to ${text(parent.expression)}. Inputs are worked out before that call runs. An inner call’s result becomes an input to the outer call.`,
        );
      }
      if (ts.isFunctionLike(parent))
        return explain(
          open
            ? 'Starts the parameter list: the inputs this function accepts.'
            : 'Ends the parameter list.',
        );
      return explain(
        open
          ? 'Starts a grouped expression or control-flow condition.'
          : 'Ends this group or condition.',
      );
    }
    if (token === ';')
      return explain(
        ts.isForStatement(parent)
          ? 'Separates the loop’s setup, condition, and update.'
          : 'Ends the statement.',
        'A semicolon marks a statement boundary; in a for header it separates setup, condition, and update.',
      );
    if (token === ',')
      return explain('Separates arguments, parameters, declarations, or items in this list.');
    if (token === ':') {
      if (ts.isConditionalExpression(parent))
        return explain('Introduces the value chosen when the condition is falsy.');
      if (ts.isPropertyAssignment(parent))
        return explain('Separates the property name from its value.');
      return glossary[':'];
    }
    if (token === '?')
      return explain(
        ts.isConditionalExpression(parent)
          ? 'Chooses between two values; the next value is used when the condition is truthy.'
          : 'Marks this property or parameter as optional.',
      );
    if (token === '=>')
      return explain(
        'Separates an arrow function’s inputs from its body.',
        'An expression body returns its value automatically. A block body uses return explicitly. Arrow functions inherit this from the surrounding code.',
      );
    if (token === '[' || token === ']')
      return explain(
        ts.isElementAccessExpression(parent)
          ? 'Uses the value inside brackets as a property key or array index.'
          : 'Groups array items, destructured values, or a computed property name.',
      );
    if (token === '{' || token === '}')
      return explain(
        ts.isObjectLiteralExpression(parent)
          ? 'Groups the properties of this object value.'
          : ts.isNamedImports(parent) || ts.isNamedExports(parent)
            ? 'Groups the named imports or exports.'
            : 'Marks the boundary of this block or declaration body.',
      );
    if (token === '...')
      return explain(
        ts.isParameter(parent) || ts.isBindingElement(parent)
          ? 'Collects the remaining inputs or items into this name.'
          : 'Spreads the values or properties into the surrounding call, array, or object.',
      );
    if (token === '!')
      return explain(
        ts.isNonNullExpression(parent)
          ? 'Tells TypeScript to treat this value as non-null; it adds no runtime check.'
          : ts.isPrefixUnaryExpression(parent)
            ? 'Converts the value to a boolean and flips it.'
            : 'Asserts to TypeScript that this value will be assigned before use.',
      );
    if (token === '++' || token === '--')
      return explain(
        `${token === '++' ? 'Increases' : 'Decreases'} the stored value by one.`,
        ts.isPostfixUnaryExpression(parent)
          ? 'The postfix form returns the old value, then updates the target.'
          : 'The prefix form updates the target and returns its new value.',
      );
    if ((token === '+' || token === '-') && ts.isPrefixUnaryExpression(parent))
      return explain(
        token === '+' ? 'Converts the value to a number.' : 'Negates the numeric value.',
      );
    if (token === '~') return explain('Flips the bits of the numeric value.');
    if (token === '<' || token === '>')
      return explain('Encloses type arguments or type parameters; this is not a value comparison.');
    if (token === '=') return explain('Assigns the initial or default value.');
    if (token === 'return' && ts.isReturnStatement(parent) && !parent.expression)
      return explain('Ends this function without a value; the caller receives undefined.');
    const entry = glossary[token];
    if (entry) return entry;
    if (keywords[token]) return explain(keywords[token]);
    return explain(
      `Part of this ${ts.SyntaxKind[parent.kind].replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}.`,
      'Its meaning depends on the surrounding TypeScript syntax. Inspect the enclosing code for more context.',
    );
  }
  const parts: Part[] = [];
  function add(node: ts.Node, explanation: Explanation, token = node.getText(source)) {
    parts.push({
      token,
      brief: explanation[0],
      detail: explanation[1],
      start: node.getStart(source),
      end: node.end,
    });
  }
  function visit(node: ts.Node) {
    if (node.end <= node.getStart(source)) return;
    // Keep headers readable; hovering inside a body selects its own statement.
    if (node !== target && ts.isBlock(node)) {
      add(
        node,
        explain('The body of this block. Hover inside to inspect its statements.'),
        '{ … }',
      );
      return;
    }
    if (ts.isTemplateExpression(node)) {
      add(node.head, explain('Starts template text; ${ introduces a value to insert.'));
      for (const span of node.templateSpans) {
        visit(span.expression);
        add(
          span.literal,
          explain('Continues the template text after inserting the expression’s value.'),
        );
      }
      return;
    }
    if (ts.isTypeNode(node)) {
      add(node, describe(node));
      return;
    }
    const children = node.getChildren(source);
    if (children.length) children.forEach(visit);
    else if (node.kind !== ts.SyntaxKind.EndOfFileToken) add(node, describe(node));
  }
  visit(target);
  return parts;
}
