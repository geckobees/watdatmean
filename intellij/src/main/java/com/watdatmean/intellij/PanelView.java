package com.watdatmean.intellij;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.util.Disposer;
import com.intellij.ui.jcef.*;
import org.cef.browser.CefBrowser;
import org.cef.browser.CefFrame;
import org.cef.handler.CefRequestHandlerAdapter;
import org.cef.handler.CefLifeSpanHandlerAdapter;
import org.cef.network.CefRequest;
import javax.swing.*;
import java.awt.BorderLayout;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.function.Consumer;

final class PanelView extends JPanel {
  // loadHTML serves its in-memory document through JCEF's file-scheme handler.
  // An explicit, per-panel URL lets navigation stay restricted to exactly that document.
  private final String pageUrl = "file:///watdatmean-" + UUID.randomUUID() + "/panel.html";
  private JBCefBrowser browser;
  PanelView(Disposable parent, Consumer<JsonObject> receive) {
    super(new BorderLayout());
    if (!JBCefApp.isSupported()) {
      add(new JLabel("WatDatMean requires IntelliJ's bundled JetBrains Runtime with JCEF."));
      return;
    }
    browser = new JBCefBrowser();
    Disposer.register(parent, browser);
    var query = JBCefJSQuery.create((JBCefBrowserBase) browser);
    Disposer.register(parent, query);
    query.addHandler(raw -> {
      try { if (raw.length() <= 100000) receive.accept(JsonParser.parseString(raw).getAsJsonObject()); }
      catch (RuntimeException ignored) { /* Ignore invalid UI messages. */ }
      return null;
    });
    browser.getJBCefClient().addRequestHandler(new CefRequestHandlerAdapter() {
      @Override public boolean onBeforeBrowse(CefBrowser cef, CefFrame frame, CefRequest request, boolean gesture, boolean redirect) {
        return !pageUrl.equals(request.getURL());
      }
    }, browser.getCefBrowser());
    browser.getJBCefClient().addLifeSpanHandler(new CefLifeSpanHandlerAdapter() {
      @Override public boolean onBeforePopup(CefBrowser cef, CefFrame frame, String url, String name) { return true; }
    }, browser.getCefBrowser());
    try (var stream = PanelView.class.getResourceAsStream("/web/panel.html")) {
      if (stream == null) throw new IOException("Missing panel");
      String html = new String(stream.readAllBytes(), StandardCharsets.UTF_8);
      String bridge = "let state; window.watdatmeanHost = {getState:()=>state, setState:v=>{state=v;}, postMessage:m=>{"
        + query.inject("JSON.stringify(m)") + "}};";
      html = html.replace("__WDM_NONCE__", UUID.randomUUID().toString()).replace("/*__WDM_BRIDGE__*/", bridge);
      browser.loadHTML(html, pageUrl);
      add(browser.getComponent());
    } catch (IOException error) { add(new JLabel("WatDatMean panel is missing. Reinstall the plugin.")); }
  }
  void send(JsonObject message) {
    if (browser != null && !browser.isDisposed()) browser.getCefBrowser().executeJavaScript(
      "window.dispatchEvent(new MessageEvent('message',{data:" + Bridge.JSON.toJson(message) + "}));",
      pageUrl, 0);
  }
}
