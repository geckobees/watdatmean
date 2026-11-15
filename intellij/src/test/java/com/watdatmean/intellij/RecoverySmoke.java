package com.watdatmean.intellij;

import com.google.gson.*;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.command.WriteCommandAction;
import com.intellij.openapi.editor.EditorFactory;
import com.intellij.openapi.fileEditor.FileDocumentManager;
import com.intellij.openapi.fileTypes.FileTypeManager;
import com.intellij.openapi.project.ProjectManager;
import com.intellij.testFramework.LightVirtualFile;
import com.intellij.ui.jcef.*;
import org.cef.CefSettings;
import org.cef.browser.CefBrowser;
import org.cef.handler.CefDisplayHandlerAdapter;
import javax.swing.*;
import java.util.concurrent.*;

/** Exercises Tutor's real browser replacement, saved range, and preview invalidation. */
final class RecoverySmoke {
  static void run() throws Exception {
    var project = ProjectManager.getInstance().getDefaultProject();
    var tutor = Tutor.get(project);
    String source = "class RecoveryDemo { int score = 3; }";
    var file = new LightVirtualFile("RecoveryDemo.java", FileTypeManager.getInstance().getFileTypeByExtension("java"), source);
    var document = ApplicationManager.getApplication().runReadAction((com.intellij.openapi.util.Computable<com.intellij.openapi.editor.Document>) () -> FileDocumentManager.getInstance().getDocument(file));
    com.intellij.openapi.editor.Editor[] editors = new com.intellij.openapi.editor.Editor[1];
    JFrame[] frames = new JFrame[1];
    try {
      ApplicationManager.getApplication().invokeAndWait(() -> {
        editors[0] = EditorFactory.getInstance().createEditor(document, project);
        editors[0].getCaretModel().moveToOffset(source.indexOf("score"));
        EditSmoke.prepare(tutor, SourceContext.capture(project, editors[0]), "int score = 7;");
        frames[0] = new JFrame("WatDatMean panel recovery test");
        frames[0].setContentPane(tutor.panel()); frames[0].setSize(620, 900); frames[0].setVisible(true);
      });
      awaitReady(tutor);
      for (int iteration = 0; iteration < 2; iteration++) {
        var oldPanel = (PanelView) field(tutor, "panel");
        var oldBrowser = (JBCefBrowser) field(oldPanel, "browser");
        ApplicationManager.getApplication().invokeAndWait(() -> {
          WriteCommandAction.runWriteCommandAction(project, () -> document.insertString(0, "// shifted\n"));
          tutor.reopenPanel();
        });
        check(oldBrowser.isDisposed(), "Recovery disposes the old browser");
        check(field(tutor, "panel") != oldPanel, "Recovery creates a fresh panel");
        check(field(tutor, "preview") == null, "Recovery invalidates previous edit approval");
        awaitReady(tutor);
        var selected = (SourceContext.Selection) field(tutor, "selection");
        ApplicationManager.getApplication().invokeAndWait(() -> {
          check(document.getText().endsWith(source), "Recovery does not apply the prepared edit");
          check(selected.current() && selected.code().equals("int score = 3;"), "Saved selection refreshes after edits before it");
        });
        var panel = (PanelView) field(tutor, "panel");
        var browser = (JBCefBrowser) field(panel, "browser");
        var replies = new LinkedBlockingQueue<JsonObject>();
        ApplicationManager.getApplication().invokeAndWait(() -> {
          browser.getJBCefClient().addDisplayHandler(new CefDisplayHandlerAdapter() {
            @Override public boolean onConsoleMessage(CefBrowser cef, CefSettings.LogSeverity severity, String message, String source, int line) {
              if (!message.startsWith("wdm-recovery-probe:")) return false;
              replies.add(JsonParser.parseString(message.substring("wdm-recovery-probe:".length())).getAsJsonObject());
              return true;
            }
          }, browser.getCefBrowser());
          browser.getCefBrowser().executeJavaScript("console.log('wdm-recovery-probe:'+JSON.stringify({code:document.getElementById('source').textContent,pieces:document.getElementById('parts').textContent,buttons:document.querySelectorAll('#parts [role=button]').length}))", "", 0);
        });
        var reply = replies.poll(20, TimeUnit.SECONDS);
        check(reply != null && reply.get("code").getAsString().equals(selected.code()), "Recovered panel receives the current selection");
        check(reply.get("pieces").getAsString().equals(selected.code()) && reply.get("buttons").getAsInt() > 0, "Native selection offsets keep pieces clickable after recovery");
      }
      System.out.println("PASS: repeated native panel recovery, browser disposal, saved range refresh, preview invalidation, and boxed source offsets");
    } finally {
      ApplicationManager.getApplication().invokeAndWait(() -> {
        if (frames[0] != null) frames[0].dispose();
        if (editors[0] != null) EditorFactory.getInstance().releaseEditor(editors[0]);
      });
    }
  }
  private static void awaitReady(Tutor tutor) throws Exception {
    for (int attempt = 0; attempt < 200; attempt++) {
      boolean[] ready = new boolean[1];
      ApplicationManager.getApplication().invokeAndWait(() -> ready[0] = (boolean) field(tutor, "ready"));
      if (ready[0]) return;
      Thread.sleep(100);
    }
    throw new AssertionError("Recovered panel did not finish its ready handshake");
  }
  private static Object field(Object object, String name) {
    try { var field = object.getClass().getDeclaredField(name); field.setAccessible(true); return field.get(object); }
    catch (ReflectiveOperationException error) { throw new AssertionError(error); }
  }
  private static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
}
