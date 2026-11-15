package com.watdatmean.intellij;

import com.google.gson.*;
import java.nio.file.*;

final class HistorySmoke {
  static void run() throws Exception {
    Path directory = Files.createTempDirectory("watdatmean-history-test-");
    Path file = directory.resolve("project.json");
    try {
      var history = new LessonHistory(file);
      var source = JsonParser.parseString("""
        {"file":"Demo.java","line":8,"code":"int n = 2;","language":"Java","mode":"standalone","audience":"beginner"}
        """).getAsJsonObject();
      var result = JsonParser.parseString("""
        {"provider":"test","model":"fixture","mode":"standalone","audience":"beginner",
         "lesson":{"title":"A count","summary":"Stores the count.","steps":[],"concepts":[],"example":{"code":"","explanation":""},"predictions":[],"checks":[]}}
        """).getAsJsonObject();
      history.add(source, "concept", result);
      check(!Files.exists(file), "Concept exploration does not spam history");
      history.add(source, "explain", result);
      source.addProperty("line", 12);
      history.add(source, "explain", result);
      result.addProperty("replacement", "int n = 9;");
      history.add(source, "impact", result);
      var entries = new LessonHistory(file).snapshot().getAsJsonArray("entries");
      check(entries.size() == 1 && entries.get(0).getAsJsonObject().get("line").getAsInt() == 12, "Duplicate code updates one entry and its source line");
      check(entries.get(0).getAsJsonObject().getAsJsonObject("results").size() == 2, "Different actions are grouped and survive reload");
      history.enable(false);
      source.addProperty("code", "int other = 3;");
      history = new LessonHistory(file);
      history.add(source, "explain", result);
      check(history.snapshot().getAsJsonArray("entries").size() == 1, "Paused history does not save new entries after reload");
      new LessonHistory(file).clear();
      history = new LessonHistory(file);
      check(!history.snapshot().get("enabled").getAsBoolean() && history.snapshot().getAsJsonArray("entries").isEmpty(), "Clear preserves paused state");
      history.enable(true);
      for (int i = 0; i < 35; i++) {
        source.addProperty("code", "int count = " + i + ";");
        history.add(source, "explain", result);
      }
      entries = history.snapshot().getAsJsonArray("entries");
      check(entries.size() == 30 && entries.get(29).getAsJsonObject().get("code").getAsString().equals("int count = 5;"), "Oldest entries expire at the 30 entry bound");
      history.remove(entries.get(0).getAsJsonObject().get("id").getAsString());
      check(new LessonHistory(file).snapshot().getAsJsonArray("entries").size() == 29, "Delete persists");
      result.getAsJsonObject("lesson").addProperty("summary", "語".repeat(50000));
      for (int i = 0; i < 20; i++) {
        source.addProperty("code", "int large = " + i + ";"); history.add(source, "explain", result);
      }
      check(Files.size(file) <= LessonHistory.MAX_BYTES && history.snapshot().getAsJsonArray("entries").size() < 20, "UTF-8 storage stays bounded without truncating lessons");
      result.getAsJsonObject("lesson").addProperty("summary", "語".repeat(90000));
      String before = history.snapshot().toString();
      try { history.add(source, "explain", result); throw new AssertionError("Oversized entry must be rejected"); }
      catch (IllegalStateException expected) { }
      check(history.snapshot().toString().equals(before), "Failed saves leave previous history intact");
      Files.writeString(file, "broken json");
      history = new LessonHistory(file);
      try { history.snapshot(); throw new AssertionError("Corruption must surface"); } catch (JsonParseException expected) { }
      history.clear();
      check(new LessonHistory(file).snapshot().getAsJsonArray("entries").isEmpty(), "Explicit clear recovers unreadable history");
      System.out.println("PASS: native project history persistence, grouping, pause, delete, clear, corruption recovery and UTF-8 bounds");
    } finally {
      try (var files = Files.list(directory)) { for (var path : files.toList()) Files.deleteIfExists(path); }
      Files.deleteIfExists(directory);
    }
  }
  private static void check(boolean condition, String description) { if (!condition) throw new AssertionError(description); }
}
