package com.watdatmean.intellij;

import com.intellij.codeInsight.daemon.DaemonCodeAnalyzer;
import com.intellij.codeInsight.daemon.impl.DaemonCodeAnalyzerImpl;
import com.intellij.ide.highlighter.JavaHighlightingColors;
import com.intellij.openapi.application.*;
import com.intellij.openapi.command.WriteCommandAction;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.editor.colors.EditorColorsScheme;
import com.intellij.openapi.editor.markup.TextAttributes;
import com.intellij.openapi.fileEditor.*;
import com.intellij.openapi.module.ModuleManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.roots.ModuleRootModificationUtil;
import com.intellij.openapi.vfs.*;
import com.intellij.psi.*;
import java.awt.Color;

/** Real daemon-produced semantic highlighting, using an isolated Java source module. */
final class SemanticSmoke {
  static void run(Project project) throws Exception {
    String source = "class NativeColors { static int read(int input) { return input; } void run() { NativeColors value = new NativeColors(); int result = read(2); } }";
    VirtualFile[] file = {null}; Editor[] editor = {null};
    ApplicationManager.getApplication().invokeAndWait(() -> WriteCommandAction.runWriteCommandAction(project, () -> {
      try {
        var root = VfsUtil.createDirectories(project.getBasePath() + "/semantic");
        var module = ModuleManager.getInstance(project).findModuleByName("colors");
        if (module == null) module = ModuleManager.getInstance(project).newModule(project.getBasePath() + "/colors.iml", "JAVA_MODULE");
        ModuleRootModificationUtil.updateModel(module, model -> {
          if (java.util.Arrays.stream(model.getContentEntries()).noneMatch(entry -> entry.getUrl().equals(root.getUrl())))
            model.addContentEntry(root).addSourceFolder(root, false);
        });
        file[0] = root.findOrCreateChildData(SemanticSmoke.class, "NativeColors.java");
        VfsUtil.saveText(file[0], source);
        editor[0] = FileEditorManager.getInstance(project).openTextEditor(new OpenFileDescriptor(project, file[0]), true);
        var scheme = (EditorColorsScheme)com.intellij.openapi.editor.colors.EditorColorsManager.getInstance().getGlobalScheme().clone();
        scheme.setAttributes(JavaHighlightingColors.CLASS_NAME_ATTRIBUTES, new TextAttributes(new Color(0x345671), null, null, null, 0));
        scheme.setAttributes(JavaHighlightingColors.STATIC_METHOD_ATTRIBUTES, new TextAttributes(new Color(0x345672), null, null, null, 0));
        scheme.setAttributes(JavaHighlightingColors.CONSTRUCTOR_CALL_ATTRIBUTES, new TextAttributes(new Color(0x345673), null, null, null, 0));
        ((com.intellij.openapi.editor.ex.EditorEx)editor[0]).setColorsScheme(scheme);
        PsiDocumentManager.getInstance(project).commitAllDocuments();
        DaemonCodeAnalyzer.getInstance(project).restart();
      } catch (Exception error) { throw new RuntimeException(error); }
    }));
    try {
      long deadline = System.nanoTime() + 30_000_000_000L;
      boolean passed = false;
      String[] status = {"not checked"};
      while (System.nanoTime() < deadline) {
        passed = ReadAction.compute(() -> {
          var psi = PsiManager.getInstance(project).findFile(file[0]);
          var daemon = (DaemonCodeAnalyzerImpl)DaemonCodeAnalyzer.getInstance(project);
          if (!daemon.isErrorAnalyzingFinished(psi)) { status[0] = "daemon pending; available=" + daemon.isHighlightingAvailable(psi) + "; dumb=" + com.intellij.openapi.project.DumbService.isDumb(project); return false; }
          var result = CodeColors.highlight(project, file[0], source, 0, source.length());
          // The production color budget can expire while the IDE is starting. Keep the
          // existing bounded polling window, as the panel also retries an empty result.
          if (result.getAsJsonArray("runs").isEmpty()) { status[0] = "color budget exceeded during startup"; return false; }
          status[0] = "class=" + CodeColorsSmoke.colorAt(result, source.indexOf("NativeColors value")) + "; method=" + CodeColorsSmoke.colorAt(result, source.lastIndexOf("read"));
          return CodeColorsSmoke.colorAt(result, source.indexOf("NativeColors value")).equals("#345671")
            && CodeColorsSmoke.colorAt(result, source.lastIndexOf("NativeColors")).equals("#345673")
            && CodeColorsSmoke.colorAt(result, source.lastIndexOf("read")).equals("#345672");
        });
        if (passed) break;
        Thread.sleep(100);
      }
      if (!passed) {
        ReadAction.run(() -> {
          var psi = PsiManager.getInstance(project).findFile(file[0]);
          com.intellij.codeInsight.daemon.impl.DaemonCodeAnalyzerEx.processHighlights(editor[0].getDocument(), project, com.intellij.codeInsight.daemon.impl.HighlightInfoType.SYMBOL_TYPE_SEVERITY, 0, source.length(), info -> {
            System.out.println("SEMANTIC DEBUG " + info.getActualStartOffset() + ".." + info.getActualEndOffset() + " " + info.getSeverity() + " " + info.type + " " + info.getTextAttributes(psi, editor[0].getColorsScheme())); return true;
          });
        });
        throw new AssertionError("Completed native Java semantics color class references and static method calls using the editor scheme: " + status[0]);
      }
      String draft = source.replace("int result = read(2);", "String read = \"read\";");
      var changed = CodeColors.highlight(project, file[0], draft, 0, draft.length());
      if (CodeColorsSmoke.colorAt(changed, draft.lastIndexOf("read")).equals("#345672"))
        throw new AssertionError("A draft string must never borrow native method-call colors");
      System.out.println("PASS: completed native Java semantic markup, distinct class/constructor references, static calls, per-editor scheme and changed-draft guard");
    } finally {
      ApplicationManager.getApplication().invokeAndWait(() -> FileEditorManager.getInstance(project).closeFile(file[0]));
    }
  }
}
