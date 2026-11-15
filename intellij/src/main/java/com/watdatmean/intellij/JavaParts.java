package com.watdatmean.intellij;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.intellij.openapi.progress.ProgressManager;
import com.intellij.psi.*;
import com.intellij.psi.util.PsiTreeUtil;
import java.util.Map;
import java.util.HashSet;

/** Local syntax and declaration origins from Java PSI, without project resolution, Node, or AI. */
final class JavaParts {
  private JavaParts() {}
  private static Map.Entry<String, String[]> entry(String token, String brief, String detail) {
    return Map.entry(token, new String[]{brief, detail});
  }
  private static final Map<String, String[]> WORDS = Map.ofEntries(
    entry("public", "Allows access from other classes.", "This visibility modifier exposes the declaration where its containing type is accessible. Module boundaries can also restrict access."),
    entry("private", "Limits access to the declaring class and its nested types.", "Use private for implementation details that callers should access through the class's methods."),
    entry("protected", "Allows package access and access by subclasses.", "Code in the same package can use this member. Subclasses outside the package can also access it, subject to Java's inheritance rules."),
    entry("static", "Belongs to the class itself.", "A static member can be used without creating an instance. A static method has no implicit this object."),
    entry("final", "Prevents reassignment or further overriding.", "A final variable can be assigned only once; an object it refers to may still change. A final method cannot be overridden, and a final class cannot be extended."),
    entry("abstract", "Leaves implementation to a subclass.", "An abstract class cannot be instantiated directly. An abstract method declares a contract without a method body."),
    entry("class", "Declares a class.", "A class describes fields and methods. Instances created with new have their own instance fields."),
    entry("interface", "Declares a contract for implementing types.", "An interface specifies behavior that implementing types provide. It may also contain default, static, and private methods."),
    entry("enum", "Declares a fixed set of named instances.", "An enum gives meaningful names to a closed set of choices. Each constant is an instance of that enum type."),
    entry("record", "Declares a compact data class.", "Java supplies a constructor, accessors, equals, hashCode, and toString from the record components. Referenced objects are not made immutable."),
    entry("extends", "Names a superclass or an extended interface.", "The new type inherits an existing type's contract and accessible behavior. Generic bounds also use extends."),
    entry("implements", "Lists interfaces this class implements.", "The class must provide the required behavior, either itself or through inherited implementations."),
    entry("new", "Creates an object or array.", "For an object, Java allocates an instance and runs its constructor. For an array, Java allocates elements with default values or the supplied initializer values."),
    entry("this", "Refers to the current object.", "Use this to access instance members or distinguish a field from a parameter. A constructor can use this(...) to call another constructor."),
    entry("super", "Accesses superclass behavior.", "Use super to call an inherited implementation or a superclass constructor. It refers to the superclass part of the current object."),
    entry("return", "Finishes this call and optionally sends back a value.", "A method or lambda uses return to give control back to its caller. A supplied expression becomes the result, subject to any enclosing finally block."),
    entry("if", "Chooses whether a branch runs.", "Java evaluates the boolean condition. The first branch runs when it is true; an else branch, if present, runs when it is false."),
    entry("else", "Runs the alternative branch.", "This branch is chosen when the matching if condition is false."),
    entry("for", "Repeats a body using loop control.", "A basic for loop runs its setup once, checks its condition, runs the body, then runs the update. An enhanced for loop takes each value from an array or Iterable."),
    entry("while", "Repeats while a condition stays true.", "A while loop checks before entering its body. In a do-while loop, the condition is checked after the body instead."),
    entry("do", "Runs the loop body before checking its condition.", "A do-while loop enters the body at least once, then repeats when its trailing condition is true."),
    entry("break", "Leaves a loop, switch, or labeled statement.", "An unlabeled break exits the nearest loop or switch. A labeled break exits the named enclosing statement."),
    entry("continue", "Moves to the next loop repetition.", "The remaining body is skipped. A basic for loop still performs its update before checking its condition again."),
    entry("switch", "Chooses a case based on a selector.", "Java matches a value or supported pattern against cases. A switch expression produces a result; a switch statement controls execution."),
    entry("case", "Introduces a switch alternative.", "This label identifies the values or pattern handled by a switch branch."),
    entry("default", "Provides default behavior.", "In a switch this is the fallback branch. In an interface a default method supplies an implementation that a class can inherit."),
    entry("yield", "Produces a result for a switch expression.", "A block inside a switch expression uses yield to return that branch's result to the surrounding expression."),
    entry("try", "Starts exception handling or resource cleanup.", "A try block can have catch and finally clauses. Resources declared in try(...) are closed automatically when the block exits."),
    entry("catch", "Handles a matching thrown exception.", "If execution throws a compatible exception, Java transfers control to this handler and gives it the exception object."),
    entry("finally", "Runs cleanup when a try statement exits.", "The finally block normally runs whether execution completes, returns, or throws. Abrupt process termination can prevent it from running."),
    entry("throw", "Raises an exception here.", "Normal execution stops at this point. Java searches enclosing calls and blocks for a compatible catch handler."),
    entry("throws", "Declares exceptions a method may pass to its caller.", "Callers must handle or declare checked exceptions listed here. This declaration does not itself throw anything."),
    entry("import", "Makes a type or static member available by a shorter name.", "Java imports affect name lookup during compilation. An import does not execute or download another source file."),
    entry("package", "Places this source in a named package.", "Packages organize types and participate in access control. The package and class name form a qualified type name."),
    entry("instanceof", "Checks a value's runtime type.", "It is false for null. A supported type pattern can also introduce a variable for use where the match is known to hold."),
    entry("synchronized", "Uses a monitor to coordinate threads.", "The thread must acquire the object's monitor before entering the protected block or method. Leaving it releases the monitor."),
    entry("int", "Stores a 32-bit signed whole number.", "An int holds values from -2,147,483,648 to 2,147,483,647. Integer arithmetic can overflow; it does not automatically grow to fit."),
    entry("long", "Stores a 64-bit signed whole number.", "Use long when the range of int is too small. Long arithmetic can still overflow."),
    entry("double", "Stores a 64-bit floating-point number.", "A double represents a wide range of approximate numeric values. Many decimal fractions cannot be stored exactly."),
    entry("float", "Stores a 32-bit floating-point number.", "A float is an approximate numeric value with less precision than double. Java floating-point literals use double unless given an f suffix."),
    entry("boolean", "Stores true or false.", "Conditions in if and loop statements require boolean expressions; Java does not treat numbers as booleans."),
    entry("char", "Stores one UTF-16 code unit.", "A char literal uses single quotes. Some Unicode characters require two char values, so a char is not always a complete visible character."),
    entry("byte", "Stores an 8-bit signed whole number.", "A byte holds values from -128 to 127 and is often used for binary data."),
    entry("short", "Stores a 16-bit signed whole number.", "A short holds values from -32,768 to 32,767. Arithmetic usually promotes short operands to int."),
    entry("void", "Declares that a method returns no value.", "The method may perform work and side effects, but its caller does not receive a result value."),
    entry("var", "Asks the compiler to infer a local variable's type.", "The initializer determines a fixed compile-time type. This is not a dynamically typed variable and does not make the type change later."),
    entry("=", "Assigns a value.", "The expression on the right supplies a value for the variable or field on the left. In a declaration this sets the initial value; it is not an equality test."),
    entry("==", "Compares primitive values or reference identity.", "For primitives, == compares values. For object references, it checks whether both refer to the same object (or are both null). Content equality is usually expressed with equals."),
    entry("!=", "Checks inequality.", "This is the opposite of ==: primitive values differ, or object references do not identify the same object."),
    entry("+", "Adds numbers or joins text.", "With numeric operands this performs addition. When a String is involved, + joins text representations instead."),
    entry("-", "Subtracts a number or negates a value.", "Binary subtraction finds a difference; a leading minus changes a number's sign."),
    entry("*", "Multiplies numbers.", "The operands supply the factors. Integer overflow and floating-point rounding still follow the operands' numeric types."),
    entry("/", "Divides numbers.", "Division of integers discards the fractional part toward zero. Floating-point division can produce a fractional result."),
    entry("%", "Calculates a remainder.", "The remainder is what remains after division. For example, 7 % 3 is 1; it is useful for cyclic positions or divisibility checks."),
    entry("&&", "Requires both boolean expressions to be true.", "The right side is evaluated only if the left side is true. This is short-circuit evaluation."),
    entry("||", "Accepts either boolean expression being true.", "The right side is evaluated only if the left side is false. This can avoid unnecessary work."),
    entry("!", "Negates a boolean.", "It changes true to false and false to true."),
    entry("++", "Increments a variable by one.", "The variable is updated. A prefix expression produces the updated value; a postfix expression produces the value from before the update."),
    entry("--", "Decrements a variable by one.", "The variable is updated. Prefix and postfix forms differ in whether the expression produces the new or previous value."),
    entry(".", "Selects a member or qualifies a name.", "The left side identifies the object, type, or package. The right side names a member or the next part of the qualified name."),
    entry(";", "Marks a statement boundary or a for-loop separator.", "Java generally requires semicolons after declarations, calls, assignments, and returns. In a basic for header they separate setup, condition, and update."),
    entry(",", "Separates items in a list.", "Commas separate arguments, parameters, declarations, or initializer entries depending on this code's structure."),
    entry("?", "Starts a conditional choice or a generic wildcard.", "In condition ? first : second, only the selected result expression is evaluated. In a generic type, ? describes an unknown type argument."),
    entry(":", "Separates parts of a Java construct.", "It can separate the two conditional results, an enhanced for variable from its source, or a label from the following statement."),
    entry("::", "Creates a method or constructor reference.", "This identifies behavior for a compatible functional interface. It does not immediately call that method or constructor."),
    entry("[", "Starts an array type, size, or index.", "Arrays have a fixed length. An index expression selects an element, starting at index zero."),
    entry("]", "Closes an array type, size, or index.", "This closes the matching square bracket in the array-related expression."),
    entry("@", "Introduces an annotation.", "Annotations attach metadata to a declaration or type use. Compilers, tools, or runtime code may read that metadata.")
  );

