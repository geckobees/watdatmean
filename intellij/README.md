# WatDatMean for IntelliJ IDEA

This plugin brings the existing WatDatMean learning flow to IntelliJ IDEA. It shares
the TypeScript/JavaScript/JSX and Python analyzers, provider adapters, validated lesson format, cache, and panel
with the VS Code extension. It does not require VS Code to be installed or running.

## Install and use

1. Use **IntelliJ IDEA 2022.3 through 2025.2.x**, Community or Ultimate, with its bundled JetBrains Runtime and JCEF.
   The plugin is compiled against 2022.3 using Java 17 and tested on Community **2022.3** and **2025.2.4**.
   The descriptor allows builds 223–252; later versions need compatibility verification before widening that range.
   Remote Development is not covered by this release.
2. Node.js **22.12+** is detected automatically. If it is absent or too old, WatDatMean
   downloads a private runtime when the learning engine is first needed. The worker
   runs the same engine as VS Code over private pipes, with no server or listening port.
3. Install `dist/intellij/watdatmean-intellij-0.1.11.zip` through
   **Settings → Plugins → ⚙ → Install Plugin from Disk**, then restart the IDE.
4. Open a text source file. Select code, or place the cursor on a Java declaration or
   statement. Right-click → **WatDatMean: Explain Selection or Code at Cursor**,
   use the **Tools** menu, or press **Ctrl+Alt+E** (**Cmd+Alt+E** on macOS).
5. In **Understand → The small pieces**, click a Java, TypeScript, JavaScript, JSX, or Python token to unpack it
   locally. For a practice file, use **Tools → WatDatMean: Open Java Demo**.
6. For AI help, click **Connect provider**. Set the provider, model, and API key. You can also select
   a Node executable or disable automatic downloads. A blank key keeps
   the existing key. Configuration alone does not send code or validate the key.
7. Use **Understand**, **Another example**, or **Try it yourself**. The default explanation is one compact walkthrough; choose **More detail · AI** to expand it. **In this project** includes bounded import/declaration clues; missing values stay unknown. Terms and practice start collapsed. Click underlined concepts
   to open their definitions without another AI request, or choose **Explain further · AI**.
   Concept expansions, guidance levels, repeated comparisons, and resetting your draft use
   the same panel as VS Code. Applied edits reload the selected range for another experiment.

Use **Find Action** to run **WatDatMean: Remove API Key** or
**WatDatMean: Clear Explanation Cache**. The provider configuration is also in **Tools**.

If the panel stops loading or responding, use **Tools → WatDatMean: Reopen Learning Panel**
or find the action by name. It refreshes the saved selection, cancels pending work, and
recreates the browser with your current theme. The displayed lesson and unapplied draft
reset; your source file stays intact.

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

### The small pieces

The learning panel now breaks Java into clickable pieces: names, types, modifiers,
method and constructor calls, parameters, arguments, literals, operators, and common
control flow. Nested calls identify the result passed into the surrounding call.
Pieces appear as filled boxes in the original code layout, preserving indentation,
comments, and line breaks. Click a box, or Tab to it and press Enter or Space.
Descriptions use Java semantics, including integer ranges, reference equality, and
the difference between a final reference and an immutable object.

Variable pieces also show their declaration line and starting expression, or explain
where a parameter, loop element, caught exception, or pattern value comes from.
Lookups respect local scope and shadowed names. They describe declarations in the
current file, not live values or later assignments. Imported/inherited fields and
members of arbitrary objects remain unknown; the lookup does not search the project. Type pieces can show matching explicit written imports, without claiming a library is installed or verifying its version.

These explanations use IntelliJ's Java parser locally, without Node.js, an API key,
or token usage. **Use latest code** and applied edits regenerate the pieces. Comments
and partially selected tokens are skipped; long selections show up to 80 pieces.
Select a smaller expression for a focused breakdown. TypeScript, JavaScript, JSX, and Python files use the same offline analyzers as VS Code through the bundled Node worker. Python pieces explain assignments, parameters, loop variables, built-ins, and written module aliases. Complex or uncertain scope relationships are left unknown.

