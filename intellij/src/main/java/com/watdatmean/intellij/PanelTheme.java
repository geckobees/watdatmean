package com.watdatmean.intellij;

import com.intellij.openapi.editor.colors.EditorColorsManager;
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
    var foreground = UIUtil.getLabelForeground();
    var font = UIUtil.getLabelFont();
    boolean dark = ColorUtil.isDark(background);
    var link = color("Link.activeForeground", dark ? new Color(0x6AB0FF) : new Color(0x005FCC));
    var button = color("Button.default.startBackground", link);
    var buttonText = color("Button.default.foreground", Color.WHITE);
    var border = color("Component.borderColor", dark ? new Color(0x62676E) : new Color(0xB8BEC5));
    var error = UIUtil.getErrorForeground();
    return ":root {color-scheme:" + (dark ? "dark" : "light") + ";"
      + property("--vscode-editor-background", hex(background))
      + property("--vscode-editor-foreground", hex(foreground))
      + property("--vscode-sideBar-background", hex(color("TextField.background", background)))
      + property("--vscode-descriptionForeground", hex(UIUtil.getContextHelpForeground()))
      + property("--vscode-widget-border", hex(border))
      + property("--vscode-focusBorder", hex(link))
      + property("--vscode-textLink-foreground", hex(link))
      + property("--vscode-errorForeground", hex(error))
      + property("--vscode-inputValidation-errorBorder", hex(error))
      + property("--vscode-font-family", family(font.getFamily()) + ",sans-serif")
      + property("--vscode-editor-font-family", family(scheme.getEditorFontName()) + ",monospace")
      + property("--accent", hex(link)) + "}"
      + "body {font-size:" + font.getSize() + "px;}"
      + "pre,textarea {background:" + hex(scheme.getDefaultBackground()) + ";color:" + hex(scheme.getDefaultForeground()) + ";}"
      + "pre,textarea,.part {font-size:" + scheme.getEditorFontSize() + "px;}"
      + ".primary,.logo {background:" + hex(button) + ";color:" + hex(buttonText) + ";}"
      + ".pill {background:" + hex(link) + "12;border-color:" + hex(link) + "55;}";
  }

  private static Color color(String key, Color fallback) {
    var value = UIManager.getColor(key);
    return value == null ? fallback : value;
  }
  private static String hex(Color color) { return "#" + ColorUtil.toHex(color); }
  private static String property(String name, String value) { return name + ":" + value + ";"; }
  // Hex escapes keep user-configured font names safe in both CSS strings and the initial HTML style tag.
  private static String family(String name) {
    var css = new StringBuilder("\"");
    name.codePoints().limit(120).forEach(value -> css.append('\\').append(Integer.toHexString(value)).append(' '));
    return css.append('"').toString();
  }
}
