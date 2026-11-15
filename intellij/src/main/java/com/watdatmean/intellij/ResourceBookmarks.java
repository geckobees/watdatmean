package com.watdatmean.intellij;

import com.google.gson.*;
import com.intellij.openapi.application.PathManager;
import com.intellij.openapi.project.Project;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** Explicit local saves, separate from rolling history. Accessed on the serial storage worker. */
final class ResourceBookmarks {
  private final Path file;
  private JsonObject state;
  ResourceBookmarks(Project project) {
    this(Path.of(PathManager.getConfigPath(), "watdatmean", "bookmarks", hash(project.getBasePath() == null ? project.getLocationHash() : project.getBasePath()) + ".json"));
  }
  ResourceBookmarks(Path file) { this.file = file; }
  private static String hash(String text) {
    try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8))); }
    catch (Exception e) { throw new IllegalStateException(e); }
  }
  private static String text(JsonObject o, String key, int max) {
    var v = o.get(key); if (v == null || !v.isJsonPrimitive() || !v.getAsJsonPrimitive().isString()) return "";
    String s = v.getAsString(); return s.substring(0, Math.min(max, s.length()));
  }
  private static JsonObject clean(JsonObject value) {
    String url = text(value, "url", 2049);
    if (!WebSources.publicUrl(url)) return null;
    var result = new JsonObject(); result.addProperty("url", url);
    for (var entry : Map.of("title", 200, "kind", 40, "topic", 200, "version", 120).entrySet())
      result.addProperty(entry.getKey(), text(value, entry.getKey(), entry.getValue()));
    result.addProperty("savedAt", value.get("savedAt").getAsLong());
    result.addProperty("checkedAt", value.get("checkedAt").getAsLong()); return result;
  }
  synchronized JsonObject snapshot() throws Exception {
    if (state == null) {
      var next = new JsonObject(); next.addProperty("version", 1); var entries = new JsonArray(); next.add("entries", entries);
      if (Files.exists(file)) {
        if (Files.size(file) > 1_000_000) throw new IllegalStateException("Bookmarks are too large to read.");
        var raw = JsonParser.parseString(Files.readString(file)).getAsJsonObject();
        if (raw.get("version").getAsInt() != 1) throw new IllegalStateException("Unsupported bookmark format.");
        var seen = new HashSet<String>();
        for (var item : raw.getAsJsonArray("entries")) {
          if (entries.size() == 100) break;
          try { var entry = clean(item.getAsJsonObject()); if (entry != null && seen.add(entry.get("url").getAsString())) entries.add(entry); }
          catch (RuntimeException ignored) { }
        }
      }
      state = next;
    }
    return state.deepCopy();
  }
  private void save(JsonObject next) throws Exception {
    Files.createDirectories(file.getParent()); Path temporary = Files.createTempFile(file.getParent(), "bookmarks-", ".tmp");
    try {
      Files.writeString(temporary, next.toString());
      try { Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE); }
      catch (AtomicMoveNotSupportedException e) { Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING); }
      state = next;
    } finally { Files.deleteIfExists(temporary); }
  }
  synchronized void add(JsonObject source, JsonObject research) throws Exception {
    var next = snapshot(); var entries = next.getAsJsonArray("entries");
    for (var item : entries) if (item.getAsJsonObject().get("url").equals(source.get("url"))) return;
    if (entries.size() >= 100) throw new IllegalStateException("Your 100 bookmarks are full. Remove one before saving another.");
    var entry = source.deepCopy(); entry.addProperty("topic", text(research, "topic", 200));
    entry.addProperty("version", research.has("options") && research.get("options").isJsonObject() ? text(research.getAsJsonObject("options"), "version", 120) : "");
    entry.add("checkedAt", research.get("checkedAt")); entry.addProperty("savedAt", System.currentTimeMillis());
    entry = clean(entry); if (entry == null) throw new IllegalStateException("Invalid bookmark source.");
    var updated = new JsonArray(); updated.add(entry); entries.forEach(updated::add); next.add("entries", updated); save(next);
  }
  synchronized void remove(String url) throws Exception {
    var next = snapshot(); var updated = new JsonArray();
    for (var item : next.getAsJsonArray("entries")) if (!url.equals(item.getAsJsonObject().get("url").getAsString())) updated.add(item);
    next.add("entries", updated); save(next);
  }
}
