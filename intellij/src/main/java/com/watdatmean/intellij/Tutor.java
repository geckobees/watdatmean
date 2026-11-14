package com.watdatmean.intellij;

import com.google.gson.*;
import com.intellij.diff.DiffManager;
import com.intellij.diff.DiffContentFactory;
import com.intellij.diff.requests.SimpleDiffRequest;
import com.intellij.ide.impl.TrustedProjects;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.command.WriteCommandAction;
import com.intellij.openapi.components.Service;
import com.intellij.openapi.editor.*;
import com.intellij.openapi.editor.event.*;
import com.intellij.openapi.fileEditor.*;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.Messages;
import com.intellij.openapi.wm.ToolWindowManager;
import com.intellij.openapi.vfs.VirtualFileManager;
import com.intellij.openapi.vfs.newvfs.BulkFileListener;
import com.intellij.openapi.vfs.newvfs.events.VFileEvent;
import com.intellij.openapi.roots.ProjectFileIndex;
import com.intellij.util.concurrency.AppExecutorUtil;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import javax.swing.JComponent;
import org.jetbrains.annotations.NotNull;

@Service(Service.Level.PROJECT)
public final class Tutor implements Disposable {
  private final Project project;
  private final Bridge bridge = new Bridge();
  private final AtomicLong revision = new AtomicLong();
  private final AtomicLong operation = new AtomicLong();
  private volatile SourceContext.Selection selection;
  private RangeMarker selectedRange;
  private volatile SourceContext.Context context;
  private volatile Preview preview;
  private PanelView panel;
  private boolean ready;
  private boolean busy;
  private volatile boolean disposed;
  private record Preview(SourceContext.Selection selection, String replacement, long revision) {}

  public Tutor(Project project) {
    this.project = project;
    EditorFactory.getInstance().getEventMulticaster().addDocumentListener(new DocumentListener() {
      @Override public void documentChanged(@NotNull DocumentEvent event) {
        revision.incrementAndGet(); preview = null; context = null;
        boolean stale = selection != null && selection.document() == event.getDocument();
        cancel();
        send(message(stale ? "stale" : "contextChanged"));
      }
    }, this);
    project.getMessageBus().connect(this).subscribe(VirtualFileManager.VFS_CHANGES, new BulkFileListener() {
      @Override public void after(@NotNull java.util.List<? extends VFileEvent> events) {
        if (project.isDisposed() || project.isDefault()) return;
        boolean changed = events.stream().anyMatch(event -> {
          var file = event.getFile();
          if (selection != null && event.getPath().equals(selection.file().getPath())) return true;
          return file != null && ProjectFileIndex.getInstance(project).isInContent(file)
            && !ProjectFileIndex.getInstance(project).isExcluded(file)
            && !file.getPath().matches(".*(?:^|/)(?:node_modules|\\.git|\\.idea|dist|build|out|target|vendor)/.*");
        });
        if (changed) {
          revision.incrementAndGet(); preview = null; context = null;
          ui(() -> { cancel(); send(message(selection != null && !selection.current() ? "stale" : "contextChanged")); });
        }
      }
    });
  }
  static Tutor get(Project project) { return project.getService(Tutor.class); }
  JComponent panel() {
    if (panel == null) panel = new PanelView(this, incoming -> ui(() -> handle(incoming)));
    return panel;
  }
  private void ui(Runnable action) {
    ApplicationManager.getApplication().invokeLater(() -> {
      if (!disposed && !project.isDisposed()) action.run();
    });
  }
  private void send(JsonObject message) { ui(() -> { if (ready && panel != null) panel.send(message); }); }
  static JsonObject message(String type) { var m = new JsonObject(); m.addProperty("type", type); return m; }
  private static String string(JsonObject m, String name) {
    return m.has(name) && m.get(name).isJsonPrimitive() && m.getAsJsonPrimitive(name).isString() ? m.get(name).getAsString() : "";
  }
  private void error(Throwable error) {
    while ((error instanceof CompletionException || error instanceof ExecutionException) && error.getCause() != null) error = error.getCause();
    var m = message("error");
    m.addProperty("message", error instanceof IllegalStateException ? error.getMessage() : "The operation could not finish. Refresh the code and retry.");
    send(m);
  }
  private void background(Runnable action) {
    AppExecutorUtil.getAppExecutorService().execute(() -> { try { action.run(); } catch (Exception error) { error(error); } });
  }
  private JsonElement call(String method, JsonObject params) { return bridge.call(method, params).join(); }

