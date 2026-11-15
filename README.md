# WatDatMean

**Learn programming through the code you are already working on.** WatDatMean supports **VS Code** and **IntelliJ IDEA** with a shared learning engine and panel. Both explain selected code in its editor language and provide free local TypeScript, JavaScript, JSX, and Python breakdowns in **The small pieces**. VS Code provides short TypeScript/JavaScript hover explanations; IntelliJ adds compact Java explanations with theme colors to its native documentation popup and local Java pieces. OpenAI, Anthropic, or Groq help is optional.

For IntelliJ installation, automatic Node.js setup, language capabilities, and builds, see [the IntelliJ guide](intellij/README.md). This release targets IntelliJ **2022.3–2025.2.x**; the same Java 17 plugin has been tested on Community 2022.3 and 2025.2.4.

## Try it

### Visual Studio Code

1. Install `watdatmean-0.1.27.vsix` using **Extensions → … → Install from VSIX** in VS Code 1.95 or newer. After upgrading, run **Developer: Reload Window** and reopen the learning panel.
2. Open a TypeScript, JavaScript, JSX, or Python file. Open the learning panel for individual syntax pieces and local variable origins. TypeScript/JavaScript also have short hover paragraphs with code names highlighted. Java, C#, Go, Rust, and other text languages can use selected-code AI help; the extension does not supply local pieces for every language.
   Inside an interface or object type, hover a property or method to explain just that member. Its panel link opens the same member.
3. Click **Wat Dat Mean? →**, right-click → **WatDatMean: Explain Selection or Code at Cursor**, or press **Ctrl+Alt+E** (Mac: **Cmd+Alt+E**).
   In **The small pieces**, select a boxed word or symbol directly in the code. Indentation, comments, and line breaks stay intact. Tab to a piece and press Enter or Space to unpack it. Complex TypeScript types, tuple entries, and object values have individual explanations, including unfinished declarations.
4. Click **Connect provider**, select **OpenAI**, **Anthropic**, or **Groq**, enter your API key in the password prompt, and confirm a model ID available to your account.
5. Choose **Explain this code** for one compact walkthrough with the important interactions and distinctions. Definitions and reviewed practice stay collapsed until opened. **More detail · AI** expands the walkthrough; **Another example** is a separate action. Choose **In this project** to include bounded import/declaration clues. Missing declarations and values stay unknown.

API keys are stored in **VS Code SecretStorage**, never in project settings or the panel. A provider API account with available credits is required for AI features. Chat subscriptions do not supply API credits. Keys are checked on the first request, not when saved. You can switch providers or remove a key through the Command Palette.

