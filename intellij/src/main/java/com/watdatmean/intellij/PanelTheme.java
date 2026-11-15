package com.watdatmean.intellij;

import com.intellij.openapi.editor.colors.EditorColorsManager;
import com.intellij.openapi.editor.colors.EditorColors;
import com.intellij.openapi.editor.DefaultLanguageHighlighterColors;
import com.intellij.openapi.editor.colors.EditorColorsScheme;
import com.intellij.openapi.editor.colors.TextAttributesKey;
import com.intellij.ui.ColorUtil;
import com.intellij.util.ui.UIUtil;
import java.awt.Color;
import javax.swing.UIManager;

/** Adapts the existing shared panel through CSS only; no reload or panel state changes. */
final class PanelTheme {
  private PanelTheme() {}

  static String css() {
    var scheme = EditorColorsManager.getInstance().getGlobalScheme();
    var background = UIUtil.getPanelBackground();
    var font = UIUtil.getLabelFont();
    boolean dark = ColorUtil.isDark(background);
    var link = color("Link.activeForeground", dark ? new Color(0x6AB0FF) : new Color(0x005FCC));
    var border = color("Component.borderColor", dark ? new Color(0x62676E) : new Color(0xB8BEC5));
    var error = UIUtil.getErrorForeground();
    boolean codeDark = ColorUtil.isDark(scheme.getDefaultBackground());
    return ":root {color-scheme:dark;"
      + property("--vscode-editor-background", hex(scheme.getDefaultBackground()))
      + property("--vscode-editor-foreground", hex(scheme.getDefaultForeground()))
      + property("--vscode-sideBar-background", hex(color("TextField.background", background)))
      + property("--vscode-descriptionForeground", hex(UIUtil.getContextHelpForeground()))
      + property("--vscode-widget-border", hex(border))
      + property("--vscode-focusBorder", hex(link))
      + property("--vscode-textLink-foreground", hex(link))
      + property("--vscode-errorForeground", hex(error))
      + property("--vscode-inputValidation-errorBorder", hex(error))
      + property("--vscode-font-family", family(font.getFamily()) + ",sans-serif")
      + property("--vscode-editor-font-family", family(scheme.getEditorFontName()) + ",monospace")
      + property("--vscode-editor-font-size", scheme.getEditorFontSize() + "px")
      + property("--code-background", hex(scheme.getDefaultBackground()))
      + property("--code-foreground", hex(scheme.getDefaultForeground()))
      + property("--wdm-code-keyword", syntax(scheme, DefaultLanguageHighlighterColors.KEYWORD, codeDark ? 0x569CD6 : 0x0000AA))
      + property("--wdm-code-string", syntax(scheme, DefaultLanguageHighlighterColors.STRING, codeDark ? 0xCE9178 : 0xA31515))
      + property("--wdm-code-number", syntax(scheme, DefaultLanguageHighlighterColors.NUMBER, codeDark ? 0xB5CEA8 : 0x098658))
      + property("--wdm-code-comment", syntax(scheme, DefaultLanguageHighlighterColors.LINE_COMMENT, codeDark ? 0x6A9955 : 0x387638))
      + property("--vscode-editorLineNumber-foreground", hex(fallback(scheme.getColor(EditorColors.LINE_NUMBERS_COLOR), UIUtil.getContextHelpForeground())))
      + property("--vscode-editorLineNumber-activeForeground", hex(fallback(scheme.getColor(EditorColors.LINE_NUMBER_ON_CARET_ROW_COLOR), scheme.getDefaultForeground())))
      + property("--vscode-editorGutter-background", hex(fallback(scheme.getColor(EditorColors.GUTTER_BACKGROUND), scheme.getDefaultBackground())))
      + property("--vscode-editor-selectionBackground", hex(scheme.getColor(EditorColors.SELECTION_BACKGROUND_COLOR) == null ? link : scheme.getColor(EditorColors.SELECTION_BACKGROUND_COLOR)))
      + "}"
      + "body {font-size:" + font.getSize() + "px;}"
      + "pre,textarea {background:" + hex(scheme.getDefaultBackground()) + ";color:" + hex(scheme.getDefaultForeground()) + ";}"
      + "pre,textarea,.part {font-size:" + scheme.getEditorFontSize() + "px;}";
  }

  private static Color color(String key, Color fallback) {
    var value = UIManager.getColor(key);
    return value == null ? fallback : value;
  }
  private static String syntax(EditorColorsScheme scheme, TextAttributesKey key, int defaultColor) {
    var attributes = scheme.getAttributes(key);
    return hex(attributes != null && attributes.getForegroundColor() != null
      ? attributes.getForegroundColor() : new Color(defaultColor));
  }
  private static String hex(Color color) { return "#" + ColorUtil.toHex(color); }
  private static Color fallback(Color value, Color other) { return value == null ? other : value; }
  private static String property(String name, String value) { return name + ":" + value + ";"; }
  // Hex escapes keep user-configured font names safe in both CSS strings and the initial HTML style tag.
  private static String family(String name) {
    var css = new StringBuilder("\"");
    name.codePoints().limit(120).forEach(value -> css.append('\\').append(Integer.toHexString(value)).append(' '));
    return css.append('"').toString();
  }
}
