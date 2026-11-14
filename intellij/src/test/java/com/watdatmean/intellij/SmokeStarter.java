package com.watdatmean.intellij;

import com.google.gson.JsonObject;
import com.intellij.openapi.actionSystem.ActionManager;
import com.intellij.openapi.application.*;
import com.intellij.openapi.editor.EditorFactory;
import com.intellij.openapi.fileEditor.FileDocumentManager;
import com.intellij.openapi.project.ProjectManager;
import com.intellij.openapi.command.WriteCommandAction;
import com.intellij.openapi.fileTypes.FileTypeManager;
import com.intellij.testFramework.LightVirtualFile;
import com.intellij.psi.PsiDocumentManager;
import java.nio.file.*;
import java.util.List;
import java.util.concurrent.TimeUnit;

/** Test-only application starter: packaged only in an isolated test profile. */
public final class SmokeStarter implements ApplicationStarter {
  @Override public String getCommandName() { return "watdatmean-smoke"; }
  @Override public boolean isHeadless() { return true; }
  @Override public int getRequiredModality() { return NOT_IN_EDT; }
  @Override public void main(List<String> args) {
    try {
      ApplicationManager.getApplication().invokeAndWait(this::editorChecks);
      Settings.get().getState().nodePath = System.getProperty("watdatmean.node.path");
      RuntimeSmoke.run();
      var bridge = new Bridge();
      try {
        var input = new JsonObject(); input.addProperty("code", "const score: number = 0;"); input.addProperty("start", 8); input.addProperty("end", 8);
        var result = bridge.call("inspect", input).get(20, TimeUnit.SECONDS).getAsJsonObject();
        check(result.get("symbol").getAsString().equals("score"), "Java/Node stdio bridge returns the TypeScript symbol");
        check(!result.getAsJsonArray("parts").isEmpty(), "Shared offline syntax explanations");
        bridge.call("clearCache", new JsonObject()).get(5, TimeUnit.SECONDS);
      } finally { bridge.dispose(); }
      if (Boolean.getBoolean("watdatmean.test.ui")) {
        try (var panel = new PanelSmoke()) { panel.run(); }
      }
      Files.writeString(Path.of(System.getProperty("watdatmean.test.result")), "PASS: plugin actions, Java method/selection capture, Java syntax checks, unsupported-language guard, document invalidation, Node runtime checks, cancellation, packaged Java/Node bridge"
        + (Boolean.getBoolean("watdatmean.test.ui") ? ", and native JCEF panel" : "") + ".\n");
      System.exit(0);
    } catch (Throwable error) {
      error.printStackTrace();
      try { Files.writeString(Path.of(System.getProperty("watdatmean.test.result")), "FAIL: " + error); } catch (Exception ignored) { }
      System.exit(1);
    }
  }
  private void editorChecks() {
    var project = ProjectManager.getInstance().getDefaultProject();
    for (String action : List.of("Inspect", "Configure", "RemoveKey", "ClearCache"))
      check(ActionManager.getInstance().getAction("WatDatMean." + action) != null, "Registered action " + action);
    String source = "class Demo { int doubleIt(int value) { return value * 2; } }";
    var file = new LightVirtualFile("Demo.java", FileTypeManager.getInstance().getFileTypeByExtension("java"), source);
    var document = FileDocumentManager.getInstance().getDocument(file);
    check(document != null, "Java document");
    var editor = EditorFactory.getInstance().createEditor(document, project);
    try {
      editor.getCaretModel().moveToOffset(source.indexOf("doubleIt"));
      var selected = SourceContext.capture(project, editor);
      check(selected.language().equalsIgnoreCase("Java"), "Detected Java language");
      check(selected.code().equals("int doubleIt(int value) { return value * 2; }"), "Method-name selection includes the method");
      check(SourceContext.syntax(project, selected, source).checked(), "Java parser available");
      check(SourceContext.syntax(project, selected, source).errors().isEmpty(), "Valid Java syntax");
      check(!SourceContext.syntax(project, selected, "class Demo { int value = ; }").errors().isEmpty(), "Invalid Java syntax blocked");
      int start = source.indexOf("value * 2");
      editor.getSelectionModel().setSelection(start, start + 9);
      check(SourceContext.capture(project, editor).code().equals("value * 2"), "Exact user selection preserved");
      WriteCommandAction.runWriteCommandAction(project, () -> document.insertString(0, "// changed\n"));
      check(!selected.current(), "Edited documents invalidate captured selections");
    } finally { EditorFactory.getInstance().releaseEditor(editor); }
    var plain = new LightVirtualFile("unknown.xyz", "some code");
    var plainDocument = FileDocumentManager.getInstance().getDocument(plain);
    var plainEditor = EditorFactory.getInstance().createEditor(plainDocument, project);
    try {
      var selected = SourceContext.capture(project, plainEditor);
      check(!SourceContext.syntax(project, selected, "changed code").checked(), "Unknown languages cannot falsely pass syntax checks");
    } finally { EditorFactory.getInstance().releaseEditor(plainEditor); }
    Tutor.get(project); // Check project service construction and listener lifecycle.
  }
  private static void check(boolean condition, String message) {
    if (!condition) throw new AssertionError(message);
  }
}
