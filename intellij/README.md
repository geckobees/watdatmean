# WatDatMean for IntelliJ IDEA

This plugin brings the existing WatDatMean learning flow to IntelliJ IDEA. It shares
the TypeScript analyzer, provider adapters, validated lesson format, cache, and panel
with the VS Code extension. It does not require VS Code to be installed or running.

## Install and use

1. Use **IntelliJ IDEA 2022.3 through 2025.2.x**, Community or Ultimate, with its bundled JetBrains Runtime and JCEF.
   The plugin is compiled against 2022.3 using Java 17 and tested on Community **2022.3** and **2025.2.4**.
   The descriptor allows builds 223–252; later versions need compatibility verification before widening that range.
   Remote Development is not covered by this release.
2. Node.js **22.12+** is detected automatically. If it is absent or too old, WatDatMean
   downloads a private runtime when the learning engine is first needed. The worker
   runs the same engine as VS Code over private pipes, with no server or listening port.
3. Install `dist/intellij/watdatmean-intellij-0.1.2.zip` through
   **Settings → Plugins → ⚙ → Install Plugin from Disk**, then restart the IDE.
4. Open a text source file. Select code, or place the cursor on a Java declaration or
   statement. Right-click → **WatDatMean: Explain Selection or Code at Cursor**,
   use the **Tools** menu, or press **Ctrl+Alt+E** (**Cmd+Alt+E** on macOS).
5. Click **Connect provider**. Set the provider, model, and API key. You can also select
   a Node executable or disable automatic downloads. A blank key keeps
   the existing key. Configuration alone does not send code or validate the key.
6. Use **Understand**, **Another example**, or **Try it yourself**. Click underlined concepts
   to open their definitions without another AI request, or choose **Explain further · AI**.
   Concept expansions, guidance levels, repeated comparisons, and resetting your draft use
   the same panel as VS Code. Applied edits reload the selected range for another experiment.

Use **Find Action** to run **WatDatMean: Remove API Key** or
**WatDatMean: Clear Explanation Cache**. The provider configuration is also in **Tools**.

### Compact Java hover

Hover over a Java declaration, call, variable, or supported statement keyword to see a
short WatDatMean explanation inside IntelliJ's normal documentation popup. The native
signature, Javadoc, links, and Ctrl-hover navigation remain available. Code names,
types, and keywords use your editor's color scheme, including light and dark themes.

The explanation covers inputs and return types, starting values, object creation,
simple nested calls, assignments, and common control flow. It is generated locally:
hovering needs neither Node.js nor an API key and does not make an AI request.
Choose **Open learning panel →** for examples, concept definitions, and edit experiments
using the hovered code. AI features in that panel still require a connected provider.

If mouse hover documentation is disabled, enable **Show quick documentation on hover**
under **Settings → Editor → Code Editing**, or use **Quick Documentation** from Find Action.
The added hover explanation currently supports Java. Other languages keep their IDE
documentation and can use the existing selection/cursor action to open WatDatMean.

### Short AI responses and token usage

IntelliJ uses the same compact prompts and **200-token output cap** as VS Code, while
keeping explanations and examples in the selected code's language. Examples and deeper
concept explanations are separate actions; opening an existing concept definition is local.
The panel displays provider-reported input/output usage and **0 new tokens** for cached results.
The 500-token total is a target for small requests; full source context can exceed it.
Cut-short or invalid responses are reported without automatic retries.

Defaults match VS Code: `gpt-4.1-mini`, `claude-haiku-4-5`, and `qwen/qwen3.8-27b`.
Saved model overrides remain unchanged. To adopt a new default, use **Connect provider**
and enter its model ID. See the root guide's [token usage notes](../README.md#token-usage).

### Automatic runtime setup

