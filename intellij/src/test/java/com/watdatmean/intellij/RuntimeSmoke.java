package com.watdatmean.intellij;

import java.nio.file.*;
import java.util.concurrent.*;

final class RuntimeSmoke {
  static void run() throws Exception {
    for (String version : new String[]{"v22.12.0", "22.23.5", "v24.0.0", "v25.1.2\n"})
      check(NodeRuntime.supportedVersion(version), "Accept " + version);
    for (String version : new String[]{"v22.11.9", "v20.19.0", "v22.12.0-rc.1", "garbage", "v999999999999.1.1"})
      check(!NodeRuntime.supportedVersion(version), "Reject " + version);
    check(NodeRuntime.platform("Windows 11", "amd64").equals("win-x64.zip"), "Windows download");
    check(NodeRuntime.platform("Mac OS X", "aarch64").equals("darwin-arm64.tar.gz"), "Apple Silicon download");
    check(NodeRuntime.platform("Linux", "x86_64").equals("linux-x64.tar.gz"), "Linux download");
    try { NodeRuntime.platform("Linux", "riscv64"); throw new AssertionError("Unsupported architecture accepted"); }
    catch (IllegalStateException expected) { }
    Path tampered = Files.createTempFile(Path.of(System.getProperty("idea.system.path")), "node-hash-test", ".bin");
    try {
      Files.writeString(tampered, "tampered runtime");
      try { NodeRuntime.verifyChecksum(tampered, "0".repeat(64)); throw new AssertionError("Bad checksum accepted"); }
      catch (java.io.IOException expected) { }
    } finally { Files.deleteIfExists(tampered); }
    String installed = System.getProperty("watdatmean.node.path");
    check(NodeRuntime.compatible(installed), "Installed Node version detected");
    check(NodeRuntime.resolve(installed, false).get(10, TimeUnit.SECONDS).equals(installed), "Manual executable works without downloading");
    String missing = Path.of(System.getProperty("idea.system.path"), "missing-node-executable").toString();
    check(!NodeRuntime.compatible(missing), "Missing executable detection");
    if (Boolean.getBoolean("watdatmean.test.download")) {
      String runtime = NodeRuntime.resolve(missing, true).get(4, TimeUnit.MINUTES);
      check(NodeRuntime.compatible(runtime), "Downloaded verified runtime starts");
      check(Path.of(runtime).toAbsolutePath().normalize().startsWith(Path.of(System.getProperty("idea.system.path")).toAbsolutePath().normalize()), "Runtime remains in isolated test profile");
      check(NodeRuntime.resolve(missing, false).get(10, TimeUnit.SECONDS).equals(runtime), "Private runtime reused offline");
      Settings.get().getState().nodePath = runtime;
      System.out.println("PASS: real Node.js download, SHA-256 verification, installation, and reuse.");
    }
    var bridge = new Bridge();
    try {
      var params = new com.google.gson.JsonObject();
      params.addProperty("code", "const score = 1;"); params.addProperty("start", 8); params.addProperty("end", 8);
      var pending = bridge.call("inspect", params);
      bridge.cancel();
      try { pending.get(10, TimeUnit.SECONDS); }
      catch (ExecutionException | CancellationException expected) { }
      check(bridge.call("inspect", params).get(10, TimeUnit.SECONDS).isJsonObject(), "Bridge works after startup cancellation");
    } finally { bridge.dispose(); }
  }
  private static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
}
