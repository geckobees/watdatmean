package com.watdatmean.intellij;

import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.editor.*;
import com.intellij.openapi.editor.colors.*;
import com.intellij.openapi.editor.markup.*;
import com.intellij.openapi.project.Project;
import com.intellij.ui.ColorUtil;
import java.awt.Color;

/** Uses a real editor and Swing timer, never waits on the EDT. */
final class LineHighlightSmoke {
  static void run(Project project) throws Exception {
    Editor[] editor = {null};
    var highlight = new SourceLineHighlight();
    String source = "int first = 1;\n\nint second = 2;";
    try {
      ApplicationManager.getApplication().invokeAndWait(() -> {
        editor[0] = EditorFactory.getInstance().createEditor(EditorFactory.getInstance().createDocument(source), project);
        for (String name : new String[]{"Default", "Darcula"}) {
          var scheme = (EditorColorsScheme)EditorColorsManager.getInstance().getScheme(name).clone();
          var search = new TextAttributes(); search.setBackgroundColor(new Color(0x4E9AFF));
          scheme.setAttributes(EditorColors.SEARCH_RESULT_ATTRIBUTES, search);
          ((com.intellij.openapi.editor.ex.EditorEx)editor[0]).setColorsScheme(scheme);
          highlight.show(editor[0], 1);
          var previous = editor[0].getMarkupModel().getAllHighlighters();
          check(previous.length == 1, "Exactly one highlight appears on an empty line");
          check(previous[0].getTargetArea() == HighlighterTargetArea.LINES_IN_RANGE, "Whole destination line is highlighted");
          check(previous[0].getTextAttributes().getBackgroundColor().equals(ColorUtil.mix(scheme.getDefaultBackground(), search.getBackgroundColor(), 0.35)), "Highlight follows the native light/dark scheme");
          highlight.show(editor[0], 2);
          check(!previous[0].isValid() && editor[0].getMarkupModel().getAllHighlighters().length == 1, "Repeated clicks replace the previous highlight");
        }
      });
      Thread.sleep(1450);
      ApplicationManager.getApplication().invokeAndWait(() -> {
        check(editor[0].getMarkupModel().getAllHighlighters().length == 0, "Native Swing timer removes the highlight");
        check(editor[0].getDocument().getText().equals(source) && editor[0].getCaretModel().getOffset() == 0, "Highlighting leaves code and caret unchanged");
        highlight.show(editor[0], 0);
        highlight.dispose();
        check(editor[0].getMarkupModel().getAllHighlighters().length == 0, "Disposal removes active markup");
        highlight.show(editor[0], 2);
        check(editor[0].getMarkupModel().getAllHighlighters().length == 0, "Disposed highlights stay inactive");
      });
      System.out.println("PASS: native 2022.3 destination highlight, light/dark colors, blank lines, repeated clicks, timer cleanup and disposal");
    } finally {
      ApplicationManager.getApplication().invokeAndWait(() -> {
        highlight.dispose();
        if (editor[0] != null) EditorFactory.getInstance().releaseEditor(editor[0]);
      });
    }
  }
  private static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
}
