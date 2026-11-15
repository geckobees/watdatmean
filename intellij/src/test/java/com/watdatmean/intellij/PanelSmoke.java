package com.watdatmean.intellij;

import com.google.gson.*;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.editor.colors.EditorColorsManager;
import com.intellij.openapi.editor.colors.EditorColors;
import com.intellij.openapi.editor.colors.EditorColorsScheme;
import com.intellij.openapi.util.Disposer;
import com.intellij.ide.ui.LafManager;
import com.intellij.util.ui.UIUtil;
import com.intellij.ui.jcef.*;
import org.cef.CefSettings;
import org.cef.browser.CefBrowser;
import org.cef.browser.CefFrame;
import org.cef.handler.CefDisplayHandlerAdapter;
import org.cef.handler.CefLoadHandlerAdapter;
import javax.swing.*;
import java.awt.event.*;
import java.util.concurrent.*;

/** Exercises the packaged panel in IntelliJ's real JCEF runtime without API keys. */
final class PanelSmoke implements AutoCloseable {
  private final BlockingQueue<JsonObject> messages = new LinkedBlockingQueue<>();
  private final BlockingQueue<JsonElement> probes = new LinkedBlockingQueue<>();
  private final BlockingQueue<String> layoutErrors = new LinkedBlockingQueue<>();
  private final CountDownLatch closed = new CountDownLatch(1);
  private final Disposable lifetime = Disposer.newDisposable("WatDatMean panel smoke test");
  private JFrame frame;
  private PanelView panel;
  private JBCefBrowser browser;
  private JBCefJSQuery probe;

