package com.watdatmean.intellij;

import com.google.gson.*;
import com.intellij.lang.LanguageParserDefinitions;
import com.intellij.openapi.application.ReadAction;
import com.intellij.openapi.editor.*;
import com.intellij.openapi.fileEditor.FileDocumentManager;
import com.intellij.openapi.progress.*;
import com.intellij.openapi.project.*;
import com.intellij.openapi.roots.ProjectFileIndex;
import com.intellij.openapi.util.TextRange;
import com.intellij.openapi.vfs.*;
import com.intellij.psi.*;
import com.intellij.psi.search.GlobalSearchScope;
import com.intellij.psi.search.searches.ReferencesSearch;
import com.intellij.psi.util.PsiTreeUtil;
import com.intellij.util.concurrency.AppExecutorUtil;
import java.util.*;
import java.util.concurrent.TimeUnit;

final class SourceContext {
  record Selection(Document document, VirtualFile file, long stamp, String source,
                   String language, JsonObject snippet) {
    int start() { return snippet.get("start").getAsInt(); }
    int end() { return snippet.get("end").getAsInt(); }
    String code() { return snippet.get("code").getAsString(); }
    int symbolOffset() { return snippet.get("symbolOffset").getAsInt(); }
    boolean typescript() { return file.getName().endsWith(".ts"); }
    boolean current() { return file.isValid() && document.getModificationStamp() == stamp; }
  }
  record Location(VirtualFile file, int offset) {}
  record Context(String nearby, JsonArray evidence, Map<String, Location> locations, String note) {}
  record Syntax(JsonArray errors, boolean checked) {}

  static Selection refresh(Project project, Selection previous, int start, int end) {
    var document = previous.document();
    if (!previous.file().isValid() || document.getTextLength() > 500000)
      throw new IllegalStateException("Reopen a source file under 500,000 characters and inspect it again.");
    PsiDocumentManager.getInstance(project).commitDocument(document);
    String source = document.getText();
    start = Math.max(0, Math.min(start, source.length()));
    end = Math.max(start, Math.min(end, source.length()));
    var snippet = new JsonObject();
    snippet.addProperty("start", start); snippet.addProperty("end", end);
    snippet.addProperty("symbolOffset", start); snippet.addProperty("code", source.substring(start, end));
    snippet.add("parts", new JsonArray());
    return new Selection(document, previous.file(), document.getModificationStamp(), source, previous.language(), snippet);
  }

  static Selection capture(Project project, Editor editor) {
    Document document = editor.getDocument();
    VirtualFile file = FileDocumentManager.getInstance().getFile(document);
    if (file == null || file.getFileType().isBinary()) throw new IllegalStateException("Open a source file in the editor first.");
    String source = document.getText();
    if (source.length() > 500000) throw new IllegalStateException("Open a file under 500,000 characters.");
    int caret = editor.getCaretModel().getOffset();
    var selected = editor.getSelectionModel();
    int start = selected.hasSelection() ? selected.getSelectionStart() : caret;
    int end = selected.hasSelection() ? selected.getSelectionEnd() : caret;
    PsiDocumentManager.getInstance(project).commitDocument(document);
    PsiFile psi = PsiDocumentManager.getInstance(project).getPsiFile(document);
    String language = psi == null ? "Plain text" : psi.getLanguage().getDisplayName();
    if (language.equalsIgnoreCase("TEXT") || language.equalsIgnoreCase("Plain text")) {
      language = switch (Objects.toString(file.getExtension(), "").toLowerCase(Locale.ROOT)) {
        case "ts" -> "TypeScript"; case "tsx" -> "TypeScript JSX";
        case "js", "mjs", "cjs" -> "JavaScript"; case "jsx" -> "JavaScript JSX";
        case "py" -> "Python"; case "rs" -> "Rust"; case "go" -> "Go";
        case "cs" -> "C#"; case "cpp", "cc", "hpp" -> "C++"; case "c", "h" -> "C";
        case "rb" -> "Ruby"; case "kt", "kts" -> "Kotlin"; case "java" -> "Java";
        default -> "Plain text (infer language from code)";
      };
    }
    int symbolOffset = start;
    PsiElement leaf = psi == null || source.isEmpty() ? null : psi.findElementAt(Math.min(caret, source.length() - 1));
    PsiElement target = null;
    if (!selected.hasSelection()) {
      for (PsiElement element = leaf; element != null && !(element instanceof PsiFile); element = element.getParent()) {
        if (element instanceof PsiNameIdentifierOwner owner && owner.getNameIdentifier() != null
          && caret <= owner.getNameIdentifier().getTextRange().getEndOffset()) { target = element; break; }
        if (element instanceof PsiStatement) { target = element; break; }
      }
      if (target != null) { start = target.getTextRange().getStartOffset(); end = target.getTextRange().getEndOffset(); }
      else { int line = document.getLineNumber(caret); start = document.getLineStartOffset(line); end = document.getLineEndOffset(line); }
    }
    if (target instanceof PsiNameIdentifierOwner owner && owner.getNameIdentifier() != null)
      symbolOffset = owner.getNameIdentifier().getTextOffset();
    else if (leaf != null && leaf.getTextOffset() >= start && leaf.getTextOffset() < end) symbolOffset = leaf.getTextOffset();
    JsonObject snippet = new JsonObject();
    snippet.addProperty("start", start); snippet.addProperty("end", end);
    snippet.addProperty("symbolOffset", symbolOffset);
    snippet.addProperty("code", source.substring(start, end));
    snippet.add("parts", new JsonArray());
    // The shared TS parser receives the original cursor/selection, not a Java PSI guess.
    snippet.addProperty("cursorStart", selected.hasSelection() ? selected.getSelectionStart() : caret);
    snippet.addProperty("cursorEnd", selected.hasSelection() ? selected.getSelectionEnd() : caret);
    return new Selection(document, file, document.getModificationStamp(), source, language, snippet);
  }