WatDatMean checks the configured executable (or `node` on PATH), then its private runtime.
Stable Node 22.12+ and newer major versions are accepted; older versions and prereleases are rejected.
If needed, it downloads pinned Node **22.23.5** from `nodejs.org`, checks the archive against
the official SHA-256 checksum bundled in the plugin, and extracts only Node and its license.
Downloads support Windows, macOS, and Linux on x64 and ARM64, subject to Node's OS requirements.
Windows x64 installation and reuse were tested; other platform downloads have not been exercised here.

The runtime stays under the IDE system/cache directory in `watdatmean/node`. It requires
no administrator access and changes neither system Node nor PATH. Progress is cancellable;
failed setup can be retried. Disable automatic downloads for offline/manual setups and
select an existing executable. A managed runtime already installed can be reused offline.
Node downloads do not contain your code or API key. New pinned runtime releases require a plugin update.

## Language support

| Capability                                 | Behavior                                                                                                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact selection                            | Works for text source files, regardless of installed language plugins.                                                                                                                    |
| Cursor inspection                          | Shared AST inspection for `.ts`; Java PSI declarations/statements; named declarations where another plugin exposes them; otherwise the current line. Select a block for precise control.  |
| AI explanation, examples, concepts, impact | Uses the editor language, with extension-based fallback for common languages. Unknown text asks the model to infer the language and acknowledge ambiguity. AI accuracy is not guaranteed. |
| Offline syntax pieces                      | Shared TypeScript `.ts` breakdowns: declarations, calls, nested arguments, operators, imports, control flow, and local bindings. Other languages use AI help.                             |
| References and definitions                 | IntelliJ PSI for the inspected symbol, where installed language support provides it. At most 12 project locations, with a four-second lookup budget.                                      |
| Syntax checking                            | Shared TypeScript parser for `.ts`; installed IntelliJ parser for other languages. No type checking, compilation, or test execution.                                                      |
| Applying edits                             | Requires a syntax-checked preview, unchanged document/project revision, trusted project, and final confirmation. Unsupported parsers leave Apply disabled.                                |

JavaScript/TypeScript semantic references, Python, and other language services depend
on the plugins and edition of IntelliJ being used. Community Edition can still send
selected text to AI without those services. Unresolved references do not establish
that an edit is harmless. Test files are identified by path/name, not execution.

VS Code uses short TypeScript hover explanations with code names highlighted. IntelliJ
adds a compact Java explanation to its native documentation popup. Both retain the
shared learning tool window for deeper help.

## Privacy and edits

- API keys use IntelliJ Password Safe, accessed off the UI thread. They never enter
  the JCEF panel, project files, command-line arguments, or logs. They reach the
  plugin-owned Node worker over private stdin only for an explicit AI action.
- Requests go to the same fixed HTTPS provider endpoints as VS Code; redirects are
  rejected. OpenAI requests use `store: false`. Provider retention policies apply.
- **Just this code** sends only the selected code (maximum 12,000 characters).
  **In this project** and impact add at most 5,000 nearby characters and 12 project
  snippets of 650 characters, including relative paths and line numbers. Impact
  also sends the replacement (maximum 12,000 characters). Embedded secrets are not redacted.
- Source context excludes dependency/build directories and external library files.
  Models can only link to locally collected evidence IDs; generated paths and
  commands are not executed. Output is rendered as text.
- Safe Mode permits local inspection and preview. AI and applying changes require
  a trusted project. Node runs only bundled plugin code, in its own temporary
  directory; `NODE_OPTIONS` and `NODE_PATH` are removed from its environment.
- Explanations use an 80-entry, memory-only cache. Provider changes, removing a key,
  clearing the cache, and disposing the project stop the worker and clear its cache.
- Applied changes use IntelliJ's document/Undo mechanism. The plugin does not save
  files explicitly; IntelliJ's normal autosave settings still apply.
- Cancelling an operation or changing the source while an edit confirmation is open
  prevents that pending edit from being applied. Duplicate Apply actions are ignored.

## Build from this repository

