package com.watdatmean.intellij;

import com.google.gson.*;
import com.intellij.openapi.Disposable;
import com.intellij.util.concurrency.AppExecutorUtil;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.Map;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;

/** A plugin-owned Node worker over private pipes, never a localhost HTTP server. */
final class Bridge implements Disposable {
  static final Gson JSON = new Gson();
  private final AtomicLong nextId = new AtomicLong();
  private final Map<Long, CompletableFuture<JsonElement>> pending = new ConcurrentHashMap<>();
  private Process process;
  private BufferedWriter writer;
  private Path directory;
  private boolean disposed;
  private long generation;

  synchronized CompletableFuture<JsonElement> call(String method, JsonObject params) {
    if (disposed) return CompletableFuture.failedFuture(new IllegalStateException("The learning engine is closed."));
    long id = nextId.incrementAndGet(), token = generation;
    var future = new CompletableFuture<JsonElement>();
    pending.put(id, future);
    var settings = Settings.get().getState();
    // Resolution/download happens outside this monitor so cancellation and the EDT never wait for it.
    var runtime = process != null && process.isAlive() ? CompletableFuture.completedFuture("")
      : NodeRuntime.resolve(settings.nodePath, settings.autoDownloadNode);
    runtime.whenCompleteAsync((executable, error) -> {
      synchronized (this) {
        if (disposed || token != generation || future.isDone()) return;
        if (error != null) { future.completeExceptionally(error); return; }
        try { start(executable); write(id, method, params); }
        catch (Exception failure) {
          future.completeExceptionally(new IllegalStateException("Could not start the learning engine. Check the Node.js executable in WatDatMean settings.", failure));
          stop();
        }
      }
    }, AppExecutorUtil.getAppExecutorService());
    // Allow first-time runtime setup to complete before the provider's own 60-second timeout.
    return future.orTimeout(5, TimeUnit.MINUTES).whenComplete((result, error) -> pending.remove(id));
  }

  private void write(long id, String method, JsonObject params) throws IOException {
      var message = new JsonObject();
      message.addProperty("id", id);
      message.addProperty("method", method);
      message.add("params", params);
      writer.write(JSON.toJson(message));
      writer.newLine();
      writer.flush();
  }

  synchronized void cancel() {
    generation++;
    pending.values().forEach(future -> future.completeExceptionally(new CancellationException()));
    pending.clear();
    if (process != null && process.isAlive()) {
      try { write(nextId.incrementAndGet(), "cancel", new JsonObject()); }
      catch (IOException ignored) { stop(); }
    }
  }

  private void start(String executable) throws IOException {
    if (disposed) throw new IOException("Disposed");
    if (process != null && process.isAlive()) return;
    directory = Files.createTempDirectory("watdatmean-");
    Path worker = directory.resolve("engine.cjs");
    try (var stream = Bridge.class.getResourceAsStream("/web/engine.cjs")) {
      if (stream == null) throw new IOException("Missing engine");
      Files.copy(stream, worker);
    }
    var builder = new ProcessBuilder(executable, worker.toString());
    builder.directory(directory.toFile());
    // Project Node hooks and environment injection must not run in the trusted bridge.
    NodeRuntime.cleanEnvironment(builder);
    builder.redirectError(ProcessBuilder.Redirect.DISCARD);
    Process started = builder.start();
    process = started;
    writer = new BufferedWriter(new OutputStreamWriter(started.getOutputStream(), StandardCharsets.UTF_8));
    AppExecutorUtil.getAppExecutorService().execute(() -> read(started));
  }

  private void read(Process started) {
    try (var reader = new BufferedReader(new InputStreamReader(started.getInputStream(), StandardCharsets.UTF_8))) {
      String line;
      while ((line = reader.readLine()) != null) {
        var message = JsonParser.parseString(line).getAsJsonObject();
        var future = pending.get(message.get("id").getAsLong());
        if (future == null) continue;
        if (message.has("error")) future.completeExceptionally(new IllegalStateException(message.get("error").getAsString()));
        else future.complete(message.get("result"));
      }
    } catch (Exception ignored) {
      // Never log raw protocol data, source, credentials, or provider responses.
    } finally {
      synchronized (this) {
        if (process == started) stop();
      }
    }
  }

  synchronized void stop() {
    generation++;
    if (process != null) process.destroyForcibly();
    process = null;
    writer = null;
    pending.values().forEach(future -> future.completeExceptionally(new IllegalStateException(
      "The learning engine stopped. Verify Node.js 22.12+ is configured, then retry.")));
    pending.clear();
    if (directory != null) {
      try { Files.deleteIfExists(directory.resolve("engine.cjs")); Files.deleteIfExists(directory); }
      catch (IOException ignored) { /* OS temp cleanup handles an outstanding file lock. */ }
      directory = null;
    }
  }
  @Override public synchronized void dispose() { disposed = true; stop(); }
}
