package com.watdatmean.intellij;

import com.intellij.ide.highlighter.JavaHighlightingColors;
import com.intellij.openapi.editor.colors.*;
import com.intellij.openapi.util.text.StringUtil;
import com.intellij.psi.*;
import com.intellij.psi.util.PsiTreeUtil;
import com.intellij.ui.ColorUtil;
import java.util.*;

/** A short, local reading of Java PSI. No execution, worker, or AI requests. */
final class JavaHover {
  private JavaHover() {}

  static PsiElement target(PsiElement origin) {
    if (origin == null || !origin.isValid() || !(origin.getContainingFile() instanceof PsiJavaFile)
      || origin.getContainingFile().getTextLength() > 500000
      || PsiTreeUtil.getParentOfType(origin, PsiComment.class, false) != null) return null;
    int offset = origin.getTextOffset();
    for (PsiElement element = origin; element != null && !(element instanceof PsiFile); element = element.getParent()) {
      if (element instanceof PsiMethod method) {
        if (method.getBody() == null || offset < method.getBody().getTextRange().getStartOffset()) return method;
        return null;
      }
      if (element instanceof PsiStatement) return element;
      if (element instanceof PsiField || element instanceof PsiClass) return element;
    }
    return null;
  }

  static String explain(PsiElement origin) {
    PsiElement target = target(origin);
    if (target == null) return null;
    // Avoid inventing behavior for an incomplete statement, without walking a whole class body.
    if (!(target instanceof PsiClass) && !(target instanceof PsiMethod)
      && PsiTreeUtil.findChildOfType(target, PsiErrorElement.class) != null)
      return "This code is incomplete. Finish the statement to see its short explanation.";
    if (target instanceof PsiMethod method) return method(method);
    if (target instanceof PsiField field) return variable(field);
    if (target instanceof PsiDeclarationStatement statement) {
      for (PsiElement declared : statement.getDeclaredElements())
        if (declared instanceof PsiVariable variable && (statement.getDeclaredElements().length == 1
          || variable.getTextRange().contains(origin.getTextOffset()))) return variable(variable);
      return null;
    }
    if (target instanceof PsiExpressionStatement statement) return expression(statement.getExpression());
    if (target instanceof PsiReturnStatement statement)
      return keyword("return") + " finishes this call" + (statement.getReturnValue() == null
        ? " without sending back a value." : " and sends " + value(statement.getReturnValue()) + " back to its caller.");
    if (target instanceof PsiIfStatement statement)
      return keyword("if") + " checks " + value(statement.getCondition()) + ". When it is true, the first branch runs"
        + (statement.getElseBranch() == null ? "." : "; otherwise, the " + keyword("else") + " branch runs.");
    if (target instanceof PsiForeachStatement statement)
      return "This loop takes each item from " + value(statement.getIteratedValue()) + ", assigns it to "
        + code(statement.getIterationParameter().getName(), JavaHighlightingColors.PARAMETER_ATTRIBUTES) + ", and runs the loop body.";
    if (target instanceof PsiWhileStatement statement)
      return keyword("while") + " checks " + value(statement.getCondition()) + " before each repetition. The body runs while it is true.";
    if (target instanceof PsiDoWhileStatement statement)
      return "This " + keyword("do") + " loop runs its body once, then repeats while " + value(statement.getCondition()) + " is true.";
    if (target instanceof PsiForStatement statement)
      return "This " + keyword("for") + " loop runs its setup once, repeats "
        + (statement.getCondition() == null ? "without a built-in stopping condition" : "while " + value(statement.getCondition()) + " is true")
        + ", and runs its update after each completed repetition.";
    if (target instanceof PsiThrowStatement statement)
      return keyword("throw") + " raises " + value(statement.getException()) + " as an exception and stops normal execution here. A matching " + keyword("catch") + " can handle it.";
    if (target instanceof PsiBreakStatement statement)
      return keyword("break") + " exits " + (statement.getLabelIdentifier() == null ? "the nearest loop or switch" : "the statement labeled " + identifier(statement.getLabelIdentifier().getText())) + ".";
    if (target instanceof PsiContinueStatement statement)
      return keyword("continue") + " skips the rest of this repetition of " + (statement.getLabelIdentifier() == null ? "the nearest loop" : "the loop labeled " + identifier(statement.getLabelIdentifier().getText())) + ".";
    if (target instanceof PsiClass type && type.getName() != null)
      return code(type.getName(), JavaHighlightingColors.CLASS_NAME_ATTRIBUTES) + (type.isInterface()
        ? " defines an interface: a contract that implementing classes follow."
        : type.isEnum() ? " groups a fixed set of named values in an enum."
        : type.isRecord() ? " defines a record: a compact data class with accessors, equality, and a constructor supplied by Java."
        : " defines a class: a blueprint for objects with stored values (fields) and behavior (methods).");
    return null;
  }

