package com.watdatmean.intellij;

import com.intellij.openapi.Disposable;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.editor.colors.EditorColors;
import com.intellij.openapi.editor.markup.*;
import com.intellij.ui.ColorUtil;
import javax.swing.Timer;

/** A single temporary whole-line highlight, using only IntelliJ 2022.3 APIs. */
final class SourceLineHighlight implements Disposable {
  private RangeHighlighter highlighter;
  private boolean disposed;
  private final Timer timer = new Timer(1200, event -> clear());

  SourceLineHighlight() { timer.setRepeats(false); }

  void show(Editor editor, int line) {
    clear();
    if (disposed || editor.isDisposed() || line < 0 || line >= editor.getDocument().getLineCount()) return;
    var scheme = editor.getColorsScheme();
    var search = scheme.getAttributes(EditorColors.SEARCH_RESULT_ATTRIBUTES);
    var color = search == null ? null : search.getBackgroundColor();
    if (color == null) color = scheme.getColor(EditorColors.SELECTION_BACKGROUND_COLOR);
    if (color == null) color = scheme.getDefaultForeground();
    var attributes = new TextAttributes();
    // Blend with the native editor background so existing syntax colors stay legible.
    attributes.setBackgroundColor(ColorUtil.mix(scheme.getDefaultBackground(), color, 0.35));
    highlighter = editor.getMarkupModel().addLineHighlighter(line, HighlighterLayer.SELECTION - 1, attributes);
    timer.restart();
  }

  void clear() {
    timer.stop();
    if (highlighter != null) { if (highlighter.isValid()) highlighter.dispose(); highlighter = null; }
  }

  @Override public void dispose() { disposed = true; clear(); }
}
