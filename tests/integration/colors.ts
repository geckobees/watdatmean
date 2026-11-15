import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VSCodeCodeColors } from '../../src/vscode-code-colors';
export async function checkNativeColors(extensionUri: vscode.Uri) {
  const workbench = vscode.workspace.getConfiguration('workbench'),
    editor = vscode.workspace.getConfiguration('editor');
  const themeBefore = workbench.inspect('colorTheme')?.globalValue;
  const tokensBefore = editor.inspect('tokenColorCustomizations')?.globalValue;
  const uiBefore = workbench.inspect('colorCustomizations')?.globalValue;
  const semanticBefore = editor.inspect('semanticTokenColorCustomizations')?.globalValue;
  const semanticEnabledBefore = editor.inspect('semanticHighlighting.enabled')?.globalValue;
  const engine = new VSCodeCodeColors(extensionUri, (message) =>
    console.log('Color check:', message),
  );
  try {
    const initialCode = 'const count: number = 2; // native default theme';
    const initialColors = await engine.colorize(initialCode, 'typescript', 0, initialCode.length);
    assert.ok(
      new Set(initialColors.styles.map((s) => s.color)).size > 1,
      'The active/default theme colors TypeScript before any theme switch',
    );
    const themes = vscode.extensions.all.flatMap((e) => e.packageJSON.contributes?.themes ?? []);
    const choices = ['vs-dark', 'vs', 'hc-black'].map((kind) =>
      themes.find((t) => t.uiTheme === kind),
    );
    assert.ok(choices.every(Boolean), 'Built-in dark, light and high-contrast themes available');
    const cases = [
      ['typescript', 'const label = "Hello"; function add(n: number) { return n + 2; }'],
      ['python', 'def add(n):\n    return n + 2 # hello\nname = "雪"'],
      ['java', 'public class Demo { String name = "hello"; int add(int n) { return n + 2; } }'],
      ['html', '<div class="box">Hello</div>'],
    ];
    const palettes: string[][] = [];
    for (const theme of choices) {
      await workbench.update(
        'colorTheme',
        theme.id ?? theme.label,
        vscode.ConfigurationTarget.Global,
      );
      engine.reset();
      const actualSource = readFileSync(
        vscode.Uri.joinPath(extensionUri, 'src', 'hover-explanation.ts').fsPath,
        'utf8',
      );
      const selectionStart = actualSource.indexOf('const pad =');
      const selectionEnd = actualSource.indexOf('\n', selectionStart);
      const actual = await engine.colorize(
        actualSource,
        'typescript',
        selectionStart,
        selectionEnd,
      );
      assert.ok(
        actual.runs.length > 2,
        `Screenshot selection on line 13 is colored in ${theme.label}`,
      );
      assert.ok(
        new Set(actual.styles.map((s) => s.color)).size > 1,
        `Screenshot selection has distinct native TypeScript colors in ${theme.label}`,
      );
      for (const [language, source] of cases) {
        const result = await engine.colorize(source, language, 0, source.length);
        assert.ok(
          result.runs.length > 2,
          `${language}: real installed grammar produced colored ranges for ${theme.label}: ${JSON.stringify(result)}`,
        );
        assert.ok(
          new Set(result.styles.map((s) => s.color)).size > 1,
          `${language}: native theme has distinct syntax colors`,
        );
        if (language === 'typescript') palettes.push(result.styles.map((s) => s.color));
      }
    }
    assert.notDeepEqual(palettes[0], palettes[1], 'Dark and light syntax colors differ');
    const theme = choices[0];
    await workbench.update(
      'colorTheme',
      theme.id ?? theme.label,
      vscode.ConfigurationTarget.Global,
    );
    await editor.update(
      'tokenColorCustomizations',
      { [`[${theme.id ?? theme.label}]`]: { keywords: '#123456' } },
      vscode.ConfigurationTarget.Global,
    );
    engine.reset();
    const text = 'const answer = 42;';
    const custom = await engine.colorize(text, 'typescript', 0, text.length);
    assert.equal(
      custom.styles[custom.runs[0][2]].color,
      '#123456',
      'Native user keyword override is applied',
    );
    await workbench.update(
      'colorCustomizations',
      { [`[${theme.id ?? theme.label}]`]: { 'editor.foreground': '#2468aa' } },
      vscode.ConfigurationTarget.Global,
    );
    engine.reset();
    const foreground = await engine.colorize('   ', 'typescript', 0, 3);
    assert.equal(
      foreground.styles[foreground.runs[0][2]].color,
      '#2468AA',
      'Native foreground override applies to plain code tokens',
    );
    const source = '/* multi\nconst answer = 42;\n*/';
    const start = source.indexOf('const');
    const context = await engine.colorize(source, 'typescript', start, start + 18);
    assert.notEqual(
      context.styles[context.runs[0][2]].color,
      '#123456',
      'Selection keeps multiline comment context',
    );
    console.log(
      'PASS: actual installed VS Code grammars for TypeScript, Python, Java and HTML; dark/light/high-contrast themes, user override and partial-selection context, no AI',
    );
    await vscode.extensions.getExtension('vscode.typescript-language-features')?.activate();
    await editor.update('semanticHighlighting.enabled', true, vscode.ConfigurationTarget.Global);
    await editor.update(
      'semanticTokenColorCustomizations',
      {
        rules: {
          'class:typescript': '#123451',
          'method:typescript': '#123452',
          'variable:typescript': '#123453',
          'parameter:typescript': '#123454',
          'property:typescript': '#123455',
        },
      },
      vscode.ConfigurationTarget.Global,
    );
    const semanticSource =
      'class ColorDemo { field = 1; read(input: number) { return input + this.field; } }\nlet item = new ColorDemo();\nitem.read(2);';
    const doc = await vscode.workspace.openTextDocument({
      language: 'typescript',
      content: semanticSource,
    });
    await vscode.window.showTextDocument(doc);
    engine.reset();
    const lexical = await engine.colorize(semanticSource, 'typescript', 0, semanticSource.length);
    let semantic = lexical;
    // The native TypeScript server starts asynchronously in a clean profile.
    for (let attempt = 0; attempt < 8; attempt++) {
      semantic = await engine.withSemantic(lexical, doc, semanticSource, 0, semanticSource.length);
      if (semantic.styles.some((s) => s.color === '#123453')) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const at = (offset: number) =>
      semantic.styles[semantic.runs.find(([a, b]) => a <= offset && b > offset)![2]].color;
    for (const [name, expected] of [
      ['ColorDemo', '#123451'],
      ['read', '#123452'],
      ['item', '#123453'],
      ['input', '#123454'],
      ['field', '#123455'],
    ]) {
      assert.equal(
        at(semanticSource.indexOf(name)),
        expected,
        `Native TypeScript ${name} declaration color`,
      );
      assert.equal(
        at(semanticSource.lastIndexOf(name)),
        expected,
        `Native TypeScript ${name} reference color`,
      );
    }
    assert.equal(
      await engine.withSemantic(
        lexical,
        doc,
        semanticSource.replace('item', 'editedItem'),
        0,
        semanticSource.length,
      ),
      lexical,
      'Draft never receives old document semantics',
    );
    await editor.update('semanticHighlighting.enabled', false, vscode.ConfigurationTarget.Global);
    assert.equal(
      await engine.withSemantic(lexical, doc, semanticSource, 0, semanticSource.length),
      lexical,
      'Native semantic opt-out respected',
    );
    console.log(
      'PASS: actual TypeScript semantic provider colors class, method, variable, parameter and property declarations/references; overrides, draft guard and semantic opt-out, no AI',
    );
  } finally {
    engine.dispose();
    await workbench.update('colorTheme', themeBefore, vscode.ConfigurationTarget.Global);
    await workbench.update('colorCustomizations', uiBefore, vscode.ConfigurationTarget.Global);
    await editor.update(
      'tokenColorCustomizations',
      tokensBefore,
      vscode.ConfigurationTarget.Global,
    );
    await editor.update(
      'semanticTokenColorCustomizations',
      semanticBefore,
      vscode.ConfigurationTarget.Global,
    );
    await editor.update(
      'semanticHighlighting.enabled',
      semanticEnabledBefore,
      vscode.ConfigurationTarget.Global,
    );
  }
}
