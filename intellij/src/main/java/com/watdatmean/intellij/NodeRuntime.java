package com.watdatmean.intellij;

import com.intellij.openapi.application.PathManager;
import com.intellij.openapi.progress.*;
import com.intellij.util.concurrency.AppExecutorUtil;
import com.intellij.util.io.Decompressor;
import java.io.*;
import java.net.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.regex.Pattern;
import org.jetbrains.annotations.NotNull;

/** Private runtime: no administrator installer, system PATH changes, npm, or project scripts. */
final class NodeRuntime {
  static final String VERSION = "22.23.5";
  private static final Pattern VERSION_PATTERN = Pattern.compile("v?(\\d+)\\.(\\d+)\\.(\\d+)");
  // SHA-256 from https://nodejs.org/dist/v22.23.5/SHASUMS256.txt.
  private static final Map<String, String> HASHES = Map.of(
    "win-x64.zip", "4a191082e9706866830379d577d2cc8a50c776fcd9436a8d061b063ed0d9a0e3",
    "win-arm64.zip", "c1856817f611738c77534efbff8a5a17990593eab24046bc8d2c23a77a160d13",
    "darwin-x64.tar.gz", "c53383238206b9ae4db23c5d8a63645e2e753bec8ab51a49cc81939aa64e9422",
    "darwin-arm64.tar.gz", "e7131995759b61a0170b646010d2ad35a5d37b4cb0d471f3e8317eac6f742f3d",
    "linux-x64.tar.gz", "c54118104acc524633b5abe106bbf44a53126ec8b4e5fa105cb92b5d7de8a1a1",
    "linux-arm64.tar.gz", "8bd3dc69eee8f3f226315a80d7d1d4faccf217a4c8fae500168ac2e38f3bdba3");
  private static final Map<String, CompletableFuture<String>> pending = new HashMap<>();
  private static CompletableFuture<String> installation;

  static boolean supportedVersion(String version) {
    var match = VERSION_PATTERN.matcher(version.trim());
    if (!match.matches()) return false;
    try {
      int major = Integer.parseInt(match.group(1)), minor = Integer.parseInt(match.group(2));
      return major > 22 || major == 22 && minor >= 12;
    } catch (NumberFormatException ignored) { return false; }
  }

  static String platform(String os, String arch) {
    String cpu = switch (arch.toLowerCase(Locale.ROOT)) {
      case "amd64", "x86_64", "x64" -> "x64";
      case "aarch64", "arm64" -> "arm64";
      default -> throw new IllegalStateException("Automatic Node.js setup supports x64 and ARM64. Configure a Node.js 22.12+ executable for this computer.");
    };
    String lower = os.toLowerCase(Locale.ROOT);
    String system = lower.startsWith("windows") ? "win" : lower.startsWith("mac") || lower.equals("darwin") ? "darwin" : lower.equals("linux") ? "linux" : "";
    if (system.isEmpty()) throw new IllegalStateException("Configure a Node.js 22.12+ executable for this operating system.");
    return system + "-" + cpu + (system.equals("win") ? ".zip" : ".tar.gz");
  }

  static synchronized CompletableFuture<String> resolve(String configured, boolean download) {
    String executable = configured == null || configured.isBlank() ? "node" : configured.trim();
    String key = executable + "\n" + download;
    var active = pending.get(key);
    if (active != null) return active;
    var result = CompletableFuture.supplyAsync(() -> {
      if (compatible(executable)) return executable;
      String target = platform(System.getProperty("os.name"), System.getProperty("os.arch"));
      Path binary = binary(installationPath(target), target);
      if (compatible(binary.toString())) return binary.toString();
      if (!download) throw new IllegalStateException("Node.js 22.12+ was not found. Enable automatic setup or select an executable in Tools → WatDatMean: Configure AI Provider / Node.js.");
      return null;
    }, AppExecutorUtil.getAppExecutorService()).thenCompose(found -> found == null ? install() : CompletableFuture.completedFuture(found));
    pending.put(key, result);
    result.whenComplete((value, error) -> { synchronized (NodeRuntime.class) { pending.remove(key, result); } });
    return result;
  }

  static boolean compatible(String executable) {
    Process process = null;
    try {
      var builder = new ProcessBuilder(executable, "--version");
      builder.directory(Path.of(PathManager.getSystemPath()).toFile());
      cleanEnvironment(builder);
      builder.redirectError(ProcessBuilder.Redirect.DISCARD);
      process = builder.start();
      if (!process.waitFor(5, TimeUnit.SECONDS) || process.exitValue() != 0) return false;
      return supportedVersion(new String(process.getInputStream().readNBytes(100), java.nio.charset.StandardCharsets.UTF_8));
    } catch (IOException ignored) { return false; }
    catch (InterruptedException ignored) { Thread.currentThread().interrupt(); return false; }
    finally { if (process != null) process.destroyForcibly(); }
  }

