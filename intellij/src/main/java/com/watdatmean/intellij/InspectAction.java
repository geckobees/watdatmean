package com.watdatmean.intellij;

import com.intellij.openapi.actionSystem.*;
import com.intellij.openapi.project.DumbAwareAction;
import org.jetbrains.annotations.NotNull;

public final class InspectAction extends DumbAwareAction {
  @Override public void actionPerformed(@NotNull AnActionEvent event) {
    var project = event.getProject();
    var editor = event.getData(CommonDataKeys.EDITOR);
    if (project != null && editor != null) Tutor.get(project).inspect(editor);
  }
  @Override public void update(@NotNull AnActionEvent event) {
    event.getPresentation().setEnabledAndVisible(event.getProject() != null && event.getData(CommonDataKeys.EDITOR) != null);
  }
  @Override public @NotNull ActionUpdateThread getActionUpdateThread() { return ActionUpdateThread.BGT; }
}
