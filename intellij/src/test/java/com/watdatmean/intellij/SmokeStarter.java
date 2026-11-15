package com.watdatmean.intellij;

import com.google.gson.JsonObject;
import com.intellij.openapi.actionSystem.ActionManager;
import com.intellij.openapi.application.*;
import com.intellij.openapi.editor.EditorFactory;
import com.intellij.openapi.fileEditor.FileDocumentManager;
import com.intellij.openapi.project.ProjectManager;
import com.intellij.openapi.command.WriteCommandAction;
import com.intellij.openapi.fileTypes.FileTypeManager;
import com.intellij.testFramework.LightVirtualFile;
import java.nio.file.*;
import java.util.List;
import java.util.concurrent.TimeUnit;

/** Test-only application starter: packaged only in an isolated test profile. */
public final class SmokeStarter implements ApplicationStarter {
  @Override public String getCommandName() { return "watdatmean-smoke"; }
  @Override public boolean isHeadless() { return true; }
  @Override public int getRequiredModality() { return NOT_IN_EDT; }
  @Override public void main(List<String> args) {
    try {
      if (Boolean.getBoolean("watdatmean.test.live")) {
        // Initialize and verify language plugins just as the full native suite does.
        ApplicationManager.getApplication().invokeAndWait(this::editorChecks);
        LiveWebSmoke.run();
        System.exit(0);
        return;
      }
      ApplicationManager.getApplication().invokeAndWait(this::editorChecks);
      HoverSmoke.run();
      Settings.get().getState().nodePath = System.getProperty("watdatmean.node.path");
      RuntimeSmoke.run();
      HistorySmoke.run();
      var bridge = new Bridge();
      try {
        var defaults = bridge.call("defaults", new JsonObject()).get(20, TimeUnit.SECONDS).getAsJsonObject();
        for (String provider : List.of("openai", "anthropic", "groq"))
          check(defaults.get(provider).getAsString().equals(Settings.defaultModel(provider)), "Native and shared provider defaults agree for " + provider);
        var input = new JsonObject(); input.addProperty("code", "const score: number = 0;"); input.addProperty("start", 8); input.addProperty("end", 8);
        var result = bridge.call("inspect", input).get(20, TimeUnit.SECONDS).getAsJsonObject();
        check(result.get("symbol").getAsString().equals("score"), "Java/Node stdio bridge returns the TypeScript symbol");
        check(!result.getAsJsonArray("parts").isEmpty(), "Shared offline syntax explanations");
        for (String code : List.of(
          "export interface Options {\n  label?: string;\n}",
          "// prefix\nconst glossary: Record<string, [string, string]> = {",
          "type Record<K,V> = [K,V];\nconst pair: Record<string, number> = value;")) {
          var types = new JsonObject(); types.addProperty("code", code);
          int start = code.contains("label?") ? code.indexOf("label?") : code.indexOf("const");
          types.addProperty("start", start); types.addProperty("end", start); types.addProperty("language", "typescript");
          var inspected = bridge.call("inspect", types).get(20, TimeUnit.SECONDS).getAsJsonObject();
          check(inspected.get("start").getAsInt() == start, "Shared type selection keeps its source offset");
          check(!inspected.getAsJsonArray("parts").isEmpty(), "Type pieces survive incomplete code and custom utilities");
          String explanation = inspected.get("explanation").getAsString();
          if (code.contains("label?")) check(explanation.contains("optional property"), "Native bridge focuses interface members");
          if (code.contains("glossary")) check(explanation.contains("incomplete"), "Incomplete object remains honest");
          if (code.startsWith("type Record")) check(!explanation.contains("text keys"), "Custom utility is not mistaken for a built-in");
          for (var part : inspected.getAsJsonArray("parts")) {
            var piece = part.getAsJsonObject();
            check(code.substring(piece.get("start").getAsInt(), piece.get("end").getAsInt()).equals(piece.get("token").getAsString()), "Type pieces have exact source ranges");
          }
        }
        System.out.println("PASS: native bridge interface member selection, unfinished types, custom utilities, and source offsets");
        for (String language : List.of("python", "javascript", "typescriptreact")) {
          String code = language.equals("python") ? "import math as m\nscore = m.sqrt(9)\nprint(score)" : language.equals("javascript") ? "const score = 3;" : "const score = <button>Hi</button>;";
          var multi = new JsonObject(); multi.addProperty("code", code); multi.addProperty("start", code.indexOf("score")); multi.addProperty("end", code.indexOf("score")); multi.addProperty("language", language);
          var inspected = bridge.call("inspect", multi).get(20, TimeUnit.SECONDS).getAsJsonObject();
          check(!inspected.getAsJsonArray("parts").isEmpty(), "Native bridge returns " + language + " pieces");
          if (language.equals("python")) check(inspected.get("learningContext").getAsString().contains("import math"), "Python import clues retained locally");
          var syntax = bridge.call("checkSyntax", multi).get(20, TimeUnit.SECONDS).getAsJsonObject();
          check(syntax.get("checked").getAsBoolean() && syntax.getAsJsonArray("errors").isEmpty(), "Native bridge checks " + language + " syntax");
          multi.addProperty("code", language.equals("python") ? "score = (" : "const score = ;");
          check(!bridge.call("checkSyntax", multi).get(20, TimeUnit.SECONDS).getAsJsonObject().getAsJsonArray("errors").isEmpty(), "Native bridge rejects malformed " + language);
        }
        var python = new JsonObject(); python.addProperty("language", "python");
        for (String invalid : List.of("if True:\n    x=1\n  y=2", "return 3", "def f(x, x):\n return x", "try:\n x=1")) {
          python.addProperty("code", invalid);
          check(!bridge.call("checkSyntax", python).get(20, TimeUnit.SECONDS).getAsJsonObject().getAsJsonArray("errors").isEmpty(), "Native Python structural checks reject invalid code");
        }
        python.addProperty("code", "async def run():\n    value = await work()\n    return value");
        check(bridge.call("checkSyntax", python).get(20, TimeUnit.SECONDS).getAsJsonObject().getAsJsonArray("errors").isEmpty(), "Native Python checker accepts valid async code");
        System.out.println("PASS: native Python, JavaScript, and TSX inspection, import clues, and syntax previews");
        JavaTraceSmoke.run(bridge);
        WebResearchSmoke.run(bridge);
        bridge.call("clearCache", new JsonObject()).get(5, TimeUnit.SECONDS);
      } finally { bridge.dispose(); }
      if (Boolean.getBoolean("watdatmean.test.ui")) {
        try (var panel = new PanelSmoke()) {
          panel.run();
          var directory = Files.createTempDirectory("watdatmean-live-replay-");
          try (var stream = SmokeStarter.class.getResourceAsStream("/web-research-live.json")) {
            var fixtures = com.google.gson.JsonParser.parseReader(new java.io.InputStreamReader(stream, java.nio.charset.StandardCharsets.UTF_8)).getAsJsonArray();
            var bookmarks = new ResourceBookmarks(directory.resolve("bookmarks.json"));
            for (var fixture : fixtures) panel.checkLiveResources(fixture.getAsJsonObject().getAsJsonObject("result"), bookmarks);
          } finally {
            Files.deleteIfExists(directory.resolve("bookmarks.json")); Files.deleteIfExists(directory);
          }
        }
        RecoverySmoke.run();
      }
      Files.writeString(Path.of(System.getProperty("watdatmean.test.result")), "PASS: plugin actions, native Java hover and documentation, edit confirmation/cancellation, Java method/selection capture, Java syntax checks, unsupported-language guard, document invalidation, Node runtime checks, cancellation, packaged Java/Node bridge"
        + (Boolean.getBoolean("watdatmean.test.ui") ? ", and native JCEF panel" : "") + ".\n");
      System.exit(0);
    } catch (Throwable error) {
      error.printStackTrace();
      try { Files.writeString(Path.of(System.getProperty("watdatmean.test.result")), "FAIL: " + error); } catch (Exception ignored) { }
      System.exit(1);
    }
  }
  private void editorChecks() {
    CodeColorsSmoke.run();
    var project = ProjectManager.getInstance().getDefaultProject();
    for (String action : List.of("Inspect", "ReopenPanel", "Configure", "RemoveKey", "ClearCache"))
      check(ActionManager.getInstance().getAction("WatDatMean." + action) != null, "Registered action " + action);
    String source = "class Demo { int doubleIt(int value) { return value * 2; } }";
    var file = new LightVirtualFile("Demo.java", FileTypeManager.getInstance().getFileTypeByExtension("java"), source);
    var document = FileDocumentManager.getInstance().getDocument(file);
    check(document != null, "Java document");
    var editor = EditorFactory.getInstance().createEditor(document, project);
    try {
      editor.getCaretModel().moveToOffset(source.indexOf("doubleIt"));
      var selected = SourceContext.capture(project, editor);
      check(selected.language().equalsIgnoreCase("Java"), "Detected Java language");
      check(selected.code().equals("int doubleIt(int value) { return value * 2; }"), "Method-name selection includes the method");
      check(SourceContext.syntax(project, selected, source).checked(), "Java parser available");
      check(SourceContext.syntax(project, selected, source).errors().isEmpty(), "Valid Java syntax");
      check(!SourceContext.syntax(project, selected, "class Demo { int value = ; }").errors().isEmpty(), "Invalid Java syntax blocked");
      int start = source.indexOf("value * 2");
      editor.getSelectionModel().setSelection(start, start + 9);
      check(SourceContext.capture(project, editor).code().equals("value * 2"), "Exact user selection preserved");
      WriteCommandAction.runWriteCommandAction(project, () -> document.insertString(0, "// changed\n"));
      check(!selected.current(), "Edited documents invalidate captured selections");
    } finally { EditorFactory.getInstance().releaseEditor(editor); }
    var plain = new LightVirtualFile("unknown.xyz", "some code");
    var plainDocument = FileDocumentManager.getInstance().getDocument(plain);
    var plainEditor = EditorFactory.getInstance().createEditor(plainDocument, project);
    try {
      var selected = SourceContext.capture(project, plainEditor);
      check(!SourceContext.syntax(project, selected, "changed code").checked(), "Unknown languages cannot falsely pass syntax checks");
    } finally { EditorFactory.getInstance().releaseEditor(plainEditor); }
    Tutor.get(project); // Check project service construction and listener lifecycle.
  }
  private static void check(boolean condition, String message) {
    if (!condition) throw new AssertionError(message);
  }
}
