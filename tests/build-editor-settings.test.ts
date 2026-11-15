import { describe, expect, it } from 'vitest';
import { parse } from 'jsonc-parser';
import { configureBuildEditorSettings } from '../src/build-editor-settings';

describe('checkout-local editor Java settings', () => {
  it('generates literal paths for importers that do not expand workspace variables', () => {
    const home = 'C:/A checkout with spaces/intellij/.gradle/java-home';
    const text = configureBuildEditorSettings('', home);
    const result = parse(text);
    expect(result['java.import.gradle.java.home']).toBe(home);
    expect(result['jdk.project.jdkhome']).toBe(home);
    expect(result['java.import.gradle.wrapper.enabled']).toBe(true);
    expect(result['gradle.nestedProjects']).toEqual(['intellij']);
    expect(result['java.import.exclusions']).toContain('**/work');
    expect(text).not.toContain('${workspaceFolder}');
    expect(configureBuildEditorSettings(text, home, home)).toBe(text);
  });
  it('migrates the old pointers while preserving comments and custom settings', () => {
    const text = `{
      // Preserve my editor choices.
      "editor.fontSize": 16,
      "java.import.gradle.java.home": "\${workspaceFolder}/intellij/.gradle/java-home",
      "jdk.project.jdkhome": "\${workspaceFolder}/intellij/.gradle/java-home",
      "java.import.exclusions": ["**/private"],
    }`;
    const result = configureBuildEditorSettings(text, '/checkout/jdk17');
    expect(result).toContain('// Preserve my editor choices.');
    expect(parse(result)).toMatchObject({
      'editor.fontSize': 16,
      'java.import.gradle.java.home': '/checkout/jdk17',
      'jdk.project.jdkhome': '/checkout/jdk17',
      'java.import.exclusions': ['**/private'],
    });
  });
  it('updates generated paths after moving a checkout, preserving explicit overrides', () => {
    const before = JSON.stringify({
      'java.import.gradle.java.home': '/old/jdk',
      'jdk.project.jdkhome': '/my/custom/jdk',
      'jdk.jdkhome': '/server/java25',
    });
    expect(parse(configureBuildEditorSettings(before, '/new/jdk', '/old/jdk'))).toMatchObject({
      'java.import.gradle.java.home': '/new/jdk',
      'jdk.project.jdkhome': '/my/custom/jdk',
      'jdk.jdkhome': '/server/java25',
    });
  });
  it('preserves explicit null, empty and custom runtime choices', () => {
    for (const choice of [null, '', '/custom/jdk']) {
      const before = JSON.stringify({ 'java.import.gradle.java.home': choice });
      expect(
        parse(configureBuildEditorSettings(before, '/managed/jdk'))['java.import.gradle.java.home'],
      ).toBe(choice);
    }
  });
  it.each(['{"broken":', '[]', 'null', '"not settings"'])(
    'rejects malformed settings without overwriting them',
    (text) => {
      expect(() => configureBuildEditorSettings(text, '/jdk')).toThrow('preserved');
    },
  );
});
