package com.watdatmean.intellij;

import com.intellij.ide.scratch.ScratchFileService;
import com.intellij.ide.scratch.ScratchRootType;
import com.intellij.lang.java.JavaLanguage;
import com.intellij.openapi.actionSystem.*;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.fileEditor.OpenFileDescriptor;
import com.intellij.openapi.project.DumbAwareAction;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.vfs.VirtualFile;
import org.jetbrains.annotations.NotNull;

/** A fresh editable scratch file; opening the demo neither changes project files nor executes code. */
public final class DemoAction extends DumbAwareAction {
  static final String SOURCE = """
    // WatDatMean Java demo: select a piece in the learning panel to unpack it.
    // Hover a declaration or press Ctrl+Alt+E (Cmd+Alt+E on macOS) to inspect it.
    // Try the field below, addCompletedTasks(3), and the nested call in main.
    // In Try it yourself, change tasks * POINTS_PER_TASK to tasks + POINTS_PER_TASK.
    // Compare first, then optionally apply and undo. Opening this file does not run it.
    class WatDatMeanDemo {
        static final int POINTS_PER_TASK = 10;
        private int score = 0;

        int addCompletedTasks(int tasks) {
            score += tasks * POINTS_PER_TASK;
            return score;
        }

        String getLevel() {
            if (score >= 30) {
                return "Explorer";
            }
            return "Starter";
        }

        public static void main(String[] args) {
            WatDatMeanDemo board = new WatDatMeanDemo();
            board.addCompletedTasks(3);
            System.out.println(board.getLevel()); // Explorer after three completed tasks
        }
    }
    """;
  static VirtualFile create(Project project) {
    return ScratchRootType.getInstance().createScratchFile(project, "WatDatMeanDemo.java",
      JavaLanguage.INSTANCE, SOURCE, ScratchFileService.Option.create_new_always);
  }
  @Override public void actionPerformed(@NotNull AnActionEvent event) {
    var project = event.getProject();
    if (project == null) return;
    var file = create(project);
    if (file == null) return;
    var editor = FileEditorManager.getInstance(project).openTextEditor(
      new OpenFileDescriptor(project, file, SOURCE.indexOf("private int score")), true);
    if (editor != null) Tutor.get(project).inspect(editor);
  }
  @Override public void update(@NotNull AnActionEvent event) {
    event.getPresentation().setEnabled(event.getProject() != null);
  }
  @Override public @NotNull ActionUpdateThread getActionUpdateThread() { return ActionUpdateThread.BGT; }
}
