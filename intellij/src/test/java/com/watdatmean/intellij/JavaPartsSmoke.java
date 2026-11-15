package com.watdatmean.intellij;

import com.google.gson.*;
import com.intellij.ide.scratch.ScratchFileService;
import com.intellij.ide.scratch.ScratchRootType;
import com.intellij.openapi.actionSystem.ActionManager;
import com.intellij.openapi.command.WriteCommandAction;
import com.intellij.openapi.editor.EditorFactory;
import com.intellij.openapi.fileEditor.FileDocumentManager;
import com.intellij.openapi.fileTypes.FileTypeManager;
import com.intellij.openapi.project.Project;
import com.intellij.psi.*;
import com.intellij.psi.util.PsiTreeUtil;
import com.intellij.testFramework.LightVirtualFile;

/** Real Java PSI, selection refresh, and the editable demo, without Node or an API key. */
final class JavaPartsSmoke {
  static void run(Project project) {
    String source = """
      import java.util.List;
      class PartsDemo {
        // private int ignored = 99;
        private final int score = 3;
        int doubleIt(int value) { return value * 2; }
        void demo() {
          System.out.println(doubleIt(score));
          String text = "<img src=x>";
          if (text == null) { text += "hello"; }
        }
      }
      """;
    var virtual = new LightVirtualFile("PartsDemo.java", FileTypeManager.getInstance().getFileTypeByExtension("java"), source);
    var document = FileDocumentManager.getInstance().getDocument(virtual);
    var editor = EditorFactory.getInstance().createEditor(document, project);
    try {
      editor.getCaretModel().moveToOffset(source.indexOf("score ="));
      var selection = SourceContext.capture(project, editor);
      var parts = selection.snippet().getAsJsonArray("parts");
      check(selection.code().endsWith("private final int score = 3;"), "Cursor selects the Java field");
      check(detail(parts, "int").contains("2,147,483,647"), "Java integer range, not a TypeScript number");
      check(detail(parts, "final").contains("may still change"), "Final does not promise deep immutability");
      check(brief(parts, "score").contains("name"), "Declaration role");
      var file = PsiDocumentManager.getInstance(project).getPsiFile(document);
      parts = JavaParts.inspect(file, 0, source.length());
      check(detail(parts, "import").contains("does not execute or download"), "Java import semantics");
      check(detail(parts, "==").contains("same object"), "Reference identity is distinct from content equality");
      check(brief(parts, "+=").contains("assignment"), "Compound assignment");
      check(!contains(parts, "ignored"), "Comment contents are not syntax pieces");
      check(brief(parts, "\"<img src=x>\"").contains("text"), "String stays one literal piece");

      String call = "System.out.println(doubleIt(score));";
      int start = source.indexOf(call), end = start + call.length();
      editor.getSelectionModel().setSelection(start, end);
      selection = SourceContext.capture(project, editor);
      parts = selection.snippet().getAsJsonArray("parts");
      check(selection.code().equals(call), "Exact Java selection is preserved");
      check(brief(parts, "println").contains("called"), "Outer method call");
      check(detail(parts, "doubleIt").contains("argument"), "Nested call result is an argument");
      check(detail(parts, "score").contains("argument"), "Variable input is an argument");
      check(brief(parts, "out").contains("qualifier"), "Receiver in a qualified call");
      for (var element : parts) {
        var part = element.getAsJsonObject();
        int from = part.get("start").getAsInt(), to = part.get("end").getAsInt();
        check(from >= start && to <= end && source.substring(from, to).equals(part.get("token").getAsString()), "Pieces stay within the selected source");
      }
      check(JavaParts.inspect(file, start + 1, start + 5).isEmpty(), "A partially selected name is not expanded beyond the selection");
      int input = start + call.indexOf("score");
      WriteCommandAction.runWriteCommandAction(project, () -> document.replaceString(input, input + 5, "42"));
      var refreshed = SourceContext.refresh(project, selection, start, end - 3);
      parts = refreshed.snippet().getAsJsonArray("parts");
      check(contains(parts, "42") && !contains(parts, "score"), "Refresh regenerates pieces from the edited document");
      check(detail(parts, "42").contains("argument"), "Literal input retains its call role after refresh");
    } finally { EditorFactory.getInstance().releaseEditor(editor); }

    var factory = PsiFileFactory.getInstance(project);
    var javaType = FileTypeManager.getInstance().getFileTypeByExtension("java");
    var broken = factory.createFileFromText("Broken.java", javaType, "class Broken { void run( { int score = ; }");
    check(!JavaParts.inspect(broken, 0, broken.getTextLength()).isEmpty(), "Incomplete code still yields available pieces");
    var plain = factory.createFileFromText("notes.txt", "private int score = 3;");
    check(JavaParts.inspect(plain, 0, plain.getTextLength()).isEmpty(), "No Java guesses for unsupported languages");
    var comments = factory.createFileFromText("Comments.java", javaType, "// if (score == 3) return;\n/* class Demo {} */");
    check(JavaParts.inspect(comments, 0, comments.getTextLength()).isEmpty(), "Comment-only selections have no pieces");
    var large = factory.createFileFromText("Large.java", javaType, "class Large { void run() {" + "use(1);".repeat(2000) + "} }");
    check(JavaParts.inspect(large, 0, large.getTextLength()).size() <= 80, "Large selections are bounded");
    var repeated = factory.createFileFromText("Repeated.java", javaType,
      "class Repeated { int value = 1; void run() {" + "System.out.println(value);".repeat(60) + "int afterLoops = 7; } }");
    var unique = JavaParts.inspect(repeated, 0, repeated.getTextLength());
    check(count(unique, "println") == 1 && count(unique, ";") == 1, "Repeated calls and punctuation are outlined once");
    check(count(unique, "value") == 2, "Keep one declaration and one reference explanation");
    check(contains(unique, "afterLoops"), "Duplicates do not consume the budget before later new names");
    var distinct = factory.createFileFromText("Distinct.java", javaType,
      "class Distinct { int value; void pick(int n) {} void pick(String n) {} void run(int value) { left.use(value); right.use(value); } }");
    var different = JavaParts.inspect(distinct, 0, distinct.getTextLength());
    check(count(different, "pick") == 2, "Overloaded method declarations stay distinct");
    check(count(different, "value") >= 3, "Shadowed declarations and the parameter reference retain their origins");
    check(count(different, "use") == 2, "Same method name on different receivers stays distinct");
    var longLiteral = factory.createFileFromText("Long.java", javaType, "class Long { String text = \"" + "x".repeat(200) + "\"; }");
    for (var part : JavaParts.inspect(longLiteral, 0, longLiteral.getTextLength()))
      check(part.getAsJsonObject().get("token").getAsString().length() <= 100, "Long labels stay compact");

    check(ActionManager.getInstance().getAction("WatDatMean.Demo") instanceof DemoAction, "Demo action is registered");
    var first = DemoAction.create(project);
    var second = DemoAction.create(project);
    check(first != null && second != null && !first.equals(second), "Each demo gets a fresh scratch file");
    check(ScratchFileService.findRootType(first) == ScratchRootType.getInstance(), "Demo does not enter the project source tree");
    var demoDocument = FileDocumentManager.getInstance().getDocument(first);
    check(demoDocument != null && demoDocument.getText().equals(DemoAction.SOURCE), "Opening another demo preserves the first file");
    var demoPsi = PsiManager.getInstance(project).findFile(first);
    check(demoPsi instanceof PsiJavaFile && PsiTreeUtil.findChildOfType(demoPsi, PsiErrorElement.class) == null, "Demo is valid Java syntax");
    System.out.println("PASS: Java syntax pieces, duplicate reduction, preserved declarations/shadowing/receivers, nested arguments, exact ranges, refreshed edits, incomplete code, bounded output, and fresh Java demo scratches");
  }
  private static boolean contains(JsonArray parts, String token) {
    for (var element : parts) if (element.getAsJsonObject().get("token").getAsString().equals(token)) return true;
    return false;
  }
  private static int count(JsonArray parts, String token) {
    int count = 0; for (var part : parts) if (part.getAsJsonObject().get("token").getAsString().equals(token)) count++; return count;
  }
  private static String field(JsonArray parts, String token, String name) {
    for (var element : parts) {
      var part = element.getAsJsonObject();
      if (part.get("token").getAsString().equals(token)) return part.get(name).getAsString();
    }
    throw new AssertionError("Missing syntax piece: " + token + " in " + parts);
  }
  private static String brief(JsonArray parts, String token) { return field(parts, token, "brief"); }
  private static String detail(JsonArray parts, String token) { return field(parts, token, "detail"); }
  private static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
}
