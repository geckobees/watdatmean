# Changelog

## 0.1.30

- Fix shared web-summary validation rejecting complete answers with Markdown formatting, source markers or a single JSON code fence.
- Keep retrieved sources available when an AI summary is incomplete, malformed or has invalid references. Show a clear notice, preserve actual usage, version targets, filters, bookmarks and History, and never display the rejected answer or invent replacement citations.
- Withhold explicit false `Collectors.toList()` mutability/view guarantees caught during live testing, using a narrow local check. Keep the retrieved Java documentation accessible without another AI request; this is not a general factual verifier.
- Keep the same 3,500-byte input and 900-output-token limits with no automatic AI retry. Cache sources-only results for five minutes to avoid repeat spending, then allow a later explicit lookup to recover the summary. Preserve IntelliJ 2022.3 / Java 17 support.

## 0.1.29

- Replace the main slogan with WatDatMean and give both panels sharper Steam-inspired navy/blue surfaces, square card edges and stronger Arial headings. Preserve the colored stage controls and local switch sound.
- Keep valid syntax colors when a native highlighter temporarily returns no tokens. Ignore malformed responses without erasing the last valid palette, retain bounded retry behavior, and use basic local Java/JavaScript/TypeScript/Python colors while native syntax and semantic information loads.
- Keep code backgrounds, fonts, gutters and native token colors separate from the dark panel chrome. IntelliJ's fallback colors use its editor scheme. Update light/dark code surfaces without resetting drafts or lessons; no additional AI tokens.

## 0.1.28

- Refresh the shared learning panel with blue/teal card accents and numbered glossy stage controls: green for Understand, yellow for Another example, and red for Try it yourself. Match each stage's primary action and use a soft glow with clear focus/selection states.
- Bundle an original 95 ms soft switch click for stage buttons and main actions. Sound on/off is saved by each editor. Playback is local, quiet, and limited to user activation; unavailable audio never blocks a lesson or edit.
- Preserve native code colors, individual pieces, line gutters, history, resources and bookmarks. Support narrow panels, keyboard navigation, reduced motion and high contrast, with IntelliJ 2022.3 / Java 17 compatibility and no additional AI usage.

## 0.1.27

- Keep native syntax colors on displayed snapshots after source edits; recover from temporary theme/grammar failures with one local retry. Keep live semantic highlighting limited to matching documents.
- Add themed line gutters and syntax colors to Another Example (starting at 1), saved source snapshots (their recorded file lines), and saved drafts on both editors. Refresh with theme changes, virtualize long gutters, and discard obsolete color replies.
- Break nested TypeScript/JavaScript bodies and object types into individual pieces instead of outlining whole blocks. Give pieces a subtle rectangular fill and a stronger selected border without changing code spacing.
- Preserve IntelliJ 2022.3 / Java 17 support and document the intentional legacy native-documentation adapter. These display changes use no AI tokens.

## 0.1.26

- Replace uncontrolled provider browsing with bounded public search excerpts and one compact AI summary on both editors. Enforce 3,500 input-content bytes (including the response schema), 900 output tokens, no browser tools, low Groq reasoning within the completion cap, no automatic AI retries, and no overlapping lookups.
- Preserve explanation settings, target versions, resource filters, bookmarks and cached History. Reject unrelated sources and missing fixed documentation editions before spending tokens.
- Disclose Bing search and the DuckDuckGo fallback, bound local HTML/RSS parsing, and fetch excerpts only from allowlisted official reference hosts. Do not download PDFs or videos.
- Correct IntelliJ's web-summary model label; retain IntelliJ 2022.3 / Java 17 compatibility.

## 0.1.25

- Test real Groq searches through the VS Code extension host and IntelliJ 2022.3 bridge, then replay public results in both panels without API calls.
- Scope exact Java/Python documentation targets to official versioned pages and make repository/video searches explicit. Reuse reviewed Java collection and Java 8 API facts to reduce unsupported guarantees and newer-API examples.
- Use Groq GPT-OSS 120B for the optional web supplement with low reasoning and a compact search-only task. Keep the selected explanation model unchanged; cache hits, filters and bookmarks remain local.
- Recognize HTML books, preserve original source titles, hide opaque browser citation IDs without guessing links, exclude search-wrapper pages, and distinguish temporary provider errors from account-access failures.
- Preserve IntelliJ 2022.3 / Java 17 compatibility. Add credential-free real-result regressions and an explicitly invoked live test harness.

