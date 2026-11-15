package com.watdatmean.intellij;

import com.intellij.openapi.fileTypes.FileTypeManager;
import com.intellij.openapi.project.Project;
import com.intellij.psi.PsiFileFactory;

/** Exercises scope boundaries using the real Java parser, without a project resolver or Node. */
final class JavaOriginsSmoke {
  static void run(Project project) {
    expect(project, "class Demo { int value = 1; void f(int value) { print(<caret>value); } }", "argument from the caller", "Initializer: 1");
    expect(project, "class Demo { int value = 1; void f() { int value = 7; value = 9; print(<caret>value); } }", "Initializer: 7", "Initializer: 9");
    expect(project, "class Demo { int value = 1; void f() { print(<caret>value); int value = 7; } }", "Initializer: 1", "Initializer: 7");
    expect(project, "class Demo { int value = 1; void f() { int first = <caret>value, value = 7; } }", "Initializer: 1", "Initializer: 7");
    expect(project, "class Demo { int value = 1; void f() { int value = <caret>value; } }", "Initializer: value", "Initializer: 1");
    expect(project, "class Demo { void f() { int value = 7, later = <caret>value; } }", "Initializer: 7", "applicable scope");
    expect(project, "class Demo { int value = 1; void f() { { int value = 7; print(value); } print(<caret>value); } }", "Initializer: 1", "Initializer: 7");
    expect(project, "class Demo { int value = 1; void f(int value) { print(this.<caret>value); } }", "Initializer: 1", "argument from the caller");
    expect(project, "class Demo { int value = 1; void f(Demo other) { print(other.<caret>value); } }", "applicable scope", "Initializer: 1");
    expect(project, "class Demo { int value = 1; static void f() { print(<caret>value); } }", "applicable scope", "Initializer: 1");
    expect(project, "class Demo { static int value = 1; static void f() { print(<caret>value); } }", "Initializer: 1", "argument from the caller");
    expect(project, "class Demo { void f() { int value; print(<caret>value); } }", "assignment before this local", "Fields receive");
    expect(project, "class Demo { int value; void f() { print(<caret>value); } }", "Fields receive Java's default", "assignment before this local");
    expect(project, "class Demo { void f() { var board = new Board(); <caret>board.run(); } }", "Initializer: new Board()", "applicable scope");
    expect(project, "class Demo { void f() { int[] values = new int[3]; print(<caret>values); } }", "Initializer: new int[3]", "constructor");
    expect(project, "class Demo { void f() { use(value -> print(<caret>value)); } }", "argument from the caller", "No initializer");
    expect(project, "class Demo { void f() { int value = 7; use(() -> print(<caret>value)); } }", "Initializer: 7", "applicable scope");
    expect(project, "class Demo { void f() { int value = 7; class Local { void g() { print(<caret>value); } } } }", "Initializer: 7", "applicable scope");
    expect(project, "class Demo { int value = 7; class Child extends Base { void f() { print(<caret>value); } } }", "applicable scope", "Initializer: 7");
    expect(project, "class Demo { void f() { for (int value = 0; value < 3; value++) print(<caret>value); } }", "Initializer: 0", "applicable scope");
    expect(project, "class Demo { int value = 7; void f() { for (int value = 0; value < 3; value++) {} print(<caret>value); } }", "Initializer: 7", "Initializer: 0");
    expect(project, "class Demo { void f(int[] values) { for (int value : values) print(<caret>value); } }", "element from values", "argument from the caller");
    expect(project, "class Demo { int[] value = {1}; void f() { for (int value : <caret>value) {} } }", "Initializer: {1}", "Each iteration");
    expect(project, "class Demo { void f() { try { run(); } catch (Exception error) { print(<caret>error); } } }", "exception handled by the catch", "argument from the caller");
    expect(project, "class Demo { void f() { try (var input = open()) { print(<caret>input); } } }", "Initializer: open()", "applicable scope");
    expect(project, "class Demo { Object input = fallback(); void f() { try (var input = open()) {} catch (Exception e) { print(<caret>input); } } }", "Initializer: fallback()", "Initializer: open()");
    expect(project, "class Demo { void f(Object value) { if (value instanceof String text) print(<caret>text); } }", "matched by the pattern", "argument from the caller");
    expect(project, "class Demo { String text = \"outer\"; void f(Object value) { if (value instanceof String text) {} else print(<caret>text); } }", "Initializer: \"outer\"", "matched by the pattern");
    expect(project, "class Demo { void f(Object value) { if (!(value instanceof String text)) return; print(<caret>text); } }", "matched by the pattern", "applicable scope");
    expect(project, "class Demo {\n void f() {\n  int value = 7;\n  print(<caret>value);\n }\n}", "Declared on line 3", "Declared on line 4");
    expect(project, "class Demo { String value = \"<img src=x>\"; void f() { print(<caret>value); } }", "Initializer: \"<img src=x>\"", "applicable scope");
    expect(project, "class Demo { String value = \"a   b\"; void f() { print(<caret>value); } }", "Initializer: \"a   b\"", "Initializer: \"a b\"");
    expect(project, "class Demo { void f() { int value = ; print(<caret>value); } }", "No initializer here", "Initializer: ;");
    System.out.println("PASS: Java variable origins, shadowing, declaration order, fields, parameters, lambdas, loops, exceptions, resources, patterns, and unknown receivers");
  }
  private static void expect(Project project, String marked, String expected, String absent) {
    int start = marked.indexOf("<caret>");
    String source = marked.replace("<caret>", "");
    int end = start;
    while (end < source.length() && Character.isJavaIdentifierPart(source.charAt(end))) end++;
    var file = PsiFileFactory.getInstance(project).createFileFromText("Demo.java", FileTypeManager.getInstance().getFileTypeByExtension("java"), source);
    var parts = JavaParts.inspect(file, start, end);
    if (parts.size() != 1) throw new AssertionError("Expected one piece at " + marked + ": " + parts);
    String detail = parts.get(0).getAsJsonObject().get("detail").getAsString();
    if (!detail.contains(expected) || detail.contains(absent))
      throw new AssertionError("Expected '" + expected + "', without '" + absent + "', at " + marked + ": " + detail);
  }
}