The shared explanation engine handles supported sequential Java streams, expression/block lambdas, method references, and `Optional`/`OptionalInt` locally, at zero API tokens. Compact walkthroughs explain lazy pipelines, saved receivers, overload selection, constructor references, present/empty values, eager versus lazy fallbacks, callback failures, and exact output. Both editors share the same [supported operations and fallback limits](../README.md#token-usage). Parallel streams, unmodeled APIs and uncertain intermediate callback effects retain the existing AI path. IntelliJ 2022.3 compatibility is preserved.

User-defined generics and interfaces also use the shared local engine: generic classes/methods, supported bounds and diamond inference, generic interfaces, implementation dispatch, inherited defaults, and custom functional-interface lambdas/references. Explanations retain compile-time overload choices and distinguish checked type arguments from runtime classes. Unsupported or ambiguous forms keep the AI fallback; IntelliJ's native hover, origins and theming remain available.

Repeated concept names are shown once, including case/spacing variants and older cached lessons. Opening an existing definition still needs no AI request.

**WatDatMean: Open Java Demo** creates a fresh editable Java scratch file and opens
the learning panel on a field. Try the method declaration and nested call, then use
**Try it yourself** to compare a change. Reopening the demo preserves your previous
scratch file. Opening it does not execute the sample or request AI.

### Automatic panel theme

The learning panel follows IntelliJ's light, dark, or custom UI theme automatically:
backgrounds, text, borders, buttons, links, and focus indicators use IDE colors.
Code blocks and the edit draft use the editor color scheme and font. Changes apply
while the panel is open, preserving your lesson, selected tab, and draft. No extra
setting, reload, Node startup, or AI request is needed.

### Comparison with VS Code

| Feature                                                   | VS Code                                                                                        | IntelliJ                                                                                 |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| The small pieces                                          | TypeScript, JavaScript, JSX, Python; local origins and written imports                         | Same shared parsers, plus Java syntax, local variable origins, and explicit import clues |
| Compact hover                                             | TypeScript/JavaScript explanation                                                              | Java explanation inside native documentation, with editor colors                         |
| Practice example                                          | Open Demo Project, TypeScript                                                                  | Open Java Demo, editable scratch file                                                    |
| AI explanations, examples, clickable concepts             | Shared learning panel                                                                          | Same panel, using the detected language                                                  |
| Full explanations and optional step-by-step lessons       | Relationships, ordered trace, output, pitfalls, origins, and reviewed practice where supported | Same shared actions, detail, and budgets                                                 |
| Guidance levels, compact prompts, usage and caching       | Supported                                                                                      | Supported                                                                                |
| Automatic panel theme                                     | VS Code theme                                                                                  | IntelliJ UI theme and editor code colors/fonts                                           |
| Project references, comparisons, confirmed edits and Undo | VS Code language services and editor                                                           | IntelliJ language services and editor                                                    |

Offline pieces cover Java, TypeScript, JavaScript, JSX, and Python; other languages can use AI help.
Variable-origin details stay local to the current file in these analyzers and do
not report live runtime values.

### Short AI responses and token usage

IntelliJ uses the same complete, plain-language explanations as VS Code, while
keeping explanations and examples in the selected code's language. Examples and deeper
concept explanations are separate actions; opening an existing concept definition is local.
The panel displays provider-reported input/output usage and **0 new tokens** for cached results.
**Explain this code** allows 900 completion tokens; **More detail** allows 1,600. The default Groq Qwen model keeps the existing additional 2,048-token allowance, for completion ceilings of 2,948 and 3,648 including reasoning. The panel shows actual usage. There is no 500-total-token target. Output is assembled from the print fragments and displayed once. Reviewed practice questions, answers, and matching examples open on demand; unsupported topics omit unverified quizzes. The shared engine recognizes a limited Java constructor/override fragment locally, explains initialization order, and leaves output unknown without field declarations and parent-constructor context. This retains the Java 17 / IntelliJ 2022.3 baseline.

Both editors explain narrowly recognized literal/print snippets locally at zero API tokens, including a single Java `println` of a string literal or simple literal assignments and print calls in Python/TypeScript/JavaScript. The reviewed walkthrough retains operations, output, definitions and output-function origins, with an explicit standard-function assumption. A bounded reader derives the values without executing the selection. Unknown helpers, extra context, unsupported Java constructions, closures, and other model-backed requests keep the AI path and Qwen low reasoning. Short code is not automatically simple. Completion ceilings and AI explanation instructions remain unchanged; other models retain their existing settings.

The zero-token Java trace also handles ordinary or static nested classes, multiple objects/aliases, longer inheritance chains, scalar locals, and simple methods/constructors with arguments, returns and field updates. It now supports `for`, `while`, `do-while`, enhanced `for`, branches, `break`/`continue`, common `java.util` lists/sets/maps of `String`/`Integer`, and fixed-arity method overloads. It distinguishes index/value removal and selects an overload from declared types before applying runtime overriding. Each object's fields stay separate, including hidden parent fields; constructor and evaluation order are preserved.

Arrays now support initializers, sized/default creation, indexed updates, `length`, aliases, parameters/returns/fields, up to three dimensions, iteration, shallow `clone` and `Arrays.toString`/`deepToString`/`copyOf`. Exception handling covers `try`/`catch`/`finally`, multi-catch, explicit throws, modeled `throws` declarations, rethrows and common built-in failures. Explanations show which statements are skipped and whether finally preserves or replaces a saved return or exception.

Default explanations have one compact walkthrough and one output block. Loop iterations are summarized with a first pass, count, final values and exit reason. Definitions stay local; AI prompts and reasoning settings are unchanged. Missing context, unordered hash iteration, uncaught failures, unknown JVM messages, resource limits and unmodeled syntax retain the existing AI path. Streams, varargs, constructor overloads, arbitrary generic types, custom exceptions and try-with-resources remain outside the local subset. No selection is executed. Both editors share this reader; IntelliJ still targets **2022.3 and Java 17**. See the root [test report](../TEST_REPORT.md).

The shared engine also removes repeated prompt instructions and represents exact duplicate context with references. Unique source and evidence locations are preserved. Known definitions are supplied locally after the response; unfamiliar terms still receive definitions from AI. These changes preserve the explanation and reasoning allowances above.

Basic explanations of supported literal arithmetic, incomplete selections, and matching practice examples need no provider request. Existing definitions open locally; explicit concept expansions and deeper lessons provide a contextual explanation. Recognized Java superclass/subclass declarations support a reviewed three-step polymorphism expansion locally; other expansions use AI. Local facts inform the request without adding repetitive sections. Known contradictions and malformed replies can fall back to labeled **Local learning help**, preserving actual usage. There are no automatic retries. The shared checks do not prove arbitrary AI explanations correct or establish a sixth-grade reading level.

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

| Capability                                 | Behavior                                                                                                                                                                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact selection                            | Works for text source files, regardless of installed language plugins.                                                                                                                                                        |
| Cursor inspection                          | Shared parser inspection for TypeScript, JavaScript, JSX, and Python; Java PSI declarations/statements; named declarations where another plugin exposes them; otherwise the current line. Select a block for precise control. |
| AI explanation, examples, concepts, impact | Uses the editor language, with extension-based fallback for common languages. Unknown text asks the model to infer the language and acknowledge ambiguity. AI accuracy is not guaranteed.                                     |
| Offline syntax pieces                      | Java PSI syntax and local variable origins; shared TypeScript, JavaScript, JSX, and Python breakdowns including local origin/import clues. Other languages use AI help.                                                       |
| References and definitions                 | IntelliJ PSI for the inspected symbol, where installed language support provides it. At most 12 project locations, with a four-second lookup budget.                                                                          |
| Syntax checking                            | Shared parsers for TypeScript, JavaScript, JSX, and Python; installed IntelliJ parser for other languages. No type checking, compilation, or test execution.                                                                  |
| Applying edits                             | Requires a syntax-checked preview, unchanged document/project revision, trusted project, and final confirmation. Unsupported parsers leave Apply disabled.                                                                    |

JavaScript/TypeScript semantic references, Python, and other language services depend
on the plugins and edition of IntelliJ being used. Community Edition can still send
selected text to AI without those services. Unresolved references do not establish
that an edit is harmless. Test files are identified by path/name, not execution.

VS Code uses short TypeScript/JavaScript hover explanations with code names highlighted. IntelliJ
adds a compact Java explanation to its native documentation popup. Both retain the
shared learning tool window for deeper help.

### Checking Python edits

Open a `.py` file and use **WatDatMean: Explain Selection or Code at Cursor**. In **Try it yourself**, edit your draft and choose **See what changes**. The shared checker checks the proposed whole file, reports lines needing attention, and blocks Apply when it finds a problem. It catches common indentation/tab mistakes, incomplete syntax, invalid assignment targets, parameter errors, and misplaced control-flow/async statements. It runs locally through the bundled Node worker, including in Community Edition without a Python language plugin or Python interpreter. Semantic references still require suitable IDE language support. This does not replace a Python compiler, type checker, or project tests.

## Privacy and edits

- API keys use IntelliJ Password Safe, accessed off the UI thread. They never enter
  the JCEF panel, project files, command-line arguments, or logs. They reach the
  plugin-owned Node worker over private stdin only for an explicit AI action.
- Requests go to the same fixed HTTPS provider endpoints as VS Code; redirects are
  rejected. OpenAI requests use `store: false`. Provider retention policies apply.
- **Just this code** sends only the selected code (maximum 12,000 characters).
  **In this project** and impact add at most 5,000 nearby characters and 12 project
  snippets of 650 characters, including relative paths and line numbers. Impact
  also sends the replacement (maximum 12,000 characters). Project-mode step-by-step lessons can add up to 2,500 characters of written imports and local declaration clues. Explanation requests may add up to 1,000 characters of teaching facts derived from the selected code. Embedded secrets are not redacted.
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
`dist/intellij/watdatmean-intellij-0.1.11.zip`. IntelliJ SDK libraries and Node are not
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
npm run test:stress
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
Java pieces and their refresh after edits, scoped variable origins (including shadowing,
declaration order, loops, catch/resources, and patterns), fresh Java demo scratch files,
syntax diagnostics, unsupported-language handling, document invalidation, and the
packaged Java-to-Node bridge, version detection, checksum rejection, and startup cancellation.
`--runtime-home` tests the same baseline binary in a newer IDE. `--download-node`
tests an actual official runtime download and reuse in the isolated profile.
Its test-only application starter is never included
in the distributable plugin. It does not use an API key or modify your normal IDE
profile.

Add `--ui` to test the packaged panel inside IntelliJ's actual JCEF runtime. This
checks the startup handshake, detected language, Java-to-JavaScript messages,
button requests, local Java piece expansion without AI, text-only rendering, edit controls, and narrow layout.
It switches light/dark themes and editor fonts while checking that the lesson, draft, and tab survive.
It exports static panel HTML snapshots and renders the native documentation component
to light/dark PNGs in the test profile. It requires
a desktop session and the bundled JetBrains Runtime. Add `--hold` to leave the
sample window open for visual inspection for up to three minutes; closing it ends
the test. No test code is included in the plugin ZIP.

Both the native JCEF test and VS Code extension-host regression test have passed
on this Windows checkout. Automated tests use local fixtures. The live Groq follow-up and regression tests cover the observed teaching failures, reviewed quiz answers, and reduced output budget. See [the testing report](../TEST_REPORT.md) for results and limitations.

The integration follows JetBrains' [JCEF API](https://plugins.jetbrains.com/docs/intellij/embedded-browser-jcef.html),
[version compatibility guidance](https://plugins.jetbrains.com/docs/intellij/build-number-ranges.html),
[Password Safe guidance](https://plugins.jetbrains.com/docs/intellij/persisting-sensitive-data.html),
[PSI APIs](https://plugins.jetbrains.com/docs/intellij/psi-files.html), and
[project trust API](https://plugins.jetbrains.com/docs/intellij/trusted-projects.html).