  void inspect(Editor editor) {
    cancel(); preview = null; context = null; selection = null;
    send(message("stale"));
    if (selectedRange != null) { selectedRange.dispose(); selectedRange = null; }
    var window = ToolWindowManager.getInstance(project).getToolWindow("WatDatMean");
    if (window != null) window.show();
    try {
      var captured = SourceContext.capture(project, editor);
      long token = operation.get();
      if (captured.typescript()) {
        var args = new JsonObject(); args.addProperty("code", captured.source());
        args.add("start", captured.snippet().get("cursorStart")); args.add("end", captured.snippet().get("cursorEnd"));
        background(() -> {
          try {
            var snippet = call("inspect", args).getAsJsonObject();
            ui(() -> {
              if (token != operation.get() || !captured.current()) return;
              select(new SourceContext.Selection(captured.document(), captured.file(), captured.stamp(), captured.source(), "TypeScript", snippet), false);
            });
          } catch (Exception failure) { if (token == operation.get()) error(failure); }
        });
      } else select(captured, false);
    } catch (Exception error) { error(error); }
  }

  private void select(SourceContext.Selection captured, boolean keepTab) {
    if (selectedRange != null) selectedRange.dispose();
    selection = captured;
    selectedRange = captured.document().createRangeMarker(captured.start(), captured.end());
    selectedRange.setGreedyToLeft(true); selectedRange.setGreedyToRight(true);
    sendSelection(keepTab);
  }
  private void sendSelection() { sendSelection(false); }
  private void sendSelection(boolean keepTab) {
    var selected = selection;
    if (selected == null) return;
    var m = message("selection");
    m.addProperty("keepTab", keepTab);
    m.addProperty("code", selected.code()); m.add("parts", selected.snippet().get("parts"));
    m.addProperty("language", selected.language()); m.addProperty("file", SourceContext.relative(project, selected.file()));
    m.addProperty("line", selected.document().getLineNumber(selected.start()) + 1);
    send(m); sendConfig();
  }
  private void refreshSelection() { refreshSelection(false); }
  private void refreshSelection(boolean applied) {
    if (selection == null) return;
    if (selectedRange == null || !selectedRange.isValid()) throw new IllegalStateException("Select the updated code in your editor and inspect it again.");
    cancel(); preview = null; context = null;
    var captured = SourceContext.refresh(project, selection, selectedRange.getStartOffset(), selectedRange.getEndOffset());
    long token = operation.get();
    if (captured.typescript() && captured.start() != captured.end()) {
      var args = new JsonObject(); args.addProperty("code", captured.source());
      args.addProperty("start", captured.start()); args.addProperty("end", captured.end());
      background(() -> {
        try {
          var snippet = call("inspect", args).getAsJsonObject();
          ui(() -> {
            if (token == operation.get() && captured.current()) {
              select(new SourceContext.Selection(captured.document(), captured.file(), captured.stamp(), captured.source(), captured.language(), snippet), true);
              if (applied) send(message("applied"));
            }
          });
        } catch (Exception failure) { if (token == operation.get()) error(failure); }
      });
    } else { select(captured, true); if (applied) send(message("applied")); }
  }
  private void sendConfig() {
    background(() -> {
      var state = Settings.get().getState();
      var m = message("config"); m.addProperty("provider", state.provider);
      m.addProperty("model", state.model.isBlank() ? Settings.defaultModel(state.provider) : state.model);
      m.addProperty("audience", state.audience); m.addProperty("hasKey", Keys.get(state.provider) != null);
      send(m);
    });
  }
  private SourceContext.Selection current() {
    var selected = selection;
    if (selected == null) throw new IllegalStateException("Select code in the editor, then use WatDatMean: Explain Selection or Code at Cursor.");
    if (!selected.current()) throw new IllegalStateException("This code changed. Refresh to inspect the latest version.");
    return selected;
  }
  private void trusted() {
    if (!TrustedProjects.isTrusted(project)) throw new IllegalStateException("Trust this project in IntelliJ before sending code to AI or applying edits. Local explanations still work.");
  }
  private void cancel() {
    operation.incrementAndGet(); bridge.cancel(); busy = false;
    var m = message("busy"); m.addProperty("value", false); send(m);
  }
  private void handle(JsonObject m) {
    try {
      switch (string(m, "type")) {
        case "ready" -> { ready = true; sendSelection(); sendConfig(); }
        case "configure" -> configure();
        case "cancel" -> cancel();
        case "refresh" -> refreshSelection();
        case "openEvidence" -> {
          var c = context;
          if (c == null) return;
          var location = c.locations().get(string(m, "id"));
          if (location != null && location.file().isValid()) new OpenFileDescriptor(project, location.file(), location.offset()).navigate(true);
        }
        case "apply" -> apply(string(m, "replacement"));
        case "request", "preview" -> run(m);
        default -> { }
      }
    } catch (Exception error) { error(error); }
  }