  private static String method(PsiMethod method) {
    var parameters = method.getParameterList().getParameters();
    String input = parameters.length == 0 ? "takes no inputs" : parameters.length > 3
      ? "takes " + parameters.length + " parameters (named inputs)"
      : "takes " + join(Arrays.stream(parameters).map(p -> code(p.getName(), JavaHighlightingColors.PARAMETER_ATTRIBUTES)
        + " (" + type(p.getType()) + ")").toList());
    String name = code(method.getName(), method.isConstructor() ? JavaHighlightingColors.CONSTRUCTOR_DECLARATION_ATTRIBUTES : JavaHighlightingColors.METHOD_DECLARATION_ATTRIBUTES);
    if (method.isConstructor()) return name + " sets up a new object when called with " + keyword("new") + ". It " + input + ".";
    String result = PsiType.VOID.equals(method.getReturnType()) ? " and does not return a value"
      : method.getReturnType() == null ? "" : " and is declared to return " + type(method.getReturnType());
    return name + " " + input + result + "." + (method.hasModifierProperty(PsiModifier.STATIC)
      ? " " + keyword("static") + " makes it callable on the class itself." : "");
  }

  private static String variable(PsiVariable variable) {
    String name = code(variable.getName(), variable instanceof PsiField ? JavaHighlightingColors.INSTANCE_FIELD_ATTRIBUTES : JavaHighlightingColors.LOCAL_VARIABLE_ATTRIBUTES);
    PsiExpression initial = unwrap(variable.getInitializer());
    String result;
    if (initial instanceof PsiNewExpression created) {
      result = keyword("new") + (isArray(created) ? " creates an array" : " calls the "
        + code(created.getClassReference() == null ? null : created.getClassReference().getReferenceName(), JavaHighlightingColors.CONSTRUCTOR_CALL_ATTRIBUTES)
        + " constructor to create an object") + ". " + name + " holds a reference to it.";
    } else result = name + " " + (initial == null ? "is declared without an explicit starting value" : "starts with " + value(initial)) + ".";
    result += " Its declared type is " + type(variable.getType()) + ".";
    if (variable.hasModifierProperty(PsiModifier.FINAL)) result += " " + keyword("final") + " allows the variable to be assigned only once; it does not freeze an object's contents.";
    return result;
  }

  private static String expression(PsiExpression expression) {
    expression = unwrap(expression);
    if (expression instanceof PsiMethodCallExpression call) {
      var inputs = call.getArgumentList().getExpressions();
      // Explain the simple inner -> outer case without flattening conditions or callback bodies.
      if (inputs.length == 1 && unwrap(inputs[0]) instanceof PsiMethodCallExpression inner
        && Arrays.stream(inner.getArgumentList().getExpressions()).noneMatch(e -> PsiTreeUtil.findChildOfType(e, PsiCallExpression.class, false) != null)
        && simpleReceiver(call.getMethodExpression().getQualifierExpression()) && simpleReceiver(inner.getMethodExpression().getQualifierExpression()))
        return "The inner call " + call(inner, false) + ". Then the outer call " + call(call, true) + ".";
      return "The call to " + call(call, false) + ".";
    }
    if (expression instanceof PsiAssignmentExpression assignment) {
      String operator = assignment.getOperationSign().getText();
      return code(operator, JavaHighlightingColors.OPERATION_SIGN) + (operator.equals("=") ? " assigns " : " updates " + value(assignment.getLExpression()) + " using ")
        + value(assignment.getRExpression()) + (operator.equals("=") ? " to " + value(assignment.getLExpression()) : " and its current value") + ".";
    }
    if (expression instanceof PsiNewExpression created)
      return keyword("new") + " creates " + (isArray(created) ? "an array" : "an object using the "
        + code(created.getClassReference().getReferenceName(), JavaHighlightingColors.CONSTRUCTOR_CALL_ATTRIBUTES) + " constructor") + ".";
    return null;
  }

