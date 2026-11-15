package com.watdatmean.intellij;

import com.intellij.openapi.progress.ProgressManager;
import com.intellij.openapi.util.Key;
import com.intellij.psi.*;
import com.intellij.psi.scope.*;
import com.intellij.psi.util.PsiTreeUtil;

/** Bounded, file-local declaration lookup. Never resolves imports, base classes, or runtime values. */
final class JavaOrigins {
  private int remaining = 4096;
  private final java.util.Map<PsiReferenceExpression, PsiVariable> cache = new java.util.IdentityHashMap<>();

  String describe(PsiReferenceExpression reference) {
    var variable = find(reference);
    return variable == null ? "" : describe(variable);
  }

  private boolean step() {
    ProgressManager.checkCanceled();
    return --remaining >= 0;
  }

  PsiVariable find(PsiReferenceExpression reference) {
    if (cache.containsKey(reference)) return cache.get(reference);
    var value = lookup(reference); cache.put(reference, value); return value;
  }
  private PsiVariable lookup(PsiReferenceExpression reference) {
    String name = reference.getReferenceName();
    if (name == null) return null;
    var qualifier = reference.getQualifierExpression();
    if (qualifier != null) {
      // An arbitrary object's field cannot be identified from its spelling. Only plain this is local.
      if (!(qualifier instanceof PsiThisExpression self) || self.getQualifier() != null) return null;
      var owner = PsiTreeUtil.getParentOfType(reference, PsiClass.class);
      return owner == null ? null : field(owner, name);
    }
    PsiVariable[] found = {null};
    var processor = new PsiScopeProcessor() {
      @Override public boolean execute(PsiElement element, ResolveState state) {
        if (!step()) return false;
        if (element instanceof PsiVariable variable && name.equals(variable.getName())) {
          // PSI can offer later declarators in the same statement; they are not in scope yet.
          if (variable instanceof PsiLocalVariable && variable.getTextOffset() > reference.getTextOffset()) return true;
          found[0] = variable; return false;
        }
        return true;
      }
      @Override @SuppressWarnings("unchecked") public <T> T getHint(Key<T> key) {
        if (key == NameHint.KEY) return (T) (NameHint) state -> name;
        if (key == ElementClassHint.KEY) return (T) (ElementClassHint) kind -> kind == ElementClassHint.DeclarationKind.VARIABLE;
        return null;
      }
    };
    PsiElement last = null;
    boolean staticContext = false;
    for (PsiElement scope = reference; scope != null && !(scope instanceof PsiFile) && step(); last = scope, scope = scope.getParent()) {
      if (scope instanceof PsiClass owner) {
        var field = field(owner, name);
        if (field != null) return !staticContext || field.hasModifierProperty(PsiModifier.STATIC) ? field : null;
        // An inherited member could shadow an outer declaration. Leave it unknown without project resolution.
        if (owner instanceof PsiAnonymousClass || owner.getExtendsListTypes().length > 0 || owner.getImplementsListTypes().length > 0) return null;
      } else if (!scope.processDeclarations(processor, ResolveState.initial(), last, reference)) {
        return found[0];
      }
      if (scope instanceof PsiModifierListOwner owner && !(scope instanceof PsiLocalVariable)
        && owner.hasModifierProperty(PsiModifier.STATIC)) staticContext = true;
    }
    return null;
  }

  private PsiField field(PsiClass owner, String name) {
    for (var field : owner.getFields()) {
      if (!step()) break;
      if (name.equals(field.getName())) return field;
    }
    return null;
  }

  static String importClue(PsiElement element) {
    if (!(element.getContainingFile() instanceof PsiJavaFile file) || file.getImportList() == null) return "";
    var reference = element instanceof PsiTypeElement ? PsiTreeUtil.findChildOfType(element, PsiJavaCodeReferenceElement.class)
      : element.getParent() instanceof PsiJavaCodeReferenceElement ref ? ref : null;
    if (reference == null || reference.getReferenceName() == null) return "";
    String name = reference.getReferenceName();
    for (var statement : file.getImportList().getImportStatements()) {
      var imported = statement.getImportReference();
      if (!statement.isOnDemand() && imported != null && name.equals(imported.getReferenceName()))
        return " Written import: " + imported.getQualifiedName() + ". This names a type in a Java package; an installed library or version has not been independently verified.";
    }
    return "";
  }

  static String describe(PsiVariable variable) {
    var file = variable.getContainingFile();
    var document = file == null ? null : file.getViewProvider().getDocument();
    String where = document == null ? "Declared here." : "Declared on line " + (document.getLineNumber(variable.getTextOffset()) + 1) + ".";
    if (variable instanceof PsiPatternVariable)
      return where + " This variable receives the value matched by the pattern, where that match is in scope.";
    if (variable instanceof PsiParameter parameter) {
      var scope = parameter.getDeclarationScope();
      if (scope instanceof PsiCatchSection) return where + " This parameter receives the exception handled by the catch block.";
      if (scope instanceof PsiForeachStatement loop)
        return where + " Each iteration receives an element from " + compact(loop.getIteratedValue()) + ".";
      return where + " This parameter receives an argument from the caller. Java passes values; an object value is a reference.";
    }
    var initial = variable.getInitializer();
    if (initial != null) return where + " Initializer: " + compact(initial) + ". An initializer sets the starting value; later code may change it.";
    if (variable instanceof PsiEnumConstant) return where + " This named constant is an instance of its enum type.";
    return where + (variable instanceof PsiField
      ? " No initializer here. Fields receive Java's default value before constructor or other initialization runs."
      : " No initializer here. Java requires assignment before this local variable can be read.");
  }

  private static String compact(PsiElement element) {
    if (element == null) return "the loop's source (currently incomplete)";
    String text = element.getText().replaceAll("[\\r\\n\\t]+", " ").trim();
    return text.length() <= 100 ? text : text.substring(0, 97) + "…";
  }
}