  private void run(JsonObject input) {
    if (busy) return;
    var selected = current();
    boolean diff = string(input, "type").equals("preview");
    if (diff) { preview = null; send(message("previewReset")); }
    if (!diff) trusted();
    if (selected.code().length() > 12000) throw new IllegalStateException("Select a smaller block of code (under 12,000 characters).");
    busy = true;
    long token = operation.incrementAndGet(), version = revision.get();
    var busyMessage = message("busy"); busyMessage.addProperty("value", true); send(busyMessage);
    background(() -> {
      try {
        if (diff) makePreview(input, selected, token, version);
        else request(input, selected, token, version);
      } catch (Exception failure) {
        if (unchanged(selected, token, version)) error(failure);
      } finally {
        ui(() -> { if (token == operation.get()) { busy = false; var m = message("busy"); m.addProperty("value", false); send(m); } });
      }
    });
  }
  private boolean unchanged(SourceContext.Selection selected, long token, long version) {
    return !disposed && selection == selected && selected.current() && operation.get() == token && revision.get() == version;
  }
  private static String replacement(JsonObject input, SourceContext.Selection selected) {
    if (!input.has("replacement") || !input.get("replacement").isJsonPrimitive() || !input.getAsJsonPrimitive("replacement").isString())
      throw new IllegalStateException("Enter replacement code first.");
    String value = string(input, "replacement");
    if (value.length() > 12000) throw new IllegalStateException("Keep the replacement under 12,000 characters.");
    if (value.equals(selected.code())) throw new IllegalStateException("Change the replacement before previewing its impact.");
    return value;
  }
  private void showEvidence(SourceContext.Context found) {
    context = found;
    var m = message("evidence"); m.add("items", found.evidence()); m.addProperty("note", found.note()); send(m);
  }
  private void request(JsonObject input, SourceContext.Selection selected, long token, long version) {
    String task = string(input, "task");
    if (!java.util.List.of("explain", "example", "concept", "impact").contains(task)) return;
    String mode = task.equals("impact") || string(input, "mode").equals("project") ? "project" : "standalone";
    var request = new JsonObject();
    request.addProperty("task", task); request.addProperty("mode", mode);
    request.addProperty("audience", string(input, "audience")); request.addProperty("code", selected.code());
    request.addProperty("language", selected.language());
    if (task.equals("concept")) request.addProperty("concept", string(input, "concept").substring(0, Math.min(150, string(input, "concept").length())));
    if (task.equals("impact")) request.addProperty("replacement", replacement(input, selected));
    SourceContext.Context found = mode.equals("project") ? SourceContext.collect(project, selected) : null;
    if (found != null) { request.addProperty("context", found.nearby()); request.add("evidence", found.evidence()); }
    var state = Settings.get().getState();
    String key = Keys.get(state.provider);
    if (key == null || key.isBlank()) throw new IllegalStateException("Connect an AI provider first using Connect provider above.");
    if (!unchanged(selected, token, version)) return;
    trusted();
    var params = new JsonObject(); params.addProperty("provider", state.provider); params.addProperty("model", state.model);
    params.addProperty("key", key); params.add("request", request);
    CompletableFuture<JsonElement> pending;
    synchronized (bridge) {
      if (!unchanged(selected, token, version)) return;
      pending = bridge.call("request", params);
    }
    var result = pending.join().getAsJsonObject();
    ui(() -> {
      if (!unchanged(selected, token, version)) return;
      if (found != null) showEvidence(found);
      result.addProperty("type", "lesson"); result.addProperty("task", task);
      if (request.has("concept")) result.add("concept", request.get("concept"));
      send(result);
    });
  }
  private void makePreview(JsonObject input, SourceContext.Selection selected, long token, long version) {
    String value = replacement(input, selected);
    String proposed = selected.source().substring(0, selected.start()) + value + selected.source().substring(selected.end());
    SourceContext.Context found = SourceContext.collect(project, selected);
    SourceContext.Syntax syntax;
    if (selected.typescript()) {
      var args = new JsonObject(); args.addProperty("code", proposed);
      syntax = new SourceContext.Syntax(call("syntax", args).getAsJsonArray(), true);
    } else syntax = SourceContext.syntax(project, selected, proposed);
    ui(() -> {
      if (!unchanged(selected, token, version)) return;
      try {
        var factory = DiffContentFactory.getInstance();
        DiffManager.getInstance().showDiff(project, new SimpleDiffRequest("WatDatMean · See what changes",
          factory.create(project, selected.source(), selected.file().getFileType()),
          factory.create(project, proposed, selected.file().getFileType()), "Original", "Proposed"));
        if (!unchanged(selected, token, version)) return;
        preview = syntax.checked() && syntax.errors().isEmpty() ? new Preview(selected, value, version) : null;
        showEvidence(found);
        var m = message("preview"); m.add("errors", syntax.errors()); m.addProperty("syntaxChecked", syntax.checked()); m.addProperty("replacement", value); send(m);
      } catch (Exception failure) { preview = null; error(failure); }
    });
  }
  private void apply(String replacement) {
    apply(replacement, () -> Messages.showYesNoDialog(project,
      "Apply the previewed edit? Impact predictions are not guarantees. Tests have not been run.",
      "WatDatMean", "Apply edit", "Cancel", Messages.getWarningIcon()) == Messages.YES);
  }
  void apply(String replacement, java.util.function.BooleanSupplier confirm) {
    if (busy || disposed || project.isDisposed()) return;
    trusted();
    var selected = current();
    var checked = preview;
    if (checked == null || checked.selection() != selected || !checked.replacement().equals(replacement) || checked.revision() != revision.get())
      throw new IllegalStateException("Preview this exact edit again before applying it.");
    long token = operation.incrementAndGet();
    busy = true;
    var busyMessage = message("busy"); busyMessage.addProperty("value", true); send(busyMessage);
    try {
      if (!confirm.getAsBoolean() || operation.get() != token || disposed || project.isDisposed()) return;
      trusted();
      if (current() != selected || preview != checked || checked.revision() != revision.get()) throw new IllegalStateException("Code changed. Preview the edit again.");
      if (!selected.document().isWritable()) throw new IllegalStateException("The file is read-only.");
      WriteCommandAction.runWriteCommandAction(project, "WatDatMean: Apply previewed edit", null, () -> {
        if (!selected.current() || checked.revision() != revision.get()) throw new IllegalStateException("Code changed. Preview the edit again.");
        selected.document().replaceString(selected.start(), selected.end(), replacement);
      });
      // Preserve the exact replacement range, including deletion followed by insertion.
      select(SourceContext.refresh(project, selected, selected.start(), selected.start() + replacement.length()), true);
      preview = null;
      if (selection.typescript()) refreshSelection(true); else send(message("applied"));
      new OpenFileDescriptor(project, selected.file(), selected.start()).navigate(true);
    } finally {
      // Cancellation may have started another operation while the confirmation dialog was open.
      if (operation.get() == token) {
        busy = false;
        var finished = message("busy"); finished.addProperty("value", false); send(finished);
      }
    }
  }

