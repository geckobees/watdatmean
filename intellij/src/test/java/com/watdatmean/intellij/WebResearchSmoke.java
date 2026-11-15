package com.watdatmean.intellij;

import com.google.gson.*;
import java.nio.file.*;
import java.util.List;
import java.util.concurrent.TimeUnit;

final class WebResearchSmoke {
  static void run(Bridge bridge) throws Exception {
    for (String url : List.of("command:run", "file:///secret", "javascript:alert(1)", "http://127.0.0.1/", "http://[::1]/", "https://user:pw@example.com/", "https://machine.local/x", "https://example.com:8080/x"))
      check(!WebSources.publicUrl(url), "Unsafe browser destination rejected: " + url);
    var sources = new WebSources();
    var research = JsonParser.parseString("""
      {"topic":"Java loops","provider":"groq","model":"fixture","checkedAt":1,"blocks":[],"searches":1,"cached":false,"sources":[{"title":"Docs","url":"https://docs.oracle.com/javase/","kind":"Documentation"}]}
      """).getAsJsonObject();
    check(!sources.allows("https://docs.oracle.com/javase/"), "Unknown links are not opened");
    sources.current(research);
    check(sources.allows("https://docs.oracle.com/javase/"), "Retrieved public sources can open");
    check(!sources.allows("https://invented.example.com/"), "Model-invented URLs cannot open");
    Path directory = Files.createTempDirectory("watdatmean-web-history-test-");
    try {
      var history = new LessonHistory(directory.resolve("history.json"));
      var source = JsonParser.parseString("{\"file\":\"Demo.java\",\"line\":1,\"language\":\"Java\",\"code\":\"int n=2;\",\"mode\":\"standalone\",\"audience\":\"beginner\"}").getAsJsonObject();
      var result = JsonParser.parseString("{\"lesson\":{\"title\":\"A count\",\"summary\":\"Keeps a count.\",\"steps\":[],\"concepts\":[],\"example\":{\"code\":\"\",\"explanation\":\"\"},\"predictions\":[],\"checks\":[]}}").getAsJsonObject();
      history.add(source,"explain",result); history.attachResearch(source,"explain",result.get("lesson"),research);
      var reloaded = new LessonHistory(directory.resolve("history.json"));
      sources.current(new JsonObject()); sources.history(reloaded.snapshot());
      check(sources.allows("https://docs.oracle.com/javase/"), "Stored research sources survive reload");
      history.clear(); history.attachResearch(source,"explain",result.get("lesson"),research);
      check(history.snapshot().getAsJsonArray("entries").isEmpty(), "Late web results do not resurrect cleared history");
      research.add("options", JsonParser.parseString("{\"version\":\"Java 17\",\"filter\":\"docs\"}"));
      var bookmarks = new ResourceBookmarks(directory.resolve("bookmarks.json"));
      var link = research.getAsJsonArray("sources").get(0).getAsJsonObject();
      bookmarks.add(link, research); bookmarks.add(link, research);
      var restored = new ResourceBookmarks(directory.resolve("bookmarks.json"));
      check(restored.snapshot().getAsJsonArray("entries").size() == 1, "Bookmarks persist and deduplicate");
      sources.history(history.snapshot()); sources.bookmarks(restored.snapshot());
      check(sources.allows(link.get("url").getAsString()), "Bookmarks open after history is cleared");
      check(restored.snapshot().toString().contains("Java 17"), "Bookmark retains target version");
      restored.remove(link.get("url").getAsString()); sources.bookmarks(restored.snapshot());
      check(!sources.allows(link.get("url").getAsString()), "Removed bookmark is no longer a known source");
      Files.writeString(directory.resolve("pom.xml"), "<project><properties><maven.compiler.release>17</maven.compiler.release></properties></project>");
      Files.writeString(directory.resolve("Demo.java"), "class Demo {}");
      var hints = new JsonObject(); hints.addProperty("language", "Java"); hints.add("manifests", ResearchVersions.read(directory.toString(), directory.resolve("Demo.java").toString()));
      var detected = bridge.call("researchHints", hints).get(20, TimeUnit.SECONDS).getAsJsonObject();
      check(detected.getAsJsonArray("hints").get(0).getAsJsonObject().get("version").getAsString().equals("Java 17"), "Native manifest read and shared version parser agree");
      for (int i = 0; i < 100; i++) { var item = link.deepCopy(); item.addProperty("url", "https://docs.oracle.com/" + i); restored.add(item, research); }
      try { restored.add(link, research); throw new AssertionError("Full bookmarks must not evict"); }
      catch (IllegalStateException expected) { check(expected.getMessage().startsWith("Your 100"), "Bookmark limit gives a clear message"); }
    } finally {
      try (var files = Files.list(directory)) { for (var path : files.toList()) Files.deleteIfExists(path); }
      Files.deleteIfExists(directory);
    }
    var params = new JsonObject(); params.addProperty("provider","groq"); params.addProperty("key","fixture-key"); params.addProperty("topic","Java loops");
    try { bridge.call("research",params).get(20,TimeUnit.SECONDS); throw new AssertionError("Research must require explicit opt-in"); }
    catch (java.util.concurrent.ExecutionException expected) { check(expected.getCause().getMessage().contains("Turn on web resources"), "Packaged bridge refuses research while off"); }
    System.out.println("PASS: native source URL guards, source provenance, saved web supplements, cleared-history guard and packaged bridge opt-in");
    System.out.println("PASS: native bookmark persistence, duplicates, retained sources after history clear, deletion, limits and shared project-version detection");
  }
  private static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
}