## 0.1.24

- Add editable project version targets and resource filters to web resources in both editors. Detect bounded literal manifest declarations locally, preserve unknown versions, and separate search caches by target and resource choice.
- Add explicit source bookmarks with local search/filtering, URL deduplication and removal. Keep up to 100 independently of recent History, without silent expiry or additional AI calls.
- Preserve the existing search request/output limits, source provenance and IntelliJ 2022.3 / Java 17 compatibility.

## 0.1.23

- Add an optional, initially-off **Add web resources** switch to Part 1 in both editors. Search a public topic for compact explanations, illustrative code, practical uses and source links while preserving the normal code explanation and selected model.
- Support Groq, OpenAI and Anthropic search APIs, with separate usage, bounded output, cancellation and a 24-hour in-memory cache. Send only the editable topic and guidance to web research, never project source context.
- Require provider source metadata for clickable links, open sources on click in the external browser, and keep successful supplements with their lesson in project History. Preserve IntelliJ 2022.3 compatibility.

## 0.1.22

- Add local project history to VS Code and IntelliJ 2022.3+: one searchable History view for completed lessons, with repeated code grouped into one entry and up to 30 recent entries retained.
- Preserve the current lesson and draft when reviewing saved code, explanations, examples and changes. History review uses no AI tokens and does not apply edits.
- Add individual removal, confirmed clearing and paused saving. Bound storage, persist across reloads, and exclude failed, cancelled and stale responses from history.

## 0.1.2

- Add shared zero-token Java arrays and exception handling for both editors: array creation, indexing, aliases/copies, multidimensional arrays, array fields/parameters/returns, covariance, try/catch/finally, multi-catch, checked throws, rethrows and common built-in failures. Preserve evaluation order and pending returns across finally; distinguish catchable Java failures from uncatchable reader limits. Keep explanations compact and model-backed requests unchanged, advance caches to version 12, and validate varied examples against Java 17 and both native IDE hosts.
- Add shared zero-token Java loop, collection and method-overload explanations in VS Code and IntelliJ 2022.3+. Summarize repeated iterations compactly, preserve loop control and collection mutation, distinguish index/value removal, and bind overloads before runtime overriding. Decline uncertain order, exceptional execution and unsupported syntax. Keep model-backed requests unchanged, invalidate both caches (version 11), and compare varied programs against Java 17 and both native editor hosts.
- Generalize the shared zero-token Java reader beyond the two-class construction example. Support ordinary/static nested classes, multiple objects and aliases, longer inheritance chains, scalar parameters/locals, return values, field updates, integer division/remainder, and self-contained arithmetic/print selections. Validate the accepted subset before tracing, preserve per-object state and evaluation order, and retain AI for unsupported syntax. Add independent Java 17 compiler comparisons and native editor-host coverage; version both lesson caches to 10.
- Fix the supported complete Java construction example in both editors with a bounded local trace: preserve hidden field ownership, superclass/initializer order, virtual dispatch during construction, casts, static calls through null, and exact output. Use four compact steps for the supplied example and optional detailed events; require no AI tokens. Decline incomplete/unsupported programs, preserve other features and model settings, and invalidate both lesson caches. Compare controlled variants against Java 17 execution.
- Avoid hidden reasoning and AI requests for narrowly recognized literal/print explanations in both editors. Supply a bounded, reviewed local walkthrough with operations, exact output, definitions and output-function origins; retain the existing AI reasoning path for complex, uncertain, contextual, or deeper requests. Preserve AI prompts, completion ceilings, and all panel actions. Live no-reasoning replies omitted the walkthrough and were rejected; keep them in the comparison evidence.
- Optimize both editors' shared requests: remove repeated prompt/schema instructions, reference exact duplicate context while preserving source and evidence locations, and restore reviewed definitions locally instead of regenerating them. Preserve output/reasoning allowances and all panel actions; compare before/after usage on identical Java, Python, and TypeScript fixtures.

