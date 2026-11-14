package com.watdatmean.intellij;

import com.intellij.codeInsight.documentation.DocumentationManager;
import com.intellij.lang.documentation.*;
import com.intellij.openapi.editor.Editor;
import com.intellij.psi.*;
import java.util.List;
import java.util.Set;
import org.jetbrains.annotations.NotNull;

/** Adds a small learning section to the native popup; native docs and Ctrl-hover still belong to the IDE. */
public final class HoverDocumentation extends AbstractDocumentationProvider implements ExternalDocumentationHandler {
  private static final ThreadLocal<Boolean> DELEGATING = ThreadLocal.withInitial(() -> false);
  private static final Set<String> STATEMENT_KEYWORDS = Set.of("return", "if", "else", "for", "while", "do", "throw", "break", "continue");

  @Override public String generateHoverDoc(@NotNull PsiElement element, PsiElement original) { return document(element, original, true); }
  @Override public String generateDoc(PsiElement element, PsiElement original) { return document(element, original, false); }

  private String document(PsiElement element, PsiElement original, boolean hover) {
    if (DELEGATING.get() || element == null || !element.isValid()) return null;
    PsiElement origin = original != null ? original : element;
    String explanation = JavaHover.explain(origin);
    if (explanation == null) return null;
    String nativeDoc = nativeDocumentation(element, original, hover);
    String block = DocumentationMarkup.CONTENT_START + "<p><b>WatDatMean</b> · " + explanation + "</p>"
      + "<a href=\"" + HoverLinks.get(origin.getProject()).remember(origin) + "\">Open learning panel →</a>" + DocumentationMarkup.CONTENT_END;
    return combine(nativeDoc, block);
  }

  private static String nativeDocumentation(PsiElement element, PsiElement original, boolean hover) {
    DELEGATING.set(true);
    try {
      var provider = DocumentationManager.getProviderFromElement(element, original);
      var providers = provider instanceof CompositeDocumentationProvider composite ? composite.getAllProviders() : List.of(provider);
      for (var delegate : providers) {
        if (delegate instanceof HoverDocumentation) continue;
        String result = hover ? delegate.generateHoverDoc(element, original) : delegate.generateDoc(element, original);
        if (result != null) return result;
      }
      // Java suppresses its own declaration hovers. Include the normal signature/docs alongside our addition.
      if (hover) for (var delegate : providers) {
        if (delegate instanceof HoverDocumentation) continue;
        String result = delegate.generateDoc(element, original);
        if (result != null) return result;
      }
      return null;
    } finally { DELEGATING.remove(); }
  }
  static String combine(String nativeDoc, String block) {
    if (nativeDoc == null || nativeDoc.isBlank()) return block;
    int definition = nativeDoc.indexOf(DocumentationMarkup.DEFINITION_END);
    if (definition >= 0) {
      int position = definition + DocumentationMarkup.DEFINITION_END.length();
      return nativeDoc.substring(0, position) + block + nativeDoc.substring(position);
    }
    // Providers may return a complete HTML document instead of a fragment.
    int body = nativeDoc.toLowerCase(java.util.Locale.ROOT).indexOf("<body");
    int position = body < 0 ? -1 : nativeDoc.indexOf('>', body);
    return position < 0 ? block + nativeDoc : nativeDoc.substring(0, position + 1) + block + nativeDoc.substring(position + 1);
  }
  @Override public PsiElement getCustomDocumentationElement(@NotNull Editor editor, @NotNull PsiFile file, PsiElement context, int offset) {
    // Let IntelliJ resolve identifiers, methods, constructors, and type navigation normally.
    return context instanceof PsiKeyword && STATEMENT_KEYWORDS.contains(context.getText()) && JavaHover.target(context) != null ? context : null;
  }
  @Override public boolean handleExternalLink(PsiManager manager, String link, PsiElement context) {
    if (!link.startsWith(HoverLinks.PREFIX)) return false;
    HoverLinks.get(manager.getProject()).open(link);
    return true;
  }
}
