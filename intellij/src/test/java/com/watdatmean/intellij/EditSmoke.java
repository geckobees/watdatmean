package com.watdatmean.intellij;

import com.intellij.openapi.command.WriteCommandAction;
import com.intellij.openapi.editor.EditorFactory;
import com.intellij.openapi.fileEditor.FileDocumentManager;
import com.intellij.openapi.fileTypes.FileTypeManager;
import com.intellij.openapi.project.Project;
import com.intellij.testFramework.LightVirtualFile;
import java.util.concurrent.atomic.AtomicLong;

/** Exercises the real edit path; the confirmation callback simulates events while a dialog is open. */
final class EditSmoke {
  static void run(Project project) {
    var tutor = Tutor.get(project);
    var original = "class EditDemo { int score = 0; }";
    var file = new LightVirtualFile("EditDemo.java", FileTypeManager.getInstance().getFileTypeByExtension("java"), original);
    var document = FileDocumentManager.getInstance().getDocument(file);
    var editor = EditorFactory.getInstance().createEditor(document, project);
    try {
      editor.getCaretModel().moveToOffset(original.indexOf("score"));
      var selection = SourceContext.capture(project, editor);
      String replacement = "int score = 10;";
      prepare(tutor, selection, replacement);
      tutor.apply(replacement, () -> {
        check(busy(tutor), "Apply disables other actions while awaiting confirmation");
        invoke(tutor, "cancel");
        return true;
      });
      check(document.getText().equals(original), "Cancellation prevents a previously confirmed edit");
      check(!busy(tutor), "Cancellation releases the busy state");

      prepare(tutor, selection, replacement);
      tutor.apply(replacement, () -> false);
      check(document.getText().equals(original) && !busy(tutor), "Declining confirmation leaves the file unchanged and ready");

      prepare(tutor, selection, replacement);
      tutor.apply(replacement, () -> {
        tutor.apply(replacement, () -> { throw new AssertionError("A second apply must not open another confirmation"); });
        return true;
      });
      check(document.getText().equals("class EditDemo { int score = 10; }"), "A confirmed edit still applies normally");
      check(!busy(tutor), "Successful edits release the busy state");

      var next = SourceContext.capture(project, editor);
      prepare(tutor, next, "int score = 20;");
      tutor.apply("int score = 20;", () -> {
        WriteCommandAction.runWriteCommandAction(project, () -> document.insertString(0, "// edited during confirmation\n"));
        return true;
      });
      check(document.getText().equals("// edited during confirmation\nclass EditDemo { int score = 10; }"), "A source edit during confirmation invalidates Apply");
      check(!busy(tutor), "Source invalidation releases the busy state");
      System.out.println("PASS: native edit confirmation, cancellation, duplicate-apply guard, source invalidation, and successful apply");
    } finally { EditorFactory.getInstance().releaseEditor(editor); }
  }
  private static void prepare(Tutor tutor, SourceContext.Selection selection, String replacement) {
    try {
      var select = Tutor.class.getDeclaredMethod("select", SourceContext.Selection.class, boolean.class);
      select.setAccessible(true); select.invoke(tutor, selection, false);
      var revision = Tutor.class.getDeclaredField("revision"); revision.setAccessible(true);
      var preview = Tutor.class.getDeclaredField("preview"); preview.setAccessible(true);
      var constructor = preview.getType().getDeclaredConstructor(SourceContext.Selection.class, String.class, long.class);
      constructor.setAccessible(true);
      preview.set(tutor, constructor.newInstance(selection, replacement, ((AtomicLong) revision.get(tutor)).get()));
    } catch (ReflectiveOperationException error) { throw new AssertionError(error); }
  }
  private static boolean busy(Tutor tutor) {
    try {
      var field = Tutor.class.getDeclaredField("busy"); field.setAccessible(true);
      return field.getBoolean(tutor);
    } catch (ReflectiveOperationException error) { throw new AssertionError(error); }
  }
  private static void invoke(Tutor tutor, String name) {
    try {
      var method = Tutor.class.getDeclaredMethod(name); method.setAccessible(true); method.invoke(tutor);
    } catch (ReflectiveOperationException error) { throw new AssertionError(error); }
  }
  private static void check(boolean condition, String message) {
    if (!condition) throw new AssertionError(message);
  }
}