- Strengthen Python previews beyond the recovering editor grammar: check indentation/tab consistency, statement placement, assignment targets, parameter rules, and incomplete try blocks. Keep invalid edits from reaching Apply; cover 87 focused valid/invalid Python cases.
- Add local Python assignment, scope, built-in, and written import explanations; route TypeScript, JavaScript, and JSX through their correct parser in both editors. Other VS Code text languages can use selected-code AI help without pretending their syntax was checked.
- Use one compact walkthrough in both panels, without repeated connections, pitfalls, or per-step output blocks. Keep definitions and reviewed practice collapsed; add explicit **More detail**. Preserve ordered steps and important distinctions without forcing a two-sentence summary.
- Assemble output from each trace step's printed characters and display it once. Withhold a visibly incomplete Java println fragment instead of guessing missing characters. Keep local arithmetic results from repeating as extra steps.
- Add reviewed contextual Java polymorphism help and a narrow constructor/override safeguard. Explain field initialization after super() correctly, distinguish earlier parent-constructor calls, and leave field values/output unknown without declarations. Keep nesting/library clues in the prompt. Supplied project context remains available to the provider.
- Give explanations 900 completion tokens and expanded walkthroughs 1,600; Groq Qwen adds 2,048 tokens for low reasoning and returns only the final answer. Version both editor caches for the new format; retain no automatic retries or background AI calls.
- Correct observed teaching failures involving arithmetic, C# comparison boundaries, async Promises, Python HTTP/JSON and scope, Java list types, and rounded examples. Use short sentences and reviewed definitions; replace generated quiz answers with reviewed practice and omit unsupported quizzes.
- Answer basic supported literal arithmetic, incomplete selections, and matching examples locally at zero API cost. Existing definitions open locally. Label local results, preserve actual usage when a provider reply falls back to local facts, and never retry automatically. Arbitrary AI prose remains fallible.
- Add bounded project-mode import/declaration context and explicit written Java import clues; keep standalone requests limited to the inspected code.
- Fix a hover crash on unfinished declarations and fall back safely on excessive parser nesting. Exercise 1,200 malformed mutations and large/deep inputs in a memory-limited process.
- Document real Groq teaching-quality failures separately from passing software checks in `TEST_REPORT.md`.
- Explain Java variable origins inside existing pieces, including declaration lines, initializers, scoped parameters, loop elements, exceptions, and pattern variables.
- Follow IntelliJ UI themes and editor fonts/colors automatically without reloading the learning panel or losing drafts; keep the Java 17 / IntelliJ 2022.3 baseline.
- Fill IntelliJ's **The small pieces** for Java with offline syntax roles and clickable explanations; refresh them after edits without AI requests or Node startup.
- Add **WatDatMean: Open Java Demo**, which opens a fresh editable scratch file and its learning panel.
- Match VS Code's edit cancellation in IntelliJ: cancel pending confirmations, reject duplicate Apply actions, and release the busy state when confirmation ends.
- Merge compact task prompts, the 200-token output cap, provider usage reporting, and on-demand examples across VS Code and IntelliJ; retain language-aware requests, native Java hover, and cached definitions.
- Add compact, local Java explanations to IntelliJ's native documentation hover, preserving signatures/Javadoc and using editor theme colors, with one link to the learning panel.
- Adopt Cesar's short hover explanations with highlighted code names and clickable concept definitions in both learning panels.
- Reconcile the merged hover breakdowns, local binding explanations, concept tooltips, and repeatable edit experiments with both IDE adapters.
- Restore the IntelliJ plugin source and build/test scripts; support IntelliJ 2022.3–2025.2.x with Java 17.
- Detect Node.js 22.12+ and optionally download a private, checksum-verified runtime for IntelliJ.
- Share language-aware AI requests and the learning panel while retaining VS Code's TypeScript features.
- Fix merge markers, missing provider/development modules, stale preview handling, and panel disposal.
- Prevent an infinite hover-scanner loop and memory exhaustion while declarations are incomplete during editing.
- Test malformed declarations in a memory-limited process and hover behavior after real VS Code edits.
- Keep low reasoning effort for Groq GPT-OSS models and omit the option for other models.
- Distinguish rejected request settings, model availability, and JSON generation failures without displaying private provider content.

## 0.1.1

- Request strict structured output from supported Groq models, including the default GPT-OSS 20B.
- Accept omitted optional explanation sections instead of discarding otherwise usable responses.
- Identify malformed response fields in errors while keeping provider content private.
- Keep validation for required content and filter unsupported evidence links.
- Format source consistently and add reusable formatting commands.

## 0.1.0

- Initial TypeScript learning extension for VS Code.
