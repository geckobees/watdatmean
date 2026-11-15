package com.watdatmean.intellij;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.concurrent.TimeUnit;

/** Explicit live test only. Receives the configured credential over a private stdin pipe. */
final class LiveWebSmoke {
  static void run() throws Exception {
    var input = System.in.readNBytes(16385);
    if (input.length > 16384) throw new IllegalArgumentException("Live test input too large");
    var job = JsonParser.parseString(new String(input, StandardCharsets.UTF_8)).getAsJsonObject();
    String key = job.remove("key").getAsString();
    Path report = Path.of(job.remove("report").getAsString());
    var record = new JsonObject(); record.addProperty("editor", "intellij-2022.3");
    record.add("case", job.remove("case"));
    Settings.get().getState().nodePath = System.getProperty("watdatmean.node.path");
    var bridge = new Bridge();
    Path directory = Files.createTempDirectory("watdatmean-live-bookmarks-");
    try {
      var params = new JsonObject(); params.addProperty("provider", "groq"); params.addProperty("key", key);
      params.addProperty("enabled", true); params.addProperty("audience", "beginner");
      params.add("topic", job.get("topic")); var options = new JsonObject();
      options.add("version", job.get("version")); options.add("filter", job.get("filter")); params.add("options", options);
      var result = bridge.call("research", params).get(80, TimeUnit.SECONDS).getAsJsonObject();
      record.add("result", result);
      var budget = result.getAsJsonObject("budget");
      check(budget.get("inputBytes").getAsInt() <= 3500 && budget.get("maxOutputTokens").getAsInt() == 900 && budget.get("aiRequests").getAsInt() == 1, "Native request limits must survive the shared bridge");
      check(result.getAsJsonObject("usage").get("output").getAsInt() <= 900, "Native output stays within its cap");
      String kind = switch (options.get("filter").getAsString()) {
        case "docs" -> "Documentation"; case "books" -> "Book / PDF";
        case "code" -> "Source code"; case "videos" -> "Video"; default -> "";
      };
      boolean match = false;
      for (var item : result.getAsJsonArray("sources"))
        if (kind.isEmpty() || kind.equals(item.getAsJsonObject().get("kind").getAsString())) match = true;
      check(match, "Live lookup must return at least one source matching the requested filter");
      var cached = bridge.call("research", params).get(10, TimeUnit.SECONDS).getAsJsonObject();
      params.remove("key");
      check(cached.get("cached").getAsBoolean(), "Native repeat must reuse the result");
      record.addProperty("cacheHit", true);
      check(result.getAsJsonObject("options").equals(options), "Native target and filter survive bridge");
      var source = result.getAsJsonArray("sources").get(0).getAsJsonObject();
      var store = new ResourceBookmarks(directory.resolve("bookmarks.json"));
      store.add(source, result); store.add(source, result);
      var reloaded = new ResourceBookmarks(directory.resolve("bookmarks.json"));
      check(reloaded.snapshot().getAsJsonArray("entries").size() == 1, "Native save deduplicates");
      check(reloaded.snapshot().getAsJsonArray("entries").get(0).getAsJsonObject().get("version").equals(options.get("version")), "Native saved version survives reload");
      var allowed = new WebSources(); allowed.bookmarks(reloaded.snapshot());
      check(allowed.allows(source.get("url").getAsString()), "Real saved URL can be opened");
      reloaded.remove(source.get("url").getAsString());
      check(reloaded.snapshot().getAsJsonArray("entries").isEmpty(), "Native remove persists");
      record.addProperty("bookmarks", true);
      try (var panel = new PanelSmoke()) {
        panel.run(); panel.checkLiveResources(result, reloaded);
      }
      record.addProperty("nativePanel", true); record.addProperty("status", "complete");
    } catch (Throwable error) {
      record.addProperty("status", "failed");
      record.addProperty("error", String.valueOf(error.getMessage()).replace(key, "[REDACTED]"));
    } finally {
      bridge.dispose(); Files.deleteIfExists(directory.resolve("bookmarks.json")); Files.deleteIfExists(directory);
      Files.writeString(report, new GsonBuilder().setPrettyPrinting().create().toJson(record).replace(key, "[REDACTED]"));
    }
    check("complete".equals(record.get("status").getAsString()), "Native live check failed; see sanitized report");
  }
  private static void check(boolean ok, String message) { if (!ok) throw new AssertionError(message); }
}
