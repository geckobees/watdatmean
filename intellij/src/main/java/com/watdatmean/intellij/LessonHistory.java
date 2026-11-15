package com.watdatmean.intellij;

import com.google.gson.*;
import com.intellij.openapi.application.PathManager;
import com.intellij.openapi.project.Project;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

/** Local project history, outside the source tree. Accessed on Tutor's serial worker. */
final class LessonHistory {
  static final int LIMIT = 30, MAX_BYTES = 2_000_000, MAX_ENTRY_BYTES = 256_000;
  private static final Set<String> TASKS = Set.of("explain", "walkthrough", "example", "impact");
  private final Path file;
  private JsonObject state;

  LessonHistory(Project project) {
    this(Path.of(PathManager.getConfigPath(), "watdatmean", "history",
      hash(project.getBasePath() == null ? project.getLocationHash() : project.getBasePath()) + ".json"));
  }
  LessonHistory(Path file) { this.file = file; }
  private static String hash(String text) {
    try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8))); }
    catch (Exception error) { throw new IllegalStateException(error); }
  }
  private static JsonObject empty() {
    var value = new JsonObject(); value.addProperty("version", 1); value.addProperty("enabled", true);
    value.add("entries", new JsonArray()); return value;
  }
  private static int bytes(JsonElement value) { return value.toString().getBytes(StandardCharsets.UTF_8).length; }
  synchronized JsonObject snapshot() throws Exception {
    if (state == null) {
      if (!Files.exists(file)) state = empty();
      else {
        if (Files.size(file) > MAX_BYTES) throw new IllegalStateException("History is too large to read.");
        var loaded = JsonParser.parseString(Files.readString(file)).getAsJsonObject();
        if (loaded.get("version").getAsInt() != 1 || !loaded.get("enabled").isJsonPrimitive()
            || !loaded.getAsJsonPrimitive("enabled").isBoolean() || !loaded.get("entries").isJsonArray())
          throw new IllegalStateException("History format is not supported.");
        var entries = new JsonArray(); var ids = new HashSet<String>();
        for (var item : loaded.getAsJsonArray("entries")) {
          if (entries.size() >= LIMIT) break;
          try {
            var entry = item.getAsJsonObject();
            if (bytes(entry) <= MAX_ENTRY_BYTES && entry.get("code").getAsString().length() <= 12000
                && entry.get("results").isJsonObject() && ids.add(entry.get("id").getAsString())) entries.add(entry);
          } catch (RuntimeException ignored) { }
        }
        loaded.add("entries", entries); state = loaded;
      }
    }
    return state.deepCopy();
  }
  private void save(JsonObject next) throws Exception {
    var entries = next.getAsJsonArray("entries");
    while (entries.size() > LIMIT || (bytes(next) > MAX_BYTES && !entries.isEmpty())) entries.remove(entries.size() - 1);
    Files.createDirectories(file.getParent());
    Path temporary = Files.createTempFile(file.getParent(), "history-", ".tmp");
    try {
      Files.writeString(temporary, next.toString());
      try { Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE); }
      catch (AtomicMoveNotSupportedException unsupported) { Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING); }
      state = next;
    } finally { Files.deleteIfExists(temporary); }
  }
  synchronized void add(JsonObject source, String task, JsonObject result) throws Exception {
    if (!TASKS.contains(task)) return;
    var next = snapshot(); if (!next.get("enabled").getAsBoolean()) return;
    String id = hash(source.get("file") + "\n" + source.get("language") + "\n" + source.get("code"));
    var entry = source.deepCopy(); var results = new JsonObject();
    for (var item : next.getAsJsonArray("entries"))
      if (id.equals(item.getAsJsonObject().get("id").getAsString())) results = item.getAsJsonObject().getAsJsonObject("results").deepCopy();
    results.add(task, result.deepCopy()); entry.add("results", results);
    entry.addProperty("id", id); entry.addProperty("updatedAt", System.currentTimeMillis());
    if (bytes(entry) > MAX_ENTRY_BYTES) throw new IllegalStateException("This entry is too large to save.");
    var entries = new JsonArray(); entries.add(entry);
    for (var item : next.getAsJsonArray("entries"))
      if (!id.equals(item.getAsJsonObject().get("id").getAsString())) entries.add(item);
    next.add("entries", entries); save(next);
  }
  synchronized void remove(String id) throws Exception {
    var next = snapshot(); var entries = new JsonArray();
    for (var item : next.getAsJsonArray("entries"))
      if (!id.equals(item.getAsJsonObject().get("id").getAsString())) entries.add(item);
    next.add("entries", entries); save(next);
  }
  synchronized void attachResearch(JsonObject source, String task, JsonElement lesson, JsonObject research) throws Exception {
    var next = snapshot(); if (!next.get("enabled").getAsBoolean()) return;
    String id = hash(source.get("file") + "\n" + source.get("language") + "\n" + source.get("code"));
    for (var item : next.getAsJsonArray("entries")) {
      var entry = item.getAsJsonObject();
      if (!id.equals(entry.get("id").getAsString())) continue;
      var result = entry.getAsJsonObject("results").getAsJsonObject(task);
      if (result == null || !lesson.equals(result.get("lesson"))) return;
      result.add("research", research.deepCopy());
      if (bytes(entry) > MAX_ENTRY_BYTES) throw new IllegalStateException("This entry is too large to save.");
      save(next); return;
    }
  }
  synchronized void clear() throws Exception {
    JsonObject next;
    try { next = snapshot(); } catch (Exception corrupt) { next = empty(); }
    next.add("entries", new JsonArray()); save(next);
  }
  synchronized void enable(boolean enabled) throws Exception {
    var next = snapshot(); next.addProperty("enabled", enabled); save(next);
  }
}
