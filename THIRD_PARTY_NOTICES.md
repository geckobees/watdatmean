# Third-party notices

The extension bundle includes TypeScript, copyright Microsoft Corporation,
licensed under the Apache License, Version 2.0. The complete license is in
`licenses/TypeScript.txt`.

The bundle also includes the Lezer Python parser and its common, LR, and highlighting
support packages, copyright Marijn Haverbeke and contributors, under the MIT license.
Their complete licenses are in `licenses/Lezer-python.txt`, `Lezer-common.txt`,
`Lezer-lr.txt`, and `Lezer-highlight.txt`. The parser's source is maintained at
https://code.haverbeke.berlin/lezer/python. No Python interpreter is bundled or executed.

Build, test, and packaging tools are development dependencies and are not
included in the VSIX. Their licenses remain in their npm packages.

The IntelliJ plugin bundles the same TypeScript engine and its license. JetBrains
SDK libraries are supplied by the IDE. When automatic Node.js setup is needed,
the official Node.js runtime is downloaded separately; its LICENSE (including
third-party notices) is retained alongside the private executable.
