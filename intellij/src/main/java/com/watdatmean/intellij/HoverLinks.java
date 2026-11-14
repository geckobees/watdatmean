package com.watdatmean.intellij;

import com.intellij.openapi.Disposable;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.components.Service;
import com.intellij.openapi.fileEditor.*;
import com.intellij.openapi.project.Project;
import com.intellij.psi.*;
import java.util.*;

/** Bounded, project-local targets: documentation links never contain file paths or executable commands. */
@Service(Service.Level.PROJECT)
public final class HoverLinks implements Disposable {
  static final String PREFIX = "watdatmean://learn/";
  private final Project project;
  private final Map<String, SmartPsiElementPointer<PsiElement>> targets = new LinkedHashMap<>();
  public HoverLinks(Project project) { this.project = project; }
  static HoverLinks get(Project project) { return project.getService(HoverLinks.class); }
  synchronized String remember(PsiElement origin) {
    String token = UUID.randomUUID().toString();
    targets.put(token, SmartPointerManager.getInstance(project).createSmartPsiElementPointer(origin));
    while (targets.size() > 80) targets.remove(targets.keySet().iterator().next());
    return PREFIX + token;
  }
  synchronized PsiElement resolve(String link) {
    if (!link.startsWith(PREFIX)) return null;
    var pointer = targets.get(link.substring(PREFIX.length()));
    return pointer == null ? null : pointer.getElement();
  }
  void open(String link) {
    ApplicationManager.getApplication().invokeLater(() -> {
      if (project.isDisposed()) return;
      PsiElement source = resolve(link);
      if (source == null || !source.isValid() || source.getContainingFile() == null) return;
      var file = source.getContainingFile().getVirtualFile();
      if (file == null || !file.isValid()) return;
      var editor = FileEditorManager.getInstance(project).openTextEditor(new OpenFileDescriptor(project, file, source.getTextOffset()), true);
      if (editor != null) { editor.getSelectionModel().removeSelection(); Tutor.get(project).inspect(editor); }
    });
  }
  @Override public synchronized void dispose() { targets.clear(); }
}
