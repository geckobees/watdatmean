package com.watdatmean.intellij;

import com.intellij.ide.highlighter.JavaHighlightingColors;
import com.intellij.openapi.editor.colors.TextAttributesKey;
import com.intellij.psi.*;

/** File-local PSI fallback while native analysis is warming up, also safe for an unsaved draft. */
final class JavaSemanticColors {
  private JavaSemanticColors() {}
  static TextAttributesKey key(PsiElement leaf, JavaOrigins origins) {
    if (!(leaf instanceof PsiIdentifier)) return null;
    var parent = leaf.getParent();
    if (parent instanceof PsiClass type) return classKey(type);
    if (parent instanceof PsiMethod method) {
      if (method.isConstructor()) return JavaHighlightingColors.CONSTRUCTOR_DECLARATION_ATTRIBUTES;
      return JavaHighlightingColors.METHOD_DECLARATION_ATTRIBUTES;
    }
    if (parent instanceof PsiVariable variable) return variableKey(variable);
    if (parent instanceof PsiReferenceExpression reference) {
      if (reference.getParent() instanceof PsiMethodCallExpression call && call.getMethodExpression() == reference)
        return JavaHighlightingColors.METHOD_CALL_ATTRIBUTES;
      var variable = origins.find(reference);
      return variable == null ? null : variableKey(variable);
    }
    // Unresolved imported names may be classes, interfaces or enums; don't guess their role.
    return null;
  }
  private static TextAttributesKey classKey(PsiClass type) {
    if (type instanceof PsiTypeParameter) return JavaHighlightingColors.TYPE_PARAMETER_NAME_ATTRIBUTES;
    if (type.isAnnotationType()) return JavaHighlightingColors.ANNOTATION_NAME_ATTRIBUTES;
    if (type.isInterface()) return JavaHighlightingColors.INTERFACE_NAME_ATTRIBUTES;
    if (type.isEnum()) return JavaHighlightingColors.ENUM_NAME_ATTRIBUTES;
    if (type.hasModifierProperty(PsiModifier.ABSTRACT)) return JavaHighlightingColors.ABSTRACT_CLASS_NAME_ATTRIBUTES;
    return JavaHighlightingColors.CLASS_NAME_ATTRIBUTES;
  }
  private static TextAttributesKey variableKey(PsiVariable variable) {
    if (variable instanceof PsiField field) {
      boolean fixed = field.hasModifierProperty(PsiModifier.FINAL);
      if (field.hasModifierProperty(PsiModifier.STATIC)) return fixed
        ? JavaHighlightingColors.STATIC_FINAL_FIELD_ATTRIBUTES : JavaHighlightingColors.STATIC_FIELD_ATTRIBUTES;
      return fixed ? JavaHighlightingColors.INSTANCE_FINAL_FIELD_ATTRIBUTES : JavaHighlightingColors.INSTANCE_FIELD_ATTRIBUTES;
    }
    if (variable instanceof PsiParameter parameter) return parameter.getDeclarationScope() instanceof PsiLambdaExpression
      ? JavaHighlightingColors.LAMBDA_PARAMETER_ATTRIBUTES : JavaHighlightingColors.PARAMETER_ATTRIBUTES;
    return JavaHighlightingColors.LOCAL_VARIABLE_ATTRIBUTES;
  }
}