  private static String call(PsiMethodCallExpression call, boolean nestedResult) {
    var method = call.getMethodExpression();
    var inputs = call.getArgumentList().getExpressions();
    String receiver = method.getQualifierExpression() == null ? "" : " on " + value(method.getQualifierExpression());
    String arguments = nestedResult ? "the inner call's result" : inputs.length > 3 ? inputs.length + " inputs"
      : inputs.length == 0 ? "no inputs" : join(Arrays.stream(inputs).map(JavaHover::value).toList());
    return code(method.getReferenceName(), JavaHighlightingColors.METHOD_CALL_ATTRIBUTES) + receiver + " receives " + arguments;
  }
  private static boolean simpleReceiver(PsiExpression expression) {
    return expression == null || expression instanceof PsiThisExpression || expression instanceof PsiSuperExpression
      || expression instanceof PsiReferenceExpression reference && simpleReceiver(reference.getQualifierExpression());
  }
  private static boolean isArray(PsiNewExpression expression) {
    return expression.getArrayDimensions().length > 0 || expression.getArrayInitializer() != null;
  }
  private static PsiExpression unwrap(PsiExpression expression) {
    while (expression instanceof PsiParenthesizedExpression parenthesized && parenthesized.getExpression() != null) expression = parenthesized.getExpression();
    return expression;
  }
  private static String value(PsiExpression expression) {
    if (expression == null) return "the value";
    if (expression instanceof PsiLiteralExpression literal) return code(literal.getText(), literal.getValue() instanceof Number
      ? JavaHighlightingColors.NUMBER : literal.getValue() instanceof String || literal.getValue() instanceof Character
      ? JavaHighlightingColors.STRING : JavaHighlightingColors.KEYWORD);
    return identifier(expression.getText());
  }
  private static String type(PsiType type) {
    String name = type.getPresentableText();
    return code(name, type instanceof PsiPrimitiveType ? JavaHighlightingColors.KEYWORD : JavaHighlightingColors.CLASS_NAME_ATTRIBUTES)
      + (PsiType.INT.equals(type) ? ", a whole number" : PsiType.BOOLEAN.equals(type) ? ", true or false" : name.equals("String") ? ", text" : "");
  }
  private static String join(List<String> values) {
    return values.size() < 3 ? String.join(" and ", values) : String.join(", ", values.subList(0, values.size() - 1)) + ", and " + values.get(values.size() - 1);
  }
  private static String keyword(String text) { return code(text, JavaHighlightingColors.KEYWORD); }
  private static String identifier(String text) { return code(text, JavaHighlightingColors.LOCAL_VARIABLE_ATTRIBUTES); }
  static String code(String text, TextAttributesKey key) {
    String source = Objects.toString(text, "value").replaceAll("[\\r\\n\\t]+", " ");
    if (source.length() > 56) source = source.substring(0, 53) + "…";
    var scheme = EditorColorsManager.getInstance().getGlobalScheme();
    var attributes = scheme.getAttributes(key);
    var color = attributes == null || attributes.getForegroundColor() == null ? scheme.getDefaultForeground() : attributes.getForegroundColor();
    return "<code><span style=\"color:#" + ColorUtil.toHex(color) + "\">" + StringUtil.escapeXmlEntities(source) + "</span></code>";
  }
}
