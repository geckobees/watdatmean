package com.watdatmean.intellij;

import com.google.gson.*;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.editor.colors.EditorColorsManager;
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
  private final CountDownLatch closed = new CountDownLatch(1);
  private final Disposable lifetime = Disposer.newDisposable("WatDatMean panel smoke test");
  private JFrame frame;
  private PanelView panel;
  private JBCefBrowser browser;
  private JBCefJSQuery probe;

  void run() throws Exception {
    ApplicationManager.getApplication().invokeAndWait(() -> {
      if (!JBCefApp.isSupported()) throw new AssertionError("The bundled JCEF runtime must be available");
      panel = new PanelView(lifetime, messages::add);
      try {
        var field = PanelView.class.getDeclaredField("browser");
        field.setAccessible(true);
        browser = (JBCefBrowser) field.get(panel);
      } catch (ReflectiveOperationException error) { throw new AssertionError(error); }
      browser.getJBCefClient().addDisplayHandler(new CefDisplayHandlerAdapter() {
        @Override public boolean onConsoleMessage(CefBrowser cef, CefSettings.LogSeverity severity, String message, String source, int line) {
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
    awaitStyle("document.body", "backgroundColor", rgb(UIUtil.getPanelBackground()));
    var selection = JsonParser.parseString("""
      {"type":"selection","code":"int doubleIt(int value) { return value * 2; }",
       "language":"Java","file":"Demo.java","line":2}
      """).getAsJsonObject();
    ApplicationManager.getApplication().invokeAndWait(() -> {
      var project = com.intellij.openapi.project.ProjectManager.getInstance().getDefaultProject();
      String prefix = "class Demo { ";
      String code = selection.get("code").getAsString();
      var file = com.intellij.psi.PsiFileFactory.getInstance(project).createFileFromText("Demo.java",
        com.intellij.openapi.fileTypes.FileTypeManager.getInstance().getFileTypeByExtension("java"), prefix + code + " }");
      selection.add("parts", JavaParts.inspect(file, prefix.length(), prefix.length() + code.length()));
    });
    send(selection.toString());
    send("""
      {"type":"config","provider":"openai","model":"test-model","audience":"beginner","hasKey":false}
      """);
    check(evaluate("document.getElementById('language').textContent").getAsString().equals("JAVA"), "Java language label rendered");
    check(evaluate("document.getElementById('source').textContent").getAsString().contains("doubleIt"), "Selected code rendered");
    check(!evaluate("document.getElementById('syntax-section').hidden").getAsBoolean(), "Java small pieces are visible");
    evaluate("(Array.from(document.querySelectorAll('#parts button')).find(b => b.textContent === 'int').click(), true)");
    check(evaluate("document.getElementById('part-detail').textContent").getAsString().contains("32-bit"), "Java piece opens its local explanation");
    evaluate("(Array.from(document.querySelectorAll('#parts button')).find(b => b.textContent === 'value').click(), true)");
    check(evaluate("document.getElementById('part-detail').textContent").getAsString().contains("argument from the caller"), "Variable origin is shown inside the existing piece detail");
    check(messages.isEmpty(), "Opening a piece does not request AI or call the host");
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
       "concepts":[{"term":"return","explanation":"Sends the computed result back to the caller."}],
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
    check(!evaluate("document.querySelector('.lesson-practice').open").getAsBoolean(), "Practice starts collapsed");
    evaluate("(document.querySelector('[data-tab=impact]').click(), true)");
    send("{\"type\":\"preview\",\"errors\":[],\"syntaxChecked\":false}");
    check(evaluate("document.getElementById('apply').disabled").getAsBoolean(), "Unsupported syntax checker blocks Apply");
    send("{\"type\":\"preview\",\"errors\":[],\"syntaxChecked\":true,\"replacement\":\"int doubleIt(int value) { return value * 2; }\"}");
    check(!evaluate("document.getElementById('apply').disabled").getAsBoolean(), "Valid preview enables Apply");
    evaluate("(document.getElementById('replacement').value='changed', document.getElementById('replacement').dispatchEvent(new Event('input')), true)");
    check(evaluate("document.getElementById('apply').disabled").getAsBoolean(), "Changing replacement invalidates Apply");
    ApplicationManager.getApplication().invokeAndWait(() -> frame.setSize(380, 900));
    check(evaluate("document.documentElement.scrollWidth <= window.innerWidth").getAsBoolean(), "Narrow panel has no horizontal overflow");
    ApplicationManager.getApplication().invokeAndWait(() -> frame.setSize(640, 980));
    evaluate("(document.querySelector('[data-tab=understand]').click(), window.scrollTo(0,0), true)");
    checkThemes();
    System.out.println("PASS: native JCEF ready handshake, Java language label, text rendering, UI requests, edit gating, and narrow layout.");
    if (Boolean.getBoolean("watdatmean.test.hold")) {
      System.out.println("Panel ready for visual inspection. Close the test window to finish (three-minute limit).");
      closed.await(3, TimeUnit.MINUTES);
    }
  }
  private void checkThemes() throws Exception {
    var colors = EditorColorsManager.getInstance();
    var original = colors.getGlobalScheme();
    var laf = LafManager.getInstance();
    Object originalLaf = HoverSmoke.theme(laf, null);
    evaluate("(window.wdmThemeSentinel = {}, window.wdmThemeDocument = document, true)");
    try {
      for (boolean dark : new boolean[]{false, true}) {
        String[] expected = new String[3];
        ApplicationManager.getApplication().invokeAndWait(() -> {
          HoverSmoke.setTheme(laf, HoverSmoke.theme(laf, dark));
          var scheme = (EditorColorsScheme) colors.getScheme(dark ? "Darcula" : "Default").clone();
          scheme.setEditorFontName("Monospaced"); scheme.setEditorFontSize(dark ? 17 : 15);
          colors.setGlobalScheme(scheme);
          expected[0] = rgb(UIUtil.getPanelBackground());
          expected[1] = rgb(UIUtil.getLabelForeground());
          expected[2] = rgb(scheme.getDefaultBackground());
        });
        awaitStyle("document.body", "backgroundColor", expected[0]);
        check(evaluate("getComputedStyle(document.body).color").getAsString().equals(expected[1]), "Panel foreground follows the IDE theme");
        awaitStyle("document.getElementById('source').closest('pre')", "backgroundColor", expected[2]);
        awaitStyle("document.getElementById('source')", "fontSize", dark ? "17px" : "15px");
        check(evaluate("getComputedStyle(document.getElementById('source')).fontFamily.toLowerCase().includes('monospaced')").getAsBoolean(), "Code follows the editor font");
        check(evaluate("getComputedStyle(document.documentElement).colorScheme").getAsString().equals(dark ? "dark" : "light"), "Native controls follow light/dark mode");
        check(evaluate("document === window.wdmThemeDocument && !!window.wdmThemeSentinel").getAsBoolean(), "Theme changes do not reload the document");
        check(evaluate("document.getElementById('replacement').value").getAsString().equals("changed"), "Draft survives theme changes");
        check(evaluate("document.getElementById('explanation').textContent").getAsString().contains("270 tokens"), "Lesson survives theme changes");
        check(evaluate("document.querySelector('.tab.active').dataset.tab").getAsString().equals("understand"), "Selected tab survives theme changes");
        check(messages.isEmpty(), "Theme changes make no host or AI requests");
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
  private static String rgb(java.awt.Color color) { return "rgb(" + color.getRed() + ", " + color.getGreen() + ", " + color.getBlue() + ")"; }
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
