package com.watdatmean.intellij;

import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.project.DumbAwareAction;
import org.jetbrains.annotations.NotNull;

public final class ConfigureAction extends DumbAwareAction {
  @Override public void actionPerformed(@NotNull AnActionEvent event) {
    if (event.getProject() != null) Tutor.get(event.getProject()).configure();
  }
}