Run **WatDatMean: Open Demo Project** for a small rewards-system example. [The demo walkthrough](demo/README.md) demonstrates the complete flow in three minutes.
In IntelliJ, **Tools → WatDatMean: Open Java Demo** opens an editable Java scratch file and its learning panel. See the [feature comparison](intellij/README.md#comparison-with-vs-code) for editor-specific behavior.

### Optional web resources for the explanation

In **01 / Understand**, turn on **Add web resources**. It is off by default and remembers your choice for this project. Review or edit the **Public search topic** (for example, `Java 17 streams`), then choose **Explain this code** or **More detail**. Your normal explanation appears first; a separate, collapsible **From the web** supplement follows. **Find web resources · AI** searches without regenerating the explanation. Turning the switch off cancels a pending lookup.

The supplement asks for a short, original example, a concrete real-world use case, and up to three useful resources, favoring official docs and maintainer examples. YouTube lessons, source repositories, and author/publisher-hosted free books or PDFs are included when relevant results are found; missing categories are not filled with invented links. Links show their host and resource type, and open in your browser only when clicked. PDFs are not fetched by the extension and examples are not executed or applied to your file.

Web lookup sends the editable public topic, target version and resource choice to **Bing**, with **DuckDuckGo** as a fallback. It does not send selected code, file paths or project snippets. Up to three source titles and short excerpts then go to your connected AI provider for one compact walkthrough, one illustrative example and one practical use. At most two allowlisted official reference pages are read locally for focused excerpts; whole pages are never sent to the model. PDFs and videos are not downloaded.

The shared VS Code/IntelliJ engine enforces **3,500 UTF-8 bytes of input content (including the response schema), 900 output tokens and one AI request per lookup**. It disables browser tools and keeps Groq reasoning low within the same 900-token completion cap, never retries an AI request automatically, and rejects overlapping requests. The input cap is a byte bound, not a claim that bytes equal billed tokens; provider message framing is additional. Summary models are Groq openai/gpt-oss-120b, OpenAI gpt-4.1-mini, and Anthropic claude-haiku-4-5. Your normal code explanation and its selected model are unchanged.

**AI summaries still use provider tokens**, shown separately in the panel. Public search itself uses no AI tokens or provider search tools. Up to 40 matching lookups are cached in memory for 24 hours; cache hits, filters and bookmarks cost no tokens. Turning the switch off cancels pending work. **Clear Explanation Cache** clears the web cache too. If retrieval fails or needs browser verification, no AI request is sent. Provider failures, rate limits and incomplete summaries leave the code explanation intact, without an automatic retry.

Source URLs come from search results, never model-written links. This records where links came from; it does not prove every claim or resource is correct. Exact known Java/Python editions are prioritized and known conflicting editions excluded. Other compatibility remains unverified. Successful supplements remain with their explanation in **History**, including their retrieval date; reviewing them is free of new AI requests.

### Version targets, resource filters and bookmarks

Inside the web options, **Target version** suggests a literal declaration from nearby project manifests, such as `Java 17`, `TypeScript ~5.9.3`, or `Python >=3.11,<3.13`. The field shows where the declaration came from and is editable; its suggestions can include recognized public libraries such as React. A declaration or range is not proof of an installed version. Unknown/dynamic versions stay blank. Enter any other library/version yourself, or clear the field for an unspecified target. Search asks for matching documentation and example APIs, and must acknowledge uncertain compatibility.

Detection reads only a bounded set of local `pom.xml`, `build.gradle(.kts)`, `package.json`, `pyproject.toml`, `.python-version`, `go.mod` and `Cargo.toml` files between the selected file and project root. It does not run builds, resolve dependency trees, read outside the project or send manifests to AI. Only the displayed target, topic, resource choice and guidance are sent during a requested lookup. Build profiles, computed properties, lockfile resolution and installed interpreter/compiler versions are not inferred.

Choose **All resources**, **Docs**, **Videos**, **Code** or **Books / PDFs**. Changing this filters existing source links locally; citations remain visible with the explanation. **Find web resources** explicitly searches for that type. If no matching links were found, the panel says so. Resource types are identified from URL/domain patterns and may be incomplete for unusual sites.

Choose **Save** beside a source, then open **Bookmarks** in the header. Search by title, topic, version or website, or filter by resource type. Bookmarks are local to this editor/project, deduplicated by URL, and kept until individually removed—even after History expires or its cache is cleared. Up to 100 are kept; the limit asks you to remove one rather than silently discarding saved links. Bookmarks store source metadata, target and retrieval date, not selected code or API keys. IntelliJ stores them outside the project under its configuration directory's `watdatmean/bookmarks`; VS Code uses workspace storage. They are not synced between editors.

Detection, link filtering and bookmark actions use **0 AI tokens**. A new lookup uses the same bounded summary request; version and filter are compact fields, not additional AI calls. The 24-hour cache separates results by target version and resource choice to avoid reusing a mismatched search.

### Find a previous entry

Use **History** next to the provider settings in either editor. Completed explanations save automatically for this project, including their selected code and file/line. Search by code, file, language, explanation, or a saved change. Open an entry to review it, then choose **Back to current code** to return to your lesson and draft unchanged. Reading history uses no AI tokens.

Repeated requests for the same code in the same file update one entry. Its explanation, more detailed walkthrough, example, and change explanation are grouped under **Saved view**, keeping the latest result for each action. Selections, keystrokes, cancelled requests, and concept expansions do not create entries. History holds up to 30 recent entries within 2 MB; older entries expire as needed. It starts saving with this release and does not recover earlier sessions.

Remove individual entries with **×**, use **Clear history** to remove all, or uncheck **Save completed lessons** to pause saving without removing existing entries. History is a local snapshot, not proof that the code ran successfully; the original file may since have changed. Review does not apply edits or follow old evidence links.

Saved code and lessons stay in VS Code's workspace storage or IntelliJ's configuration directory under `watdatmean/history`, outside the repository. They are not synced between editors or sent to AI when reviewed. History does not store provider keys or the additional source snippets collected for project context. It is separate from **Clear Explanation Cache**; use **Clear history** to remove saved entries.

### Code colors that follow your editor

The original code, **The small pieces**, **Your version**, **Another example**, and saved snapshots use local syntax colors from your editor. Changing themes refreshes the colors without clearing the lesson, selected piece, or draft. Individual pieces have subtly filled rectangular boxes and stronger selected/focus borders, including inside nested TypeScript/JavaScript bodies. The practice area preserves normal typing, selection and undo. Coloring makes no AI requests and uses **zero API tokens**.

**Another example** starts numbering at 1. History shows the recorded file line numbers beside saved source and drafts; examples inside saved lessons also start at 1. These gutters are read-only because examples and old snapshots may not match a current file. Long snippets scroll without creating thousands of gutter elements.

All three areas also show line numbers using the editor's gutter colors. Numbers start at the selection's actual line in the complete file and cover every displayed line, including blank lines and lines without boxed pieces. Scroll sideways and the gutter stays visible; open a piece to see its file and line. **Your version** numbers update while you type and show the lines the draft would occupy if applied. **Use latest code** refreshes positions after changes elsewhere in the file. Numbering is entirely local and uses no AI tokens.

Click a line number to focus that line in the original file. Keyboard users can Tab into a gutter, choose a line with Up/Down or Home/End, and press Enter or Space. Draft clicks open the original numbered line; extra rows beyond the original selection become available after applying the draft. If the source changes, choose **Use latest code** before navigating so the positions are current. Jumping preserves your draft and lesson and makes no AI request.

The destination line receives a brief theme-colored highlight (about 1.2 seconds), which clears automatically and moves to the latest click. Wider gutter spacing separates numbers from code, and tab indentation follows the original editor's tab width in all three code areas.

VS Code uses installed TextMate language grammars, active theme rules, and token/foreground color customizations. IntelliJ uses its installed language highlighters and editor color scheme, including on **2022.3**. Selections retain the lexical context before them, so a fragment inside a multiline comment or string stays colored correctly. Embedded languages follow the installed grammar/highlighter. Unsupported languages, missing themes, oversized input or highlighting limits fall back to readable plain text.

When semantic highlighting is enabled, VS Code also uses the installed language provider's symbol roles and the theme's semantic colors, including user overrides. IntelliJ reuses completed native semantic colors and supplies file-local Java role colors while analysis loads. Edited drafts keep their own syntax context; IntelliJ can also identify Java roles locally, while VS Code avoids borrowing semantic positions from a different document. Missing or slow providers leave syntax colors available. Inspection decorations are not copied. The editable layer keeps regular font weight/style so its glyphs align with the native text input; original code and pieces retain supported bold/italic styles. High-contrast system mode uses the native visible text input.

### Automatic Java setup

When **Oracle Java** is installed in VS Code, WatDatMean checks its Java server runtime in trusted workspaces. A working older JDK stays selected. If the path is missing or incompatible, it looks for an installed JDK on Windows, macOS, or Linux, checks it against the installed Oracle extension's requirements, and repairs the machine's server setting. Your existing project JDK is kept separately, so fixing the editor does not silently upgrade that project's Java version. Nothing is written to shared workspace settings.

If no compatible JDK is found, **Open Java Setup** opens Oracle's installation/selection flow. If Oracle already failed during startup, choose **Reload Window** after the repair. The check cannot control which extension starts first. Local WatDatMean explanations work without Oracle Java and this check uses no AI tokens.

Run **WatDatMean: Check Java Setup** to check again. **WatDatMean: Restore Previous Java Setup** undoes the latest adjustment if those settings have not subsequently been edited, and switches automatic setup off. You can also turn off **WatDatMean → Auto Configure Java Runtime** in Settings. Explicit workspace server settings, unknown extension requirements and custom Java options that cannot be checked safely are preserved for manual setup. This does not change `JAVA_HOME` or download a JDK automatically.

IntelliJ uses its IDE runtime and retains compatibility with **2022.3–2025.2.x**; this Oracle-specific repair is for VS Code. IntelliJ's existing automatic Node.js setup remains available in the [IntelliJ guide](intellij/README.md).

### Syntax help and partial selections

Both editors show a local syntax warning before the walkthrough. For supported
TypeScript/JavaScript punctuation mistakes, Java missing semicolons or closing
parentheses/brackets/braces, and Python block headers missing a colon,
WatDatMean offers a **Suggested correction**, checks it again, and explains the corrected
version. **Try corrected version** puts it in **Your version**; compare it before choosing
**Use this code**. Syntax checking and repair use no AI tokens and never execute your code.
Ambiguous mistakes need more context; WatDatMean does not invent missing expressions.

A selection ending before a closing brace can still be explained. It is labeled
**Partial selection**, with the missing punctuation offered as a standalone completion.
The full file may already contain it. Exact results remain unknown, and applying a
draft still checks the whole file. Other languages retain their existing editor checks;
automatic syntax repair is not a general compiler or runtime checker.

Java warnings explain the punctuation's purpose and show its position in the
selection. Names, expressions, valid methods and constructors can be selected on
their own. A closing brace offered at the selection boundary is a **standalone
completion**, since the rest may already exist in your file. Missing values, array
sizes, exception handlers and unfinished text are reported without inventing code.
These checks run locally in both editors, without requiring a JDK or Java extension
for the syntax-help step. Your editor/compiler still handles full Java validation.

### Checking Python code

Open a `.py` file, select the code, and press **Ctrl+Alt+E**. **The small pieces** explains local names, assignments, common built-ins, and written imports. In **Try it yourself**, edit the draft and choose **See what changes**. The checker examines the proposed whole file, including indentation around your selection. Detected errors show line numbers and keep **Use this code** disabled.

Both editors use the same local Python 3 grammar and structural checks. These catch common indentation/tab problems, unfinished strings/brackets/functions, invalid assignment targets, duplicate or misordered parameters, incomplete `try` blocks, and misplaced `return`, `break`, `continue`, `yield`, or `await`. They handle valid multiline code, decorators, comprehensions, unpacking, and async functions without running the file or requiring Python installation. These checks are not a complete CPython compiler, type checker, dependency checker, or runtime test. References across files still depend on your editor's Python language service.

## If the learning panel does not open

Run **WatDatMean: Reopen Learning Panel** from the Command Palette. This creates a fresh panel for the same code. A panel that does not finish loading also offers this action after ten seconds.

IntelliJ has the same action in **Tools** and **Find Action**. Both editors refresh the saved selection even when focus is on the panel, cancel pending work, and clear previews that are no longer valid. Reopening resets the displayed lesson and unapplied draft; it does not change your source file.

If VS Code reports **Could not register service worker: InvalidStateError**, the failure occurs in VS Code before the extension's panel can load. Save your work, fully quit VS Code (**Cmd+Q** on macOS), and reopen it. This is a [reported VS Code webview issue](https://github.com/microsoft/vscode/issues/330595); reloading one window may not restart the affected browser process. Reopening the panel cannot repair a persistent error in that process.

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

Sequential Java streams and lambda expressions also use the local path. Supported sources include `Stream.of`, `IntStream.of`/`empty`/`range`/`rangeClosed`, `Arrays.stream`, and ordered collection streams. Pipelines can filter, map, convert between reference and int streams, box ints, sort, remove duplicates, skip/limit items, and take/drop a matching prefix. Terminals include `sum`, `count`, identity-based `reduce`, `anyMatch`/`allMatch`/`noneMatch`, `forEach`/`forEachOrdered`, `toArray`, `toList`, and `collect(Collectors.toList())` or `joining`.

Expression and block lambdas support standard `java.util.function` interfaces, typed or inferred parameters, local calculations, and captured scalar locals that are final or effectively final. Explanations show lazy evaluation, intermediate/terminal relationships, early stopping, saved captures, stream reuse, and exceptions. A known-size `count` can skip mapping functions—even a mapping that would otherwise throw. Source changes made before traversal are reflected. Read-only `Stream.toList()` results are distinguished from collectors whose mutability is unspecified. These checked examples need **zero API tokens** in both editors.

Method references (`::`) also use the shared local path: supported static helpers, bound/unbound instance methods, `System.out::println`, and constructors. Examples include `Integer::parseInt`, `Integer::sum`, `String::trim`, `String::length`, and `Box::new`. Explanations distinguish saving a receiver now from calling its method later, and preserve overload selection and virtual dispatch. A bound null receiver fails when the reference is created, even if the callback would never run.

`Optional<String/Integer>` and `OptionalInt` cover present/empty/null distinctions, factories, retrieval, `filter`, `map`, `flatMap`, `or`, presence actions, fallback suppliers, exception suppliers, equality, and fresh zero/one-item streams where each API supports them. `orElse` evaluates its argument immediately; `orElseGet` calls its supplier only when empty. `map` turns a null result into empty; `flatMap` requires a non-null Optional. Streams also support `findFirst`, int `min`/`max`, and `reduce` without an identity, returning an Optional. Supported examples remain **zero API tokens** on both editors.

User-defined Java generics and interfaces also share the local path. Examples include `Box<T>`, `Pair<K,V>`, nested type arguments, diamond construction, single upper bounds such as `T extends Number`, and generic methods with supported inferred or explicit arguments. Generic method bodies retain the overload choices made from their declared bounds. Type arguments are invariant: `Box<String>` is not a subtype of `Box<Object>`, and generic arguments do not create separate runtime classes.

Interfaces support explicit `implements`, interface inheritance, generic contracts, public implementations, covariant returns, static/default methods, and concrete custom functional-interface lambdas/method references. Walkthroughs show actual-object dispatch, class methods taking priority over defaults, and more-specific interface defaults. Missing implementations, ambiguous defaults, erasure clashes, conflicting generic inheritance, or invalid bounds are declined instead of receiving a fabricated local output. These supported examples use **zero API tokens** on both editors.

This remains a bounded Java subset, using Java 17 library behavior. Stream elements are `int`, `Integer`, or `String`; general long arithmetic is not modeled, but stream counts can be stored and printed as `long`. Parallel/unordered pipelines, stream `flatMap`/`findAny`, array-constructor references, explicit generic method references, custom collectors, observable intermediate callback side effects, varargs outside the modeled factories, arbitrary generic library APIs or Optional object payloads, custom exception classes, try-with-resources, constructor overloads, packages and unmodeled APIs retain the existing AI path. Generic raw types, wildcards/capture, intersection/recursive bounds, generic arrays, unchecked casts, generic overload inference, unconstrained generic results and some nested inference cases also use fallback. Interface constants, private methods, `Interface.super` calls and default-method execution on lambda objects are not locally modeled. Local stream callbacks allow modeled pure library references and simple field-free static helpers; uncertain callback effects decline. Uncaught failures, JVM-generated message/identity details, uncertain library-error ordering, incomplete context and resource bounds decline the whole local result. Missing values are not invented. No selection is compiled or run by the extension. AI prompt sizes and reasoning settings are unchanged. See [the test report](TEST_REPORT.md) for independent Java 17 comparisons and exact scope limits.

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

IntelliJ users do not need to install Node separately: the plugin detects a compatible runtime or downloads a private, checksum-verified copy. Building from source still requires Node and npm. `npm ci` now also prepares a private Java 17 build runtime automatically, reusing an installed JDK or verifying and downloading one. `npm run gradle:intellij -- buildPlugin` uses that runtime and the pinned Gradle wrapper without configuring Java/Gradle paths. VS Code and IntelliJ use the same checkout setup; generated scratch projects are excluded from VS Code's Java import. The first download needs internet access. See [automatic build setup](intellij/README.md#build-from-this-repository). Installed plugins do not require Gradle. IntelliJ build outputs and local runtime settings are ignored by Git; commit its `src/`, build configuration, and shared bridge sources.

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
`npm run package` creates the installer; it does not update the extension already running in VS Code. Install the new VSIX and reload the window to use it. For local development, rebuild with `npm run build` and reload the Extension Development Host.

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
