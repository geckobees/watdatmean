package com.watdatmean.intellij;

import com.google.gson.*;
import com.intellij.openapi.command.WriteCommandAction;
import com.intellij.openapi.fileEditor.*;
import com.intellij.openapi.fileTypes.FileTypeManager;
import com.intellij.openapi.project.Project;
import com.intellij.testFramework.LightVirtualFile;

/** Exercises the actual line-navigation message and native editor, on the EDT. */
final class NavigationSmoke {
  static void run(Project project) {
    String source = "// prefix\nclass JumpDemo {\n  int first = 1;\n  int second = 2;\n}\n";
    var java = FileTypeManager.getInstance().getFileTypeByExtension("java");
    var file = new LightVirtualFile("JumpDemo.java", java, source);
    var other = new LightVirtualFile("Other.java", java, "class Other {}\n");
    var manager = FileEditorManager.getInstance(project);
    var tutor = Tutor.get(project);
    try {
      var editor = manager.openTextEditor(new OpenFileDescriptor(project, file), true);
      check(editor != null, "Original editor opens");
      var document = editor.getDocument();
      int start = source.indexOf("int first"), end = source.indexOf("int second") + "int second = 2;".length();
      editor.getSelectionModel().setSelection(start, end);
      var selected = SourceContext.capture(project, editor);
      EditSmoke.prepare(tutor, selected, selected.code());
      long id = (long) field(tutor, "selectionId");
      Object preview = field(tutor, "preview");
      editor.getSelectionModel().removeSelection(); editor.getCaretModel().moveToOffset(0);
      handle(tutor, "{\"type\":\"openSourceLine\",\"selectionId\":" + id + ",\"line\":4,\"file\":\"Other.java\"}");
      check(editor.getCaretModel().getLogicalPosition().line == 3 && editor.getCaretModel().getLogicalPosition().column == 0, "Click navigates to column zero of the exact original line");
      check(document.getText().equals(source) && field(tutor, "preview") == preview, "Navigation preserves source and pending edit preview");
      check(editor.getMarkupModel().getAllHighlighters().length > 0, "The navigation path adds a temporary destination highlight");

      editor.getCaretModel().moveToOffset(0);
      for (String line : new String[]{"0", "-1", "1", "2", "5", "3.5", "\"3\"", "null", "1e30"}) {
        handle(tutor, "{\"type\":\"openSourceLine\",\"selectionId\":" + id + ",\"line\":" + line + "}");
        check(editor.getCaretModel().getOffset() == 0, "Invalid/outside line is ignored: " + line);
      }
      for (String token : new String[]{"0", "-1", "null", "\"" + id + "\"", Long.toString(id + 1)}) {
        handle(tutor, "{\"type\":\"openSourceLine\",\"selectionId\":" + token + ",\"line\":3}");
        check(editor.getCaretModel().getOffset() == 0, "Invalid/old selection id is ignored");
      }
      manager.closeFile(file);
      manager.openTextEditor(new OpenFileDescriptor(project, other), true);
      handle(tutor, "{\"type\":\"openSourceLine\",\"selectionId\":" + id + ",\"line\":3}");
      editor = manager.getSelectedTextEditor();
      check(editor != null && editor.getDocument() == document && editor.getCaretModel().getLogicalPosition().line == 2, "Click reopens original file when a different editor is active");

      WriteCommandAction.runWriteCommandAction(project, () -> document.insertString(0, "// moved\n"));
      editor.getCaretModel().moveToOffset(0);
      handle(tutor, "{\"type\":\"openSourceLine\",\"selectionId\":" + id + ",\"line\":3}");
      check(editor.getCaretModel().getOffset() == 0, "Changed source cannot navigate using stale positions");
      var refreshed = SourceContext.refresh(project, selected, start + 9, end + 9);
      EditSmoke.prepare(tutor, refreshed, refreshed.code());
      handle(tutor, "{\"type\":\"openSourceLine\",\"selectionId\":" + id + ",\"line\":5}");
      check(editor.getCaretModel().getOffset() == 0, "Old links remain invalid after refresh");
      long currentId = (long) field(tutor, "selectionId");
      handle(tutor, "{\"type\":\"openSourceLine\",\"selectionId\":" + currentId + ",\"line\":5}");
      check(editor.getCaretModel().getLogicalPosition().line == 4, "Refreshed link reaches the updated source line");
      check(document.getText().equals("// moved\n" + source), "Navigation makes no document edits");
      System.out.println("PASS: native source-line navigation, reopened original file, exact caret, invalid/stale/snapshot guards, and preserved edits");
    } finally { manager.closeFile(file); manager.closeFile(other); }
  }
  private static void handle(Tutor tutor, String json) {
    try {
      var method = Tutor.class.getDeclaredMethod("handle", JsonObject.class);
      method.setAccessible(true); method.invoke(tutor, JsonParser.parseString(json).getAsJsonObject());
    } catch (ReflectiveOperationException error) { throw new AssertionError(error); }
  }
  private static Object field(Tutor tutor, String name) {
    try { var field = Tutor.class.getDeclaredField(name); field.setAccessible(true); return field.get(tutor); }
    catch (ReflectiveOperationException error) { throw new AssertionError(error); }
  }
  private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
}
