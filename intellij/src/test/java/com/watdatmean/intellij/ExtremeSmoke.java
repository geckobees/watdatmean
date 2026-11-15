package com.watdatmean.intellij;

import com.intellij.openapi.editor.EditorFactory;
import com.intellij.openapi.fileEditor.FileDocumentManager;
import com.intellij.openapi.fileTypes.FileTypeManager;
import com.intellij.openapi.project.Project;
import com.intellij.psi.PsiFileFactory;
import com.intellij.testFramework.LightVirtualFile;

final class ExtremeSmoke {
  static void run(Project project) {
    long started = System.nanoTime();
    var type = FileTypeManager.getInstance().getFileTypeByExtension("java");
    for (String source : new String[]{"", "// only a comment", "class Broken { void f( { int = ; }", "class Unicode { String name = \"😀\"; int café = 3; }",
      "class Large { String text = \"" + "x".repeat(480000) + "\"; }",
      "class Many { " + java.util.stream.IntStream.range(0,4000).mapToObj(i -> "int item" + i + " = " + i + ";").collect(java.util.stream.Collectors.joining()) + "}"}) {
      var file = PsiFileFactory.getInstance(project).createFileFromText("Extreme.java", type, source);
      var pieces = JavaParts.inspect(file, 0, source.length());
      if (pieces.size() > 80) throw new AssertionError("Java pieces must stay bounded");
      for (var item : pieces) if (item.getAsJsonObject().get("token").getAsString().length() > 100) throw new AssertionError("Long labels must stay bounded");
    }
    var virtual = new LightVirtualFile("Limit.java", type, "x".repeat(500001));
    var editor = EditorFactory.getInstance().createEditor(FileDocumentManager.getInstance().getDocument(virtual), project);
    try {
      try { SourceContext.capture(project, editor); throw new AssertionError("Oversized source must be rejected"); }
      catch (IllegalStateException expected) { if (!expected.getMessage().contains("500,000")) throw expected; }
    } finally { EditorFactory.getInstance().releaseEditor(editor); }
    String code = "import java.util.ArrayList;\nclass Demo { void f() { var values = new ArrayList<Integer>(); values.add(3); } }";
    virtual = new LightVirtualFile("Imports.java", type, code);
    editor = EditorFactory.getInstance().createEditor(FileDocumentManager.getInstance().getDocument(virtual), project);
    try {
      editor.getCaretModel().moveToOffset(code.indexOf("values.add"));
      var selected = SourceContext.capture(project, editor);
      String clues = SourceContext.learningContext(project, selected);
      if (!clues.contains("java.util.ArrayList") || !clues.contains("not independently verified")) throw new AssertionError("Library clues must stay explicit about what is known");
      editor.getCaretModel().moveToOffset(code.indexOf("values ="));
      if (!SourceContext.capture(project, editor).snippet().get("parts").toString().contains("Written import: java.util.ArrayList")) throw new AssertionError("Java type pieces show their written import locally");
    } finally { EditorFactory.getInstance().releaseEditor(editor); }
    System.out.println("PASS: native Java empty/comment/invalid/Unicode/480k literal/4000 fields, size limits, and library clues (" + (System.nanoTime()-started)/1000000 + " ms)");
  }
}
