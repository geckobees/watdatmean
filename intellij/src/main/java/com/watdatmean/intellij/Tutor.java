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
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.wm.ToolWindowManager;
import com.intellij.openapi.vfs.VirtualFileManager;
import com.intellij.openapi.vfs.newvfs.BulkFileListener;
import com.intellij.openapi.vfs.newvfs.events.VFileEvent;
import com.intellij.openapi.roots.ProjectFileIndex;
import com.intellij.util.concurrency.AppExecutorUtil;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import javax.swing.JComponent;
import javax.swing.JPanel;
import java.awt.BorderLayout;
import org.jetbrains.annotations.NotNull;

@Service(Service.Level.PROJECT)
public final class Tutor implements Disposable {
  private final Project project;
  private final Bridge bridge = new Bridge();
  private final LessonHistory history;
  private final ResourceBookmarks bookmarks;
  private volatile JsonObject latestResearch;
  private final WebSources webSources = new WebSources();
  private volatile boolean researchEnabled, researchRunning;
  private record LastExplanation(SourceContext.Selection selection, JsonObject source, String task, JsonElement lesson) {}
  private volatile LastExplanation lastExplanation;
  private final ExecutorService historyWorker = AppExecutorUtil.createBoundedApplicationPoolExecutor("WatDatMean history", 1);
  private final AtomicLong revision = new AtomicLong();
  private final AtomicLong operation = new AtomicLong();
  private volatile SourceContext.Selection selection;
  private RangeMarker selectedRange;
  private volatile SourceContext.Context context;
  private volatile Preview preview;
  private PanelView panel;
  private final JPanel panelContainer = new JPanel(new BorderLayout());
  private long panelGeneration;
  private long selectionId;
  private final SourceLineHighlight lineHighlight = new SourceLineHighlight();
  private boolean ready;
  private boolean busy;
  private volatile boolean disposed;
  private record Preview(SourceContext.Selection selection, String replacement, long revision) {}

