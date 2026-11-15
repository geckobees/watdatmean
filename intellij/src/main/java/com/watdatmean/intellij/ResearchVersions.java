package com.watdatmean.intellij;

import com.google.gson.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;

final class ResearchVersions {
  // Same small manifest set as the shared reader. No scripts or build tools run.
  static JsonArray read(String rootPath, String filePath) {
    var result = new JsonArray();
    if (rootPath == null) return result;
    try {
      Path root = Path.of(rootPath).toRealPath(), file = Path.of(filePath).toRealPath();
      if (!file.startsWith(root)) return result;
      Path dir = file.getParent();
      for (int depth = 0; dir != null && dir.startsWith(root) && depth < 10; depth++, dir = dir.getParent()) {
        for (String name : new String[]{"pom.xml", "build.gradle.kts", "build.gradle", "package.json", "pyproject.toml", ".python-version", "go.mod", "Cargo.toml"}) {
          if (result.size() == 32) return result;
          try {
            Path target = dir.resolve(name).toRealPath();
            if (!target.startsWith(root) || !Files.isRegularFile(target) || Files.size(target) > 65536) continue;
            byte[] bytes;
            try (var input = Files.newInputStream(target)) { bytes = input.readNBytes(65537); }
            if (bytes.length > 65536) continue;
            var manifest = new JsonObject(); manifest.addProperty("name", name); manifest.addProperty("text", new String(bytes, StandardCharsets.UTF_8)); result.add(manifest);
          } catch (Exception ignored) { }
        }
        if (dir.equals(root)) break;
      }
    } catch (Exception ignored) { }
    return result;
  }
}