Install the root's locked Node dependencies first:

```sh
npm ci
npm run check
npm test
```

The build uses an IntelliJ IDEA **2022.3** SDK and a JDK **17+**:

```sh
npm run package:intellij -- --ide-home "/path/to/idea" --java-home "/path/to/jdk"
```

On Windows, quote paths containing spaces. `INTELLIJ_HOME` and `JAVA_HOME` can be
used instead of command-line options. The command compiles Java against the IDE SDK,
bundles the shared engine/panel, and produces
`dist/intellij/watdatmean-intellij-0.1.2.zip`. IntelliJ SDK libraries and Node are not
inside the plugin ZIP; Node is downloaded on demand when necessary. `npm run build`
and `npm run package` still build the VS Code extension.

For Gradle development, open this `intellij` directory as a Gradle project with
Gradle 8.x and JDK 17. The build uses the legacy official Gradle IntelliJ plugin 1.17.4
to compile against the 2022.3 baseline.
After root `npm ci`, run `gradle runIde` or `gradle buildPlugin`. Optionally supply
`-PlocalIdePath=/path/to/idea` and `-PnodeExecutable=/absolute/path/to/node`.
The local SDK packaging command above is the verified build path in this checkout.

## Verification

```sh
npm run test:ui
npm run test:intellij -- --ide-home "/path/to/idea" --java-home "/path/to/jdk"
npm run test:intellij -- --ui --ide-home "/path/to/idea" --java-home "/path/to/jdk"
npm run test:intellij -- --ide-home "/path/to/idea-2022.3" --java-home "/path/to/jdk" --runtime-home "/path/to/idea-2025.2" --ui
npm run test:intellij -- --ide-home "/path/to/idea-2022.3" --java-home "/path/to/jdk" --download-node
npm run build
npm run test:integration
```

UI tests require Playwright Chromium (`npx playwright install chromium`) or an installed
browser selected with `PLAYWRIGHT_CHANNEL=msedge`. They exercise both editor bridges,
language labels, safe rendering, and edit gating.

The native smoke test runs the installed IntelliJ IDE headlessly with an isolated
profile under `work/intellij-test-<build>`. It checks plugin/action loading, native Java hover
with preserved documentation/navigation, safe source rendering, bounded learning links, edit confirmation/cancellation, Java PSI selection,
syntax diagnostics, unsupported-language handling, document invalidation, and the
packaged Java-to-Node bridge, version detection, checksum rejection, and startup cancellation.
`--runtime-home` tests the same baseline binary in a newer IDE. `--download-node`
tests an actual official runtime download and reuse in the isolated profile.
Its test-only application starter is never included
in the distributable plugin. It does not use an API key or modify your normal IDE
profile.

Add `--ui` to test the packaged panel inside IntelliJ's actual JCEF runtime. This
checks the startup handshake, detected language, Java-to-JavaScript messages,
button requests, text-only rendering, edit controls, and narrow layout. It also renders
the native documentation component in light and dark themes to PNGs in the test profile. It requires
a desktop session and the bundled JetBrains Runtime. Add `--hold` to leave the
sample window open for visual inspection for up to three minutes; closing it ends
the test. No test code is included in the plugin ZIP.

Both the native JCEF test and VS Code extension-host regression test have passed
on this Windows checkout. Live provider authentication and billing still require
a user-configured API account; automated tests use local fixtures.

The integration follows JetBrains' [JCEF API](https://plugins.jetbrains.com/docs/intellij/embedded-browser-jcef.html),
[version compatibility guidance](https://plugins.jetbrains.com/docs/intellij/build-number-ranges.html),
[Password Safe guidance](https://plugins.jetbrains.com/docs/intellij/persisting-sensitive-data.html),
[PSI APIs](https://plugins.jetbrains.com/docs/intellij/psi-files.html), and
[project trust API](https://plugins.jetbrains.com/docs/intellij/trusted-projects.html).
