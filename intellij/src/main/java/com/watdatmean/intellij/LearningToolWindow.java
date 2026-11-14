package com.watdatmean.intellij;

import com.intellij.openapi.project.*;
import com.intellij.openapi.wm.*;
import com.intellij.ui.content.ContentFactory;
import org.jetbrains.annotations.NotNull;

public final class LearningToolWindow implements ToolWindowFactory, DumbAware {
  @Override public void createToolWindowContent(@NotNull Project project, @NotNull ToolWindow window) {
    var content = ContentFactory.getInstance().createContent(Tutor.get(project).panel(), "", false);
    window.getContentManager().addContent(content);
  }
}