  static String relative(Project project, VirtualFile file) {
    String base = project.getBasePath();
    if (base != null && file.getPath().startsWith(base + "/")) return file.getPath().substring(base.length() + 1);
    return file.getName();
  }

  static Context collect(Project project, Selection selection) {
    JsonArray evidence = new JsonArray();
    Map<String, Location> locations = new LinkedHashMap<>();
    String nearby = ReadAction.compute(() -> {
      if (!selection.current()) throw new IllegalStateException("Code changed. Refresh before requesting context.");
      var doc = selection.document();
      int first = Math.max(0, doc.getLineNumber(selection.start()) - 12);
      int last = Math.min(doc.getLineCount() - 1, doc.getLineNumber(selection.end()) + 12);
      return doc.getText(new TextRange(doc.getLineStartOffset(first), doc.getLineEndOffset(last)));
    });
    boolean[] incomplete = {false};
    var indicator = new EmptyProgressIndicator();
    var timeout = AppExecutorUtil.getAppScheduledExecutorService().schedule(indicator::cancel, 4, TimeUnit.SECONDS);
    try {
      ProgressManager.getInstance().runProcess(() -> ReadAction.run(() -> {
        if (DumbService.isDumb(project)) { incomplete[0] = true; return; }
        PsiFile psi = PsiDocumentManager.getInstance(project).getPsiFile(selection.document());
        if (psi == null || selection.source().isEmpty()) return;
        int offset = Math.min(selection.symbolOffset(), selection.source().length() - 1);
        PsiReference reference = psi.findReferenceAt(offset);
        PsiElement target = reference == null ? null : reference.resolve();
        if (target == null) target = PsiTreeUtil.getParentOfType(psi.findElementAt(offset), PsiNameIdentifierOwner.class, false);
        if (target == null) return;
        Set<String> seen = new HashSet<>();
        add(project, target, target.getTextOffset(), "definition", evidence, locations, seen);
        ReferencesSearch.search(target, GlobalSearchScope.projectScope(project)).forEach(ref -> {
          ProgressManager.checkCanceled();
          add(project, ref.getElement(), ref.getElement().getTextOffset() + ref.getRangeInElement().getStartOffset(), "reference", evidence, locations, seen);
          return evidence.size() < 12;
        });
      }), indicator);
    } catch (ProcessCanceledException | IndexNotReadyException ignored) { incomplete[0] = true; }
    finally { timeout.cancel(false); }
    String note = evidence.isEmpty()
      ? "No project references were returned. Language support may be unavailable or indexing; this does not mean an edit has no impact."
      : "Showing " + evidence.size() + " IntelliJ reference/definition locations (maximum 12). Behavioral effects are predictions. Indirect calls may be missing. Test files are identified by name; tests have not been run.";
    if (incomplete[0]) note += " Reference lookup was limited by indexing or the four-second time limit.";
    return new Context(nearby.substring(0, Math.min(5000, nearby.length())), evidence, locations, note);
  }

  private static void add(Project project, PsiElement element, int offset, String kind,
                          JsonArray evidence, Map<String, Location> locations, Set<String> seen) {
    if (evidence.size() >= 12 || element.getContainingFile() == null) return;
    VirtualFile file = element.getContainingFile().getVirtualFile();
    if (file == null || !file.isInLocalFileSystem() || !ProjectFileIndex.getInstance(project).isInContent(file)
      || ProjectFileIndex.getInstance(project).isExcluded(file) || file.getFileType().isBinary()
      || file.getPath().matches(".*(?:^|/)(?:node_modules|\\.git|\\.idea|dist|build|out|target|vendor)/.*")) return;
    Document document = PsiDocumentManager.getInstance(project).getDocument(element.getContainingFile());
    if (document == null || document.getTextLength() > 500000 || offset > document.getTextLength()) return;
    if (!seen.add(file.getPath() + ":" + offset)) return;
    int line = document.getLineNumber(offset);
    int first = document.getLineStartOffset(Math.max(0, line - 2));
    int last = document.getLineEndOffset(Math.min(document.getLineCount() - 1, line + 2));
    String path = relative(project, file);
    String id = "E" + (evidence.size() + 1);
    JsonObject item = new JsonObject();
    item.addProperty("id", id); item.addProperty("file", path); item.addProperty("line", line + 1);
    item.addProperty("kind", kind);
    item.addProperty("test", path.matches("(?i).*(?:[./_-](?:tests?|spec|__tests__)[./_-]|Test\\.[^/]+$|Tests\\.[^/]+$).*"));
    item.addProperty("code", document.getText(new TextRange(first, Math.min(last, first + 650))));
    evidence.add(item); locations.put(id, new Location(file, offset));
  }

  static Syntax syntax(Project project, Selection selection, String proposed) {
    return ReadAction.compute(() -> {
      JsonArray errors = new JsonArray();
      PsiFile original = PsiDocumentManager.getInstance(project).getPsiFile(selection.document());
      if (original == null || LanguageParserDefinitions.INSTANCE.forLanguage(original.getLanguage()) == null
        || original.getLanguage().getID().equalsIgnoreCase("TEXT")) return new Syntax(errors, false);
      PsiFile parsed = PsiFileFactory.getInstance(project).createFileFromText(selection.file().getName(), original.getLanguage(), proposed, false, false);
      for (PsiErrorElement error : PsiTreeUtil.findChildrenOfType(parsed, PsiErrorElement.class)) {
        if (errors.size() >= 8) break;
        errors.add(error.getErrorDescription());
      }
      return new Syntax(errors, true);
    });
  }
}
