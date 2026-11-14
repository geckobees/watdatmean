# WatDatMean

**Learn programming through the code you are already working on.** WatDatMean supports **VS Code** and **IntelliJ IDEA** with a shared learning engine and panel. VS Code provides short TypeScript (`.ts`) hover explanations; IntelliJ adds compact Java explanations with theme colors to its native documentation popup. IntelliJ also explains selected code in the editor's language. Both provide free local TypeScript syntax breakdowns in the panel and optional OpenAI, Anthropic, or Groq help.

For IntelliJ installation, automatic Node.js setup, language capabilities, and builds, see [the IntelliJ guide](intellij/README.md). This release targets IntelliJ **2022.3–2025.2.x**; the same Java 17 plugin has been tested on Community 2022.3 and 2025.2.4.

## Try it

### Visual Studio Code

1. Install `watdatmean-0.1.2.vsix` using **Extensions → … → Install from VSIX** in VS Code 1.95 or newer.
2. Open a `.ts` file. Hover over code for a short paragraph explaining what it does, with code names highlighted in context. Functions describe their inputs and return types; object creation explains the constructor and reference; simple nested calls explain the inner and outer calls in order. Open the learning panel for individual syntax pieces.
3. Click **Wat Dat Mean? →**, right-click → **WatDatMean: Explain Selection or Code at Cursor**, or press **Ctrl+Alt+E** (Mac: **Cmd+Alt+E**).
4. Click **Connect provider**, select **OpenAI**, **Anthropic**, or **Groq**, enter your API key in the password prompt, and confirm a model ID available to your account.
5. Request an explanation, explore another example, or open **Try it yourself** to change code and see the difference.

API keys are stored in **VS Code SecretStorage**, never in project settings or the panel. A provider API account with available credits is required for AI features. Chat subscriptions do not supply API credits. Keys are checked on the first request, not when saved. You can switch providers or remove a key through the Command Palette.

Run **WatDatMean: Open Demo Project** for a small rewards-system example. [The demo walkthrough](demo/README.md) demonstrates the complete flow in three minutes.

## What works

| Feature             | MVP behavior                                                                                                                                                                                                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instant syntax      | TypeScript AST-based breakdowns of declarations, calls (including nested calls), member access, arguments, operators, returns, imports, and control flow. Local variable declarations explain where values originate. Click a piece for a predefined expansion. No network calls. |
| Understand code     | Select exact code or inspect at the cursor. On a function/method name, inspect the whole declaration; inside its body, inspect the smaller statement.                                                                                                                             |
| Two context views   | **Just this code** sends only the inspected snippet. **In this project** adds bounded nearby code and workspace references/definitions for the inspected symbol.                                                                                                                  |
| Transfer learning   | Request a separate example in another domain, with concrete values and expected behavior. Click underlined terms to reopen their definitions instantly. Choose **Explain further · AI** for a deeper explanation.                                                                 |
| Adjustable guidance | **Learning the basics** explains terminology. **Getting up to speed** emphasizes contracts, dependencies, and side effects.                                                                                                                                                       |
| Try it yourself     | Edit your version, choose **See what changes** for a before/after comparison and syntax check, and optionally ask AI to explain the change. Keep trying or use **Start over** to reset the draft. Code is not executed.                                                           |
| Apply an edit       | Explicit preview, syntax check, and final confirmation. Workspace edits invalidate the preview. Changes stay in the editor, support Undo, and are not automatically saved. The panel reloads each applied version so you can keep experimenting.                                  |
| Token efficiency    | No hover AI calls; bounded context; an 80-entry, in-memory LRU cache keyed by code, relevant context, task, guidance, provider, and model. Cache hits make no new API request.                                                                                                    |

## Data and safety

- The extension host sends requests directly to the selected provider's fixed HTTPS endpoint. Keys never enter the webview. Redirects are rejected. No telemetry is collected by this extension.
- Code is sent only after an explicit AI action. Hover, syntax expansions, diff preview, and language-service references are local.
- Standalone requests send up to 12,000 characters of selected code. Project and impact requests also send up to 5,000 characters of nearby code and up to 12 reference/definition snippets of 650 characters each, including relative paths and line numbers. Impact adds the replacement (up to 12,000 characters).
- Project snippets are restricted to `.ts` files within the open workspace, excluding common dependency/build directories. **Secrets embedded in selected or nearby source are not automatically redacted.** Review your code before requesting AI help.
- OpenAI requests set `store: false`. Other provider retention policies still apply. The extension cache is memory-only and can be cleared with **WatDatMean: Clear Explanation Cache**.
- A **confirmed reference** means the VS Code language service returned that source location. It does not mean a runtime behavior or affected test is confirmed. All AI impact descriptions are labeled predictions.
- AI output is schema-validated and rendered as text. Supporting-code links are resolved from local evidence IDs; model-generated paths or commands are never executed.
- Untrusted workspaces allow local explanations but block AI requests and applying edits.

