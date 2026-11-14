package com.watdatmean.intellij;

import com.google.gson.*;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.util.Disposer;
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
    send("""
      {"type":"selection","code":"int doubleIt(int value) { return value * 2; }",
       "language":"Java","file":"Demo.java","line":2,"parts":[]}
      """);
    send("""
      {"type":"config","provider":"openai","model":"test-model","audience":"beginner","hasKey":false}
      """);
    check(evaluate("document.getElementById('language').textContent").getAsString().equals("JAVA"), "Java language label rendered");
    check(evaluate("document.getElementById('source').textContent").getAsString().contains("doubleIt"), "Selected code rendered");
    evaluate("(document.getElementById('explain').click(), true)");
    check(expectMessage("request").get("task").getAsString().equals("explain"), "Real JCEF query reaches Java");
    send("""
      {"type":"lesson","task":"explain","provider":"test","model":"fixture","cached":false,
       "lesson":{"title":"Double a value","summary":"For an input of 3, the method returns 6. <img src=x onerror=alert(1)>",
       "steps":["Read value.","Multiply by 2.","Return the result."],
       "concepts":[{"term":"return","explanation":"Sends the computed result back to the caller."}],
       "example":{"code":"int price = doubleIt(3); // 6","explanation":"Three doubled is six."},"predictions":[],"checks":[]}}
      """);
    check(evaluate("document.querySelectorAll('#explanation img').length").getAsInt() == 0, "Model content remains text");
    check(evaluate("document.getElementById('explanation').textContent").getAsString().contains("<img"), "Hostile markup displayed literally");
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
    System.out.println("PASS: native JCEF ready handshake, Java language label, text rendering, UI requests, edit gating, and narrow layout.");
    if (Boolean.getBoolean("watdatmean.test.hold")) {
      System.out.println("Panel ready for visual inspection. Close the test window to finish (three-minute limit).");
      closed.await(3, TimeUnit.MINUTES);
    }
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
