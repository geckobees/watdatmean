package com.watdatmean.intellij;

import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.components.*;
import org.jetbrains.annotations.NotNull;

@Service(Service.Level.APP)
@State(name = "WatDatMean", storages = @Storage("watdatmean.xml"))
public final class Settings implements PersistentStateComponent<Settings.Values> {
  public static final class Values {
    public String provider = "openai";
    public String model = "";
    public String nodePath = "node";
    public boolean autoDownloadNode = true;
    public String audience = "beginner";
  }
  private volatile Values values = new Values();
  public static Settings get() { return ApplicationManager.getApplication().getService(Settings.class); }
  @Override public @NotNull Values getState() { return values; }
  @Override public void loadState(@NotNull Values state) { values = state; }
  public static String defaultModel(String provider) {
    return switch (provider) {
      case "anthropic" -> "claude-haiku-4-5";
      case "groq" -> "openai/gpt-oss-20b";
      default -> "gpt-5.4-mini";
    };
  }
}