  static void cleanEnvironment(ProcessBuilder builder) {
    builder.environment().keySet().removeIf(key -> key.equalsIgnoreCase("NODE_OPTIONS") || key.equalsIgnoreCase("NODE_PATH"));
  }
  private static Path installationPath(String target) {
    return Path.of(PathManager.getSystemPath(), "watdatmean", "node", VERSION + "-" + target.replace(".tar.gz", "").replace(".zip", ""));
  }
  private static Path binary(Path root, String target) { return root.resolve(target.startsWith("win-") ? "node.exe" : "bin/node"); }

  private static synchronized CompletableFuture<String> install() {
    if (installation != null && !installation.isDone()) return installation;
    var result = new CompletableFuture<String>();
    installation = result;
    new Task.Backgroundable(null, "Setting up Node.js for WatDatMean", true) {
      @Override public void run(@NotNull ProgressIndicator indicator) {
        try { result.complete(download(indicator)); }
        catch (ProcessCanceledException error) { result.completeExceptionally(new IllegalStateException("Node.js setup cancelled. Retry when ready, or configure an existing executable.")); }
        catch (Exception error) { result.completeExceptionally(new IllegalStateException("Node.js setup failed. Check your connection and available disk space, then retry, or configure a Node.js 22.12+ executable.", error)); }
      }
      @Override public void onCancel() { result.completeExceptionally(new IllegalStateException("Node.js setup cancelled.")); }
    }.queue();
    return result;
  }

  private static String download(ProgressIndicator indicator) throws Exception {
    String target = platform(System.getProperty("os.name"), System.getProperty("os.arch"));
    Path destination = installationPath(target);
    if (compatible(binary(destination, target).toString())) return binary(destination, target).toString();
    Files.createDirectories(destination.getParent());
    Path stage = Files.createTempDirectory(destination.getParent(), "setup-");
    try {
      String archiveName = "node-v" + VERSION + "-" + target;
      String prefix = archiveName.replace(".tar.gz", "").replace(".zip", "");
      Path archive = stage.resolve("download");
      var connection = (HttpURLConnection) URI.create("https://nodejs.org/dist/v" + VERSION + "/" + archiveName).toURL().openConnection();
      connection.setInstanceFollowRedirects(false);
      connection.setConnectTimeout(15000); connection.setReadTimeout(15000);
      indicator.setText("Downloading Node.js " + VERSION + " from nodejs.org");
      try {
        if (connection.getResponseCode() != 200) throw new IOException("Unexpected download status");
        long length = connection.getContentLengthLong(), received = 0;
        indicator.setIndeterminate(length <= 0);
        try (var input = connection.getInputStream(); var output = Files.newOutputStream(archive)) {
          byte[] buffer = new byte[65536]; int count;
          while ((count = input.read(buffer)) >= 0) {
            indicator.checkCanceled();
            received += count;
            if (received > 256L * 1024 * 1024) throw new IOException("Download too large");
            output.write(buffer, 0, count);
            if (length > 0) indicator.setFraction(Math.min(1, (double) received / length));
          }
        }
      } finally { connection.disconnect(); }
      indicator.checkCanceled(); indicator.setIndeterminate(true); indicator.setText("Verifying and installing Node.js");
      verifyChecksum(archive, HASHES.get(target));
      Path extracted = stage.resolve("runtime");
      String executable = target.startsWith("win-") ? "node.exe" : "bin/node";
      Decompressor decompressor = target.endsWith(".zip") ? new Decompressor.Zip(archive) : new Decompressor.Tar(archive);
      decompressor.filter(name -> name.equals(prefix + "/" + executable) || name.equals(prefix + "/LICENSE"))
        .removePrefixPath(prefix).extract(extracted);
      Path node = binary(extracted, target);
      if (!target.startsWith("win-") && !node.toFile().setExecutable(true, true)) throw new IOException("Cannot mark runtime executable");
      if (!compatible(node.toString())) throw new IOException("Runtime verification failed");
      indicator.checkCanceled();
      // A failed previous install may leave this version's directory. Never touch other runtimes.
      if (Files.exists(destination)) deleteTree(destination);
      try { Files.move(extracted, destination, StandardCopyOption.ATOMIC_MOVE); }
      catch (AtomicMoveNotSupportedException ignored) { Files.move(extracted, destination); }
      return binary(destination, target).toString();
    } finally { deleteTree(stage); }
  }

  static void verifyChecksum(Path archive, String expected) throws Exception {
    var digest = MessageDigest.getInstance("SHA-256");
    try (var input = Files.newInputStream(archive)) {
      byte[] buffer = new byte[65536]; int count;
      while ((count = input.read(buffer)) >= 0) digest.update(buffer, 0, count);
    }
    if (expected == null || !HexFormat.of().formatHex(digest.digest()).equals(expected)) throw new IOException("Node.js checksum mismatch");
  }
  private static void deleteTree(Path directory) throws IOException {
    if (!Files.exists(directory)) return;
    try (var paths = Files.walk(directory)) {
      for (Path entry : paths.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(entry);
    }
  }
}
