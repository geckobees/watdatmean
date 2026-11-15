package com.watdatmean.intellij;

import com.google.gson.*;
import com.intellij.codeInsight.daemon.DaemonCodeAnalyzer;
import com.intellij.codeInsight.daemon.impl.DaemonCodeAnalyzerEx;
import com.intellij.codeInsight.daemon.impl.DaemonCodeAnalyzerImpl;
import com.intellij.codeInsight.daemon.impl.HighlightInfoType;
import com.intellij.lang.annotation.HighlightSeverity;
import com.intellij.openapi.application.ReadAction;
import com.intellij.openapi.editor.EditorFactory;
import com.intellij.openapi.editor.colors.EditorColorsScheme;
import com.intellij.openapi.editor.colors.EditorColorsManager;
import com.intellij.openapi.editor.highlighter.EditorHighlighterFactory;
import com.intellij.openapi.editor.markup.EffectType;
import com.intellij.openapi.editor.markup.TextAttributes;
import com.intellij.openapi.fileEditor.FileDocumentManager;
import com.intellij.openapi.progress.ProgressManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.psi.*;
import com.intellij.ui.ColorUtil;
import java.awt.Font;
import java.util.*;

/** Uses the installed language plugin and editor scheme, including the lexical context before a selection. */
final class CodeColors {
  private CodeColors() {}
  static JsonObject plain() {
    var result = new JsonObject(); result.add("runs", new JsonArray()); result.add("styles", new JsonArray()); return result;
  }
  /** Saved code and examples use their own language, never the active file's semantic information. */
  static JsonObject snippet(Project project, String language, String code) {
    if (language.length() > 100 || code.length() > 50000) return plain();
    var type = com.intellij.lang.Language.getRegisteredLanguages().stream()
      .filter(l -> l.getID().equalsIgnoreCase(language) || l.getDisplayName().equalsIgnoreCase(language))
      .map(com.intellij.lang.Language::getAssociatedFileType).filter(java.util.Objects::nonNull).findFirst().orElse(null);
    if (type == null) {
      String extension = switch (language.toLowerCase(java.util.Locale.ROOT)) {
        case "typescript jsx", "typescriptreact" -> "tsx"; case "javascript jsx", "javascriptreact" -> "jsx";
        case "c#", "csharp" -> "cs"; case "c++", "cpp" -> "cpp"; default -> "txt";
      };
      var fallback = com.intellij.openapi.fileTypes.FileTypeManager.getInstance().getFileTypeByExtension(extension);
      return highlight(project, new com.intellij.testFramework.LightVirtualFile("example."+extension, fallback, code), code, 0, code.length());
    }
    return highlight(project, new com.intellij.testFramework.LightVirtualFile("example."+type.getDefaultExtension(), type, code), code, 0, code.length());
  }
  static JsonObject highlight(Project project, VirtualFile file, String source, int start, int end) {
    if (source.length() > 500000 || end - start > 50000 || start < 0 || end < start || end > source.length()) return plain();
    // Community editions may lack a language plugin. A uniform plain-text range
    // is not syntax information and must not replace the panel's lexical fallback.
    if (file.getFileType() == com.intellij.openapi.fileTypes.PlainTextFileType.INSTANCE) return plain();
    try { return ReadAction.compute(() -> {
      var document = FileDocumentManager.getInstance().getCachedDocument(file);
      var editors = document == null ? new com.intellij.openapi.editor.Editor[0] : EditorFactory.getInstance().getEditors(document, project);
      var scheme = editors.length == 0 ? EditorColorsManager.getInstance().getGlobalScheme() : editors[0].getColorsScheme();
      var highlighter = EditorHighlighterFactory.getInstance().createEditorHighlighter(file, scheme, project);
      highlighter.setText(source);
      var paint = new Paint(start, end, scheme);
      var iterator = highlighter.createIterator(start);
      long deadline = System.nanoTime() + 150_000_000;
      int count = 0;
      while (!iterator.atEnd() && iterator.getStart() < end) {
        ProgressManager.checkCanceled();
        if (++count > 12000 || System.nanoTime() > deadline) return plain();
        paint.apply(iterator.getStart(), iterator.getEnd(), iterator.getTextAttributes(), false);
        iterator.advance();
      }
      try {
        // Earlier edits can change symbol meanings: the entire snapshot must match.
        boolean current = document != null && source.contentEquals(document.getImmutableCharSequence());
        var documents = PsiDocumentManager.getInstance(project);
        PsiFile psi = current && documents.isCommitted(document) ? documents.getPsiFile(document) : null;
        if ("java".equalsIgnoreCase(file.getExtension())) {
          if (psi == null) psi = PsiFileFactory.getInstance(project).createFileFromText(file.getName(), file.getFileType(), source);
          var origins = new JavaOrigins();
          long semanticDeadline = System.nanoTime() + 150_000_000;
          for (int offset = start, visited = 0; psi instanceof PsiJavaFile && offset < end && visited < 10000; visited++) {
            ProgressManager.checkCanceled();
            if (System.nanoTime() > semanticDeadline) break;
            var leaf = psi.findElementAt(offset); if (leaf == null) break;
            var key = JavaSemanticColors.key(leaf, origins);
            if (key != null) paint.apply(leaf.getTextRange().getStartOffset(), leaf.getTextRange().getEndOffset(), scheme.getAttributes(key), true);
            offset = Math.max(offset + 1, leaf.getTextRange().getEndOffset());
          }
        }
        // Completed daemon information includes language-plugin semantics and rainbow colors.
        // Never copy errors, warnings, search matches, or markup left over from a document edit.
        if (current && documents.isCommitted(document) && psi != null && !project.isDefault()
            && DaemonCodeAnalyzer.getInstance(project) instanceof DaemonCodeAnalyzerImpl daemon
            && daemon.isErrorAnalyzingFinished(psi)) {
          final PsiFile context = psi;
          int[] visited = {0};
          long markupDeadline = System.nanoTime() + 150_000_000;
          DaemonCodeAnalyzerEx.processHighlights(document, project, HighlightInfoType.SYMBOL_TYPE_SEVERITY, start, end, info -> {
            ProgressManager.checkCanceled();
            if (++visited[0] > 12000 || System.nanoTime() > markupDeadline) return false;
            if (info.getSeverity().equals(HighlightSeverity.INFORMATION) || info.getSeverity().equals(HighlightInfoType.SYMBOL_TYPE_SEVERITY)) {
              var attributes = info.getTextAttributes(context, scheme);
              if (attributes != null && attributes.getForegroundColor() != null)
                paint.apply(info.getActualStartOffset(), info.getActualEndOffset(), attributes, true);
            }
            return true;
          });
        }
      } catch (com.intellij.openapi.progress.ProcessCanceledException canceled) { throw canceled; }
      catch (RuntimeException | LinkageError unavailable) { /* Keep local syntax if a plugin/API is unavailable. */ }
      return paint.result();
    }); } catch (com.intellij.openapi.progress.ProcessCanceledException canceled) { throw canceled; }
    catch (RuntimeException unavailable) { return plain(); }
  }
  private record Style(String color, int font) {}
  private static final class Paint {
    private final int start;
    private final int[] pixels;
    private final EditorColorsScheme scheme;
    private final ArrayList<Style> styles = new ArrayList<>();
    private final Map<Style, Integer> indices = new HashMap<>();
    Paint(int start, int end, EditorColorsScheme scheme) { this.start = start; this.pixels = new int[end-start]; this.scheme = scheme; Arrays.fill(pixels, -1); }
    void apply(int from, int to, TextAttributes attributes, boolean overlay) {
      if (attributes == null) return;
      int a = Math.max(0, from-start), b = Math.min(pixels.length, to-start);
      int font = ((attributes.getFontType() & Font.ITALIC) != 0 ? 1 : 0) | ((attributes.getFontType() & Font.BOLD) != 0 ? 2 : 0);
      if (!overlay && attributes.getEffectType() == EffectType.LINE_UNDERSCORE) font |= 4;
      if (!overlay && attributes.getEffectType() == EffectType.STRIKEOUT) font |= 8;
      for (int i = a; i < b; i++) {
        String color = attributes.getForegroundColor() == null
          ? overlay && pixels[i] >= 0 ? styles.get(pixels[i]).color() : "#" + ColorUtil.toHex(scheme.getDefaultForeground())
          : "#" + ColorUtil.toHex(attributes.getForegroundColor());
        var style = new Style(color, font);
        Integer index = indices.get(style);
        if (index == null) { index = styles.size(); indices.put(style, index); styles.add(style); }
        pixels[i] = index;
      }
    }
    JsonObject result() {
      var result = plain();
      for (var value : styles) { var style = new JsonObject(); style.addProperty("color", value.color()); style.addProperty("font", value.font()); result.getAsJsonArray("styles").add(style); }
      for (int a = 0; a < pixels.length;) {
        int b = a + 1; while (b < pixels.length && pixels[b] == pixels[a]) b++;
        if (pixels[a] >= 0) { var run = new JsonArray(); run.add(a); run.add(b); run.add(pixels[a]); result.getAsJsonArray("runs").add(run); }
        if (result.getAsJsonArray("runs").size() > 12000) return plain();
        a = b;
      }
      return result;
    }
  }
}
