# WatDatMean

**Learn programming through the code you are already working on.** WatDatMean supports **VS Code** and **IntelliJ IDEA** with a shared learning engine and panel. Both explain selected code in its editor language and provide free local TypeScript, JavaScript, JSX, and Python breakdowns in **The small pieces**. VS Code provides short TypeScript/JavaScript hover explanations; IntelliJ adds compact Java explanations with theme colors to its native documentation popup and local Java pieces. OpenAI, Anthropic, or Groq help is optional.

For IntelliJ installation, automatic Node.js setup, language capabilities, and builds, see [the IntelliJ guide](intellij/README.md). This release targets IntelliJ **2022.3–2025.2.x**; the same Java 17 plugin has been tested on Community 2022.3 and 2025.2.4.

## Try it

### Visual Studio Code

1. Install `watdatmean-0.1.2.vsix` using **Extensions → … → Install from VSIX** in VS Code 1.95 or newer.
2. Open a TypeScript, JavaScript, JSX, or Python file. Open the learning panel for individual syntax pieces and local variable origins. TypeScript/JavaScript also have short hover paragraphs with code names highlighted. Java, C#, Go, Rust, and other text languages can use selected-code AI help; the extension does not supply local pieces for every language.
3. Click **Wat Dat Mean? →**, right-click → **WatDatMean: Explain Selection or Code at Cursor**, or press **Ctrl+Alt+E** (Mac: **Cmd+Alt+E**).
4. Click **Connect provider**, select **OpenAI**, **Anthropic**, or **Groq**, enter your API key in the password prompt, and confirm a model ID available to your account.
5. Choose **Explain this code** for one compact walkthrough with the important interactions and distinctions. Definitions and reviewed practice stay collapsed until opened. **More detail · AI** expands the walkthrough; **Another example** is a separate action. Choose **In this project** to include bounded import/declaration clues. Missing declarations and values stay unknown.

API keys are stored in **VS Code SecretStorage**, never in project settings or the panel. A provider API account with available credits is required for AI features. Chat subscriptions do not supply API credits. Keys are checked on the first request, not when saved. You can switch providers or remove a key through the Command Palette.

