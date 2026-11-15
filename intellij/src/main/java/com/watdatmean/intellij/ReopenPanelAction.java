package com.watdatmean.intellij;

import com.intellij.openapi.actionSystem.*;
import com.intellij.openapi.project.DumbAwareAction;
import org.jetbrains.annotations.NotNull;

public final class ReopenPanelAction extends DumbAwareAction {
  @Override public void actionPerformed(@NotNull AnActionEvent event) {
    var project = event.getProject();
    if (project != null) Tutor.get(project).reopenPanel();
  }
  @Override public void update(@NotNull AnActionEvent event) {
    event.getPresentation().setEnabledAndVisible(event.getProject() != null);
  }
  @Override public @NotNull ActionUpdateThread getActionUpdateThread() { return ActionUpdateThread.BGT; }
}