  static JsonArray inspect(PsiFile file, int start, int end) {
    var result = new JsonArray();
    if (!(file instanceof PsiJavaFile) || start < 0 || end > file.getTextLength() || end <= start) return result;
    int offset = start;
    var origins = new JavaOrigins();
    var seen = new HashSet<String>();
    for (int visited = 0; offset < end && visited < 2000 && result.size() < 80; visited++) {
      ProgressManager.checkCanceled();
      var leaf = file.findElementAt(offset);
      if (leaf == null) break;
      int next = Math.max(offset + 1, leaf.getTextRange().getEndOffset());
      if (!(leaf instanceof PsiWhiteSpace) && PsiTreeUtil.getParentOfType(leaf, PsiComment.class, false) == null) {
        PsiElement piece = leaf;
        var type = PsiTreeUtil.getParentOfType(leaf, PsiTypeElement.class, false);
        var literal = PsiTreeUtil.getParentOfType(leaf, PsiLiteralExpression.class, false);
        if (type != null && contained(type, start, end)) piece = type;
        else if (literal != null && contained(literal, start, end)) piece = literal;
        if (contained(piece, start, end)) {
          var description = describe(piece, origins);
          if (description != null) {
            String detail = description[1] + JavaOrigins.importClue(piece);
            String key = piece.getText() + "\u0000" + description[0] + "\u0000" + detail + identity(piece, origins);
            if (!seen.add(key)) { offset = Math.max(next, piece.getTextRange().getEndOffset()); continue; }
            var item = new JsonObject();
            item.addProperty("token", compact(piece.getText()));
            item.addProperty("brief", description[0]); item.addProperty("detail", detail);
            item.addProperty("start", piece.getTextRange().getStartOffset()); item.addProperty("end", piece.getTextRange().getEndOffset());
            result.add(item);
          }
          next = Math.max(next, piece.getTextRange().getEndOffset());
        }
      }
      offset = next;
    }
    return result;
  }
  // Keep distinct declarations, shadowed names and differently qualified calls distinct.
  // Deduplication removes repeated teaching content, not source text or syntax colors.
  private static String identity(PsiElement piece, JavaOrigins origins) {
    if (!(piece instanceof PsiIdentifier)) return "";
    var parent = piece.getParent();
    if (parent instanceof PsiNameIdentifierOwner) return "@" + parent.getTextOffset();
    if (parent instanceof PsiReferenceExpression reference) {
      var variable = origins.find(reference);
      if (variable != null) return "@" + variable.getTextOffset();
      var scope = PsiTreeUtil.getParentOfType(reference, PsiMethod.class, PsiClass.class);
      String call = reference.getParent() instanceof PsiMethodCallExpression method
        ? method.getArgumentList().getText() : "";
      return "@" + (scope == null ? 0 : scope.getTextOffset()) + ":" + reference.getText() + call;
    }
    return "";
  }
  private static boolean contained(PsiElement element, int start, int end) {
    var range = element.getTextRange();
    return range.getStartOffset() >= start && range.getEndOffset() <= end;
  }
  private static String[] describe(PsiElement piece, JavaOrigins origins) {
    String text = piece.getText();
    var parent = piece.getParent();
    if (piece instanceof PsiLiteralExpression literal) {
      if (literal.getValue() == null && !text.equals("null"))
        return new String[]{"An unfinished or invalid literal.", "Finish this value to see its literal type. IntelliJ's editor diagnostics can show what is missing."};
      String kind = literal.getValue() instanceof String ? "text" : literal.getValue() instanceof Character ? "a character code unit"
        : literal.getValue() instanceof Boolean ? "a boolean" : literal.getValue() == null ? "the null reference" : "a number";
      return new String[]{"A literal value: " + kind + ".", "This writes " + kind + " directly in the source." + argument(literal)};
    }
    if (piece instanceof PsiTypeElement) return WORDS.getOrDefault(text, new String[]{"The declared type.",
      "This type describes which values can be used here. Java checks type compatibility during compilation; generic arguments and array brackets further describe the value."});
    if (piece instanceof PsiIdentifier) {
      if (parent instanceof PsiMethod method) return new String[]{method.isConstructor() ? "The constructor's name." : "The method's name.",
        method.isConstructor() ? "A constructor sets up a new instance. It uses the class's name and has no return type." : "Callers use this name to invoke the method. Its parameter list declares inputs and the return type describes any result."};
      if (parent instanceof PsiParameter parameter) return new String[]{"A named parameter.", JavaOrigins.describe(parameter)};
      if (parent instanceof PsiVariable variable) return new String[]{"The variable or field's name.", JavaOrigins.describe(variable)};
      if (parent instanceof PsiClass) return new String[]{"The declared type's name.", "This name identifies the class, interface, enum, or record being declared."};
      if (parent instanceof PsiReferenceExpression reference) {
        if (reference.getParent() instanceof PsiMethodCallExpression call && call.getMethodExpression() == reference)
          return new String[]{"The method being called.", "Arguments are evaluated from left to right before this method is invoked. Any returned value can be used by the surrounding expression; the call may also have side effects." + argument(call)};
        String origin = origins.describe(reference);
        if (reference.getParent() instanceof PsiReferenceExpression member && member.getQualifierExpression() == reference)
          return new String[]{"The receiver or qualifier.", "The name before the dot identifies an object or type whose member is being accessed." + (origin.isEmpty() ? "" : " " + origin)};
        return new String[]{"A referenced name.", (origin.isEmpty()
          ? "This uses a value or member declared elsewhere in the applicable scope. Its name alone does not establish its runtime value." : origin) + argument(reference)};
      }
      var created = PsiTreeUtil.getParentOfType(piece, PsiNewExpression.class);
      if (created != null && created.getClassReference() != null && created.getClassReference().getTextRange().contains(piece.getTextRange()))
        return new String[]{"The type being created.", "With constructor arguments, new creates an instance of this type. With array brackets, it creates an array whose elements have this type."};
      return new String[]{"Part of a Java name.", "This identifier names a type, package, member, or label according to its surrounding syntax."};
    }
    if (text.equals("(") || text.equals(")")) {
      if (parent instanceof PsiParameterList) return new String[]{"The method's parameter list.", "Parameters declare the names and types of inputs that a caller can supply. An empty list declares no parameters."};
      if (parent instanceof PsiExpressionList) return new String[]{"The call's argument list.", "Arguments are the actual input expressions for a method or constructor call. A nested call must produce its result before that result is passed as an argument."};
      return new String[]{"Groups a condition, expression, or cast.", "Parentheses delimit this part of the Java construct and can control how expressions are grouped."};
    }
    if (text.equals("{") || text.equals("}")) return new String[]{"Delimits a body or initializer.",
      parent instanceof PsiArrayInitializerExpression ? "These braces enclose the initial values of an array." : "Braces enclose a class body or block of statements. A block establishes a scope for its local variables."};
    if (text.equals("->")) return new String[]{"Introduces a lambda body or switch rule.", "A lambda supplies behavior to a functional interface; its body runs when invoked. In a switch rule, the arrow introduces the selected branch."};
    if (parent instanceof PsiAssignmentExpression assignment && assignment.getOperationSign() == piece && !text.equals("="))
      return new String[]{"Combines an operation with assignment.", "This updates the left-hand variable using its previous value and the right-hand expression. The left side is evaluated once, and Java converts the result to its type."};
    if (java.util.Set.of("<", ">", "<=", ">=").contains(text)) return new String[]{"A comparison or generic-type delimiter.", "In an expression it compares numeric values and produces true or false. Angle brackets in a type enclose generic arguments instead."};
    return WORDS.get(text);
  }
  private static String argument(PsiExpression expression) {
    PsiElement parent = expression.getParent();
    while (parent instanceof PsiParenthesizedExpression) parent = parent.getParent();
    return parent instanceof PsiExpressionList ? " Here it is an argument: its value is passed into the surrounding call." : "";
  }
  private static String compact(String text) {
    text = text.replaceAll("[\\r\\n\\t]+", " ");
    return text.length() <= 100 ? text : text.substring(0, 97) + "…";
  }
}
