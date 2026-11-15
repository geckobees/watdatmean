# Changelog

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
