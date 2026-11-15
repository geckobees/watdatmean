// Checkout setup only; neither installed plugin modifies these settings.
import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser';

const runtimeKeys = ['java.import.gradle.java.home', 'jdk.project.jdkhome'];
const legacyPointer = '${workspaceFolder}/intellij/.gradle/java-home';
const defaults: Record<string, unknown> = {
  'java.configuration.updateBuildConfiguration': 'interactive',
  'java.import.gradle.wrapper.enabled': true,
  'gradle.nestedProjects': ['intellij'],
  'java.import.exclusions': [
    '**/node_modules/**',
    '**/.metadata/**',
    '**/archetype-resources/**',
    '**/META-INF/maven/**',
    '**/work',
    '**/.vscode-test',
    '**/.vscode-dev',
    '**/.gradle',
    '**/intellij/bin',
    '**/intellij/build',
  ],
};

export function configureBuildEditorSettings(text: string, home: string, previousHome?: string) {
  const errors: ParseError[] = [];
  const settings = parse(text || '{}', errors, { allowTrailingComma: true });
  if (errors.length || !settings || typeof settings !== 'object' || Array.isArray(settings))
    throw new Error(
      'Cannot update invalid .vscode/settings.json; existing settings were preserved.',
    );
  let result = text || '{}\n';
  const set = (key: string, value: unknown) => {
    result = applyEdits(
      result,
      modify(result, [key], value, {
        formattingOptions: {
          insertSpaces: true,
          tabSize: 2,
          eol: text.includes('\r\n') ? '\r\n' : '\n',
        },
      }),
    );
  };
  for (const [key, value] of Object.entries(defaults))
    if (!Object.hasOwn(settings, key)) set(key, value);
  for (const key of runtimeKeys) {
    const value = settings[key];
    // Gradle for Java does not expand VS Code variables here. Generate a local path
    // instead. Only migrate our legacy pointer or the previously generated value.
    if (
      !Object.hasOwn(settings, key) ||
      value === legacyPointer ||
      (previousHome && value === previousHome)
    )
      if (value !== home) set(key, home);
  }
  return result;
}