  void configure() {
    var dialog = new ConfigureDialog(project);
    if (!dialog.showAndGet()) return;
    cancel();
    var state = new Settings.Values();
    state.provider = (String) dialog.provider.getSelectedItem(); state.model = dialog.model.getText().trim();
    state.nodePath = dialog.nodePath.getText().trim(); state.audience = Settings.get().getState().audience;
    state.autoDownloadNode = dialog.autoDownloadNode.isSelected();
    String key = new String(dialog.key.getPassword()).trim(); dialog.key.setText("");
    background(() -> {
      if (!key.isEmpty()) Keys.set(state.provider, key);
      Settings.get().loadState(state); bridge.stop(); sendConfig();
    });
  }
  void removeKey() {
    String provider = Messages.showEditableChooseDialog("Remove the stored key for which provider?", "WatDatMean",
      Messages.getQuestionIcon(), new String[]{"openai", "anthropic", "groq"}, Settings.get().getState().provider, null);
    if (!java.util.List.of("openai", "anthropic", "groq").contains(provider == null ? "" : provider)) return;
    cancel();
    background(() -> { Keys.set(provider, null); bridge.stop(); sendConfig(); });
  }
  void clearCache() {
    cancel(); bridge.stop();
    Messages.showInfoMessage(project, "Explanation cache cleared.", "WatDatMean");
  }
  @Override public void dispose() { disposed = true; operation.incrementAndGet(); if (selectedRange != null) selectedRange.dispose(); bridge.dispose(); }
}