## Token usage

AI requests use short instructions for the selected action and a **200-token output cap** on every provider. Explanations return a brief summary and up to two concepts with short definitions, preserving clickable keyword definitions. Example code and deeper concept explanations are requested separately when you click their buttons. Local syntax explanations and cached results use no new API tokens.

The same compact requests and usage display work in VS Code and IntelliJ. IntelliJ retains the detected language for explanations and examples; requests without a language default to TypeScript. Native Java hover stays local and does not start the learning engine.

The selected code, nearby context, reference snippets (including their locations), and replacement code retain the existing limits described above. They are not shortened to meet a token budget. **Under 500 total tokens is a target for small requests, not a guaranteed limit:** input tokens count too, so project context can exceed it. The panel shows provider-reported input, output, and total usage when available, and flags totals of 500 or more. Cached results show zero new tokens.

OpenAI defaults to a model without reasoning. Groq defaults to `qwen/qwen3.8-27b` with `reasoning_effort: none` to leave the output budget for the answer. Qwen is currently a preview model on Groq. Existing model overrides are preserved; reasoning models may spend their output budget on internal reasoning and return a cut-short error. No automatic retries are made, including for truncated or invalid JSON responses.

## Develop

Use Node.js **22.12+** and npm. Clone/open this folder, then:

```sh
npm ci
npm run check
npm test
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

## Settings

| Setting               | Purpose                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `watdatmean.provider` | `openai`, `anthropic`, or `groq`. Global application setting.                                                     |
| `watdatmean.model`    | Model ID override for the selected provider. Configure through the command to switch model and provider together. |
| `watdatmean.audience` | Default guidance: `beginner` or `experienced`. The panel can override it.                                         |

Default model IDs are `gpt-4.1-mini`, `claude-haiku-4-5`, and `qwen/qwen3.8-27b`. Model availability depends on the provider/account and may change; any compatible text model ID can be entered. To use a new default after previously configuring a model, run **WatDatMean: Configure AI Provider / API Key** and enter that model ID, or clear the `watdatmean.model` setting.

Groq models with known [strict structured-output support](https://console.groq.com/docs/structured-outputs)
receive a compact schema for the selected action. Other Groq models use JSON object mode. Omitted optional
sections are treated as empty; malformed fields produce a specific error without
exposing the response content. The extension does not automatically retry or bill
for an additional request when validation fails.

## Boundaries of this MVP

- One IDE and one language: VS Code desktop and TypeScript `.ts`. JavaScript, TSX, C#, and other IDEs are outside this build.
- Reference coverage comes from the built-in TypeScript language service for **one inspected symbol**, capped at 12 locations. It is not a complete dependency graph. Dynamic dispatch, indirect callers, reflection, generated code, and references outside the workspace may be missed. Test files are identified by filename/path, not test execution.
- Reference lookups time out after four seconds. If no references appear while the project is indexing, wait and request again. Open the project folder with its `tsconfig.json` for the best results.
- Syntax checking is not type checking. The extension never compiles or executes your replacement, runs tests, or guarantees an edit is safe. Check VS Code diagnostics and run your project tests after an edit.
- AI explanations depend on the configured provider. There is no fabricated offline AI mode, agentic editing, conversation history, streaming, or background indexing. Large files (over 500,000 characters) are intentionally excluded.
- Live provider billing/authentication is not covered by automated tests; adapter tests use mocked HTTP responses.

## Implementation

- `src/analyzer.ts`: TypeScript parser and predefined explanations.
- `src/syntax.ts` and `src/bindings.ts`: context-aware syntax pieces and file-local binding lookup. These describe syntax and declarations, not live runtime values or imported implementations.
- `src/hover-explanation.ts`: concise local prose for declarations, calls, and statements, with code names safely formatted inline.
- `src/context.ts`: bounded VS Code reference/definition collection and source links.
- `src/provider.ts`: provider protocols, request cancellation, safe errors, and response validation.
- `src/extension.ts`: commands, hovers, secret storage, cache orchestration, diff and guarded edits.
- `media/`: theme-aware webview with keyboard-accessible controls and text-only model rendering.
- `tests/`: parser, provider, caching, webview, and extension-host checks.

Provider integration follows the official [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create), [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages), and [Groq API documentation](https://console.groq.com/docs/openai). Editor integration uses the [VS Code API](https://code.visualstudio.com/api/references/vscode-api) and [webview security guidance](https://code.visualstudio.com/api/extension-guides/webview#security).