  public Tutor(Project project) {
    this.project = project;
    this.history = new LessonHistory(project);
    this.bookmarks = new ResourceBookmarks(project);
    researchEnabled = com.intellij.ide.util.PropertiesComponent.getInstance(project).getBoolean("watdatmean.webResearch", false);
    project.getMessageBus().connect(this).subscribe(com.intellij.codeInsight.daemon.DaemonCodeAnalyzer.DAEMON_EVENT_TOPIC,
      new com.intellij.codeInsight.daemon.DaemonCodeAnalyzer.DaemonListener() {
        @Override public void daemonFinished(@NotNull java.util.Collection<? extends FileEditor> editors) {
          var selected = selection;
          if (selected != null && selected.current() && editors.stream().anyMatch(editor -> selected.file().equals(editor.getFile())))
            ui(() -> { if (selection == selected && ready) send(message("syntaxThemeChanged")); });
        }
      });
    EditorFactory.getInstance().getEventMulticaster().addDocumentListener(new DocumentListener() {
      @Override public void documentChanged(@NotNull DocumentEvent event) {
        ui(lineHighlight::clear);
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
    if (panel == null) {
      long generation = ++panelGeneration;
      panel = new PanelView(this, incoming -> ui(() -> {
        if (generation == panelGeneration) handle(incoming);
      }));
      panelContainer.add(panel, BorderLayout.CENTER);
    }
    return panelContainer;
  }
  void reopenPanel() {
    ready = false;
    cancel(); preview = null; context = null;
    ++panelGeneration;
    if (panel != null) {
      panelContainer.remove(panel);
      Disposer.dispose(panel);
      panel = null;
    }
    panel();
    panelContainer.revalidate(); panelContainer.repaint();
    var window = ToolWindowManager.getInstance(project).getToolWindow("WatDatMean");
    if (window != null) window.show();
    try {
      if (selection != null && selection.file().isValid()) refreshSelection();
      else {
        selection = null;
        var editor = FileEditorManager.getInstance(project).getSelectedTextEditor();
        if (editor != null) inspect(editor);
      }
    } catch (Exception error) { error(error); }
  }
  private void ui(Runnable action) {
    ApplicationManager.getApplication().invokeLater(() -> {
      if (!disposed && !project.isDisposed()) action.run();
    });
  }
  private void send(JsonObject message) {
    var target = panel;
    ui(() -> { if (ready && target != null && panel == target) target.send(message); });
  }
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

  @FunctionalInterface private interface HistoryWork { void run() throws Exception; }
  private void historyWork(HistoryWork action) {
    historyWorker.execute(() -> {
      try {
        action.run(); var m = history.snapshot(); webSources.history(m); m.addProperty("type", "history"); send(m);
      } catch (Exception failure) {
        var m = message("historyError");
        m.addProperty("message", "History could not be saved or loaded. Your current lesson is still available; check local storage and try again."); send(m);
      }
    });
  }
  private void bookmarkWork(HistoryWork action) {
    historyWorker.execute(() -> {
      try {
        action.run(); var m = bookmarks.snapshot(); webSources.bookmarks(m); m.addProperty("type", "bookmarks"); send(m);
      } catch (Exception error) {
        var m = message("bookmarkError"); m.addProperty("message", error.getMessage() != null && error.getMessage().startsWith("Your 100")
          ? error.getMessage() : "Bookmarks could not be saved or loaded. Check local storage and try again."); send(m);
      }
    });
  }
  private void addBookmark(String url) throws Exception {
    if (!WebSources.publicUrl(url)) return;
    var results = new java.util.ArrayList<JsonObject>();
    if (latestResearch != null) results.add(latestResearch);
    for (var entry : history.snapshot().getAsJsonArray("entries"))
      for (var saved : entry.getAsJsonObject().getAsJsonObject("results").entrySet()) {
        var result = saved.getValue().getAsJsonObject().get("research");
        if (result != null && result.isJsonObject()) results.add(result.getAsJsonObject());
      }
    for (var result : results) for (var source : result.getAsJsonArray("sources"))
      if (url.equals(source.getAsJsonObject().get("url").getAsString())) { bookmarks.add(source.getAsJsonObject(), result); return; }
  }

  void inspect(Editor editor) {
    cancel(); preview = null; context = null; selection = null;
    send(message("stale"));
    if (selectedRange != null) { selectedRange.dispose(); selectedRange = null; }
    var window = ToolWindowManager.getInstance(project).getToolWindow("WatDatMean");
    if (window != null) window.show();
    try {
      var captured = SourceContext.capture(project, editor);
      long token = operation.get();
      if (!captured.sharedLanguage().isEmpty()) {
        var args = new JsonObject(); args.addProperty("code", captured.source());
        args.addProperty("language", captured.sharedLanguage());
        args.add("start", captured.snippet().get("cursorStart")); args.add("end", captured.snippet().get("cursorEnd"));
        background(() -> {
          try {
            var snippet = call("inspect", args).getAsJsonObject();
            ui(() -> {
              if (token != operation.get() || !captured.current()) return;
              select(new SourceContext.Selection(captured.document(), captured.file(), captured.stamp(), captured.source(), captured.language(), snippet), false);
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
    lineHighlight.clear();
    var m = message("selection");
    m.addProperty("selectionId", ++selectionId);
    var editors = EditorFactory.getInstance().getEditors(selected.document(), project);
    m.addProperty("tabSize", editors.length == 0 ? 4 : editors[0].getSettings().getTabSize(project));
    m.addProperty("keepTab", keepTab);
    m.addProperty("code", selected.code()); m.add("parts", selected.snippet().get("parts"));
    m.addProperty("start", selected.start());
    m.addProperty("language", selected.language()); m.addProperty("file", SourceContext.relative(project, selected.file()));
    m.addProperty("line", selected.document().getLineNumber(selected.start()) + 1);
    send(m); sendConfig();
    long id = selectionId;
    background(() -> {
      try {
        var args = new JsonObject(); args.addProperty("language", selected.language());
        args.add("manifests", ResearchVersions.read(project.getBasePath(), selected.file().getPath()));
        var hints = call("researchHints", args).getAsJsonObject();
        ui(() -> { if (selection == selected && selectionId == id && selected.current()) {
          hints.addProperty("type", "researchHints"); hints.addProperty("selectionId", id); send(hints);
        } });
      } catch (Exception ignored) { /* Version remains unknown. */ }
    });
  }
  private void refreshSelection() { refreshSelection(false); }
  private void refreshSelection(boolean applied) {
    if (selection == null) return;
    if (selectedRange == null || !selectedRange.isValid()) throw new IllegalStateException("Select the updated code in your editor and inspect it again.");
    cancel(); preview = null; context = null;
    var captured = SourceContext.refresh(project, selection, selectedRange.getStartOffset(), selectedRange.getEndOffset());
    long token = operation.get();
    if (!captured.sharedLanguage().isEmpty() && captured.start() != captured.end()) {
      var args = new JsonObject(); args.addProperty("code", captured.source());
      args.addProperty("language", captured.sharedLanguage());
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
      m.addProperty("webResearch", researchEnabled);
      m.addProperty("soundEnabled", state.buttonSounds);
      m.addProperty("webResearchModel", switch (state.provider) { case "groq" -> "openai/gpt-oss-120b"; case "anthropic" -> "claude-haiku-4-5"; default -> "gpt-4.1-mini"; });
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
    researchRunning = false;
    operation.incrementAndGet(); bridge.cancel(); busy = false;
    var m = message("busy"); m.addProperty("value", false); send(m);
  }
  private void handle(JsonObject m) {
    try {
      switch (string(m, "type")) {
        case "soundToggle" -> {
          if (m.has("enabled") && m.get("enabled").isJsonPrimitive() && m.getAsJsonPrimitive("enabled").isBoolean())
            Settings.get().getState().buttonSounds = m.get("enabled").getAsBoolean();
        }
        case "highlight" -> highlight(m);
        case "ready" -> {
          ready = true; sendSelection(); sendConfig();
          historyWork(() -> {});
          bookmarkWork(() -> {});
          if (selection != null && !selection.current()) send(message("stale"));
        }
        case "historyList" -> historyWork(() -> {});
        case "bookmarkList" -> bookmarkWork(() -> {});
        case "bookmarkAdd" -> bookmarkWork(() -> addBookmark(string(m, "url")));
        case "bookmarkRemove" -> bookmarkWork(() -> bookmarks.remove(string(m, "url")));
        case "researchToggle" -> {
          if (!m.has("enabled") || !m.get("enabled").isJsonPrimitive() || !m.getAsJsonPrimitive("enabled").isBoolean()) return;
          researchEnabled = m.get("enabled").getAsBoolean();
          com.intellij.ide.util.PropertiesComponent.getInstance(project).setValue("watdatmean.webResearch", researchEnabled, false);
          if (!researchEnabled && researchRunning) cancel();
        }
        case "openWebSource" -> {
          String url = string(m, "url");
          if (webSources.allows(url)) com.intellij.ide.BrowserUtil.browse(url);
        }
        case "historyRemove" -> historyWork(() -> history.remove(string(m, "id")));
        case "historyClear" -> historyWork(history::clear);
        case "historyEnabled" -> {
          if (m.has("enabled") && m.get("enabled").isJsonPrimitive() && m.getAsJsonPrimitive("enabled").isBoolean())
            historyWork(() -> history.enable(m.get("enabled").getAsBoolean()));
        }
        case "configure" -> configure();
        case "cancel" -> cancel();
        case "refresh" -> refreshSelection();
        case "openSourceLine" -> openSourceLine(m);
        case "openEvidence" -> {
          var c = context;
          if (c == null) return;
          var location = c.locations().get(string(m, "id"));
          if (location != null && location.file().isValid()) new OpenFileDescriptor(project, location.file(), location.offset()).navigate(true);
        }
        case "apply" -> apply(string(m, "replacement"));
        case "request", "preview", "research" -> run(m);
        default -> { }
      }
    } catch (Exception error) { error(error); }
  }

  private final AtomicLong sourceColors = new AtomicLong(), draftColors = new AtomicLong();
  private void openSourceLine(JsonObject request) {
    long id = wholeNumber(request, "selectionId"), line = wholeNumber(request, "line");
    if (id < 1 || id != selectionId || line < 1) return;
    var selected = current();
    var document = selected.document();
    if (line < document.getLineNumber(selected.start()) + 1 ||
        line > document.getLineNumber(selected.end()) + 1) return;
    // Navigate only to the captured file, never to a path supplied by the webview.
    var editor = FileEditorManager.getInstance(project).openTextEditor(
      new OpenFileDescriptor(project, selected.file(), (int) line - 1, 0), true);
    if (editor != null) lineHighlight.show(editor, (int) line - 1);
  }
  private static long wholeNumber(JsonObject request, String name) {
    var value = request.get(name);
    if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) return -1;
    try { return value.getAsBigDecimal().longValueExact(); }
    catch (NumberFormatException | ArithmeticException ignored) { return -1; }
  }
  private void highlight(JsonObject request) {
    var selected = selection; var targetPanel = panel;
    String target = string(request, "target"), code = string(request, "code");
    if (target.matches("block-\\d{1,9}")) {
      String language = string(request, "language");
      if (wholeNumber(request, "id") < 1 || code.length() > 50000 || language.length() > 100) return;
      long generation = panelGeneration;
      AppExecutorUtil.getAppExecutorService().execute(() -> {
        if (disposed) return;
        var colors = CodeColors.snippet(project, language, code);
        ui(() -> {
          if (disposed || panel != targetPanel || panelGeneration != generation) return;
          colors.addProperty("type", "highlight"); colors.addProperty("target", target);
          colors.add("id", request.get("id")); colors.addProperty("code", code); send(colors);
        });
      });
      return;
    }
    if (selected == null || code.length() > 50000 || !(target.equals("source") || target.equals("draft"))
        || !request.has("id") || !request.get("id").isJsonPrimitive() || !request.getAsJsonPrimitive("id").isNumber()) return;
    if (target.equals("source") && !code.equals(selected.code())) return;
    var sequence = target.equals("source") ? sourceColors : draftColors;
    long token = sequence.incrementAndGet();
    AppExecutorUtil.getAppExecutorService().execute(() -> {
      if (disposed || sequence.get() != token) return;
      String text = selected.source().substring(0, selected.start()) + code + selected.source().substring(selected.end());
      var colors = CodeColors.highlight(project, selected.file(), text, selected.start(), selected.start()+code.length());
      ui(() -> {
        if (selection != selected || panel != targetPanel || sequence.get() != token) return;
        colors.addProperty("type", "highlight"); colors.addProperty("target", target); colors.add("id", request.get("id")); colors.addProperty("code", code);
        send(colors);
      });
    });
  }

  private void run(JsonObject input) {
    if (busy) return;
    boolean web = string(input, "type").equals("research");
    if (web && !researchEnabled) return;
    var selected = current();
    boolean diff = string(input, "type").equals("preview");
    if (diff) { preview = null; send(message("previewReset")); }
    if (!diff) trusted();
    if (selected.code().length() > 12000) throw new IllegalStateException("Select a smaller block of code (under 12,000 characters).");
    busy = true;
    researchRunning = web;
    long token = operation.incrementAndGet(), version = revision.get();
    var busyMessage = message("busy"); busyMessage.addProperty("value", true); send(busyMessage);
    background(() -> {
      try {
        if (diff) makePreview(input, selected, token, version);
        else if (web) research(input, selected, token, version);
        else request(input, selected, token, version);
      } catch (Exception failure) {
        if (unchanged(selected, token, version)) {
          if (web) {
            Throwable cause = failure; while (cause.getCause() != null) cause = cause.getCause();
            var m = message("researchError"); m.addProperty("message", cause.getMessage() == null ? "Web research failed. Your explanation is unchanged." : cause.getMessage()); send(m);
          } else error(failure);
        }
      } finally {
        ui(() -> { if (token == operation.get()) { busy = false; researchRunning = false; var m = message("busy"); m.addProperty("value", false); send(m); } });
      }
    });
  }
  private boolean unchanged(SourceContext.Selection selected, long token, long version) {
    return !disposed && selection == selected && selected.current() && operation.get() == token && revision.get() == version;
  }
  private void research(JsonObject input, SourceContext.Selection selected, long token, long version) {
    String topic = string(input, "topic");
    if (topic.isBlank() || topic.length() > 200 || topic.indexOf('\n') >= 0 || topic.indexOf('\r') >= 0)
      throw new IllegalStateException("Enter a short public search topic (up to 200 characters), not a code block.");
    var settings = Settings.get().getState(); String key = Keys.get(settings.provider);
    if (key == null || key.isBlank()) throw new IllegalStateException("Connect a provider to search the web.");
    if (!researchEnabled || !unchanged(selected, token, version)) return;
    var previous = lastExplanation;
    var params = new JsonObject(); params.addProperty("provider", settings.provider); params.addProperty("key", key);
    params.addProperty("enabled", true); params.addProperty("topic", topic); params.addProperty("audience", string(input, "audience"));
    if (input.has("options")) params.add("options", input.get("options"));
    CompletableFuture<JsonElement> pending;
    synchronized (bridge) {
      if (!researchEnabled || !unchanged(selected, token, version)) return;
      pending = bridge.call("research", params);
    }
    var result = pending.join().getAsJsonObject();
    ui(() -> {
      if (!researchEnabled || !unchanged(selected, token, version)) return;
      webSources.current(result);
      latestResearch = result;
      var m = message("research"); m.add("result", result); send(m);
      if (previous != null && previous.selection() == selected)
        historyWork(() -> history.attachResearch(previous.source(), previous.task(), previous.lesson(), result));
    });
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
    if (!java.util.List.of("explain", "walkthrough", "example", "concept", "impact").contains(task)) return;
    String mode = task.equals("impact") || string(input, "mode").equals("project") ? "project" : "standalone";
    var request = new JsonObject();
    request.addProperty("task", task); request.addProperty("mode", mode);
    request.addProperty("audience", string(input, "audience")); request.addProperty("code", selected.code());
    request.addProperty("language", selected.language());
    if (task.equals("concept")) request.addProperty("concept", string(input, "concept").substring(0, Math.min(150, string(input, "concept").length())));
    if (task.equals("impact")) request.addProperty("replacement", replacement(input, selected));
    SourceContext.Context found = mode.equals("project") ? SourceContext.collect(project, selected) : null;
    if (found != null) {
      request.addProperty("context", found.nearby()); request.add("evidence", found.evidence());
      if (task.equals("walkthrough")) request.addProperty("learningContext", SourceContext.learningContext(project, selected));
    }
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
      if (!task.equals("concept")) {
        var source = new JsonObject();
        for (String field : java.util.List.of("code", "language", "mode", "audience")) source.add(field, request.get(field));
        source.addProperty("file", SourceContext.relative(project, selected.file()));
        source.addProperty("line", selected.document().getLineNumber(selected.start()) + 1);
        var saved = new JsonObject();
        for (String field : java.util.List.of("lesson", "provider", "model")) saved.add(field, result.get(field));
        for (String field : java.util.List.of("mode", "audience")) saved.add(field, request.get(field));
        if (task.equals("impact")) saved.add("replacement", request.get("replacement"));
        if (task.equals("explain") || task.equals("walkthrough")) lastExplanation = new LastExplanation(selected, source, task, result.get("lesson"));
        historyWork(() -> history.add(source, task, saved));
      }
    });
  }
  private void makePreview(JsonObject input, SourceContext.Selection selected, long token, long version) {
    String value = replacement(input, selected);
    String proposed = selected.source().substring(0, selected.start()) + value + selected.source().substring(selected.end());
    SourceContext.Context found = SourceContext.collect(project, selected);
    SourceContext.Syntax syntax;
    if (!selected.sharedLanguage().isEmpty()) {
      var args = new JsonObject(); args.addProperty("code", proposed);
      args.addProperty("language", selected.sharedLanguage());
      var checked = call("checkSyntax", args).getAsJsonObject();
      syntax = new SourceContext.Syntax(checked.getAsJsonArray("errors"), checked.get("checked").getAsBoolean());
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
      if (!selection.sharedLanguage().isEmpty()) refreshSelection(true); else send(message("applied"));
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
  @Override public void dispose() { disposed = true; historyWorker.shutdown(); lineHighlight.dispose(); operation.incrementAndGet(); if (selectedRange != null) selectedRange.dispose(); bridge.dispose(); }
}
