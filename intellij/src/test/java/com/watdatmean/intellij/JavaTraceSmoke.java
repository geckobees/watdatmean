package com.watdatmean.intellij;

import com.google.gson.JsonObject;
import java.util.concurrent.TimeUnit;

/** Fixed teaching fixture through the packaged engine; no credentials or user code. */
final class JavaTraceSmoke {
  static void run(Bridge bridge) throws Exception {
    String code = """
      public class Womb {
        static class A {
          String s = "A"; int n = 1;
          A() { show(); n += 10; }
          void show() { System.out.print(s + n + " "); }
          static String who() { return "a"; }
        }
        static class B extends A {
          String s = "B"; int n = 2;
          { n *= 3; }
          B() { super(); show(); n += 100; }
          @Override void show() { System.out.print(s + n + super.s + super.n + " "); }
          static String who() { return "b"; }
        }
        public static void main(String[] args) {
          A x = new B(); x.show();
          System.out.println(x.s + x.n + ((B) x).s + ((B) x).n + x.who() + ((A) null).who());
        }
      }
      """;
    var request = new JsonObject();
    request.addProperty("code", code); request.addProperty("language", "Java");
    request.addProperty("task", "explain"); request.addProperty("mode", "standalone");
    request.addProperty("audience", "beginner");
    var params = new JsonObject(); params.add("request", request);
    params.addProperty("provider", "groq"); params.addProperty("model", "qwen/qwen3.8-27b");
    params.addProperty("key", "unused-local-test");
    var lesson = bridge.call("request", params).get(10, TimeUnit.SECONDS).getAsJsonObject().getAsJsonObject("lesson");
    if (!lesson.getAsJsonObject("output").get("text").getAsString().equals("null0A1 B6A11 B106A11 A11B106aa\n")
        || lesson.getAsJsonObject("usage").get("total").getAsInt() != 0
        || !lesson.get("local").getAsBoolean()
        || lesson.getAsJsonArray("steps").size() != 4
        || !lesson.getAsJsonArray("steps").get(3).getAsString().contains("x.s → A.s=\"A\""))
      throw new AssertionError("Native Java trace must preserve field ownership and exact constructor output");
    System.out.println("PASS: native packaged Java constructor/hidden-field trace and full output (zero API tokens)");
    for (String[] fixture : new String[][] {
        {"int n = 2\nSystem.out.println(n);", "int n = 2;\nSystem.out.println(n);", "2\n"},
        {"System.out.println(3;", "System.out.println(3);", "3\n"}
    }) {
      request.addProperty("code", fixture[0]);
      var fixed = bridge.call("request", params).get(10, TimeUnit.SECONDS).getAsJsonObject().getAsJsonObject("lesson");
      if (!fixed.getAsJsonObject("syntax").get("corrected").getAsString().equals(fixture[1])
          || !fixed.getAsJsonObject("output").get("text").getAsString().equals(fixture[2])
          || fixed.getAsJsonObject("usage").get("total").getAsInt() != 0)
        throw new AssertionError("Native Java correction must explain the checked code locally");
    }
    request.addProperty("code", "int n = ;");
    var missing = bridge.call("request", params).get(10, TimeUnit.SECONDS).getAsJsonObject().getAsJsonObject("lesson");
    if (missing.getAsJsonObject("syntax").has("corrected")
        || !missing.getAsJsonObject("syntax").getAsJsonArray("issues").toString().contains("missing a value")
        || missing.getAsJsonObject("usage").get("total").getAsInt() != 0)
      throw new AssertionError("Native Java syntax help must never invent a missing value");
    System.out.println("PASS: native 2022.3 Java syntax warnings, rechecked repairs, corrected explanations, missing-value guard, zero tokens");
    try (var stream = JavaTraceSmoke.class.getResourceAsStream("/java-general-fixtures.json")) {
      if (stream == null) throw new AssertionError("General Java fixtures are required");
      var fixtures = com.google.gson.JsonParser.parseReader(new java.io.InputStreamReader(stream, java.nio.charset.StandardCharsets.UTF_8)).getAsJsonArray();
      for (var element : fixtures) {
        var fixture = element.getAsJsonObject();
        request.addProperty("code", fixture.get("code").getAsString());
        var general = bridge.call("request", params).get(10, TimeUnit.SECONDS).getAsJsonObject().getAsJsonObject("lesson");
        if (!general.getAsJsonObject("output").get("text").getAsString().equals(fixture.get("expected").getAsString())
            || general.getAsJsonObject("usage").get("total").getAsInt() != 0
            || !general.get("local").getAsBoolean())
          throw new AssertionError("General Java trace failed: " + fixture.get("id").getAsString());
      }
      System.out.println("PASS: " + fixtures.size() + " independent general Java examples in packaged native bridge (zero tokens)");
    }
  }
}
