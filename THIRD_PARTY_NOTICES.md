# Third-party notices

VS Code's local syntax coloring bundles Microsoft's `vscode-textmate`,
`vscode-oniguruma` (including its local WebAssembly regex runtime), and
`jsonc-parser`, under their MIT licenses. Copies are in
`licenses/VSCode-TextMate.txt`, `licenses/VSCode-Oniguruma.txt`, and
`licenses/JSONC-parser.txt`; the regex runtime's additional notices are in
`licenses/Oniguruma-notices.txt`. Language grammars and themes are read from the
user's installed VS Code extensions; they are not redistributed in this bundle.
IntelliJ uses its installed language highlighters instead.

Semantic-theme fallback includes the MIT-licensed TextMate scope matcher from
Microsoft's VS Code 1.95.3. Its source attribution is in
`src/textmate-scope-matcher.ts`, with the license in
`licenses/VSCode-theme-matcher.txt`. Semantic selector precedence and standard
fallback scopes follow VS Code's native theme rules.

The extension bundle includes TypeScript, copyright Microsoft Corporation,
licensed under the Apache License, Version 2.0. The complete license is in
`licenses/TypeScript.txt`.

The bundle also includes the Lezer Python and Java parsers and their common, LR, and highlighting
support packages, copyright Marijn Haverbeke and contributors, under the MIT license.
Their complete licenses are in `licenses/Lezer-python.txt`, `Lezer-java.txt`, `Lezer-common.txt`,
`Lezer-lr.txt`, and `Lezer-highlight.txt`. The parser's source is maintained at
https://code.haverbeke.berlin/lezer/python and https://code.haverbeke.berlin/lezer/java.
Local syntax assistance executes neither a Python interpreter nor Java user code.

Build, test, and packaging tools are development dependencies and are not
included in the VSIX. Their licenses remain in their npm packages.

The development checkout includes the Gradle 8.14.6 Wrapper, copyright Gradle,
licensed under Apache License 2.0. Its license is in
`intellij/gradle/wrapper/LICENSE`. The wrapper and distribution are verified
against the official Gradle SHA-256 checksums. They are not bundled in either
editor's installer.

The IntelliJ plugin bundles the same TypeScript engine and its license. JetBrains
SDK libraries are supplied by the IDE. When automatic Node.js setup is needed,
the official Node.js runtime is downloaded separately; its LICENSE (including
third-party notices) is retained alongside the private executable.

Bounded local web retrieval bundles the MIT-licensed parse5 HTML parser and
entities decoder. Their licenses are in `licenses/Parse5.txt` and
`licenses/Entities.txt`. Search HTML is parsed as data; scripts are never run.