Run **WatDatMean: Open Demo Project** for a small rewards-system example. [The demo walkthrough](demo/README.md) demonstrates the complete flow in three minutes.
In IntelliJ, **Tools → WatDatMean: Open Java Demo** opens an editable Java scratch file and its learning panel. See the [feature comparison](intellij/README.md#comparison-with-vs-code) for editor-specific behavior.

### Checking Python code

Open a `.py` file, select the code, and press **Ctrl+Alt+E**. **The small pieces** explains local names, assignments, common built-ins, and written imports. In **Try it yourself**, edit the draft and choose **See what changes**. The checker examines the proposed whole file, including indentation around your selection. Detected errors show line numbers and keep **Use this code** disabled.

Both editors use the same local Python 3 grammar and structural checks. These catch common indentation/tab problems, unfinished strings/brackets/functions, invalid assignment targets, duplicate or misordered parameters, incomplete `try` blocks, and misplaced `return`, `break`, `continue`, `yield`, or `await`. They handle valid multiline code, decorators, comprehensions, unpacking, and async functions without running the file or requiring Python installation. These checks are not a complete CPython compiler, type checker, dependency checker, or runtime test. References across files still depend on your editor's Python language service.

## What works

| Feature             | MVP behavior                                                                                                                                                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instant syntax      | TypeScript/JavaScript/JSX and Python parser-based pieces, including local declaration and written import clues. IntelliJ also has native Java pieces. Click a piece for a predefined expansion. No network calls.                                                     |
| Understand code     | Select exact code or inspect at the cursor. On a function/method name, inspect the whole declaration; inside its body, inspect the smaller statement.                                                                                                                 |
| Two context views   | **Just this code** sends only the inspected snippet. **In this project** adds bounded nearby code and workspace references/definitions for the inspected symbol.                                                                                                      |
| Transfer learning   | Request a separate example in another domain, with concrete values and expected behavior. Click underlined terms to reopen their definitions instantly. Choose **Explain further · AI** for a deeper explanation.                                                     |
| Focused walkthrough | One explanation flow with important relationships and execution order; known output appears once. Definitions and reviewed practice open on demand. **More detail** expands the explanation. AI prose still needs checking; see [the testing report](TEST_REPORT.md). |
| Adjustable guidance | **Learning the basics** explains terminology. **Getting up to speed** emphasizes contracts, dependencies, and side effects.                                                                                                                                           |
| Try it yourself     | Edit your version, choose **See what changes** for a before/after comparison and syntax check, and optionally ask AI to explain the change. Keep trying or use **Start over** to reset the draft. Code is not executed.                                               |
| Apply an edit       | Explicit preview, syntax check, and final confirmation. Workspace edits invalidate the preview. Changes stay in the editor, support Undo, and are not automatically saved. The panel reloads each applied version so you can keep experimenting.                      |
| Token efficiency    | No hover AI calls; bounded context; an 80-entry, in-memory LRU cache keyed by code, relevant context, task, guidance, provider, and model. Cache hits make no new API request.                                                                                        |

## Data and safety

- The extension host sends requests directly to the selected provider's fixed HTTPS endpoint. Keys never enter the webview. Redirects are rejected. No telemetry is collected by this extension.
- Code is sent only after an explicit AI action. Hover, syntax expansions, diff preview, and language-service references are local.
- Standalone requests send up to 12,000 characters of selected code. Project and impact requests also send up to 5,000 characters of nearby code and up to 12 reference/definition snippets of 650 characters each, including relative paths and line numbers. Impact adds the replacement (up to 12,000 characters).
- Project snippets are restricted to supported source extensions within the open workspace, excluding common dependency/build directories. Project-mode step-by-step lessons can also send up to 2,500 characters of written import and local declaration clues; standalone mode does not add these clues. **Secrets embedded in selected or nearby source are not automatically redacted.** Review your code before requesting AI help.
- Explanation requests may include up to 1,000 characters of teaching facts derived from the selected code. These do not add source from outside the selection. Project evidence can help identify a selected helper's definition.
- OpenAI requests set `store: false`. Other provider retention policies still apply. The extension cache is memory-only and can be cleared with **WatDatMean: Clear Explanation Cache**.
- A **confirmed reference** means the VS Code language service returned that source location. It does not mean a runtime behavior or affected test is confirmed. All AI impact descriptions are labeled predictions.
- AI output is schema-validated and rendered as text. Supporting-code links are resolved from local evidence IDs; model-generated paths or commands are never executed.
- Untrusted workspaces allow local explanations but block AI requests and applying edits.

## Token usage

The default prompt asks for roughly **40–80 words for simple operations**, **100–180 for interacting methods**, and **up to about 250 for complex selections**. These are guides, not forced truncation; a model may exceed them. Important distinctions belong in the walkthrough, without extra recap, connections, or pitfalls sections. Requests allow **900 completion tokens for Explain this code**, **1,600 for More detail**, **450 for a concept**, **700 for a change explanation**, and **800 for another example**. Opening the panel or hovering never requests AI automatically.

Basic supported literal arithmetic, incomplete selections, and matching practice examples can use **zero API tokens**. Opening an existing definition is also free. A recognized Java constructor/override fragment gets a compact local explanation of initialization and call order, with no invented field values; supplied project context instead goes to the provider. Recognized superclass/subclass declarations support a short local polymorphism expansion. Other expansions use AI. Local results are labeled **Local learning help**. The arithmetic reader never executes your code or arbitrary functions. Malformed or known contradictory replies can show local facts with a notice; actual usage is preserved and there is no automatic retry.

The same compact requests and usage display work in VS Code and IntelliJ. IntelliJ retains the detected language for explanations and examples; requests without a language default to TypeScript. Native Java hover stays local and does not start the learning engine.

Both editors reduce duplicate input without cutting explanation depth. Strict-schema requests use the supplied schema instead of repeating its JSON template in the prompt. Exact repeated source in context and evidence can reference an earlier field; every unique character, evidence ID, filename and line remains available. Selected code and proposed replacements stay intact. For known terms, the model can omit definition prose and the shared engine restores the reviewed definition before displaying it; unfamiliar terms still receive AI definitions. These optimizations do not lower output limits or reasoning effort.

The selected code, nearby context, reference snippets (including their locations), replacement code, and optional learning clues use the limits described above. They are not shortened to meet a token budget. The panel shows provider-reported input, output, and total usage when available. There is no 500-total-token target or warning. Cached results show zero new tokens.

Narrowly recognized simple explanations use a reviewed local walkthrough at **zero API tokens**: literal assignments and straightforward print calls in TypeScript/JavaScript or Python, and a single Java `println` of a string literal. It explains the operations, keeps definitions and output-function origins, and derives output with a bounded reader that never executes the selection. The result states its standard-output-function assumption. Unknown syntax or extra context uses AI. This local path is shared by both editors and all providers.

Supported Java also gets a local walkthrough at **zero API tokens** in both editors: self-contained `int`/`String` arithmetic and print statements; complete programs with ordinary or static nested classes; multiple objects and aliases; longer inheritance chains; and simple methods/constructors with arguments, return values and field updates. The reader checks the whole accepted program, tracks each object's fields separately and preserves constructor order, overriding, casts, static calls and evaluation order. The supplied `Womb` example still has four compact steps; **More detail** exposes individual events. Explanations use the actual declarations and values, with one output block and relevant expandable definitions.

The local Java path also covers `for`, `while`, `do-while`, enhanced `for`, branches, `break`/`continue`, and fixed-arity overloaded methods. Common `java.util` lists, sets and maps with `String`/`Integer` elements support creation, lookup and mutation. A loop gets one compact account of its first pass, iteration count, final values and exit reason. Explanations distinguish `List<Integer>.remove(int)` (index) from `remove(Object)` (value), and compile-time overload selection from runtime overriding. These supported explanations cost **zero API tokens** in both editors.

Java arrays and exception handling also use this shared local path. Supported arrays include initializers, sized/default arrays, indexing and updates, `length`, aliases, array parameters/returns/fields, up to three dimensions, enhanced loops, shallow `clone`, and `Arrays.toString`/`deepToString`/`copyOf`. The walkthrough preserves component types, field hiding through covariant arrays, and evaluation order when access or assignment fails. `try`/`catch`/`finally`, multi-catch, explicit `throw`, modeled `throws` declarations, rethrows and matching built-in exception types preserve skipped statements, saved return values and finally overrides.

This remains a bounded Java subset. Streams, varargs, arbitrary generic types, custom exception classes, try-with-resources, constructor overloads, packages and unmodeled APIs retain the existing AI path. Uncaught failures, JVM-generated message/identity details, uncertain library-error ordering, incomplete context and resource bounds decline the whole local result. Missing values are not invented. No selection is compiled or run by the extension. AI prompt sizes and reasoning settings are unchanged. See [the test report](TEST_REPORT.md) for independent Java 17 comparisons and exact scope limits.

Groq's default `qwen/qwen3.8-27b` keeps low reasoning for model-backed explanations, concept help, deeper walkthroughs, and comparisons. A short selection alone is not considered simple: unsupported constructors/inheritance, closures, unknown helpers, and mixed-type expressions keep reasoning. Generated examples retain their existing no-reasoning setting. Only the final answer is returned. Simply disabling reasoning caused missing walkthroughs in the live tests; those responses are retained in the test report and are not the shipped optimization.

Completion ceilings remain **2,948 for explanations and 3,648 for walkthroughs**, including the existing 2,048-token allowance. These ceilings stay unchanged even when reasoning is off, so savings do not come from truncating the explanation. The allowance is shared between reasoning and the answer; it does not reserve an exact number for either. Provider-reported usage includes reasoning without counting it twice. Other models retain their existing settings. These settings do not guarantee accuracy ([Groq reasoning documentation](https://console.groq.com/docs/reasoning)).

Full lessons attach any printed characters to each execution step. The panel assembles expected output from those same fragments, preserving spaces and newlines. Unknown output is labeled instead of showing a partial trace as complete. This prevents a separate final-output guess from disagreeing with the trace; it does not prove that the model's trace is correct. Your code is not executed by the extension.

## Develop

Use Node.js **22.12+** and npm. Clone/open this folder, then:

```sh
npm ci
npm run check
npm test
npm run test:stress
npm run build
```

IntelliJ users do not need to install Node separately: the plugin detects a compatible runtime or downloads a private, checksum-verified copy. Building from source still requires Node and npm. IntelliJ build outputs are ignored by Git; commit its `src/`, build configuration, and shared bridge sources.

Run `npm run dev` to build and open a persistent development window with the demo workspace.
It uses an isolated profile in `.vscode-dev` and bypasses the JavaScript debugger, so you
may need to trust the demo folder and configure your API key in that profile.

You can also press **Ctrl+F5** in VS Code to run the existing launch configuration without
debugging, or **F5** to attach the debugger. Some VS Code versions can abort during F5
startup before the extension activates ([reported VS Code issue](https://github.com/microsoft/vscode/issues/336233));
use `npm run dev` or Ctrl+F5 if that happens. For automatic rebuilds, run `npm run watch`
separately and reload the development window after changes.

`npm run test:integration` is for automated checks: its temporary window closes when the
tests finish. Use `npm run dev` for interactive testing.

Run `npm run format` to format source, tests, styles, and documentation with Prettier.
Run `npm run format:check` to check formatting without changing files. The shared
configuration uses two-space indentation, single quotes, and a 100-character line
width. Generated files and third-party licenses are excluded.

```sh
npm run test:ui
npm run test:integration
npm run package
```

UI tests require Playwright Chromium (`npx playwright install chromium`). Integration tests launch the installed `code` executable in an isolated test profile. Neither automated suite uses an API key or bills a provider. The installable VSIX is created at the repository root.

See [the extreme-testing and teaching-quality report](TEST_REPORT.md) for the tested languages, real editor runs, malformed-input stress tests, and the separate live Groq evaluation. Live evaluation is never part of `npm test`.

## Settings

| Setting               | Purpose                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `watdatmean.provider` | `openai`, `anthropic`, or `groq`. Global application setting.                                                     |
| `watdatmean.model`    | Model ID override for the selected provider. Configure through the command to switch model and provider together. |
| `watdatmean.audience` | Default guidance: `beginner` or `experienced`. The panel can override it.                                         |

Default model IDs are `gpt-4.1-mini`, `claude-haiku-4-5`, and `qwen/qwen3.8-27b`. Model availability depends on the provider/account and may change; any compatible text model ID can be entered. To use a new default after previously configuring a model, run **WatDatMean: Configure AI Provider / API Key** and enter that model ID, or clear the `watdatmean.model` setting.

Groq models with known [strict structured-output support](https://console.groq.com/docs/structured-outputs)
receive a compact schema for the selected action. Other Groq models use JSON object mode. Omitted optional
sections are treated as empty; malformed fields trigger a labeled local explanation when facts are available, otherwise a specific error without exposing the response content. The extension does not automatically make an additional request when validation fails.

## Boundaries of this MVP

- VS Code desktop has local parsers for TypeScript, JavaScript, JSX, and Python. Other text languages can use AI explanations and comparisons, but Apply stays disabled without a supported parser. IntelliJ IDEA 2022.3–2025.2.x adds native Java hover and pieces, and uses installed parsers for other languages; see its [language support table](intellij/README.md#language-support). Other IDEs are outside this build.
- Reference coverage comes from the editor's installed language services for **one inspected symbol**, capped at 12 locations. Python and other semantic language services may need separate extensions. It is not a complete dependency graph. Dynamic dispatch, indirect callers, reflection, generated code, and references outside the workspace may be missed. Test files are identified by filename/path, not test execution.
- Reference lookups time out after four seconds. If no references appear while the project is indexing, wait and request again. Open the project folder with its language configuration for the best results.
- Syntax checking is not type checking. The extension never compiles or executes your replacement, runs tests, or guarantees an edit is safe. Check VS Code diagnostics and run your project tests after an edit.
- AI explanations depend on the configured provider. Local facts and reviewed practice are labeled as local help. There is no agentic editing, conversation history, streaming, or background indexing. Large files (over 500,000 characters) are intentionally excluded.
- The shared teaching checks address observed arithmetic, HTTP/JSON, async, library, and scope mistakes; they cannot verify arbitrary AI prose. Walkthrough quizzes use reviewed examples only. Other explicitly requested AI examples are marked unverified. Instructions favor short sentences and plain definitions, but no child usability study or formal sixth-grade reading assessment has been performed.

## Implementation

- `src/analyzer.ts`: TypeScript parser and predefined explanations.
- `src/languages.ts` and `src/python.ts`: language routing, Python grammar and file-local origin clues, bounded learning context, and conservative unsupported-language behavior.
- `src/python-check.ts`: local Python grammar and structural preview checks, including indentation and statement placement, without executing code.
- `src/syntax.ts` and `src/bindings.ts`: context-aware syntax pieces and file-local binding lookup. These describe syntax and declarations, not live runtime values or imported implementations.
- `src/hover-explanation.ts`: concise local prose for declarations, calls, and statements, with code names safely formatted inline.
- `src/context.ts`: bounded VS Code reference/definition collection and source links.
- `src/provider.ts`: provider protocols, request cancellation, safe errors, and response validation.
- `src/teaching.ts`: bounded arithmetic facts, reviewed practice and definitions, and checks for observed explanation failures, shared by both editors.
- `src/extension.ts`: commands, hovers, secret storage, cache orchestration, diff and guarded edits.
- `media/`: theme-aware webview with keyboard-accessible controls and text-only model rendering.
- `tests/`: parser, provider, caching, webview, and extension-host checks.

Provider integration follows the official [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create), [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages), and [Groq API documentation](https://console.groq.com/docs/openai). Editor integration uses the [VS Code API](https://code.visualstudio.com/api/references/vscode-api) and [webview security guidance](https://code.visualstudio.com/api/extension-guides/webview#security).
