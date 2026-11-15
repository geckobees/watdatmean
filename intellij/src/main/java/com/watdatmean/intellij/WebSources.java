package com.watdatmean.intellij;

import com.google.gson.*;
import java.net.URI;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/** Sources are opened only on a user's click, through the external browser. */
final class WebSources {
  private final Set<String> live = ConcurrentHashMap.newKeySet(), saved = ConcurrentHashMap.newKeySet(), bookmarks = ConcurrentHashMap.newKeySet();
  static boolean publicUrl(String value) {
    if (value == null || value.length() > 2048 || value.matches(".*[\\s\\\\].*")) return false;
    try {
      URI uri = new URI(value); String host = uri.getHost();
      return ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) && uri.getUserInfo() == null &&
        (uri.getPort() == -1 || ("https".equals(uri.getScheme()) && uri.getPort() == 443) || ("http".equals(uri.getScheme()) && uri.getPort() == 80)) &&
        host != null && host.contains(".") && !host.contains(":") && !host.matches("[0-9.]+") && !host.endsWith(".") &&
        !host.toLowerCase(java.util.Locale.ROOT).matches(".*\\.(localhost|local|internal|lan|home|test|invalid)");
    } catch (Exception invalid) { return false; }
  }
  private static void collect(JsonObject result, Set<String> target) {
    if (result == null || !result.has("sources") || !result.get("sources").isJsonArray()) return;
    for (var item : result.getAsJsonArray("sources")) try {
      String url = item.getAsJsonObject().get("url").getAsString(); if (publicUrl(url)) target.add(url);
    } catch (RuntimeException ignored) { }
  }
  void current(JsonObject result) { live.clear(); collect(result, live); }
  void history(JsonObject history) {
    saved.clear();
    for (var item : history.getAsJsonArray("entries")) try {
      for (var result : item.getAsJsonObject().getAsJsonObject("results").entrySet())
        collect(result.getValue().getAsJsonObject().getAsJsonObject("research"), saved);
    } catch (RuntimeException ignored) { }
  }
  void bookmarks(JsonObject state) {
    bookmarks.clear();
    for (var item : state.getAsJsonArray("entries")) try {
      String url = item.getAsJsonObject().get("url").getAsString(); if (publicUrl(url)) bookmarks.add(url);
    } catch (RuntimeException ignored) { }
  }
  boolean allows(String url) { return publicUrl(url) && (live.contains(url) || saved.contains(url) || bookmarks.contains(url)); }
}