  void run() throws Exception {
    ApplicationManager.getApplication().invokeAndWait(() -> {
      if (!JBCefApp.isSupported()) throw new AssertionError("The bundled JCEF runtime must be available");
      panel = new PanelView(lifetime, this::receive);
      try {
        var field = PanelView.class.getDeclaredField("browser");
        field.setAccessible(true);
        browser = (JBCefBrowser) field.get(panel);
      } catch (ReflectiveOperationException error) { throw new AssertionError(error); }
      browser.getJBCefClient().addDisplayHandler(new CefDisplayHandlerAdapter() {
        @Override public boolean onConsoleMessage(CefBrowser cef, CefSettings.LogSeverity severity, String message, String source, int line) {
          if (message.contains("ResizeObserver loop")) layoutErrors.add(message);
          System.out.println("JCEF console: " + message); return false;
        }
      }, browser.getCefBrowser());
      browser.getJBCefClient().addLoadHandler(new CefLoadHandlerAdapter() {
        @Override public void onLoadEnd(CefBrowser cef, CefFrame cefFrame, int status) {
          System.out.println("JCEF loaded: " + status + " " + cefFrame.getURL());
        }
      }, browser.getCefBrowser());
      probe = JBCefJSQuery.create((JBCefBrowserBase) browser);
      Disposer.register(lifetime, probe);
      probe.addHandler(value -> { probes.add(JsonParser.parseString(value)); return null; });
      frame = new JFrame("WatDatMean · IntelliJ native panel test");
      frame.setDefaultCloseOperation(WindowConstants.DISPOSE_ON_CLOSE);
      frame.addWindowListener(new WindowAdapter() {
        @Override public void windowClosed(WindowEvent event) { closed.countDown(); }
      });
      frame.setContentPane(panel);
      frame.setSize(640, 980);
      frame.setLocationByPlatform(true);
      frame.setVisible(true);
    });
    expectMessage("ready");
    check(evaluate("Array.from(document.querySelectorAll('.stage-lamp')).map(e=>e.textContent).join(',')").getAsString().equals("1,2,3"), "Numbered stage controls render on 2022.3");
    check(evaluate("getComputedStyle(document.querySelector('[data-tab=impact]')).getPropertyValue('--stage').trim()").getAsString().equals("#f47b77"), "Part three uses the red stage palette");
    evaluate("(document.getElementById('button-click').load(), true)");
    awaitBoolean("document.getElementById('button-click').readyState >= 2");
    check(evaluate("document.getElementById('button-click').duration < 0.15 && document.getElementById('button-click').volume === 0.25").getAsBoolean(), "Bundled original WAV decodes in JCEF at low volume");
    evaluate("(document.getElementById('sound-toggle').click(), true)");
    check(!expectMessage("soundToggle").get("enabled").getAsBoolean(), "Mute reaches the native host");
    check(evaluate("document.getElementById('sound-toggle').textContent").getAsString().equals("Sound off"), "Mute control reflects its state");
    awaitStyle("document.body", "backgroundColor", "rgb(27, 40, 56)");
    var selection = JsonParser.parseString("""
      {"type":"selection","code":"int doubleIt(int value) { return value * 2; }",
       "language":"Java","file":"Demo.java","line":2,"selectionId":7}
      """).getAsJsonObject();
    ApplicationManager.getApplication().invokeAndWait(() -> {
      var project = com.intellij.openapi.project.ProjectManager.getInstance().getDefaultProject();
      String prefix = "class Demo { ";
      String code = selection.get("code").getAsString();
      var file = com.intellij.psi.PsiFileFactory.getInstance(project).createFileFromText("Demo.java",
        com.intellij.openapi.fileTypes.FileTypeManager.getInstance().getFileTypeByExtension("java"), prefix + code + " }");
      selection.add("parts", JavaParts.inspect(file, prefix.length(), prefix.length() + code.length()));
      selection.addProperty("start", prefix.length());
    });
    send(selection.toString());
    awaitColoredSource();
    awaitText("#source-lines > span:first-child", "2");
    awaitText("#parts-lines > span:first-child", "2");
    send("""
      {"type":"config","provider":"openai","model":"test-model","audience":"beginner","hasKey":false}
      """);
    check(evaluate("document.getElementById('language').textContent").getAsString().equals("JAVA"), "Java language label rendered");
    check(evaluate("document.getElementById('source').textContent").getAsString().contains("doubleIt"), "Selected code rendered");
    check(!evaluate("document.getElementById('syntax-section').hidden").getAsBoolean(), "Java small pieces are visible");
    check(evaluate("document.getElementById('parts').textContent").getAsString().equals(selection.get("code").getAsString()), "Boxed pieces preserve source text and absolute offsets");
    evaluate("(Array.from(document.querySelectorAll('#parts [role=button]')).find(b => b.textContent === 'int').click(), true)");
    check(evaluate("document.getElementById('part-detail').textContent").getAsString().contains("32-bit"), "Java piece opens its local explanation");
    awaitText(".part-location", "Demo.java:2");
    evaluate("(Array.from(document.querySelectorAll('#parts [role=button]')).find(b => b.textContent === 'value').click(), true)");
    check(evaluate("document.getElementById('part-detail').textContent").getAsString().contains("argument from the caller"), "Variable origin is shown inside the existing piece detail");
    check(messages.isEmpty(), "Opening a piece does not request AI or call the host");
    for (String id : new String[]{"source", "parts"}) {
      evaluate("(document.querySelector('#" + id + "-lines button').click(), true)");
      var jump = expectMessage("openSourceLine");
      check(jump.get("line").getAsInt() == 2 && jump.get("selectionId").getAsInt() == 7, "Native gutter clicks send the original file line and snapshot");
    }
    evaluate("(document.getElementById('walkthrough').click(), true)");
    check(expectMessage("request").get("task").getAsString().equals("walkthrough"), "Step-by-step lessons reach the native host");
    evaluate("(document.getElementById('explain').click(), true)");
    check(expectMessage("request").get("task").getAsString().equals("explain"), "Real JCEF query reaches Java");
    send("""
      {"type":"lesson","task":"explain","provider":"test","model":"fixture","cached":false,
       "lesson":{"notice":"The AI answer did not match the code. This explanation uses local code facts.","usage":{"input":200,"output":70,"total":270},"title":"Double a value","summary":"For an input of 3, the method returns 6. <img src=x onerror=alert(1)>",
       "steps":["Read value.","Multiply by 2.","Return the result."],
       "connections":["The caller passes 3 to doubleIt; return sends 6 back."],
       "output":{"text":"","explanation":"Returning 6 does not itself print anything."},
       "pitfalls":["A returned value and console output are different."],
       "note":"Returning a value does not display it.",
       "concepts":[{"term":"return","explanation":"Sends the computed result back to the caller."},{"term":" Return ","explanation":"Repeated definition."},{"term":"`return`","explanation":"Repeated again."}],
       "example":{"code":"int price = doubleIt(3); // 6","explanation":"Three doubled is six."},"predictions":[],"checks":[]}}
      """);
    check(evaluate("document.querySelectorAll('#explanation img').length").getAsInt() == 0, "Model content remains text");
    check(evaluate("document.getElementById('explanation').textContent").getAsString().contains("<img"), "Hostile markup displayed literally");
    check(evaluate("document.getElementById('explanation').textContent").getAsString().contains("270 tokens (200 input + 70 output)"), "Provider usage reaches the native IntelliJ panel");
    check(evaluate("document.getElementById('explanation').textContent").getAsString().contains("uses local code facts"), "Correction notices reach the native IntelliJ panel");
    check(!evaluate("document.getElementById('explanation').textContent").getAsString().contains("How the parts work together"), "No repeated connections section");
    check(evaluate("document.getElementById('explanation').textContent").getAsString().contains("Returning 6 does not itself print"), "Output explanation reaches the native panel");
    check(!evaluate("document.getElementById('explanation').textContent").getAsString().contains("Details that matter"), "No repeated pitfalls section");
    check(evaluate("document.querySelector('.lesson-note').textContent").getAsString().contains("Returning a value does not display it"), "Single important detail reaches native panel");
    check(!evaluate("document.querySelector('.lesson-terms').open").getAsBoolean(), "Definitions start collapsed");
    check(evaluate("document.querySelectorAll('.lesson-terms > details').length").getAsInt() == 1, "Repeated terms in cached native lessons render only once");
    check(!evaluate("document.querySelector('.lesson-practice').open").getAsBoolean(), "Practice starts collapsed");
    evaluate("(document.querySelector('.lesson-practice').open = true, true)");
    awaitText(".lesson-practice .line-number", "1");
    awaitBoolean("document.querySelectorAll('.lesson-practice code [class^=wdm-block-]').length > 1");
    evaluate("(document.querySelector('.lesson-practice').open = false, true)");
    evaluate("(document.querySelector('[data-tab=impact]').click(), true)");
    awaitText("#draft-lines > span:first-child", "2");
    evaluate("(document.querySelector('#draft-lines button').click(), true)");
    check(expectMessage("openSourceLine").get("line").getAsInt() == 2, "Draft gutter navigates to the original numbered line");
    send("{\"type\":\"preview\",\"errors\":[],\"syntaxChecked\":false}");
    check(evaluate("document.getElementById('apply').disabled").getAsBoolean(), "Unsupported syntax checker blocks Apply");
    send("{\"type\":\"preview\",\"errors\":[],\"syntaxChecked\":true,\"replacement\":\"int doubleIt(int value) { return value * 2; }\"}");
    check(!evaluate("document.getElementById('apply').disabled").getAsBoolean(), "Valid preview enables Apply");
    evaluate("(document.getElementById('replacement').value='int changed = 42;', document.getElementById('replacement').dispatchEvent(new Event('input')), true)");
    check(evaluate("document.getElementById('apply').disabled").getAsBoolean(), "Changing replacement invalidates Apply");
    ApplicationManager.getApplication().invokeAndWait(() -> frame.setSize(380, 900));
    check(evaluate("document.documentElement.scrollWidth <= window.innerWidth").getAsBoolean(), "Narrow panel has no horizontal overflow");
    ApplicationManager.getApplication().invokeAndWait(() -> frame.setSize(640, 980));
    evaluate("(document.querySelector('[data-tab=understand]').click(), window.scrollTo(0,0), true)");
    checkHistory();
    checkWebResources();
    checkThemes();
    checkLineNumbers();
    check(layoutErrors.isEmpty(), "Gutter layout does not cause ResizeObserver loops in older JCEF");
    System.out.println("PASS: native JCEF ready handshake, Java language label, text rendering, UI requests, edit gating, and narrow layout.");
    if (Boolean.getBoolean("watdatmean.test.hold")) {
      System.out.println("Panel ready for visual inspection. Close the test window to finish (three-minute limit).");
      closed.await(3, TimeUnit.MINUTES);
    }
  }
  private void checkHistory() throws Exception {
    send("""
      {"type":"history","version":1,"enabled":true,"entries":[{"id":"sample","file":"Saved.java","line":8,"code":"int saved = 2;","language":"Java","mode":"standalone","audience":"beginner","updatedAt":1790000000000,
        "results":{"explain":{"provider":"fixture","model":"test","mode":"standalone","audience":"beginner","lesson":{"title":"Saved count","summary":"An earlier explanation.","steps":[],"concepts":[],"example":{"code":"","explanation":""},"predictions":[],"checks":[]}}}}]}
      """);
    evaluate("(document.getElementById('history-toggle').click(), true)");
    expectMessage("historyList");
    check(evaluate("document.querySelectorAll('.history-entry').length").getAsInt() == 1, "Native history shows saved entries");
    evaluate("(document.querySelector('.history-entry').click(), true)");
    check(evaluate("document.querySelector('.history-source code').textContent").getAsString().equals("int saved = 2;"), "Native history preserves exact saved input");
    awaitText(".history-source .line-number", "8");
    awaitBoolean("document.querySelectorAll('.history-source code [class^=wdm-block-]').length > 1");
    check(evaluate("document.getElementById('history-detail').textContent").getAsString().contains("0 new tokens"), "Reading history is local");
    check(evaluate("document.getElementById('learning-panel').hidden").getAsBoolean(), "Current lesson is retained separately");
    evaluate("(document.getElementById('history-close').click(), true)");
    check(evaluate("document.getElementById('replacement').value").getAsString().equals("int changed = 42;"), "Draft survives history review");
    check(messages.isEmpty(), "History review sends no AI or edit request");
    System.out.println("PASS: native JCEF history browser, saved code, and draft preservation without AI");
  }
  private void checkWebResources() throws Exception {
    check(!evaluate("document.getElementById('web-research').checked").getAsBoolean(), "Web resources start off in native JCEF");
    evaluate("(document.getElementById('web-research').click(), true)");
    check(expectMessage("researchToggle").get("enabled").getAsBoolean(), "Native switch explicitly enables research");
    evaluate("(document.getElementById('web-version').value='Java 17', document.getElementById('web-filter').value='docs', true)");
    evaluate("(document.getElementById('web-topic').value='Java loops', document.getElementById('web-topic').dispatchEvent(new Event('input')), document.getElementById('web-find').click(), true)");
    var request = expectMessage("research");
    check(request.get("topic").getAsString().equals("Java loops") && !request.has("code"), "Only the public topic is requested for native web research");
    check(request.getAsJsonObject("options").get("version").getAsString().equals("Java 17") && request.getAsJsonObject("options").get("filter").getAsString().equals("docs"), "Native search includes explicit version and resource filter");
    send("""
      {"type":"research","result":{"topic":"Java loops","provider":"groq","model":"openai/gpt-oss-20b","checkedAt":1790000000000,"searches":1,"cached":false,"usage":{"input":200,"output":100,"total":300},"blocks":[{"text":"Loops visit each item. <img src=x>","sourceUrls":["https://docs.oracle.com/javase/"]}],"sources":[{"title":"Java docs","url":"https://docs.oracle.com/javase/","kind":"Documentation"}]}}
      """);
    check(evaluate("document.querySelectorAll('#web-result img').length").getAsInt() == 0, "Native web content stays text");
    check(evaluate("document.getElementById('web-result').textContent").getAsString().contains("300 tokens"), "Native web usage is separate from the explanation");
    evaluate("(document.querySelector('#web-result details').open=true, document.querySelector('#web-result a').click(), true)");
    check(expectMessage("openWebSource").get("url").getAsString().equals("https://docs.oracle.com/javase/"), "Native source links go through the host");
    evaluate("(document.querySelector('.bookmark-save').click(), true)");
    check(expectMessage("bookmarkAdd").get("url").getAsString().equals("https://docs.oracle.com/javase/"), "Save bookmark uses only the known source URL");
    send("""
      {"type":"research","result":{"topic":"Java loops","provider":"groq","model":"openai/gpt-oss-120b","checkedAt":1790000000000,"searches":1,"cached":false,"usage":{"input":200,"output":100,"total":300},"options":{"version":"Java 17","filter":"docs"},"summaryUnavailable":"incomplete","blocks":[],"sources":[{"title":"Java docs","url":"https://docs.oracle.com/javase/","kind":"Documentation"}]}}
      """);
    check(evaluate("document.querySelector('#web-result details').open").getAsBoolean(), "Recovered sources open without another click");
    check(evaluate("document.querySelector('.web-summary-notice').textContent").getAsString().contains("No additional AI request"), "Native recovery explains the missing summary");
    check(evaluate("document.querySelectorAll('#web-result .web-text').length").getAsInt() == 0, "No incomplete summary is displayed");
    check(evaluate("document.getElementById('web-result').textContent").getAsString().contains("300 tokens"), "Native recovery retains actual token usage");
    evaluate("(document.querySelector('.web-source-list a').click(), true)");
    check(expectMessage("openWebSource").get("url").getAsString().equals("https://docs.oracle.com/javase/"), "Recovered native source remains usable");
    evaluate("(document.querySelector('.bookmark-save').click(), true)");
    check(expectMessage("bookmarkAdd").get("url").getAsString().equals("https://docs.oracle.com/javase/"), "Recovered native source remains bookmarkable");
    send("""
      {"type":"bookmarks","version":1,"entries":[{"url":"https://docs.oracle.com/javase/","title":"Java docs","kind":"Documentation","topic":"Java loops","version":"Java 17","savedAt":1,"checkedAt":1}]}
      """);
    evaluate("(document.getElementById('bookmarks-toggle').click(), true)"); expectMessage("bookmarkList");
    check(evaluate("document.getElementById('bookmarks-list').textContent").getAsString().contains("Java 17"), "Native bookmark browser shows saved version");
    send("{\"type\":\"bookmarkError\",\"message\":\"Bookmarks could not be saved.\"}");
    check(!evaluate("document.getElementById('bookmark-feedback').hidden").getAsBoolean(), "Native bookmark failures stay visible outside the learning view");
    evaluate("(document.getElementById('bookmarks-filter').value='videos', document.getElementById('bookmarks-filter').dispatchEvent(new Event('change')), true)");
    check(evaluate("document.querySelectorAll('#bookmarks-list li').length").getAsInt() == 0, "Bookmark filtering is local");
    evaluate("(document.getElementById('bookmarks-close').click(), true)");
    evaluate("(document.getElementById('web-filter').value='videos', document.getElementById('web-filter').dispatchEvent(new Event('change')), true)");
    check(evaluate("document.querySelectorAll('.web-source-list .web-source').length").getAsInt() == 0, "Native resource type filters existing sources locally");
    evaluate("(document.getElementById('web-research').click(), true)");
    check(!expectMessage("researchToggle").get("enabled").getAsBoolean(), "Native switch turns web research off");
    check(evaluate("document.getElementById('web-result').children.length").getAsInt() == 0, "Turning off hides the optional supplement");
    check(evaluate("document.getElementById('replacement').value").getAsString().equals("int changed = 42;"), "Web research preserves the current draft");
    check(messages.isEmpty(), "Native web rendering does not trigger extra AI requests");
    System.out.println("PASS: native JCEF web switch, public topic, provider source rendering, usage, external-link dispatch and preserved draft");
    System.out.println("PASS: native JCEF version target, resource filters and bookmark save/review without additional AI");
  }
  private void checkThemes() throws Exception {
    var colors = EditorColorsManager.getInstance();
    var original = colors.getGlobalScheme();
    var laf = LafManager.getInstance();
    Object originalLaf = HoverSmoke.theme(laf, null);
    evaluate("(window.wdmThemeSentinel = {}, window.wdmThemeDocument = document, true)");
    try {
      for (boolean dark : new boolean[]{false, true}) {
        String[] expected = new String[7];
        ApplicationManager.getApplication().invokeAndWait(() -> {
          HoverSmoke.setTheme(laf, HoverSmoke.theme(laf, dark));
          var scheme = (EditorColorsScheme) colors.getScheme(dark ? "Darcula" : "Default").clone();
          scheme.setEditorFontName("Monospaced"); scheme.setEditorFontSize(dark ? 17 : 15);
          scheme.setColor(EditorColors.LINE_NUMBERS_COLOR, new java.awt.Color(dark ? 0x8899AA : 0x445566));
          scheme.setColor(EditorColors.LINE_NUMBER_ON_CARET_ROW_COLOR, new java.awt.Color(dark ? 0xCCDDEE : 0x112233));
          scheme.setColor(EditorColors.GUTTER_BACKGROUND, new java.awt.Color(dark ? 0x223344 : 0xDDEEFF));
          colors.setGlobalScheme(scheme);
          expected[0] = "rgb(27, 40, 56)";
          expected[1] = "rgb(220, 231, 241)";
          expected[2] = rgb(scheme.getDefaultBackground());
          String code="int n = 1;";
          var file=new com.intellij.testFramework.LightVirtualFile("Demo.java",com.intellij.openapi.fileTypes.FileTypeManager.getInstance().getFileTypeByExtension("java"),code);
          var tokens=CodeColors.highlight(com.intellij.openapi.project.ProjectManager.getInstance().getDefaultProject(),file,code,0,code.length());
          expected[3]=rgb(java.awt.Color.decode(CodeColorsSmoke.colorAt(tokens,0)));
          expected[4]=rgb(scheme.getColor(EditorColors.LINE_NUMBERS_COLOR));
          expected[5]=rgb(scheme.getColor(EditorColors.LINE_NUMBER_ON_CARET_ROW_COLOR));
          expected[6]=rgb(scheme.getColor(EditorColors.GUTTER_BACKGROUND));
        });
        awaitStyle("document.body", "backgroundColor", expected[0]);
        check(evaluate("getComputedStyle(document.body).color").getAsString().equals(expected[1]), "Steam-style chrome keeps its readable foreground");
        awaitStyle("document.getElementById('source').closest('pre')", "backgroundColor", expected[2]);
        awaitStyle("document.getElementById('source')", "fontSize", dark ? "17px" : "15px");
        check(evaluate("getComputedStyle(document.getElementById('source')).fontFamily.toLowerCase().includes('monospaced')").getAsBoolean(), "Code follows the editor font");
        check(evaluate("getComputedStyle(document.documentElement).colorScheme").getAsString().equals("dark"), "Panel chrome remains dark while code follows the native scheme");
        check(evaluate("document === window.wdmThemeDocument && !!window.wdmThemeSentinel").getAsBoolean(), "Theme changes do not reload the document");
        check(evaluate("document.getElementById('replacement').value").getAsString().equals("int changed = 42;"), "Draft survives theme changes");
        awaitStyle("document.querySelector('#source [class^=wdm-source-]')","color",expected[3]);
        awaitStyle("document.querySelector('#parts [class^=wdm-source-]')","color",expected[3]);
        awaitStyle("document.querySelector('#draft-colors [class^=wdm-draft-]')","color",expected[3]);
        awaitStyle("document.getElementById('source-lines')", "color", expected[4]);
        awaitStyle("document.querySelector('#parts-lines .active')", "color", expected[5]);
        awaitStyle("document.getElementById('draft-lines').parentElement", "backgroundColor", expected[6]);
        check(evaluate("document.getElementById('explanation').textContent").getAsString().contains("270 tokens"), "Lesson survives theme changes");
        check(evaluate("document.querySelector('.tab.active').dataset.tab").getAsString().equals("understand"), "Selected tab survives theme changes");
        check(messages.isEmpty(), "Theme changes make no AI requests");
        // Windowed JCEF cannot take browser screenshots. Export its rendered DOM/CSS for visual checks.
        String snapshot = evaluate("(() => {const view=document.documentElement.cloneNode(true);view.querySelectorAll('script,meta[http-equiv]').forEach(n=>n.remove());return '<!DOCTYPE html>'+view.outerHTML;})()").getAsString();
        var path = java.nio.file.Path.of(System.getProperty("watdatmean.test.result")).resolveSibling("panel-" + (dark ? "dark" : "light") + ".html");
        java.nio.file.Files.writeString(path, snapshot);
      }
      // Changing the editor scheme independently must keep the tool window palette intact.
      String panelBackground = evaluate("getComputedStyle(document.body).backgroundColor").getAsString();
      ApplicationManager.getApplication().invokeAndWait(() -> colors.setGlobalScheme(colors.getScheme("Default")));
      awaitStyle("document.getElementById('source').closest('pre')", "backgroundColor", rgb(colors.getScheme("Default").getDefaultBackground()));
      check(evaluate("getComputedStyle(document.body).backgroundColor").getAsString().equals(panelBackground), "Editor colors do not replace the IDE tool window theme");
      System.out.println("PASS: initial and live panel themes, editor colors/fonts, preserved lesson/draft/tab, no reload or AI, and light/dark panel snapshots");
    } finally {
      ApplicationManager.getApplication().invokeAndWait(() -> { HoverSmoke.setTheme(laf, originalLaf); colors.setGlobalScheme(original); });
    }
  }
  private void awaitStyle(String element, String property, String expected) throws Exception {
    for (int attempt = 0; attempt < 40; attempt++) {
      if (evaluate("getComputedStyle(" + element + ")." + property).getAsString().equals(expected)) return;
      Thread.sleep(50);
    }
    throw new AssertionError(property + " did not become " + expected + ": " + evaluate("getComputedStyle(" + element + ")." + property));
  }
  private void checkLineNumbers() throws Exception {
    var selected = new JsonObject();
    selected.addProperty("type", "selection"); selected.addProperty("file", "Long.java");
    selected.addProperty("selectionId", 8);
    selected.addProperty("language", "Java"); selected.addProperty("start", 5000); selected.addProperty("line", 35);
    String code = java.util.stream.IntStream.range(0, 300).mapToObj(i -> "int n" + i + " = " + i + ";").collect(java.util.stream.Collectors.joining("\n"));
    selected.addProperty("code", code);
    selected.add("parts", JsonParser.parseString("[{\"start\":5000,\"end\":5003,\"token\":\"int\",\"brief\":\"Integer type\",\"detail\":\"A local definition.\"}]"));
    send(selected.toString());
    for (String id : new String[]{"source", "parts"}) {
      awaitText("#" + id + "-lines > span:first-child", "35");
      evaluate("(() => {const e=document.getElementById('" + id + "-scroll');e.scrollTop=e.scrollHeight;return true;})()");
      awaitText("#" + id + "-lines > span:last-child", "334");
      check(evaluate("document.querySelectorAll('#" + id + "-lines > span').length < 40").getAsBoolean(), "Only visible line numbers are rendered in older JCEF");
      check(evaluate("document.getElementById('" + id + "').textContent").getAsString().equals(code), "Line numbers preserve the complete selected source");
    }
    evaluate("(document.querySelector('[data-tab=impact]').click(), true)");
    awaitText("#draft-lines > span:first-child", "35");
    evaluate("(() => {const e=document.getElementById('replacement');e.value='int n = 1;\\n\\nint m = 2;\\n';e.dispatchEvent(new Event('input'));return true;})()");
    awaitText("#draft-lines > span:last-child", "38");
    check(messages.isEmpty(), "Line numbering and draft edits make no AI requests");
    System.out.println("PASS: native JCEF source/parts/draft file-line gutters, whole-selection scrolling, blank/trailing draft lines, and local-only rendering");
  }
  void checkLiveResources(JsonObject result, ResourceBookmarks store) throws Exception {
    messages.clear();
    send("{\"type\":\"config\",\"provider\":\"groq\",\"model\":\"test-model\",\"audience\":\"beginner\",\"hasKey\":true,\"webResearch\":true}");
    evaluate("(document.querySelector('[data-tab=understand]').click(), true)");
    var message = new JsonObject(); message.addProperty("type", "research"); message.add("result", result); send(message.toString());
    check(evaluate("document.getElementById('web-result').textContent").getAsString().contains(result.getAsJsonObject("options").get("version").getAsString()), "Real target appears in JCEF");
    String[] filters = {"all", "docs", "videos", "code", "books"};
    String[] kinds = {"", "Documentation", "Video", "Source code", "Book / PDF"};
    for (int i = 0; i < filters.length; i++) {
      int count = 0;
      for (var source : result.getAsJsonArray("sources")) if (i == 0 || kinds[i].equals(source.getAsJsonObject().get("kind").getAsString())) count++;
      evaluate("(document.getElementById('web-filter').value='" + filters[i] + "', document.getElementById('web-filter').dispatchEvent(new Event('change')), true)");
      check(evaluate("document.querySelectorAll('.web-source-list .web-source').length").getAsInt() == count, "Real resource filter " + filters[i]);
    }
    evaluate("(document.getElementById('web-filter').value='all', document.getElementById('web-filter').dispatchEvent(new Event('change')), document.querySelector('.bookmark-save').click(), true)");
    var request = expectMessage("bookmarkAdd");
    var source = result.getAsJsonArray("sources").get(0).getAsJsonObject();
    check(request.get("url").equals(source.get("url")), "JCEF saves the actual retrieved URL");
    store.add(source, result); var state = store.snapshot(); state.addProperty("type", "bookmarks"); send(state.toString());
    evaluate("(document.getElementById('bookmarks-toggle').click(), true)"); expectMessage("bookmarkList");
    evaluate("(document.getElementById('bookmarks-filter').value='all', document.getElementById('bookmarks-filter').dispatchEvent(new Event('change')), true)");
    check(evaluate("document.getElementById('bookmarks-list').textContent").getAsString().contains(source.get("title").getAsString()), "Saved real source shown in native bookmark browser");
    check(messages.isEmpty(), "Filtering and saving do not request AI");
    evaluate("(document.getElementById('bookmarks-close').click(), true)");
    store.remove(source.get("url").getAsString());
    var cleared = store.snapshot(); cleared.addProperty("type", "bookmarks"); send(cleared.toString());
    System.out.println("PASS: real Groq resources in native JCEF, target, all filters, and saved source");
  }
  private void awaitBoolean(String expression) throws Exception {
    for (int attempt = 0; attempt < 60; attempt++) {
      if (evaluate(expression).getAsBoolean()) return;
      Thread.sleep(50);
    }
    throw new AssertionError(expression);
  }
  private void awaitText(String selector, String expected) throws Exception {
    for (int attempt = 0; attempt < 40; attempt++) {
      if (evaluate("document.querySelector('" + selector + "')?.textContent || ''").getAsString().equals(expected)) return;
      Thread.sleep(50);
    }
    throw new AssertionError(selector + " did not become " + expected);
  }
  private static String rgb(java.awt.Color color) { return "rgb(" + color.getRed() + ", " + color.getGreen() + ", " + color.getBlue() + ")"; }
  private void receive(JsonObject message) {
    if (!"highlight".equals(message.get("type").getAsString())) { messages.add(message); return; }
    com.intellij.util.concurrency.AppExecutorUtil.getAppExecutorService().execute(() -> {
      String code=message.get("code").getAsString();
      var file=new com.intellij.testFramework.LightVirtualFile("Demo.java",com.intellij.openapi.fileTypes.FileTypeManager.getInstance().getFileTypeByExtension("java"),code);
      var project=com.intellij.openapi.project.ProjectManager.getInstance().getDefaultProject();
      var result=message.get("target").getAsString().startsWith("block-")
        ? CodeColors.snippet(project,message.get("language").getAsString(),code)
        : CodeColors.highlight(project,file,code,0,code.length());
      result.add("id",message.get("id"));result.add("target",message.get("target"));result.add("code",message.get("code"));result.addProperty("type","highlight");
      send(result.toString());
    });
  }
  private void awaitColoredSource() throws Exception {
    for(int i=0;i<60;i++) {
      if(evaluate("document.querySelectorAll('#source [class^=wdm-source-]').length > 2 && document.querySelectorAll('#parts [class^=wdm-source-]').length > 2 && document.querySelectorAll('#draft-colors [class^=wdm-draft-]').length > 2").getAsBoolean())return;
      Thread.sleep(50);
    }
    throw new AssertionError("Native colors did not reach all three JCEF code surfaces");
  }
  private void send(String json) {
    var message = JsonParser.parseString(json).getAsJsonObject();
    ApplicationManager.getApplication().invokeAndWait(() -> panel.send(message));
  }
  private JsonElement evaluate(String script) throws InterruptedException {
    ApplicationManager.getApplication().invokeAndWait(() -> browser.getCefBrowser().executeJavaScript(
      "(function(){let result;try{result=(" + script + ");}catch(e){result={error:String(e)};}"
        + probe.inject("JSON.stringify(result)") + "})();", "http://watdatmean.local/", 0));
    JsonElement result = probes.poll(20, TimeUnit.SECONDS);
    if (result == null) throw new AssertionError("JCEF did not answer a DOM probe");
    if (result.isJsonObject() && result.getAsJsonObject().has("error")) throw new AssertionError(result.toString());
    return result;
  }
  private JsonObject expectMessage(String type) throws InterruptedException {
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30);
    while (System.nanoTime() < deadline) {
      JsonObject message = messages.poll(Math.max(1, deadline - System.nanoTime()), TimeUnit.NANOSECONDS);
      if (message != null && message.has("type") && message.get("type").getAsString().equals(type)) return message;
    }
    throw new AssertionError("JCEF did not send " + type);
  }
  private static void check(boolean condition, String label) { if (!condition) throw new AssertionError(label); }
  @Override public void close() {
    ApplicationManager.getApplication().invokeAndWait(() -> {
      if (frame != null) frame.dispose();
      Disposer.dispose(lifetime);
    });
  }
}
