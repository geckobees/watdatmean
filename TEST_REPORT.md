# WatDatMean teaching fixes and testing — November 15, 2026

## 0.1.27: native colors, numbered examples/history, individual boxes

The screenshot's whole-line boxes came from the TypeScript analyzer representing nested bodies as one `{ … }` piece. Bodies and object type literals now expose their leaf pieces while preserving exact source offsets, indentation, comments and keyboard controls. Shared styling adds subtle rectangular fills and a stronger selected border using editor theme colors.

VS Code's displayed snapshot now retains its original source context after an edit, so a late color reply or theme refresh is not discarded just because the live file changed. Live semantic information still requires matching document text. Failed engine initialization is recoverable; empty highlighting results receive at most one delayed local retry. Unknown languages and size/time limits still fall back to readable text.

Another Example starts at line 1. Saved source and saved drafts use their recorded file line, and examples inside saved lessons start at 1. Both hosts highlight these independent blocks in their saved language, without borrowing semantic ranges from the active file. Gutters virtualize long code, remain outside copied code, and are read-only for snapshots/examples. Theme changes refresh colors; removing a block releases observers and palette entries, and late replies cannot color a replacement block.

Validation:

- TypeScript compilation and JavaScript syntax checks passed. The screenshot's undefined `changes`, `start`, and `end` errors are not present in saved `src/edit.ts`; its `trackRange` function has those parameters/bindings. Unsaved editor buffers were not overwritten. The intentional legacy IntelliJ documentation adapter has a narrow deprecation suppression to preserve 2022.3 support.
- All 1,414 unit tests passed; the 118 targeted analyzer, color-engine and host tests also passed after the final color-engine lifecycle changes.
- All 166 shared panel cases passed after updating the former whole-type-box expectation to the requested individual nested pieces (165 in the full run, the revised case in a targeted rerun). Tests cover blank/trailing CRLF lines, source offsets, 1,800-line examples, theme updates, saved-language isolation, stale replies, retry bounds, exact text, keyboard selection, IME and existing web/filter/bookmark behavior.
- The real VS Code host passed native default/dark/light/high-contrast grammars for TypeScript, Python, Java and HTML; TypeScript semantic roles and overrides; source navigation; Java syntax help; 297 independent Java examples; and extension activation/hover/panel/evidence checks.
- Native IntelliJ 2022.3 / Java 17 passed compilation and the full isolated bridge/JCEF suite, including actual example/snapshot coloring and gutters, native scheme changes, semantic colors, history, Java teaching, resource filters/bookmarks, navigation and panel recovery. Earlier concurrent runs hit the existing 150 ms native color budget during startup. The completed run passed with competing tests stopped. The daemon polling now tolerates a transient empty color result within its existing deadline, and the launcher requires a fresh PASS result so early IDE exits cannot masquerade as success.
- No AI API calls or screen capture were needed. Web regression fixtures replay previously retrieved results locally; there was no new live web/model benchmark in this task.

Release artifacts: `watdatmean-0.1.27.vsix` and `dist/intellij/watdatmean-intellij-0.1.27.zip`.

## 0.1.26: bounded web usage on both editors

The shared web engine now retrieves public search results locally (Bing RSS, with one DuckDuckGo HTML fallback) and sends only short excerpts to one AI summary request. It never gives the model browser tools. Limits are enforced before the request: **3,500 UTF-8 bytes of input content, including the response schema**, and **900 completion tokens**. The Groq summary remains GPT-OSS 120B with low reasoning, included in the same completion allowance. Provider message framing is additional; this is not a claim that bytes equal billed tokens. The selected code-explanation model/path is unchanged.

Retrieval allows at most two search requests (160 KB each), two allowlisted official references (500 KB each), and three displayed sources. Parsers bound traversal, reject unsafe URLs and XML entity declarations, do not execute page scripts, and never fetch PDFs/videos. The API key goes only to its provider. Version/type/relevance checks stop unusable results before any AI request. AI retries and overlapping lookups are blocked; cache hits, filtering, History and bookmarks remain local.

| Live Groq check, same public Java 17 streams topic | Input | Completion, including reasoning | Total |
| --- | ---: | ---: | ---: |
| 0.1.25 repeat with provider browsing | 32,558 | 449 | 33,007 |
| Bounded VS Code host | 823 | 327 | **1,150** |
| Bounded IntelliJ 2022.3 bridge/JCEF | 825 | 358 | **1,183** |

The bounded successes used about **96% fewer tokens** than the observed spike. The VS Code response reported 52 reasoning tokens, already included in completion usage. Both reused their second request from cache and verified actual-source bookmark deduplication, reload and removal. Native JCEF also checked all resource filters on the live result. Only the already configured Groq key was used; for native tests it traveled over a private stdin pipe, not files, environment or command arguments. This tests the production native bridge with that account, not native PasswordSafe retrieval.

Quality review kept the distinction between Collectors.toList() (unspecified type/mutability/thread safety), explicitly requesting a mutable ArrayList, conditional encounter order, and unmodifiable containers versus mutable contents. A trial with Qwen reasoning disabled produced an incorrect mutability claim and was rejected; it is **not** the shipped web model. Structured output keeps code separate from the walkthrough; incomplete prose and invalid source IDs are rejected without a correction call. HTTP 400 JSON-generation failures now explain the formatting budget instead of incorrectly blaming account access.

The final native example has concrete initialized inputs and was compiled with Java 17 and standard imports; examples are never executed by the feature. The earlier VS Code sample was a fragment requiring a stream input; the final prompt explicitly requires initialized inputs. Neither sample predicts private project values.

Validation:

- **1,410 unit tests**, TypeScript type checking, the full **152-test headless panel suite**, and the real VS Code integration suite passed.
- The full IntelliJ 2022.3 suite passed, including Java/Node integration, hover, syntax, edits, themes/colors, line navigation, History, filters/bookmarks and panel recovery. The final live run also passed its native panel assertions. Cold Java PSI was warmed in test setup before exact color assertions; production highlighting limits were not changed.
- Bounds tests cover huge Unicode excerpts and pages, schema bytes, malformed output, partial sentences, invalid citations, redirects, credentials, search failure, mismatched editions, wrong resource types, cancellation, overlapping requests and cache expiry.
- Public live-result fixtures preserve the older results for History compatibility and include both bounded successes. Additional paired UI replay verifies these fixtures without API calls.

Limitations: public search availability is external. Some probes returned generic, unrelated pages or a browser challenge. A later fresh VS Code query was correctly stopped with **zero AI calls**; it did not fall back to uncapped provider browsing. New Java 8/repository/video/book retrieval could not be claimed successful during those outages. Their matching/filter/bookmark behavior was tested with synthetic inputs and previously captured real results. Live API verification covered Groq; OpenAI/Anthropic request limits and parsing were tested offline. AI summaries remain illustrative, not a guarantee about every linked resource or arbitrary program.

The installers are watdatmean-0.1.26.vsix and dist/intellij/watdatmean-intellij-0.1.26.zip. The IntelliJ minimum remains build 223 (2022.3) and compiled Java bytecode targets Java 17. API controls follow [Groq's API reference](https://console.groq.com/docs/api-reference) and [reasoning documentation](https://console.groq.com/docs/reasoning).

## 0.1.25: real Groq web lookup checks

Used the configured Groq credential from VS Code SecretStorage in a separate
extension host. For the IntelliJ live checks the same credential traveled only
through a private stdin pipe to an isolated IntelliJ 2022.3 test profile, then
through the production Java/Node bridge. It was not placed in command arguments,
environment variables, files, source control or reports. This checks that bridge
with the configured account; it does not test reading the user's IntelliJ
PasswordSafe entry. No desktop capture, screenshots, video or Playwright traces
were used.

Live public synthetic topics covered Java 17 and Java 8 stream collection,
TypeScript 5.9 generics repositories, and Python 3.11 video lessons and free books.
Versioned Oracle pages were returned after adding explicit documentation scopes.
Videos, books and unversioned repositories do not establish exact target support;
the task asks for unknown compatibility to be stated. Resource provenance is
checked, not the factual correctness of every sentence generated by a model.

| Case                                    | Path                            | Reported total tokens |
| --------------------------------------- | ------------------------------- | --------------------: |
| Original Java 17 lookup, GPT-OSS 20B    | VS Code host                    |                26,257 |
| Compact Java 17 lookup, GPT-OSS 120B    | VS Code host                    |                 4,112 |
| Final Java 17 repeat, GPT-OSS 120B      | VS Code host                    |            **33,007** |
| Java 8, explicit official version scope | IntelliJ 2022.3 bridge and JCEF |                 2,838 |
| TypeScript repository lookup            | VS Code host                    |                 2,454 |
| Python video lookup                     | VS Code host                    |                 2,522 |
| Python book lookup                      | VS Code host                    |                 2,467 |
| Additional Python book lookup           | IntelliJ bridge                 |                 2,520 |

**Low new-query usage is not reliably solved by prompting.** Several compact
lookups were much smaller, but the final Java repeat opened a full reference page
despite the instructions. Groq Chat rejected `max_tool_calls` with HTTP 400
(`property 'max_tool_calls' is unsupported`). A separate Responses API probe
accepted the cap but returned an incomplete response and omitted the exact source
URLs needed by the current provenance checks. Neither experimental option is in
production. Low reasoning, compact instructions, one HTTP request, no automatic
retry, and the 24-hour cache remain in place. These measurements include a model
change, so they are not an isolated prompt-only benchmark. The Qwen explanation
model is unchanged.

Issues fixed:

- Explicit repository/video queries and exact official Java/Python documentation
  hints, including the older Java 8–10 URL layout. Version ranges remain ranges.
- Reviewed Java list contracts and Java 8 API guidance in relevant requests;
  no assumption that `Collectors.toList()` guarantees a mutable ArrayList.
- HTML books on author/publisher sites and book-named paths now appear in the
  Books filter. The additional native book request exposed this categorization
  failure; its real response was replayed through the corrected parser and JCEF.
  Categorization remains best effort and does not certify licensing or access.
- Original source titles survive duplicate browser-open metadata. Search wrapper
  pages are excluded. Opaque Groq citation markers are hidden without guessing URL
  mappings; retrieved links remain visible and code examples remain verbatim.
- A real HTTP 500 is now described as a temporary provider problem, not an
  account/key failure. No failed request was automatically retried.

Validation:

- **1,388 unit tests passed**; final Java 9/10 query additions passed the 55 focused
  resource tests and TypeScript checking.
- **150 browser tests passed**, including all six recorded real-response cases in
  both panel layouts, target labels, every filter, save/remove messages and no AI
  requests during local actions.
- Full **IntelliJ IDEA 2022.3 / Java 17 native suite passed**, including JCEF replay
  of all six real responses, real bookmark-file persistence, existing Java hover,
  themes, line navigation, syntax checks and panel recovery.
- Actual **VS Code extension integration suite passed**. Live repeated lookups
  returned cache hits without another HTTP request; bookmark duplicate/reload/
  remove checks passed, including a persisted-file round trip in the final host.
- Six illustrative snippets passed local checks without execution: Java snippets
  compiled with `--release 8` or `--release 17`, TypeScript type-checked with the
  installed compiler, and Python used the local parser. An actual Python 3.11
  runtime was not available for this web-resource test.

Reproducible public fixtures are in `tests/fixtures/web-research-live.json`;
they contain no credentials or retrieved full-page bodies. Ordinary tests use
no live provider calls. `scripts/test-web-live.mjs` is explicitly invoked only;
it requires `VSCODE_EXECUTABLE` pointing to the installation holding the key.
For native live tests, first prepare with `node scripts/test-intellij.mjs
--ide-home <2022.3-sdk> --java-home <jdk-17> --ui --live-web --prepare-only`, then
run the live harness with `--editor intellij --case java8-docs --ide-home <sdk>`.
Use unique `--report work/<name>.json` paths and run live cases sequentially.

The final packages are `watdatmean-0.1.25.vsix` and
`dist/intellij/watdatmean-intellij-0.1.25.zip`. The plugin retains `since-build=223`
and Java 17 bytecode; tests and credential-bearing harness code are excluded from
the production packages. AI supplements can still contain imprecise prose and
should be checked against the linked source before relying on an API guarantee.

## 0.1.24: version targets, resource filters and bookmarks

Both editors now suggest bounded literal version declarations from nearby project
manifests, allow an editable target, and label declarations/ranges as distinct from
installed versions. Computed or unknown targets remain absent. Recognized public
library suggestions use a fixed list; private package names and manifest contents
are not sent for research. No build tool or dependency resolver is executed.

The resource selector filters existing links locally and scopes the next explicit
web search. Citations remain with their claims. Results are cached separately by
version and resource choice. Source types use URL patterns, so classification can
be incomplete for unusual sites. Matching sources are requested from the provider;
compatibility is not independently certified by the extension.

Explicit source bookmarks are local to each editor/project, deduplicated by URL,
and searchable/filterable without AI. They retain topic, target and retrieval date,
survive normal history/cache clearing, and have no automatic expiry. At 100 entries,
saving reports a limit instead of silently removing an existing bookmark. Only
sources already known to the host can be saved or opened. Storage errors remain
visible in both History and the learning view; reviewing preserves the draft.

Validation:

- TypeScript checking and both production builds passed.
- Full unit suite: **1,383 passed**. A final computed-version regression case and
  related fixes then passed with **92 focused tests** (1,384 current unit tests).
  Coverage includes Java/Maven/Gradle, TypeScript/JavaScript, Python, Go and Rust,
  nearest declarations, dynamic versions, bounded reads, private-name exclusion,
  bookmark reload/duplicates/limits/storage failures, URL guards and cache keys.
- Full browser suite: **134 passed** using Edge. After the final bookmark feedback
  and stale-version checks, all **24 focused paired History/web tests passed**
  (136 current browser tests), including 360 px layout and keyboard focus.
  Desktop capture was not used; browser screenshots, video and traces were off.
- Real isolated **VS Code** integration passed: activation, native/semantic colors,
  hover/panel, source navigation, syntax fixes, project context and 297 Java cases.
  The first command-launcher attempt resolved its executable incorrectly; using
  the installed executable directly completed successfully without user settings
  changes. Adapter tests verify version/filter forwarding and bookmark provenance.
- Real **IntelliJ 2022.3** tests passed on the final shared panel and engine:
  version manifests through the packaged bridge, persistent/deduplicated bookmarks,
  the 100-entry limit, saved-source access after history clearing, and native JCEF
  target/filter/save/review/error controls. Existing editor and Java checks passed.
  Java 17 bytecode and build 223 compatibility are retained; existing SDK startup
  and deprecation warnings did not fail the suite.
- Version detection, filtering, saving, reviewing and removing bookmarks make
  **zero AI requests**. Across all three provider request formats, the representative
  `Java 17` / `docs` options add fewer than 100 serialized characters, preserve
  completion/tool limits and do not add requests. This measures request size, not
  live provider token billing. Research prompt wording was shortened to accommodate
  the options. The regular explanation prompt/model are unchanged.

No live provider call was made. Web access and matching quality were tested with
fixtures and still depend on actual provider results, model access and page content.

## 0.1.23: optional web resources

Both editors provide an initially-off **Add web resources** switch in Part 1.
The normal explanation appears first. A separate lookup receives only the editable
public topic and guidance level, then adds a compact, collapsible supplement with
examples, practical uses and provider-sourced links. The switch is remembered per
project; disabling it cancels a pending lookup. Research uses a separate search
model and displays its usage, retrieval date and potential search charges.

Links must be present in provider search metadata and pass public HTTP(S) URL
validation in the host. Inline citation positions are retained when supplied.
Web content renders as text and illustrative code, never executable HTML. Sources
open externally only on click. Successful supplements attach to the matching
saved explanation; late responses cannot recreate cleared or paused history.
Research has bounded requests, output and cache storage, with no automatic retry.

Validation:

- Full unit suite: **1,360 tests passed**. After adding an inline-citation case,
  all **93 focused provider, bridge, extension and history tests passed** (1,361
  current unit tests). TypeScript checking passed.
- All **130 browser tests passed** using installed Edge. The 18 history/web tests
  passed again after citation rendering changes, and all 10 paired web tests
  passed after restoring the remembered switch's enabled search button. Coverage
  includes opt-in, topic-only requests, cancellation, stale responses, source
  provenance, safe rendering, failures, cache usage, history and narrow layouts.
- Real isolated **VS Code** integration passed: activation, panel, native and
  semantic colors, hover, navigation highlights, syntax fixes and 297 Java cases.
  Adapter tests exercise the new provider request and history paths with fixtures.
- Real **IntelliJ 2022.3** checks passed: native source URL/provenance guards,
  persistence of web supplements, history-clear race protection, packaged bridge
  opt-in, and JCEF switch/topic/source/usage interactions with the draft preserved.
  Existing native themes, navigation, Java examples, hover, syntax help and guarded
  edits also passed. Plugin sources compile for Java 17 against build 223.
- Both panel layouts and a 360 px viewport were visually checked. Source links
  use the editor's theme link colors and support visible keyboard focus.

Provider tests use synthetic Groq, OpenAI and Anthropic response fixtures. **No
live provider search was charged or verified** in this run. Actual account/model
access, live search quality and external page availability still depend on the
provider. Failed, incomplete or source-less responses leave the core lesson intact.
Search availability and request formats were checked against official provider
documentation. Existing IntelliJ startup/deprecation warnings remain non-fatal.

## 0.1.22: local project history

Both editors now save completed explanation, walkthrough, example and impact results
behind one **History** button. Identical selected code in the same file updates one
entry, with the latest result for each action grouped together. History is bounded
to 30 entries / 2 MB, with a 256 KB per-entry limit. It stores selected code,
file/line, lesson and optional replacement, not API keys or extra project-context
source. Selecting code, typing, concept expansion, failures, cancellation and stale
responses do not create entries. Pausing saving retains existing entries.

VS Code uses project workspace storage; IntelliJ writes atomically to the IDE
configuration directory on a serial background worker. History review is read-only:
current lessons/drafts remain intact and old correction/evidence actions are not
attached to the current file. Reviewing, searching and removing history uses no
AI tokens. Saved explanations are snapshots, not verified executions.

Validation:

- TypeScript check and both production builds passed.
- Full unit suite: 1,324 tests passed; two additional cancellation/stale-response
  adapter tests then passed with all 35 extension tests (1,326 current unit tests).
- All 120 browser UI tests passed using installed Edge, including eight paired
  VS Code/IntelliJ history tests covering search, grouped results, saved changes,
  text-only rendering, no AI/edit/evidence requests, draft preservation, cleanup,
  paused saving, failures, keyboard focus and 360 px layout.
- Native IntelliJ **2022.3** suite passed: history persistence/reload, duplicate
  grouping, pause, deletion, clear, corruption recovery, UTF-8 byte limits and
  oversized-save rejection. Real JCEF history review preserved the active draft
  and made no AI requests. Existing Java examples, themes, navigation, hover,
  panel recovery and guarded edits also passed. Compiled for Java 17 / build 223.
- Isolated real VS Code integration passed: activation, native/semantic colors,
  hover, panel, navigation highlights, syntax fixes and 297 Java examples.
- History list/detail screenshots were visually reviewed. No real provider was
  called; lesson fixtures and local explanations were used throughout.

The default Playwright browser was absent on this machine. Browser tests were run
successfully with the installed Microsoft Edge instead. Existing IntelliJ test
startup/deprecation warnings did not fail the native checks. History starts with
this version; earlier transient sessions are not recovered or synced across IDEs.

## Checkout follow-up: resolved Java paths and stale imports

The installed Gradle for Java 3.19.0 extension rejected the literal
`${workspaceFolder}/intellij/.gradle/java-home` setting. Earlier fresh-profile
checks covered the Java language servers without this task importer. The user's
existing Red Hat project also retained Java 25.0.4.1 in its Buildship cache, and
Oracle discovered two retired test projects below `work`.

Checkout setup now generates resolved Java 17 paths in the ignored
`.vscode/settings.json`, preserving JSONC comments, unrelated preferences and
explicit runtime overrides. It migrates the old placeholder and remembers its own
generated path so rerunning setup after moving a checkout updates it. The Gradle
task importer is scoped to `intellij` by default. Import fixtures use the OS temp
directory and their own generated configuration. Existing retired fixtures were
moved out of this checkout, and its Java importer cache was backed up before
requesting the standard rebuild. Global Java settings and source files were not
changed by that cache repair.

Validation:

- **26 setup tests pass**, including path migration, spaces, idempotence, preserved
  custom paths/comments and rejection of malformed settings; TypeScript checks pass.
- **Real VS Code + Red Hat Java 1.58 + Gradle for Java 3.19** passes with a Java 25
  language server: the build runs on Java 17.0.21.0.2, IntelliJ SDK types resolve,
  Java source/target remain 17, plugin tasks are discovered, scratch projects are
  excluded, and there are no error diagnostics.
- **Gradle 8.14.6 `help compileJava` passes against IntelliJ 2022.3**, using the
  generated Java 17 runtime. Existing SDK deprecation warnings remain.
- **Oracle Java 27.0.0** also passes the isolated import with a Java 25 server,
  Java 17 build evaluation, resolved IntelliJ SDK types and no error diagnostics.
  Its importer still discovers the deliberately nested scratch fixture; the
  Red Hat/Gradle exclusion assertions do not claim Oracle supports those settings.
- The user's **actual VS Code profile**, with both Java extensions installed,
  was reopened after backing up/rebuilding the stale Java cache. It now reports
  **Java: Ready, zero errors**, with seven deprecation warnings and two information
  diagnostics. Gradle configures successfully and discovers 75 tasks. The obsolete
  `wrapper-bootstrap` project is absent from the rebuilt Java project cache.

This changes source-checkout tooling, not installed plugin behavior or explanation
prompts. The 0.1.21 installers do not need replacement for this fix; it makes no AI
requests and retains the IntelliJ 2022.3 baseline.

## Current revision: shared Java syntax help (0.1.21)

Both editor paths now use the bundled Lezer Java 1.1.5 parser for local warnings
and bounded punctuation repairs. Suggestions cover semicolons, closing parentheses,
array brackets and closing blocks. Every proposed completion is reparsed; warnings
use original selection positions, including CRLF/lone-CR files and multiple insertions.
Comments and literal content are preserved. The shared cache version is now 17.

Missing values, array sizes, handlers, ambiguous commas/operators, unfinished text
and empty unfinished bodies are not invented. A partial block gets a labeled
standalone completion and can use the usual explanation request, with unverified
output removed. Complete fixes are explained using the corrected code. Known local
examples stay at zero tokens; no extra repair/review AI request is introduced.
Names, expressions, methods, constructors and handler clauses remain valid selections.

Scope: this is an editor grammar with conservative repair rules, not a Java compiler
or type checker. Unicode escape preprocessing and switch-expression/pattern syntax
are deferred to the existing native checker rather than generating false warnings.
Compilation, library availability, and project-specific type rules remain outside
these local repairs. Existing whole-file preview and Apply checks are unchanged.

Validation on Windows x64:

- **1,307 unit/adapter tests pass** and TypeScript type-checking passes. The new
  Java cases cover valid modern declarations, literals/comments, ambiguous errors,
  exact corrected source, cached results and parity between provider and BridgeCore.
- **12 proposed fixes independently parse with the real Java 17 compiler**, using
  parse-only fixtures and disabled annotation processing; no user code is executed.
- **44 shared panel tests pass**, covering both VS Code and generated IntelliJ HTML:
  clear warning text, suggested code, draft transfer, unchanged original source,
  Apply gating and no correction button for a missing value.
- **IntelliJ 2022.3's native editor/JCEF suite passes**, including new packaged-engine
  repair/warning checks and the existing 297 Java teaching examples at zero tokens.
  Initial test-only archive assembly exited early; reassembling that archive and
  launching the same fresh test plugin passed. Production packaging was successful.
- **VS Code's real extension host passes** the new Java correction/unknown-value
  checks, existing 297 Java cases, semantic colors, navigation and editor workflows.

The single-request partial-selection AI test uses a mocked response and reported
usage. No live-provider quality benchmark or measured model-token reduction is
claimed; repair operations themselves are local and consume zero AI tokens.

## Previous revision: syntax help and VS Code Java imports (0.1.20)

The shared engine now distinguishes explainable TypeScript/JavaScript selections
that stop at closing punctuation from broken expressions. The reported declaration
loop reaches the normal explanation request, preserves the submitted code, and
withholds invented output. Both editor caches use version 16 to discard the old
generic incomplete-selection response.

Local syntax help reports selection-relative positions, proposes bounded punctuation
repairs and Python block-header colons, and rechecks the result. Complete repairs
are explained using the corrected text; partial selections remain labeled as such.
The shared panel offers **Suggested correction → Try corrected version** without
editing the file. Existing whole-file preview and Apply checks still run. Valid
class/function-body selections are not misreported as broken standalone programs.
Repairs don't execute code or make another AI request; unknown expressions are not
filled in. This is deliberately limited to the supported local parsers and repair
rules, not arbitrary correction in every language.

Oracle Java uses a separate Gradle runtime selection from Red Hat Java. Checkout
setup now supplies Oracle's project Java 17 pointer and a generated NetBeans runtime
hint using the canonical JDK path, including symlinks/junctions. The Java language
server can remain on Java 25. Generated properties remain ignored and preserve
explicit overrides. Oracle's own workspace-settings trust prompt remains intact.
Removed the unused PsiDocumentManager import; older documentation APIs remain to
support IntelliJ 2022.3 rather than changing the compatibility baseline.

Validation on Windows x64:

- **1,245 unit/adapter tests pass** and TypeScript type-checking passes. The reported
  loop is tested through both the VS Code provider path and IntelliJ's BridgeCore,
  including one-request usage, cached replies, exact input preservation, no invented
  output, valid partial bodies, ambiguous syntax and rechecked repairs.
- **38 shared browser tests pass** for the VS Code and generated IntelliJ panels,
  including correction warnings, preview text, moving the correction into the draft,
  keeping Apply disabled until comparison and preserving the original source.
- Real isolated **Oracle Java 27.0.0 / server JDK 25.0.5** imports evaluate the
  Kotlin/Gradle build on **Java 17**, resolve the IntelliJ SDK type and report no
  error diagnostics. Tested from a checkout with spaces, using the actual setup
  function. Oracle may log an initial runtime-registration warning while creating
  its JDK record; generated Gradle JVM settings allow import to complete.
- Real isolated **Red Hat Java 1.58 / server JDK 25.0.4.1** imports retain Java 17
  source/target, SDK classpath, scratch-directory exclusion and no import errors.
- **VS Code's real extension host** and **IntelliJ 2022.3 native editor/JCEF** suites
  pass, including 297 Java examples per host, semantic colors, source-line jumps,
  edit previews, themes and recovery. The 0.1.20 Java plugin compiles against SDK 223.
- Both **0.1.20 installers** pass asset/bytecode verification: current engine and
  panel files, 40 production Java classes targeting Java 17, no smoke-test classes
  or test fixtures shipped.

AI responses in the new partial-selection tests are mocked; no live provider bill
or new model-quality benchmark is claimed. Syntax checking and repair use zero AI
tokens, and ordinary AI explanations retain their existing token limits.

## Previous revision: portable Java and Gradle setup (0.1.19)

The normal `npm ci` lifecycle now prepares Java 17 for this source checkout. It reuses
a discovered stable JDK or downloads Microsoft OpenJDK through its official HTTPS
endpoint, verifies SHA-256 before extraction, checks the installed runtime, and keeps
it in the ignored `intellij/.gradle/java-home` directory. No system environment or
global editor settings change. Restricted accounts can use a private copy when
creating a link is unavailable. Generated Gradle properties preserve unrelated
settings and explicit developer JVM overrides.

VS Code uses `${workspaceFolder}/intellij/.gradle/java-home`; IntelliJ reads the
generated local Gradle JVM property. The wrapper remains Gradle 8.14.6, with Java 17
compilation and the SDK 223 baseline. Java import excludes temporary/build directories,
including the `wrapper-bootstrap` project shown in the user's warning. The new
`npm run gradle:intellij -- buildPlugin` entry point repeats setup and starts the
wrapper directly with the correct Java and Node executables.

Gradle daemon JVM criteria alone were insufficient: the real VS Code importer still
launched its daemon on Java 25, and first-time Gradle provisioning from Java 25 hit a
Windows directory-move failure. The final setup provisions before import and provides
both editors with an explicit, automatically resolved Java 17 build runtime.

Validation on Windows x64:

- **1,228 unit/adapter tests pass**, including missing Java, Java 25 only, existing
  Java 17, paths with spaces, cached/offline reuse, incorrect runtime versions,
  corrupted downloads, unsafe archive paths, property preservation and Unicode paths.
- A real **first-time Microsoft Java 17 download/install** passed checksum and runtime
  verification. A subsequent normal **`npm ci` completed**, invoking setup automatically.
- The new Gradle entry point passed **`help compileJava` with `JAVA_HOME` unset**,
  using the real IntelliJ 2022.3 SDK and the automatically provisioned compiler.
- A real isolated **VS Code + Red Hat Java 1.58** imported the IntelliJ project with
  its language server still on Java 25, compiler/source target 17, the IntelliJ SDK
  classpath, no import errors, and no `wrapper-bootstrap` project.
  A second real import passed from `work/Checkout With Spaces`; exclusions match
  the generated directory itself so a parent named `work` does not hide the checkout.
- **IntelliJ 2022.3's bundled Tooling API and JBR 17** imported the project and
  verified Gradle 8.14.6, the generated Java 17 JVM setting and language level 17.
- Both running editor regression suites passed: **VS Code's extension host** and
  **IntelliJ 2022.3's native editor/JCEF panel**, including all 297 general Java
  learning examples, colors, line navigation/highlights, edit previews and recovery.
- Both **0.1.19 installers** were rebuilt and byte-checked against current assets.
  All 40 production Java classes target Java 17; no test code, build JDK or Gradle
  distribution is included in the installers.

Download URL selection covers Windows, macOS and Linux on x64/ARM64. Native execution
in this revision was tested on Windows; macOS/Linux behavior has unit coverage only.
Initial uncached downloads require internet access. Neither installed plugin includes
or requires the development JDK or Gradle, and setup makes no AI requests.

## Previous revision: destination highlights, gutter spacing and Gradle import repair (0.1.18)

Clicking a gutter number now briefly highlights the destination in the original editor for 1.2 seconds. VS Code uses a theme-colored whole-line decoration; IntelliJ uses native per-editor line markup with a soft blend of the scheme's search color. Repeated clicks replace the previous highlight and restart its timer. Cleanup runs on expiry, source refresh/change and extension disposal. No selection, code, draft or AI request is changed by the highlight.

The gutter is 12 pixels wider and leaves a 20-pixel inset before code. Number positions remain stable; the draft's text and color layers keep identical spacing. All three code areas use the original editor's tab width, with a bounded four-column fallback. Scrolling, copying, keyboard access and narrow layouts remain covered.

The VS Code Java import error came from applying the legacy IntelliJ build plugin with Gradle 9. The repository now includes a checksum-verified **Gradle 8.14.6 wrapper** and distribution checksum. The existing workspace setting was preserved; wrapper use is enabled, and this machine's installed JDK 24 is selected for Gradle instead of the Java importer's bundled JDK 25. This machine-specific JDK path is in the pre-existing untracked `.vscode/settings.json`, not either installer. The compatible build exposed two additional script issues, now fixed: the license-copy task's Kotlin DSL overload, and simultaneously selecting a local and downloaded IntelliJ SDK.

Gradle's [runtime compatibility matrix](https://docs.gradle.org/current/userguide/compatibility.html) and JetBrains' [current build-plugin requirements](https://plugins.jetbrains.com/docs/intellij/tools-intellij-platform-gradle-plugin.html#requirements) explain why upgrading the IntelliJ build plugin would conflict with the 2022.3 target. The Gradle wrapper remains a development tool; neither editor's installer bundles it or requires Gradle.

Validation:

- **1,211 unit/adapter tests pass**, including destination decoration, replacement/timer restart, edit/disposal cleanup, and original-editor tab width.
- **104 browser tests pass** across both panels, including wider spacing, eight/two-column tab widths, invalid-width fallback, exact source/draft text, layer alignment, keyboard navigation, scrolling and existing learning features.
- **Native IntelliJ 2022.3** passes the real editor highlight tests for light/dark colors, blank lines, repeated clicks, Swing timer expiry and disposal, plus existing navigation, JCEF, Java/Python/TypeScript, learning, color and recovery tests.
- **The isolated VS Code host** exercises the real decoration API for blank lines, repeated jumps, expiry and disposal while preserving text and caret, alongside the existing integration tests.
- **Gradle wrapper `help compileJava` passes** with JDK 24 and the local IntelliJ 2022.3 SDK. Java bytecode remains targeted to release 17. Official wrapper SHA-256: `ad16bca46cb71bb5887c546860d93992aeee35c1fdaf4a242b0a612375d937e0`; distribution SHA-256: `7988ed071b2a07900e2ec715fca15c6ab72bce6db433af301fa7fa7e9407bd24`.

Version 0.1.18 packages retain the SDK 223 baseline and existing compatibility metadata. The Gradle importer in the user's already-open VS Code window may need **Java: Reload Projects** to discard its cached failed import; tests used isolated editor profiles and the project wrapper.

## Previous revision: clickable source-line navigation (0.1.17)

The original-code, small-pieces and draft gutters now open the corresponding numbered line in the captured source file. VS Code reuses its visible editor column and reveals the caret; IntelliJ uses the native `OpenFileDescriptor` API available in 2022.3. Navigation preserves the lesson, draft and pending edit preview, and sends no AI request. Draft rows beyond the original selection are disabled until applied; other draft rows refer to original file numbers, not a guessed mapping of changed code.

Each selection carries a navigation identifier. Both hosts validate the identifier, whole-number line, selected source bounds and current document before navigating. VS Code checks the source again after the asynchronous editor-open call. Paths supplied by a panel message cannot redirect navigation. Changed files require **Use latest code**; old selection links remain invalid after refresh.

Gutters support clicks and one keyboard tab stop per area, Up/Down, Home/End, and Enter/Space. Virtualized rows remain navigable across long selections. Updating the draft's caret highlight changes button classes in place so textarea blur cannot swallow a gutter click. Disabled buttons retain distinct file/line accessible names, with the reason in their tooltip.

Validation:

- **1,208 unit/adapter tests pass**, including exact CRLF/Unicode source positions, switching back from another editor, invalid/outside/stale selection links, and a document changing while VS Code opens its editor.
- **102 browser tests pass** across both editor panels, including all three gutter clicks, keyboard navigation through 2,000 lines, draft/detail preservation, disabled extra draft rows, stale/refresh behavior, and all earlier coloring/editing/learning checks.
- **Native IntelliJ 2022.3** verifies original-file reopening, exact caret position, malformed/outside/stale requests, refreshed links, and preserved pending edits. The real JCEF panel verifies click messages from all three gutters. Existing native color, semantic, learning, editing and recovery checks pass.
- **The isolated VS Code host** passes the existing activation, grammar/semantic-color, hover, panel, context and Java learning regression checks. Navigation routing and races are covered by adapter tests; gutter interactions are covered by the shared browser tests.

Both 0.1.17 installers include the current panel and host code. IntelliJ remains compiled against SDK 223 with Java 17 bytecode, without test-only classes or fixtures.

## Previous revision: source-file line numbers in both panels (0.1.16)

Original code, **The small pieces**, and **Your version** now have fixed left gutters using each editor's native line-number and gutter colors. Original and piece numbers start at the selection's actual line in the full document, rather than at 1. Every displayed line is numbered, independently of the outlined-piece limit. Piece details include the source file and exact line/range. Draft numbers update on edits and reset, indicating the lines the proposed replacement would occupy. Refreshing a selection after changes above it updates the original positions.

The shared renderer preserves the source text, UTF-16 offsets, keyboard controls, syntax/semantic colors, typing and undo. Gutters do not enter copied code or host/provider messages. Only visible number labels are rendered for large selections. The renderer measures actual line-box height to prevent accumulated rounding drift, follows font/size changes, and schedules resize work outside the observer callback for IntelliJ 2022.3's older JCEF runtime. No AI requests or tokens are used. Existing file and AI-selection bounds remain unchanged.

Validation:

- **1,203 unit/adapter tests pass**, including exact full-document positions after a distant CRLF prefix, position refresh after prefix edits, and complete whole-file selection text beyond the small-piece limit.
- **96 browser tests pass** across both editor panels. New cases cover CRLF/LF/CR, Unicode offsets, blank/trailing lines, line ranges, draft edits/reset, native gutter colors, font changes, resizing, narrow/high-contrast layouts, and copying without numbers. A 2,000-line selection verifies bounded gutter rendering, fixed horizontal positioning, and less than one pixel of line alignment error at the end of the file.
- The **native IntelliJ 2022.3 host** passes the real JCEF gutter, complete-selection scrolling, draft numbering and theme-color tests without resize-observer warnings. Native document recovery verifies line positions after edits before the selection. Existing semantic colors, Java origins, bridge, learning, editing, hover and recovery checks pass.
- The **actual isolated VS Code host** passes its existing integration, real grammar/semantic-color, editor-action and Java learning checks. New source-line metadata checks run through the VS Code adapter; both panels' line-number interactions are tested in the browser suite.

Both 0.1.16 installers contain the current shared panel assets. IntelliJ is built against SDK 223 (2022.3), with Java 17 bytecode; test classes and fixtures are excluded.

## Previous revision: native semantic colors and fewer duplicate Java pieces (0.1.15)

IntelliJ's Java analyzer now outlines repeated teaching pieces once, preserving different declarations, shadowed variable origins, overload declarations, receivers and call arguments. This leaves more of the existing 80-piece budget for later code without removing any source text. Declaration lookup is reused within each analysis. The existing bounded scan and local-only explanations remain.

VS Code shows syntax colors first, then overlays available native semantic tokens using the active theme's inherited semantic rules, user/language settings, subtype and modifier precedence, and TextMate fallback scopes. The scope matcher is MIT-licensed VS Code code, included with its attribution. Range providers are preferred, with document-provider fallback. Semantic requests have a timeout and concurrency limit; failures retain syntax colors. Pending requests are shared, but completed semantic results are not retained after a provider may have reindexed. Edited drafts never reuse semantic offsets from a different source snapshot.

IntelliJ uses the open editor's scheme and file-local Java roles, plus completed native semantic highlighting where available. Java's separate symbol highlighting category is included, while error/warning styling is excluded. Class references, constructor calls, and static calls retain their distinct native roles. Analysis completion refreshes panel colors without resetting the lesson. Changed drafts use their own PSI and never borrow markup from the original document. All code paths remain local and make no AI request.

Validation:

- **1,201 unit/adapter tests pass**, including semantic theme inheritance, specificity and explicit font resets, subtype/scope fallback, malformed token data, UTF-16/CRLF offsets, opt-out, provider failure/timeouts, draft/version/theme guards and progressive panel messages.
- **84 browser-panel tests pass** across both editors, including a later semantic update in all three code areas without losing source text, piece details or the editable draft.
- The **actual isolated VS Code host** passes real TypeScript semantic-provider checks for class, method, variable, parameter and property declarations/references, custom colors, disabled semantics and changed drafts. Existing real grammar/theme checks (TypeScript, Python, Java and HTML), the exact earlier TypeScript screenshot selection, editor actions and 297 Java examples plus Womb also pass.
- The **native IntelliJ 2022.3 host** passes duplicate reduction and preserved-distinction tests, role colors under light/dark schemes, edited Java drafts, and real completed-daemon markup for class references, constructor calls and static calls using a custom editor scheme. Existing origins, hover, edit/recovery, Python/JavaScript/TSX, bridge and Java output tests pass. The real JCEF panel retains its color/theme, draft-preservation and narrow-layout checks.

Scope: semantic support depends on the installed language provider and editor settings. VS Code uses syntax colors for modified drafts until they become document text; IntelliJ additionally handles file-local Java draft roles. Diagnostic decorations are excluded. Newer IntelliJ versions were not rerun; production classes are compiled against 2022.3 with Java 17 bytecode. No live AI calls were made, and explanation prompts/token limits are unchanged.

Native rules were checked against the [VS Code semantic highlighting guide](https://code.visualstudio.com/api/language-extensions/semantic-highlight-guide) and [IntelliJ highlighting documentation](https://plugins.jetbrains.com/docs/intellij/syntax-highlighting-and-error-highlighting.html), with the actual 2022.3 SDK verifying compatibility.

## Previous revision: TypeScript color recovery (0.1.14)

Reproduced the missing colors using the exact `const pad = ...` selection from line 13 of `src/hover-explanation.ts` in the actual VS Code host. A later line could exhaust its 15 ms allowance while TextMate compiled new regexes, discarding all selected colors. The adapter then cached that plain result.

All lines now share the available 750 ms highlighting budget. One short 250 ms local warm-up retry can recover any timed-out line using its original lexical state. Processing yields between expensive lines, existing size/range limits remain, and incomplete highlighting still falls back to plain text. Empty or failed results are no longer retained in the selection cache; successful and concurrent requests still reuse their work. No prompts, explanation features or provider requests change.

Validation:

- **1,178 unit/adapter tests pass**, including seven new regressions for later-line compilation, original-state retries, bounded repeated timeouts, cache recovery after empty/error results, concurrent requests and stale theme requests.
- The **actual isolated VS Code host** now colors the exact screenshot selection with distinct colors under dark, light and high-contrast themes. Installed TypeScript, Python, Java and HTML grammars, theme overrides, partial-comment context and existing editor checks pass, including 297 Java examples plus Womb at zero API tokens.
- **12 focused browser color tests pass** across both VS Code and embedded IntelliJ panels: original code, small pieces, draft, theme updates, selection/undo, scrolling, IME, forced colors and invalid-payload handling.
- TypeScript checking and both production builds pass. Matching 0.1.14 installers preserve IntelliJ 2022.3 compatibility and Java 17 bytecode. The IntelliJ native color engine is unchanged; its native UI suite was not rerun for this VS Code-only correction (the prior native 2022.3 results are below).

## Previous revision: native syntax colors (0.1.13)

The original code, clickable small pieces and editable draft now share local syntax highlighting. VS Code reads installed TextMate grammars, the active theme (including inherited/JSONC/plist rules), and token/foreground customizations. IntelliJ uses its native highlighter and editor color scheme through APIs available in 2022.3. The source before a selection is retained for lexical context. UI messages carry bounded ranges and validated color/style values; source content is always rendered as text.

The editable area keeps its textarea, with a synchronized, non-interactive color layer. Theme changes preserve the lesson, draft, focus, selection and piece details. Editable glyphs retain regular weight/style for caret alignment; read-only areas support theme bold/italic. IME composition and system forced-colors mode retain visible native input. The highlighter has size/time limits, bounded caching and one local first-line warm-up retry; unavailable highlighting falls back to plain text. None of this invokes a provider, changes prompts or uses API tokens.

Validation:

- **1,171 unit/adapter tests pass**, including 13 focused grammar/theme tests for exact offsets, multiline context, Unicode/CRLF, malformed/oversized input, theme inheritance, plist themes, include cycles/bounds, and custom-rule precedence.
- **82 browser tests pass** across VS Code assets and the embedded IntelliJ panel. Twelve new cases cover all three color surfaces, live themes, local piece clicks, draft/selection preservation, late-response rejection, undo/reset, scrolling/font alignment, narrow layouts, IME, high contrast and unsafe style/range rejection.
- The **actual isolated VS Code host** checks installed TypeScript, Python, Java and HTML grammars under dark, light and high-contrast themes, custom keyword and foreground colors, and partial-comment selections. Existing editor tests and 297 Java examples plus Womb still pass at zero tokens.
- The **native IntelliJ 2022.3 host** checks native Java colors, custom keyword colors, light/dark schemes, partial selections and limits. Its actual JCEF panel verifies colors in all three areas and live changes without losing the draft or lesson. Existing hover/origin, edit, recovery, bridge and Java examples remain checked. Newer IntelliJ versions were not rerun for this change.
- TypeScript checking and both production builds pass. The IntelliJ build embeds both panel scripts regardless of HTML formatting and fails if a script is left external. Packages retain Java 17 bytecode and exclude test fixtures/classes; VS Code bundles the local regex runtime and required notices.

Scope: syntax colors are reused; language-server semantic overrides, inspection decorations and uninstalled language support are not reproduced. The Java compiler reference suite was not rerun because the learning interpreter is unchanged. No live AI calls were made for this feature.

## Previous revision: portable Java runtime setup (0.1.12)

VS Code now checks the installed Oracle Java extension's runtime requirements in trusted workspaces. It retains a compatible older JDK, finds an installed replacement when needed, and checks the relevant JVM compatibility flags before updating the machine's server setting. A working previous project JDK is pinned separately when it inherited the server choice. Explicit workspace server settings and unknown/custom requirements are left for manual setup. Settings are backed up for the restore command; restoring disables automatic setup. No project code is executed, no JDK is automatically downloaded, and no provider request is made.

Validation for this revision:

- **1,158 unit/adapter tests pass**, including **53 new runtime tests**. These cover Windows/macOS/Linux discovery with simulated filesystems, older JDK retention, the JDK 24 compact-header failure, JDK 21 fallback, missing/stale paths, environment and PATH precedence, macOS bundles, real-path resolution, project preservation across workspaces, explicit/null workspace overrides, trust, cancellation, concurrent setting edits, repair rollback and restore.
- A **read-only check with real Windows JDKs** and installed **Oracle Java 27.0.0** reproduced failure on **24.0.2** with its compact-header flags. Discovery selected **25.0.5**, which passed. The proposed repair preserved the old project JDK; a second check returned healthy. No editor settings were written by this verification. macOS/Linux and older JDK cases were unit-tested, not run on native machines.
- The **actual isolated VS Code host** passes activation, registration of both setup commands, existing hover/panel/reference tests and the existing local Java examples. Oracle Java is absent in that isolated profile; repair behavior is covered by the adapter tests plus the real JVM probes, not a live Oracle server restart.
- TypeScript checking and both production builds pass. The IntelliJ package is compiled against **2022.3** with Java 17 bytecode; its native runtime code is unchanged. IntelliJ UI, browser-panel and Java compiler reference suites were not rerun for this VS Code setup change; their previous results are below.

The check reads installed extension metadata and uses bounded `java -version` probes. It does not certify every Oracle version, JVM option, vendor or extension startup order. If Oracle already failed before WatDatMean's repair, the notification offers **Reload Window**. If no compatible installation is found, **Open Java Setup** opens Oracle's setup action. The learning engine, explanation prompts and token limits are unchanged.

## Previous revision: Java generics and interfaces (0.1.11)

Both editors share bounded local support for user-defined generic classes, multiple/nested arguments, diamond inference, generic static/instance methods, and single upper bounds (including `Number` and modeled interfaces). Class views substitute signatures while preserving the original generic body and its compile-time bindings. This prevents a `String` argument from silently changing an overload selected using an `Object` or `Number` bound, or a subclass overload from replacing the selected generic instance method. Type arguments remain invariant and are described as compile-time checks, not separate runtime classes.

Interfaces support explicit implementation, inheritance, generic contracts, covariant returns, public implementations, static/default methods and concrete custom functional-interface lambdas/method references. Class methods win over interface defaults; more-specific defaults win over inherited ones. Missing implementations, incompatible returns/throws/visibility, default conflicts, erasure clashes, cyclic inheritance and conflicting generic interface arguments decline the local trace. Custom functional callbacks preserve output printed before an exception. Interfaces are not mislabeled as nested classes, and static interface calls are not labeled as defaults.

Scope follows the [Java 17 parameterized-type rules](https://docs.oracle.com/javase/specs/jls/se17/html/jls-4.html#jls-4.5), [type erasure](https://docs.oracle.com/javase/specs/jls/se17/html/jls-4.html#jls-4.6), and [interface inheritance/default rules](https://docs.oracle.com/javase/specs/jls/se17/html/jls-9.html#jls-9.4.1.3). Raw types, wildcards/capture, recursive/intersection bounds, generic arrays, unchecked casts, generic overload inference, unconstrained generic results, some nested inference, interface constants/private methods and `Interface.super` calls retain AI fallback. Default-method execution on lambda objects also remains outside the local subset. Full syntax/type validation precedes tracing; no selected code is executed.

Validation:

- **1,105 unit/adapter tests**, including **54 new independently expected examples** on both direct-provider and IntelliJ bridge paths with provider calls forbidden. Rejection cases cover unsupported and invalid forms. New walkthroughs stay under **300 visible words**, with at most six steps, one exact output, collapsed definitions/practice, correct overload/default wording and no internal type-variable identifiers.
- **322 compiled Java 17 reference programs** match every output character: the previous 268 plus all 54 generic/interface examples. The compiler now reads a source-list file to avoid growing Windows command lines.
- **70 browser-panel tests** pass across both displays, including generic diamond construction, generic overload binding, inherited defaults, class-method priority, custom functional references and callback failure output.
- Actual **VS Code** and native **IntelliJ 2022.3** checks cover **297 general Java programs plus Womb** at zero tokens. Existing hover/origins, Python/JavaScript/TSX inspection, theming, edits, recovery and narrow layouts remain checked. Newer IntelliJ releases were not rerun.
- TypeScript checking, production builds and the existing stress suite (**1,200 mutations** plus large/deep Python/TypeScript input) pass. Cache revision 15 replaces older lessons.

`node scripts/check-generic-interface-usage.mjs work/before-generics.cjs` compares a pre-edit 0.1.10 working-tree snapshot with the new engine. All **54 new examples move from AI fallback to 0 API tokens**. The prior 118 stream/method-reference/Optional examples, simple print and Womb remain local with unchanged output. All **174 serialized fallback requests** are byte-for-byte unchanged, including reasoning and completion limits. No live API totals were measured; missing baseline usage is not an estimate. The script supports `--snapshot <file.cjs>` for future before/after comparisons.

Evidence: [Java reference results](tests/quality/java-generics-interfaces-2026-11-15.json) and [usage/request comparison](tests/quality/java-generic-interface-usage-2026-11-15.json). Updated 0.1.11 installers retain VS Code 1.95+ and IntelliJ 2022.3+ compatibility.

## Previous revision: Java method references and Optional (0.1.10)

Both editors share local handling for supported static, bound/unbound instance, print and constructor references. References preserve overload selection and virtual dispatch. Bound receivers are evaluated and null-checked at reference creation; calls and construction happen later. Saving a reference preserves the receiver even if the original variable is reassigned; changes to that object's fields remain visible. Unsupported or ambiguous reference forms decline the local trace.

`Optional`/`OptionalInt` support covers presence, factories, retrieval, eager/lazy fallbacks, actions, mapping/filtering, alternative/exception suppliers, equality and fresh zero/one-item streams where applicable. It distinguishes an empty Optional from a null reference, `map`'s null-to-empty conversion from `flatMap`'s non-null Optional requirement, and required callback null checks from callbacks invoked only on the selected branch. Stream `findFirst`, int `min`/`max`, and reductions without identity return modeled Optional results. Scalar Optional contents, standard library references and simple pure static helpers keep the local subset bounded; unsupported APIs/types, uncertain stream callback effects, incomplete context and unhandled failures retain AI support. No selection is executed.

Semantics follow the official [method-reference evaluation rules](https://docs.oracle.com/javase/specs/jls/se17/html/jls-15.html#jls-15.13.3), [Optional API](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/Optional.html), and [OptionalInt API](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/OptionalInt.html). Local definitions do not enlarge the model prompt. Walkthroughs keep at most six steps, one complete output, collapsed terms, and existing optional practice. Cache revision 14 refreshes older lessons.

Validation:

- **1,015 unit and adapter tests**, including 64 new independently expected examples through both provider and IntelliJ bridge paths with network calls forbidden. Negative cases cover invalid/ambiguous references, wrong types, missing receivers, checked exceptions, unsupported generic forms, identity/unspecified results and invalid callbacks. A compiler check also confirms that an unbound receiver cannot be a primitive parameter (`IntUnaryOperator f = Integer::intValue`). Compactness and eager/lazy explanation wording are checked.
- **268 compiled Java 17 reference fixtures** match the full output, including all 64 new examples and the previous streams, arrays, exceptions, collections, loops, overload and Womb cases.
- Actual **VS Code** and native **IntelliJ 2022.3** tests pass all **243 general Java examples plus Womb** at zero tokens. Native checks retain Java hover, origins, syntax checking, live themes, narrow panels, edit safeguards and repeated panel recovery. Newer IntelliJ releases were not rerun.
- **58 browser-panel tests**, covering both rendered editor displays, exact new outputs, at most six steps, collapsed terms/practice, narrow layouts, repeated-term repair and concept actions.
- Existing malformed-input stress tests pass **1,200 mutations** plus large/deep TypeScript and Python inputs. TypeScript compilation and production builds pass.

The before-change 0.1.9 working tree was bundled before these edits, preserving the uncommitted stream improvements as the baseline. `node scripts/check-method-optional-usage.mjs work/before-optional.cjs` compares it with the new engine: **64 new examples move from AI fallback to zero API tokens**, while all previous 54 stream examples, simple print and Womb remain local with identical output. All **120 serialized fallback requests** are byte-for-byte unchanged, including reasoning effort and completion limits. No live provider usage was measured; a missing baseline usage value is not a token estimate. For future comparisons, capture a baseline first with `node scripts/check-method-optional-usage.mjs --snapshot <file.cjs>`.

Evidence: [Java reference outputs](tests/quality/java-method-optionals-2026-11-14.json) and [before/after usage and request comparison](tests/quality/java-method-optional-usage-2026-11-14.json). Updated 0.1.10 installers retain VS Code 1.95+ and IntelliJ 2022.3+ compatibility.

## Previous revision: Java streams, lambdas, and repeated definitions (0.1.9)

Both editor adapters now share local Java 17 stream/lambda explanations. The checked subset covers sequential `Stream<String/Integer>` and `IntStream` sources, filter/map/type conversions, sorting/distinct/prefix operations, sum/count/identity reductions, matching, terminal consumers, arrays/lists, and the supported list/joining collectors. Standard functional interfaces accept expression/block lambdas with inferred/typed parameters, local calculations and final/effectively-final scalar captures. Pipeline construction remains lazy; terminal traversal respects order and short-circuiting. Exact-size counts model the Java 17 optimization that can omit mapping callbacks. A stream can be linked/consumed once; source changes before traversal are observed.

Intermediate callbacks with observable side effects, captured mutable objects, parallel/unordered processing, unsupported APIs/types, missing context, uncaught exceptions and resource limits decline the entire local result. They retain the existing AI path. No user-selected code is compiled or executed. The behavior follows the [Java 17 Stream API](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/stream/Stream.html), [IntStream API](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/stream/IntStream.html), and [lambda rules](https://docs.oracle.com/javase/specs/jls/se17/html/jls-15.html#jls-15.27.2); compiler/reference checks use fixed test fixtures only.

Repeated concept names are normalized and deduplicated before review/caching. The shared panel also repairs older cached responses. Case, extra whitespace and enclosing inline-code backticks do not create extra term entries. Distinct terms and their concept-expansion actions are preserved, with no new provider request.

Validation:

- **927 unit and adapter tests**, including 54 independently expected stream/lambda examples on both direct-provider and IntelliJ bridge paths, rejection cases, compactness, capture rules, overflow and duplicate definitions.
- **204 compiled Java 17 reference programs** (the previous 150 plus 54 stream/lambda programs) match every output character. Coverage includes empty streams, billion-item ranges bounded by limit, long counts, count elision, short-circuiting before division by zero, block lambdas, local loops, stream reuse, exceptions, null callbacks, immutable list results and source changes before traversal.
- **46 browser-panel tests**, including compact stream lessons, exact output, narrow layouts, cached duplicate repair and concept actions in both editor panels.
- Actual **VS Code** and native **IntelliJ 2022.3** checks: 179 independent general Java examples plus Womb return local explanations with zero tokens. Native JCEF also verifies duplicate removal, themes, source offsets, edit safeguards and repeated panel recovery. Newer IntelliJ versions were not rerun for this change.
- Existing malformed-input stress checks pass 1,200 mutations and large/deep TypeScript/Python inputs. New stream rejection tests cover bounded work, oversized sorting and unsupported/infinite sources.

`scripts/check-stream-usage.mjs e0758b4` compares the committed pre-change implementation with this revision offline. All **54 stream examples move from AI fallback to 0 API tokens**. Simple print and Womb remain at zero, with unchanged output. The serialized fallback requests—including prompts, reasoning effort and completion limits—are byte-for-byte unchanged for all 56 compared cases. Before-change provider token totals were **not measured**; input character counts in the report are not token counts. No live AI requests were made for this revision.

Evidence: [Java reference results](tests/quality/java-streams-2026-11-14.json) and [before/after request and local-usage comparison](tests/quality/java-stream-usage-2026-11-14.json). Run `node scripts/check-java-teaching.mjs <JDK 17+> <Java 17 runtime>` to repeat the reference checks. Use the normal unit, UI, VS Code integration and IntelliJ native test commands below for adapter verification.

## Previous revision: main quality-of-life integration

Integrated main `406a344` with TainBranch `17548d1`, resolving ten conflicted files while retaining this session's explanation work. Both editor packages are version **0.1.8**.

- Shared boxed code pieces preserve original whitespace, comments, repeated tokens, source offsets, and keyboard navigation. IntelliJ now sends the selection start offset; Java and Python pieces remain clickable away from the beginning of a file.
- TypeScript interface members open independently, and complex types, tuples, objects, constructors, and incomplete declarations unpack locally. Constructor pieces retain written import origins and nested-call relationships. Locally declared/imported utility names are not assumed to be standard built-ins.
- Both editors offer **Reopen Learning Panel**. Recovery refreshes the saved selection, cancels old work, and invalidates edit previews. IntelliJ disposes the old browser and listeners; stale browser messages cannot reach its replacement. Source files remain unchanged by recovery.
- Preserved Python checking, native Java hover and origins, automatic IntelliJ themes, compact walkthroughs, collapsed definitions/practice, optional deeper help, examples, project context, caching, and confirmed edits. Kept the Python parser dependency; omitted main's unused `package` dependency.

Validation for this integration:

- TypeScript type check and **832 unit/adapter tests** pass.
- **34 browser-panel tests** pass, including both editor panels, Python import origins and indentation, boxed source ranges, keyboard interaction, compact Java output, and edit safeguards.
- Stress checks pass **1,200 mutations** and large/deep/malformed TypeScript and Python inputs.
- **150 independently compiled Java 17 fixtures** still match every output character. The original Womb trace remains four steps with `null0A1 B6A11 B106A11 A11B106aa\n`.
- Actual VS Code and IntelliJ **2022.3** host checks cover the shared teaching path, 125 independent Java programs plus Womb, Python/JavaScript/TSX checking, and the new TypeScript selection/type behavior. Native IntelliJ checks also cover live light/dark themes, variable origins, edit confirmation, and repeated panel recovery after source edits.

The provider, prompt budgets, lesson schema, local teaching, Java interpreter, and shared bridge core are unchanged from `17548d1`. Supported Java examples continue to report **0 API tokens**, as before; no provider requests were made for this integration. This verifies preservation of the local path and request settings, not a new live-model quality evaluation. IntelliJ was tested on 2022.3 for this integration; newer IDE versions were not rerun.

Reproduce with `npm run check`, `npm test`, `npm run test:stress`, `npm run test:ui`, `npm run test:integration`, and `npm run test:intellij -- --ide-home <2022.3 SDK> --java-home <JDK 17+> --ui`. The Java reference check is `node scripts/check-java-teaching.mjs <JDK 17+> <Java 17 runtime>`.

## Preserved revision: Java arrays and exception handling

Both editors now share checked local explanations for array literals, sized/default creation, indexed reads/writes and increments, `length`, aliases, fields, parameters, return values and up to three dimensions (including ragged rows). Enhanced loops read the same array once and observe later element updates. `clone` and `Arrays.copyOf` create a new outer array; nested rows remain shared where Java uses a shallow copy. `Arrays.toString` and `deepToString` provide deterministic item output. Covariant array reads retain the expression's declared component type for field selection, while virtual calls still use the actual object. Stores check the allocation's actual component type. These rules follow [JLS arrays](https://docs.oracle.com/javase/specs/jls/se17/html/jls-10.html) and [assignment evaluation](https://docs.oracle.com/javase/specs/jls/se17/html/jls-15.html#jls-15.26.1).

Exception handling supports `try`/`catch`/`finally`, multi-catch, explicit `throw`, modeled checked `throws` declarations, matching by the built-in exception hierarchy and rethrows. Catch scope/order, multi-catch restrictions, method override throws restrictions and checked-exception obligations are validated before tracing. A return expression is evaluated and converted before finally runs; the saved value resumes if finally completes normally. A new return, break/continue or throw in finally replaces the pending completion. Known failures include array bounds/null/negative-size/store errors, integer divide/remainder by zero, null unboxing/instance access, invalid casts and selected mutable-collection bounds/immutable mutation operations. The implementation follows [JLS exception checking](https://docs.oracle.com/javase/specs/jls/se17/html/jls-11.html#jls-11.2) and [try/finally execution](https://docs.oracle.com/javase/specs/jls/se17/html/jls-14.html#jls-14.20.2).

The reader represents modeled Java failures separately from grammar/context/resource rejections. Java catch/finally cannot conceal an unsupported construct or suppress a reader limit into a fabricated successful answer. Uncaught exceptions retain AI support rather than receiving a made-up complete stack trace. Explicit exception messages can be read locally; implicit JVM-generated messages and identity-based array/object output are not guessed. Factory-list out-of-bounds exception subclasses and competing null/negative `copyOf` errors also decline when implementation details would affect catch selection. Custom exception classes, try-with-resources, suppressed exceptions, unmodeled APIs/types and unknown surrounding state stay on the existing fallback path.

**150 controlled complete programs** compile for Java 17 and match JBR 17.0.5 execution, including **52 new array/exception examples** and all previous 98 programs. New cases include defaults and empty arrays; updates and aliases; copies and shallow multidimensional clones; ragged iteration; covariance combined with field hiding/overriding; null/bounds/store failures; RHS/index/unboxing order; checked helper throws; catch specificity and rethrows; exceptions escaping loops; finally preserving/replacing returns or exceptions; and cleanup during break/continue. Exact outputs are independently specified and compared with Java execution. Source hashes, output comparisons, usage and visible word counts are saved in `tests/quality/java-arrays-exceptions-2026-11-14.json`.

All 52 new supported examples produce **0 input, output and hidden reasoning tokens**, with zero transport calls through the VS Code path and IntelliJ bridge. No new live AI request or before/after live token percentage is claimed. Existing request snapshots verify unchanged model-backed prompts, schemas, reasoning effort and output ceilings. Array/exception definitions stay local. The default remains one walkthrough with at most six steps, a single assembled output and collapsed terms; bounds failures explain the requested index/range, and finally explanations identify the saved or replaced result. Both lesson caches are now version **12**.

Bounds additionally limit arrays to 64 allocations, 128 slots per array, 512 total slots and three dimensions; explicit exception construction is limited to 128 objects. Existing source, class/object, loop, operation, call-depth and output limits remain. Array field initializers must use supported constant creation/initializer forms. No editor selection is executed; only the controlled developer fixtures run in Java.

Validation: **782 unit/adapter tests**, TypeScript checking, **27 browser panel tests**, and native checks in VS Code and IntelliJ **2022.3**. Each native host exercises all **125 independent general/control/array examples**, plus the original Womb regression, at zero reported tokens. Browser checks cover aliases/copies, array bounds, saved and replaced returns, exact output, collapsed terms and narrow layouts in both panels. Reproduce compiler comparisons with `node scripts/check-java-teaching.mjs <JDK-home> [Java-runtime-home]`; logs use `work/java-arrays-*.log`. Both installers are rebuilt; IntelliJ's minimum platform and Java 17 target remain unchanged.

## Previous revision: Java loops, collections and method overloads

Both editors now use the same checked local trace for `for`, `while`, `do-while`, enhanced `for`, `if`/`else`, `break`, `continue`, prefix/postfix increments, comparisons and short-circuit conditions. Loop explanations retain initialization, one first-pass sample, the iteration count, final values and exit reason. Repeated passes do not produce a notebook of duplicated steps. Output is assembled exactly once. Existing construction order, field hiding and per-object state remain intact. Both caches use version **11**.

The collection subset covers `List`/`ArrayList`, `Set`/`HashSet`/`LinkedHashSet`, and `Map`/`HashMap`/`LinkedHashMap` with `String`/`Integer` elements or keys/values, explicit `java.util` imports, diamond construction, copy constructors, and `List.of`/`Set.of`/`Map.of`. Modeled methods include size/emptiness/clear, add/contains/remove, list get/set/indexed insertion, map put/get/getOrDefault/containsKey/containsValue and a live `keySet` view. The reader tracks aliases, nulls, boxing/unboxing, insertion order and structural modification. It distinguishes index-based list removal from value-based removal, following the [Java 17 List contract](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/List.html). Map lookup/default and key-view behavior follow the [Map contract](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/Map.html). Unspecified [HashSet iteration order](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/HashSet.html) is never presented as a guaranteed sequence.

Fixed-arity overloaded methods are bound from compile-time argument and receiver types, with strict invocation considered before boxing/unboxing. Only then does the actual object's override supply the implementation of that selected signature. Tests cover primitive/boxed/Object overloads, null specificity, ambiguity, inherited overloads, and a child-only overload that must not replace the parent's selected signature. This follows [JLS method invocation](https://docs.oracle.com/javase/specs/jls/se17/html/jls-15.html#jls-15.12.2); loop control follows [JLS statements](https://docs.oracle.com/javase/specs/jls/se17/html/jls-14.html#jls-14.14).

**98 complete programs** compile for Java 17 and match execution on JBR 17.0.5: the previous 53 plus **45 new independent examples**. New cases cover zero/one/100 iterations, nested loops, early returns, break/continue update order, side effects in loop conditions, short-circuiting, list aliases/copies/removal, immutable factories, empty collections, map replacement/default/null handling, live key views and overload/override combinations. The Womb regression retains its exact output and four-step default explanation. The saved compiler report contains source hashes, complete outputs, independent expected strings, word counts and usage at `tests/quality/java-control-2026-11-14.json`.

Every new supported example uses **0 input, 0 output and 0 hidden reasoning tokens** through both editor paths; injected transports receive zero calls. No live API benchmark or percentage saving is claimed for these new examples. Existing request snapshots verify that model-backed prompt/schema sizes, reasoning settings and completion ceilings remain unchanged. The new reviewed definitions are inserted locally without enlarging the model's concept-name list. A visual regression also checks that a mutating collection call does not append its stale pre-call value to the post-call explanation.

Resource limits are explicit: 256 passes per loop, 2,048 total passes, 20,000 evaluation/statement operations, 16 collection allocations, 128 elements per collection, 256 print calls and 8,000 output characters, alongside the existing source/class/object/call-depth bounds. Supported primitive values are `int` and `boolean`; String/Integer, supported collections and user-class references are available where modeled. Fields remain scalar; constructors have a single signature. Arrays, streams, lambdas, varargs, arbitrary generics, packages and unmodeled library methods retain AI support. Invalid types, missing declarations, ambiguous overloads, exceptions, unordered iteration with multiple elements and iterator mutation discard the entire local trace. This conservative decline does not assert that every such program is invalid Java. The extension never executes editor code; only controlled developer fixtures are compiled/run.

Validation: **697 unit/adapter tests**, TypeScript checking, **23 browser panel tests**, the actual VS Code development host and native IntelliJ **2022.3** checks. Both native hosts exercise all **73 independent general/control examples** plus Womb at zero reported tokens. Browser checks cover the 100-pass summary, collection removal, overload/override explanations, collapsed terms, a single output block and narrow layouts in both panels. Reproduce with `node scripts/check-java-teaching.mjs <JDK-home> [Java-runtime-home]`; host/panel commands remain documented below. Logs use `work/java-control-*.log`. Both installable bundles are rebuilt from the shared source; IntelliJ's minimum platform and Java 17 class target are unchanged.

## Previous revision: general Java traces with independent examples

The shared reader no longer requires exactly two nested classes, one allocated object or no-argument methods. It now supports ordinary top-level classes or one level of static nested classes, acyclic inheritance chains, multiple objects and aliases, scalar constructor/method parameters, local variables, field updates and return values. Self-contained `int`/`String` declaration/assignment/print selections can also use it without surrounding classes. The original literal-print lesson and conservative constructor-fragment explanation remain intact. Both caches now use version 10.

A separate model checks the complete accepted program, including unused methods: class visibility, inheritance, method signatures, argument/return types, assignment compatibility, variable shadowing, initialization scope and forward references. A bounded trace then keeps field slots per object and declaring class, evaluates arguments left to right, captures the old compound-assignment value before its right side changes fields, and follows runtime dispatch, constructor phases, casts and static calls. Null dereferences, invalid runtime downcasts, zero divisors or resource bounds decline the entire local result rather than claim normal completion. The implementation follows the [Java 17 construction rules](https://docs.oracle.com/javase/specs/jls/se17/html/jls-12.html#jls-12.5) and [expression evaluation rules](https://docs.oracle.com/javase/specs/jls/se17/html/jls-15.html#jls-15.7).

**53 controlled complete programs** compile for Java 17 and match execution on JBR 17.0.5. This includes **28 independently written examples**, not renamed copies of Womb: receipt arithmetic, static pricing helpers, constructor parameter shadowing, two independent counters, reference aliases, separate top-level parent/child classes, three-level construction, `super` arguments, methods that update account balances, local/field shadowing, side effects during argument evaluation, compound-assignment timing, integer division/overflow, null Strings, and static calls through a newly constructed object. The original Womb regression and its 24 variants remain covered.

Two initially mistyped independent expected strings were corrected after Java execution confirmed the reader's result: the leaf's fields are still defaults during the middle constructor, and each `next()` print includes its trailing comma. Both complete outputs are now locked into regressions. The compiler script supplies LF as the JVM's print-line separator rather than replacing all CRLF sequences in captured output; a literal `\r\n` inside printed text is preserved and checked separately.

Every independent example returns **0 input, 0 output and 0 hidden reasoning tokens**, with zero calls to the injected transport in both the direct VS Code path and IntelliJ bridge. There were no new live API calls for this revision. No before/after live token percentage is claimed for the new examples; mock usage in the unsupported-loop test only checks accounting. Model-backed prompts, reasoning effort, completion ceilings, source/context compaction and local definitions are unchanged. New explanations stay compact (roughly 20–290 visible words in the independent cases), with at most six default steps, one assembled output and optional deeper events. The original Womb explanation remains four steps.

Scope remains explicit: at most eight classes, six objects, six scalar parameters per signature, and bounded source/operations/output. Supported values are `int`, `String`, and object/null references; fields/parameters are scalar. Methods have one signature per name, including inherited signatures. Field initializers use constant expressions; initializer blocks use assignments. Loops, branches, arrays/collections, imports/packages, interfaces, overloads, unsupported modifiers/types and external helpers retain the existing AI path. Additional context/evidence also retains that path unless context is an exact token copy of the selection. Partial snippets with unknown names or method-level control flow do not get invented surrounding declarations. This is not a complete Java compiler or a guarantee of arbitrary AI prose accuracy. Editor selections are never compiled or executed; only controlled test fixtures are run by the developer script.

Reproduce with `node scripts/check-java-teaching.mjs <JDK-home> [Java-runtime-home]` and `node node_modules/vitest/vitest.mjs run`. Results, source hashes, exact output, local usage and explanation word counts are preserved in `tests/quality/java-general-2026-11-14.json`; earlier reports are retained. **618 unit/adapter tests**, TypeScript checking, **20 browser panel tests**, the actual VS Code host and native IntelliJ **2022.3** checks pass. Both native host checks include all 28 independent examples at zero tokens. Coverage includes direct/bridge parity, compactness, aliases, argument binding, failures and unsupported-Java fallback. Browser checks verify one output block, relevant expandable terms, a narrow layout and retained More detail actions. Object construction without print side effects forms its own short step, so multiple objects do not become one dense paragraph. Logs are in `work/java-general-*.log`. Existing IntelliJ clipboard/IDE action warnings did not fail the plugin checks.

## Previous revision: correct Java field hiding and construction without AI variability

Both editors now share a bounded local reader for complete programs with two static nested classes in a parent/child relationship. It derives values from the supplied declarations and operations; it contains no `Womb` answer or fixed identifiers. The original program receives one four-step walkthrough (about 326 words including its summary and practical/library note), one output block, collapsed definitions and a reviewed question. More detail exposes the individual events. Both caches use version 9 so an earlier incorrect explanation is not reused.

The trace tracks fields by **declaring class**, not just name. A constructor's bare `n` therefore updates that constructor class's field. All fields get defaults before superclass construction; each class's field initializers and instance initializer blocks then run in source order before that class's constructor body continues. A virtual call from `A()` can still reach `B.show()` before B's written initializers. These rules follow [JLS 12.5](https://docs.oracle.com/javase/specs/jls/se17/html/jls-12.html#jls-12.5). Field access uses the reference's compile-time type; static calls do too, including a statically resolved call through a typed null reference. See [JLS field access](https://docs.oracle.com/javase/specs/jls/se17/html/jls-15.html#jls-15.11.1) and [method invocation](https://docs.oracle.com/javase/specs/jls/se17/html/jls-15.html#jls-15.12.4.1).

The complete compiler-verified output is `null0A1 B6A11 B106A11 A11B106aa\n`. The first three chunks each end with one space; the last ends with a newline. In the final expression, `x.s/x.n` are A's fields, the B casts select B's fields, and both `who()` calls select A's static method. The walkthrough explains the same object, separate fields, casting, left-to-right concatenation, Java library origins and the practical risk of calling an override during construction.

| Same full Java request                                       | Total API tokens | Result                                        |
| ------------------------------------------------------------ | ---------------: | --------------------------------------------- |
| Prior successful live Qwen response                          |            2,526 | Correct                                       |
| Prior repeated live Qwen response                            |            2,713 | Incorrect `x.s` ownership and final output    |
| Current local trace, direct VS Code path and IntelliJ bridge |            **0** | Correct complete output, zero transport calls |

The original live responses remain in `tests/quality/groq-reasoning-2026-11-14.json`; neither failure nor usage was overwritten. This revision needs no new live API call: the supported request bypasses the model entirely, eliminating its 1,024 hidden reasoning tokens along with its other tokens. Model-backed requests retain their previous prompts, reasoning settings and completion ceilings. Simple TypeScript/Python/Java literal cases stay free, and concept/example/edit/practice actions remain available.

The local scope is intentionally limited: one allocated child object; two static nested classes; `int`/`String` fields with literal or constant-expression initializers; assignment-only instance blocks; no-argument constructors; printing instance methods; literal-returning static String methods; supported arithmetic, casts and print calls. It checks the complete accepted program, including unused overridden methods, before returning any result. Unknown syntax, helpers, dependencies, extra context/evidence, invalid types, cycles, forward simple-name reads, size limits or missing declarations decline the local trace. The existing conservative fragment/AI paths then apply. The production reader never compiles or executes editor code. It assumes standard Java library behavior and normal completion; this is not an arbitrary-Java verifier or a child readability study.

Compiler validation: **24 controlled fixtures** compile with `javac --release 17` and run on IntelliJ 2022.3's Java 17 runtime. Every full output matches the local trace, including renamed/reordered classes, changed values, declarations below constructors, implicit super, absent annotations, inherited methods/fields, casts, static calls through null, numeric prefixes, int overflow, escaped text and qualified assignments. Reproduce with `node scripts/check-java-teaching.mjs <JDK-home> [Java-runtime-home]`. Only these checked-in fixtures are executed. The saved report includes source hashes, output comparisons and before/after usage.

Validation: **541 unit/adapter tests**, **19 browser panel tests**, TypeScript checking, the actual VS Code host and the native IntelliJ **2022.3** bridge/JCEF panel pass. The editor-host checks include the exact Java output and zero reported tokens. Browser checks cover four compact steps, one output block, collapsed definitions, zero-token labeling and narrow layouts in the shared panels. Incorrect/partial constructs fall through rather than returning an invented trace, including Java's longest-token rule for `--` versus two separated minus signs. Logs are in `work/java-trace-*.log`; compiler/usage results are preserved in `tests/quality/java-trace-2026-11-14.json`. Existing IDE warnings about Windows' absent `wmic` command did not fail the plugin checks.

## Previous revision: avoid hidden reasoning for fully understood literal snippets

Both editors now derive a reviewed local walkthrough for a narrow grammar of literal assignments, same-type `+` operations and standard output calls in TypeScript/JavaScript and Python, plus a single Java `println` of a string literal. This preserves operation order, local variable origins, definitions, output-function origins and derived output without sending an AI request. The notice states the standard-output-function assumption. The reader never runs a selection, invokes a helper, or uses `eval`. Unknown helpers, extra context, closures, casts, inheritance, constructors, mixed types and unsupported syntax retain the existing reasoning-enabled AI path. Explicit deeper explanations, examples, practice and concept actions remain available. Existing local arithmetic/fragment paths are preserved. Both cache versions are now 8.

The initial experiment simply disabled Qwen reasoning for the three simple snippets. All three replies omitted their walkthrough steps and output, despite receiving the same instructions and completion ceilings. Those responses are **failed quality tests**, not successful savings. The shipped optimization uses a local explanation for those fully understood forms instead. Other model-backed explanations retain their original settings. Groq documents `none` and `low`/`medium`/`high` for this Qwen model, but does not document a smaller positive reasoning tier or a separate reasoning-token budget ([API reference](https://console.groq.com/docs/api-reference#chat-create)).

| Fixture                                | Before total | Shipped total | Hidden reasoning before → after | Result                                                       |
| -------------------------------------- | -----------: | ------------: | ------------------------------: | ------------------------------------------------------------ |
| TypeScript greeting with a stored name |          805 |         **0** |                         172 → 0 | Correct output, two local steps                              |
| Python greeting with a stored name     |          716 |         **0** |                         114 → 0 | Correct output, two local steps                              |
| Java literal `println`                 |          930 |         **0** |                         125 → 0 | Correct output, one local step plus stream origin            |
| Full tricky Java construction program  |        2,526 |         2,713 |                   1,024 → 1,024 | Same request/settings; new AI reply has a field-hiding error |

For the three eligible simple examples, total usage falls from **2,451 to zero**, including **411 hidden reasoning tokens**, with zero transport calls through both the direct VS Code engine and IntelliJ bridge. This is a narrow eligibility result, not a claim that arbitrary code is free. The local walkthroughs explain assignment, the `+` operation, printing/newlines and the standard output function. They avoid the baseline Java reply's irrelevant constructor-related concepts and the baseline Python wording that attributed string joining to `print` instead of `+`.

**The tricky Java quality check did not pass in the new live sample.** Its request body, low reasoning setting, schema, temperature and completion ceiling are byte-for-byte identical to the recent successful 2,526-token baseline. The new response correctly traced construction but wrongly said `x.s` selected B's field; it produced `B11B106aa` instead of `A11B106aa` at the end. This illustrates existing model variability under unchanged settings. No Java reasoning reduction or general AI-quality guarantee is claimed. The original failure is retained, not replaced with a passing answer or counted as an optimization win.

Validation: **474 unit/adapter tests**, **18 browser panel tests**, TypeScript checking, actual VS Code host checks, and native IntelliJ **2022.3** bridge/panel checks pass. Coverage includes the local route in both adapters, zero-call assertions, reference to original values, primitive formatting, renamed identifiers, Unicode, escapes, print order, overflow/output bounds, syntax uncertainty and preserved AI paths. Baselines and failed candidates are saved alongside local results in `tests/quality/groq-reasoning-2026-11-14.json`; the exact baseline requests are in `tests/quality/reasoning-before-requests.json`. The Java baseline is explicitly reused from the preceding comparison after verifying the complete request body matches. Seven new live calls reported **6,840 tokens**; the three final local results cost zero. No private reasoning content or API key is recorded. Reproduce the summary with `node scripts/report-reasoning.mjs tests/quality/groq-reasoning-2026-11-14.json`.

## Previous revision: less duplicate input and reused definitions

Final live comparison on Groq `qwen/qwen3.8-27b` (one response per final condition):

| Fixture                                           | Input before | Input after | Total before | Total after |
| ------------------------------------------------- | -----------: | ----------: | -----------: | ----------: |
| Java construction, hidden fields and static calls |        1,313 |       1,050 |        2,905 |       2,526 |
| Python closures and default arguments             |          864 |         649 |        1,450 |       1,244 |
| TypeScript import and supplied helper             |          768 |         652 |        1,122 |       1,086 |
| **Total**                                         |    **2,945** |   **2,351** |    **5,477** |   **4,856** |

Input decreased **20.2%**, completion usage (including reasoning) decreased **1.1%** from 2,532 to 2,505, and total usage decreased **11.3%**. All three final answers matched the complete expected output, including newlines. They retained four/three/three walkthrough steps and restored nine definitions locally from term names. Unfamiliar definitions and explicit deeper explanations remain supported. Savings vary: Python and TypeScript completions individually grew slightly, while their total usage still fell. This comparison does not establish universal savings or AI accuracy.

The baseline Java answer was incorrect; the baseline TypeScript reply triggered the import-definition false positive described below. The final Java answer correctly explains initialization order, runtime instance dispatch, separate hidden fields, casts and static calls. The Python answer distinguishes the shared loop variable from defaults captured at function creation. The TypeScript answer connects the supplied helper to the discount calculation. Visible prose was 193, 134 and 58 words respectively, excluding collapsed definitions. Some wording can still be improved (for example, Java repeats a static-method rule in its note); no child readability study was performed.

Validation: **411 unit/adapter tests**, **18 browser panel tests**, TypeScript checking, actual VS Code host checks, and native IntelliJ **2022.3 and 2025.2.4** checks pass. Final response replays verify the exact wire requests, output and hydrated definitions without additional provider calls. Both installers were rebuilt and inspected; the IntelliJ package contains 33 production classes at Java 17 bytecode or earlier and no test classes. Original raw replies and all 19 attempts (16 completed responses and three rate-limit failures) are saved in `tests/quality/groq-optimization-2026-11-14.json`. Completed trials reported 28,191 tokens in total; the final three-condition comparison above is a subset, not the total evaluation cost.

Both editors now share three request optimizations: shorter instructions without a repeated JSON template on strict-schema requests; exact duplicate context represented by backward references; and reviewed definitions filled locally when the provider returns a known term by name. The strict schema lists these names once; unfamiliar terms keep their generated definitions. Legacy term/definition objects remain supported. The original request still supplies local analysis, cache keys and evidence links. Selected code and replacement code remain intact; round-trip tests recover every context character and every evidence location, including Unicode, CRLF and repeated occurrences. Neither completion limits nor reasoning settings were reduced. Both cache versions are now 7.

Testing also caught an existing false positive: a reviewed import definition saying that an import does **not** prove installation was treated as a positive installation claim. Reviewed definitions are now excluded from that check, while unsupported claims in generated prose remain checked. Known output is displayed only from its print fragments; the structured format's unknown-output reason is ignored when output is complete, preventing a second contradictory output guess.

The comparison captures the original bundled engine before edits and uses identical project-mode Java, Python and TypeScript fixtures. Groq `qwen/qwen3.8-27b`, low reasoning, temperature 0.6 and completion ceilings stay unchanged. Only synthetic/user-supplied code is sent through the existing stored VS Code key. IntelliJ parity is tested through the same engine and its native bridge. Original raw replies, failures and provider-reported usage are retained; characters are not reported as tokens. Initial trial failures are not counted as successful quality checks. This is a small, adaptive engineering comparison rather than a statistical model benchmark.

The first optimized Python trial returned definitions with no execution steps. The revised prompt explicitly requires a walkthrough and print events, retains the complete Java accuracy guidance, and spells out default Python/JavaScript print newlines. Provider per-minute limits interrupted the later checks. See the saved comparison for the actual completed conditions; do not treat an interrupted request as zero-cost successful output.

A later trial confirmed that name-only definitions work, but the Java reply still confused subclass defaults with superclass fields and spent many tokens repeating the walkthrough inside `output.explanation`. The final prompt explicitly distinguishes these fields before initialization. For strict-schema responses, complete output now requires an empty explanation, while unknown output retains a free-text reason. This removes redundant generated text without lowering completion allowances. All earlier responses remain in the saved comparison, including failed quality checks.

Reproduce offline request capture with `node scripts/benchmark-tokens.mjs --snapshot`; run the unit suite with `node node_modules/vitest/vitest.mjs run`. The checked-in before/after request fixtures preserve the exact prompts and schemas. `scripts/review-learning.mjs` replays saved replies without network access, and `scripts/report-token-comparison.mjs` summarizes provider-reported usage for a single final variant. Live comparison requires an existing local baseline bundle and a configured VS Code Groq key; it does not export that key. Do not overwrite the baseline with a later engine and call it a before/after comparison.

The Java expected output was checked by compiling the fixed fixture for Java 17. The TypeScript fixture was bundled and executed locally and printed `80` followed by a newline. The Python expected values were reviewed from the shared loop binding versus per-function default argument; a runnable Python interpreter was unavailable here. None of these developer checks adds execution of editor selections to either extension.

## Previous revision: one compact walkthrough

The default now asks for 40–80 words for simple operations, 100–180 for interacting methods, and roughly 250 for complex selections. These are guidance, not sentence chopping or guaranteed model compliance. Both hosts use the same prompt, lesson schema, reviewer, and panel. The response has a purpose sentence, ordered steps, and at most one additional distinction. There are no separate connections/pitfalls sections or per-step output blocks. Definitions and reviewed practice start collapsed; **More detail** is explicit. Local facts inform the request instead of being appended as repeated sections. Both editor cache versions have changed.

The two-line constructor/override selection receives a reviewed local explanation (about 140 words) of parent construction, subclass initialization, method dispatch, and the later update. It does not assume that bare fields belong to the subclass, or guess values from absent declarations. The matcher is narrow and uses actual identifiers; complete programs and selections with supplied project context continue to the provider. The original overlong user response is preserved as a regression fixture. The code is never executed by this safeguard.

Completion allowances are now 900 for the default, 1,600 for expanded detail, 450 for a concept, 800 for an example, and 700 for impact. Groq Qwen still adds 2,048 for low reasoning. These are ceilings; actual usage is reported.

Validation for this revision: **383 unit/adapter tests**, **17 browser panel tests**, TypeScript checking, the actual VS Code host, and native IntelliJ **2022.3 and 2025.2.4** pass. Logs are in `work/compact-*.log`. Coverage includes renamed identifiers, unsupported structures, comments/strings, missing declarations, supplied project evidence, zero-network local results, both bridge/cache paths, legacy traces, and arithmetic repetition. Panel coverage checks one output block, collapsed terms/practice, keyboard/click expansion, hostile text, and narrow layouts. Native IntelliJ continues to compile against 2022.3 with Java 17 bytecode.

Live Groq checks used only the supplied Java and synthetic Python examples with the existing stored key. The initial full Java result had correct mechanism prose but omitted a character and newline from its final print fragment. A new consistency guard withholds that incomplete output; it does not guess a correction or claim to verify arbitrary prose. A final Java request produced the correct complete output in five steps, using 2,901 reported tokens. It was still longer than the prompt's suggested word target, so this is not a guarantee of strict answer length. The small Python example was 53 words with correct `Ada, Lin` output; the partial Java constructor required zero API tokens. Original responses and usage are preserved in `tests/quality/groq-compact-initial-2026-11-14.json` and `tests/quality/groq-compact-final-2026-11-14.json`. No general AI-accuracy or child-readability guarantee is claimed.

## Earlier revision: complete explanations in plain language

The earlier 200/500-token restrictions were too aggressive. They limited explanations to summaries and discarded useful execution steps when local facts were available. The current revision preserves the complete trace, explains how named parts work together, shows per-step print fragments and assembled output, and adds important distinctions. Local facts supplement a lesson instead of replacing its useful details. Explicit concept expansions now explain the concept in the selected code rather than repeating a short definition.

The default explanation allows 1,800 completion tokens and the deeper walkthrough 3,200. Groq Qwen adds 2,048 tokens to each limit for low reasoning, with only the final answer returned. These are shared completion ceilings of 3,848 and 5,248, not a guarantee of exact answer length. Actual usage remains visible; caches and local basic arithmetic remain free, and there are no automatic retries. The earlier 42% token-reduction result below is historical and is **not** a claim about these fuller lessons.

### The supplied Java example

The checked-in `Womb` fixture was compiled with `javac --release 17` and executed in the isolated test directory. It prints:

```text
null0A1 B6A11 B106A11 A11B106aa
```

There is one space after each of the first three chunks and a newline after the final chunk. The extension itself does not compile or execute selections; this was a developer regression check of the fixed fixture. Reproduce it with `node scripts/check-java-teaching.mjs <JDK-home>`.

`Womb` contains two **static nested classes**, `A` and `B`. A nested class is written inside another class. Because these are static, neither needs a `Womb` object; Java distinguishes them from non-static inner classes. Separately, `B extends A` makes B a subclass of A. Nesting organizes the source; inheritance connects behavior.

`new B()` creates **one object containing four fields**: A.s, A.n, B.s, and B.n. B's same-named fields hide A's fields; they do not erase them. This is why both sets must be tracked:

| Moment                                             | A.s  | A.n | B.s  | B.n | Printed text             |
| -------------------------------------------------- | ---- | --: | ---- | --: | ------------------------ |
| Before written initializers                        | null |   0 | null |   0 | Nothing                  |
| A's initializers finish                            | "A"  |   1 | null |   0 | Nothing                  |
| A() calls show(), which reaches B.show()           | "A"  |   1 | null |   0 | `null0A1 `               |
| A() adds 10 to its n                               | "A"  |  11 | null |   0 | Nothing                  |
| B's fields initialize; its block multiplies n by 3 | "A"  |  11 | "B"  |   6 | Nothing                  |
| B() calls show()                                   | "A"  |  11 | "B"  |   6 | `B6A11 `                 |
| B() adds 100 to its n                              | "A"  |  11 | "B"  | 106 | Nothing                  |
| main calls x.show()                                | "A"  |  11 | "B"  | 106 | `B106A11 `               |
| main evaluates println                             | "A"  |  11 | "B"  | 106 | `A11B106aa` then newline |

The first `show()` call is the trap: even inside A's constructor, the actual object is B, so Java calls B's overridden instance method. B's written initializers have not run yet. Inside B.show, ordinary `s` and `n` name B's fields, while `super.s` and `super.n` select A's fields on the same object. A.show never runs in this program.

For the final line, `x.s` and `x.n` select A's fields because x is declared A. The cast `(B) x` selects B's fields without changing or creating the object. Static `who()` is different from instance `show()`: both `x.who()` and `((A) null).who()` select A.who and return `"a"`. That static call does not dereference null. B.who hides A.who; it does not override it. Since the `+` expression begins with a String, it joins the values as text from left to right.

`A` and `B` are user-defined; `String` and `System` are standard `java.lang` classes. `System.out` is a `java.io.PrintStream`: `print` writes text, and `println` also ends the line. In a real application, a parent constructor calling a child's display method could expose a label before the child has set it. Prefer a separate setup step after construction or a suitable private/final helper that cannot call into an unfinished subclass.

These distinctions are consistent with [Java instance initialization](https://docs.oracle.com/javase/specs/jls/se17/html/jls-12.html#jls-12.5), [nested classes](https://docs.oracle.com/javase/specs/jls/se17/html/jls-8.html#jls-8.1.3), and [field access and method invocation](https://docs.oracle.com/javase/specs/jls/se17/html/jls-15.html#jls-15.11).

### Current validation

- **360 unit/adapter tests** and the TypeScript build check pass. New coverage retains traces longer than eight steps, fixes the displayed polymorphism definition without discarding the trace, validates and assembles per-step print output, preserves unknown-output handling, and keeps valid Python closure lessons when the local origin index cannot resolve a complex scope. Saved real Groq responses are replayed as regressions.
- **16 browser panel tests** pass, including the complete Java lesson, per-step output, exact final whitespace, both host bridges, narrow layout, and text-only rendering of hostile-looking content in every new section.
- The real VS Code host and native IntelliJ Community **2022.3 and 2025.2.4** suites pass. Native tests cover the expanded sections, JCEF, themes, Java hover/origins, edit guards, and the shared Node bridge. The plugin still compiles against 2022.3 with Java 17 bytecode.
- Live testing uses the authorized Groq model through VS Code's existing SecretStorage key. Only the supplied example and synthetic fixtures are sent; the key and private reasoning are not exported. IntelliJ's native integration is checked separately with fixtures through the same provider implementation.

Initial longer replies still produced inconsistent outputs; those failures motivated the per-step print format. Final output is now assembled from the same fragments as the execution trace, eliminating an independent final-output guess. This does not prove that each model-generated step is correct. Supplemental nested-class/library clues and reviewed definitions are applied locally, without hardcoding the `Womb` answer into the product.

The final live **Java explanation (9 steps)** and **Java walkthrough (14 steps)** both produced all four correct print fragments and exactly matched the compiled output, including its trailing newline. They used **3,649** and **3,729** reported total tokens respectively, including reasoning. The final structured Python request was rate-limited; an earlier live Python reply correctly distinguished `[2, 2, 2]` from `[0, 1, 2]`, and offline replay now preserves its complete 14-step trace instead of replacing it with a generic fallback. This is not a claim that the final Python request succeeded live.

Separate concept expansions still made errors about fields during construction and the role of `@Override`. A reviewed contextual expansion now handles Java polymorphism when a single visible superclass-typed declaration constructs a directly declared subclass. It uses the actual class/variable names, explains six distinct mechanisms and a practical use, and makes zero API requests. It does not predict program output. Tests include renamed classes and variables to ensure the product does not match the `Womb` example by name. Other concept structures still use AI.

Preserved evidence: [final structured calls and local review](tests/quality/groq-depth-2026-11-14.json), [earlier reasoning-enabled calls and Python replay](tests/quality/groq-depth-earlier-2026-11-14.json), [initial attempts](tests/quality/groq-depth-initial-2026-11-14.json), and [the faulty concept reply alongside its reviewed replacement](tests/quality/groq-depth-concept-2026-11-14.json). Original replies and actual usage remain available, including failures; local replay does not retroactively remove tokens from earlier requests. The settings and response format changed during this investigation, so it is regression evidence rather than a controlled model benchmark. No further provider calls were made after the final concept check.

No child usability study or formal sixth-grade readability assessment has been conducted. The goal is full explanations with familiar words and defined terms, not a guaranteed reading score or universal AI accuracy.

## Earlier follow-up: corrected teaching and lower token use

**The observed quiz failures now use reviewed practice answers in both editors. The shared engine corrects the tested explanation failures and uses shorter AI requests.** This is bounded regression coverage, not proof that arbitrary AI prose is correct or that a child can understand every lesson without help.

The current follow-up supersedes the implementation and test counts in the historical baseline below. Existing Python checking, native IntelliJ Java origins, automatic theming, edit guards, and language support remain in place.

### What changed

- Short sentences, concrete values, and plain definitions replace model-generated definitions for known terms. Deeper lessons ask AI for only a short summary and steps. Matching topics receive a reviewed, separate application example and a question with an answer supplied locally. Unsupported walkthrough topics omit unverified examples and quizzes; explicitly requested free-form AI examples are labeled unverified.
- The regression cases correct C# `>` versus `>=`, async Promise versus resolved value, Requests HTTP error statuses and JSON types, Java `ArrayList` types/origin, local parameter shadowing, rounded square-root examples, and invented results for missing helpers. Async generators are excluded from the ordinary async-function Promise rule.
- A bounded literal-arithmetic reader handles simple written TS/JS/Python assignments without executing code. Dynamic calls, rebinding of built-ins, unsupported expressions, oversized numbers, division by zero, ambiguous JavaScript operators/octal, and Python float floor division are excluded. Standard built-in/math assumptions are explicit; arithmetic results are not runtime observations.
- Supported arithmetic, incomplete syntax, known definitions, and matching examples return locally with zero provider requests. Malformed or known contradictory replies fall back to local facts when available. The panel labels local learning help and preserves any usage already incurred. There are no automatic provider retries, and provider errors such as authentication/quota failures remain errors.
- Both editors use a 200-output-token short-action cap and a **500-output-token walkthrough cap**, down from 1,000. Teaching facts add at most 1,000 characters derived from the selection; source context limits are unchanged. Groq's default Qwen request uses no reasoning and temperature zero. Lower randomness does not establish factual accuracy ([Groq API reference](https://console.groq.com/docs/api-reference#chat-create)).

### Current verification

| Check                                  | Result                                                                                                                                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TypeScript build check                 | Passed, `tsc --noEmit`.                                                                                                                                                                                                              |
| Unit and adapter regressions           | **341 passed in 10 files**, including saved faulty Groq responses, reviewed practice answers, arithmetic boundaries, empty/malformed replies with retained usage and no retry, and the shared IntelliJ bridge correction/cache path. |
| Browser panel tests                    | **15 passed**, including both editor bridges, local labels, correction notices, actual/zero usage, narrow layout, and safe text rendering.                                                                                           |
| Real VS Code host                      | Passed activation, commands, hover, panel, references, evidence bounds, editing regressions, and multiple languages in an isolated profile.                                                                                          |
| IntelliJ Community 2022.3 and 2025.2.4 | Both native suites passed, including Java hover/origins, themes, actual JCEF notices, Java-to-Node bridge, Python/JS/TSX, syntax previews, edit guards, and extreme Java inputs. Compiled against 2022.3 with Java 17 bytecode.      |

The native editor suites ran before the final arithmetic-edge exclusions; those shared refinements passed the final 341-test suite. Native Java/UI code did not change afterward. The earlier 1,200-mutation parser stress results remain recorded below; they are not a fuzzing certification of the new teaching rules. Teaching checks use finite known rules and reviewed material, not a second AI judge.

### Live Groq follow-up

The authorized `qwen/qwen3.8-27b` follow-up used the existing VS Code SecretStorage key and synthetic fixtures only. The key was neither exported nor logged. It produced **19 completed lessons in 20 evaluation attempts**: 18 successful provider calls, one incomplete-Python lesson handled locally, and one failed provider reply with an empty Java summary. That failure stopped the evaluator; after adding local fallback, it resumed within the same cap. The product itself never retried automatically.

| Provider-reported tokens on completed lessons | Earlier batch | Follow-up |
| --------------------------------------------- | ------------: | --------: |
| Input                                         |         5,921 |     5,682 |
| Output                                        |         5,933 |     1,232 |
| Total                                         |        11,854 |     6,914 |

That is **about 42% fewer reported total tokens and 79% fewer output tokens** across these batches. Failed calls have no recorded usage here, so these are not complete billing totals. Short and deep examples are mixed, one follow-up case was local, and settings/guards changed during the batch: this is an observed sample comparison, not a controlled benchmark or a guarantee for every request. The final arithmetic shortcut was added afterward and verified at zero requests in unit tests; it is not retroactively deducted from these observed totals.

Raw follow-up replies still showed mistakes, including a false Python type-error claim, a placeholder step, and imprecise shadowing language. Final guards were replayed offline against the saved replies to verify those corrections without more API calls. See [the preserved requests, original replies, usage, and reviewed lessons](tests/quality/groq-teaching-fix-2026-11-14.json). Reproduce that offline replay with `node scripts/review-learning.mjs tests/quality/groq-teaching-fix-2026-11-14.json work/learning-replay.json`.

Reviewed lesson prose ranges from 22 to 214 words, excluding code; completed deeper lessons range from 73 to 214. The review checks plain wording, origin uncertainty, example/result agreement, and correct practice answers. No child usability study or formal reading-grade assessment was conducted. The live calls exercise the shared provider from VS Code; IntelliJ's native panel/bridge was tested separately with fixtures, not an independent live Groq conversation.

The reviewed distinctions also follow the language documentation: [C# comparisons](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/comparison-operators), [Java ArrayList](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/ArrayList.html), [Rust references and borrowing](https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html), and the Requests/async references in the baseline below.

## Historical baseline: failures that motivated these fixes

The following review predates the teaching fixes above. Its original counts, response examples, output limits, and unfinished-fix observations are retained as historical evidence.

**Result: the tested editor flows pass after fixes, but the tested Groq/Qwen explanations are not consistently accurate or complete enough for a sixth grader to rely on without review.** Longer lessons add useful structure; they do not fix factual mistakes by themselves. No child usability study or formal reading-level assessment was conducted.

This review covers the working tree on `TainBranch`, including the existing IntelliJ Java origins and automatic theming changes. It tests both editor adapters and their shared learning engine. It does not certify every language, operating system, IDE version, or possible input.

## Completed software checks

| Check                            | Result and scope                                                                                                                                                                                                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript build check           | Passed, `tsc --noEmit`.                                                                                                                                                                                                                                                            |
| Unit/adapter tests               | **279 passed** in 9 files: analyzers, local origins, providers, cache, language routing, bridge validation, context boundaries, and edit guards. Provider HTTP responses in this suite are fixtures.                                                                               |
| Browser panel tests              | **14 passed**, including both editor bridges, optional step-by-step request, usage display, narrow layout, text-only hostile-content rendering, concept interaction, and preview/apply gating.                                                                                     |
| Real VS Code host                | Passed activation, commands, TypeScript hover and editing regressions, references/evidence bounds, plus Python, JavaScript, JSX, Java, C#, Go, and Rust hover links and panel opening. Uses an isolated profile.                                                                   |
| IntelliJ IDEA Community 2022.3   | Passed native Java hover/Javadoc/navigation, syntax pieces/origins, import clues, theme and font changes preserving the lesson/draft/tab, confirmed edits/cancellation, actual JCEF panel, and packaged Java-to-Node bridge.                                                       |
| IntelliJ IDEA Community 2025.2.4 | Passed the same native checks using the plugin compiled against 2022.3 with Java 17 bytecode.                                                                                                                                                                                      |
| Native additional languages      | Python, JavaScript, and TSX inspection, import clues, and valid/invalid syntax previews passed through the actual IntelliJ-to-Node bridge.                                                                                                                                         |
| Native Java extremes             | Empty/comment-only and invalid source, Unicode, a 480,000-character literal, 4,000 fields, bounded pieces, oversized-file rejection, and written import clues passed on both tested IDE versions. The Java extreme group took 226 ms on 2022.3 and 211 ms on 2025.2.4 in this run. |
| Parser stress process            | **1,200 deterministic malformed/truncated mutations plus 8 large/deep cases passed**, with a 256 MB V8 heap limit and a 30-second child-process deadline.                                                                                                                          |
| Lockfile                         | Offline `npm ci --dry-run --ignore-scripts` passed. This is a lockfile check, not a fresh dependency installation on every platform.                                                                                                                                               |

Native tests use isolated IDE profiles, never apply edits to the user's real project, and do not use an API key. Theme inspection exports the panel DOM and renders the native documentation component; no desktop recording is needed. Existing Node version, checksum rejection, and startup-cancellation tests passed. A new Node download was not repeated in this review.

## Extreme-input measurements

These are single-run measurements on this Windows machine, not performance guarantees. Time includes inspection and syntax checking. `checked` in the raw report means a parser was available, **not** that the code was valid or would execute.

| Input                                    |               Size |         Time | Behavior                                                                               |
| ---------------------------------------- | -----------------: | -----------: | -------------------------------------------------------------------------------------- |
| TypeScript with 6,000 nested parentheses |  12,012 characters |         6 ms | Falls back to exact text; syntax unavailable/error, so Apply is blocked.               |
| Python with 4,000 nested list brackets   |   8,005 characters |       125 ms | Bounded pieces; explicit excessive-nesting error blocks Apply.                         |
| TypeScript huge string                   | 480,013 characters |        11 ms | Parses without executing; labels remain bounded.                                       |
| Python huge string                       | 480,006 characters |        16 ms | Parses without executing; labels remain bounded.                                       |
| Python 10,000 assignments                | 157,780 characters |       178 ms | Bounded syntax index; avoids promising origins when the index is incomplete.           |
| TypeScript 20,000 statements             | 260,000 characters |       155 ms | Completes without crashing. Duplicate declarations are outside this syntax-only check. |
| TypeScript 5,000 unfinished declarations |  75,000 characters |        79 ms | Returns bounded diagnostics without crashing.                                          |
| Python 1,500 unfinished blocks           |  27,000 characters |       117 ms | Returns bounded diagnostics without crashing.                                          |
| 1,200 seeded mutations                   |    TS, JSX, Python | 164 ms total | No crashes; exact selections remain exact and ranges stay inside the source.           |

The focused Python follow-up added **87 valid/invalid syntax and structure cases**, plus three VS Code host checks that invalid recovered Python cannot reach edit confirmation. These include bad dedents, ambiguous tabs/spaces, invalid assignment targets, duplicate parameters, misplaced control-flow/async statements, and valid multiline, decorated, generator, and async code. The native bridge also exercises invalid Python indentation, parameter and statement placement, plus valid async code.

Unit cases also cover CRLF, emoji/non-ASCII names, invalid ranges, missing declarations, shadowed names, Python function defaults/lambdas, uncertain scopes, malicious-looking comments/strings, and unsupported-language edit protection. Input over 500,000 characters is rejected for inspection. This is bounded stress coverage, not exhaustive fuzzing or a proof against all resource exhaustion.

Raw measurements: [stress-2026-11-14.json](tests/quality/stress-2026-11-14.json). Reproduce the offline stress suite with `npm run test:stress`.

## Live Groq evaluation

The user authorized Groq with **`qwen/qwen3.8-27b`**. The evaluation used the existing VS Code SecretStorage key through a temporary development extension. The key was not exported or logged. Only synthetic examples from [cases.ts](tests/quality/cases.ts) were submitted; the example HTTP calls inside those snippets were not executed.

- **20 request attempts: 19 successful, schema-valid responses and 1 rate-limit response.** The batch stopped at its cap. The evaluator resumed after the rate limit with spaced requests; the product still has no automatic retries.
- **5,921 input + 5,933 output = 11,854 provider-reported tokens** across successful responses. The failed request supplied no usage. This does not establish account billing or remaining free-tier quota.
- Four initial short explanations, fourteen completed deeper lessons, and one repeated short explanation were reviewed. The short action kept its 200-output-token cap; the optional deeper action allowed 1,000.
- Live calls exercised the actual shared provider adapter from VS Code. IntelliJ's actual panel/bridge was tested separately with fixtures; there was **no independent live Groq conversation initiated by the IntelliJ panel** in this batch.
- Prompts were tightened during the batch. The final change that restricts `const` guidance to TypeScript/JavaScript and prohibits discussing absent operations was made after the batch and was **not live-retested**. These results are observations across revisions, not a controlled before/after benchmark.

All synthetic requests and returned lessons are preserved in [groq-2026-11-14.json](tests/quality/groq-2026-11-14.json), including the incorrect answers. Schema validation checks structure, not truth.

## Teaching criteria and findings

A useful beginner lesson should correctly explain purpose, follow concrete input through the work to the result, trace names to declarations, distinguish written library imports from verified origins, define unfamiliar terms, show a realistic application with a correct expected result, and give a correct practice answer. It should explicitly acknowledge missing context or invalid code. Readable wording cannot compensate for a false explanation.

| Scenario                            | Observed lesson quality                                                                                                                                                                                                                                                                      |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Easy TypeScript arithmetic          | Correct result of 6 and a shopping example. Some definitions were awkward or oversimplified; the short response's `const` definition did not explain reassignment versus object changes.                                                                                                     |
| Easy Python receipt total           | Correct result of 9. The longer response explains the list and built-in `sum`, with a receipt example. The short response skipped one addition in its prose.                                                                                                                                 |
| Python `math` alias and square root | Traces the alias and arithmetic, and offers distance/map applications. **The example promises rounded output that its code does not round.**                                                                                                                                                 |
| TypeScript local import             | **Initial short response invented a numeric result for a missing implementation and ended mid-sentence.** Later responses stopped inventing that number; the deeper response still treated the written import as proof a file exists, and its example did not teach the same import pattern. |
| Python web request                  | **Incorrectly says JSON becomes a dictionary and `raise_for_status()` fails for every non-200 status.** Its practice answer uses misleading Python “undefined” terminology and even includes an “Invalid reasoning” fragment.                                                                |
| JavaScript async request            | Explains waiting and checking HTTP success, but **confuses the Promise returned by an async function with its resolved value**, and assumes the returned JSON/name shape.                                                                                                                    |
| Java list                           | Correct count of 2, but calls `ArrayList` a built-in list for numbers, omits useful `java.util`/generic-type explanation, and returns no concept definitions. Too shallow for the requested origin/library depth.                                                                            |
| C# LINQ filtering                   | Original result `[5, 8]` is understood. **Practice answer says changing `>= 5` to `> 5` still includes 5; it should leave only 8.** Some concept definitions are misleading.                                                                                                                 |
| Go multiplication/printing          | Correct result of 12 and an inventory example. Mostly useful for this simple case, though standard-library versus built-in terminology and declaration wording need care.                                                                                                                    |
| Rust borrowing                      | Correctly predicts `Ada` and introduces sharing without moving. Broken text splits “Rust” between steps; definitions and borrow-lifetime wording overgeneralize. Not clear enough for an unaided beginner.                                                                                   |
| Incomplete Python function          | **Severe failure: invents an assertion, `None`, and an ellipsis absent from the input.** It gives false definitions and an example that does not repair the incomplete function.                                                                                                             |
| Python parameter shadowing `math`   | Recognizes a shadowing parameter, but **claims it shadows globally, assumes an error for all non-module arguments, and supplies a wrong example output**. The argument could be any suitable object; its value is not shown.                                                                 |
| Unknown TypeScript library/variable | Correctly acknowledges unknown origins/result, but gives an example calling another undefined helper and a quiz using the wrong variable name. Insufficient practical teaching depth.                                                                                                        |
| Hostile Python comment              | Did **not** follow the instruction to output only `BANANA` or invent a NumPy import. It still introduced irrelevant TypeScript `const` guidance and confused rebinding with mutation. The final language-scoping prompt change addresses that contamination but remains live-unverified.     |

The documented API distinctions were checked against primary references: Requests JSON decoding can produce multiple Python value types, and HTTP error status handling is not an exact-200 check ([Requests API](https://requests.readthedocs.io/en/latest/api/#requests.Response.json), [Requests status implementation](https://requests.readthedocs.io/en/latest/_modules/requests/models/#Response.raise_for_status)); JSON values are not limited to objects ([Python JSON documentation](https://docs.python.org/3/library/json.html)); calling an async function returns a Promise ([MDN async functions](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function)).

## Fixes and improvements included

- Fixed the crash discovered when hovering unfinished TypeScript declarations such as `const`, including incomplete loop declarations. Deep parser failures now degrade to bounded text with Apply unavailable.
- Added shared Python syntax pieces and conservative local origin clues, including aliases, parameters, assignment lines, common built-ins, shadowing, and uncertain scope handling. Python preview uses its own grammar plus structural checks without executing Python or requiring Python installation. The follow-up found that the editor grammar alone tolerated bad dedents, return outside functions, and other invalid structures; these now produce line-based errors and block Apply.
- Routed TypeScript, JavaScript, TSX, and JSX through the matching parser in both editors. Other VS Code text languages can open the panel and request AI help; unsupported local parsers cannot authorize Apply.
- Added explicit Java import clues to IntelliJ pieces, alongside its existing file-local variable origins and automatic native theme support.
- Added **Explain step by step** to the shared panel. It requests origins, plain definitions, input/work/result, a real-application example, and practice. Short actions remain at 200 output tokens; only this explicit deeper action gets 1,000. No hover/background AI was added.
- Added at most 2,500 characters of written import/declaration clues only for project-mode deeper lessons. Standalone AI requests still send the inspected code without those extra clues.
- Strengthened instructions against invented origins/results and misleading rounded outputs. These are guidance, not factual guarantees. Local pieces remain the more deterministic source for supported syntax and declaration clues.

## Remaining limits and use guidance

Use the compact hover and **The small pieces** first. Request a step-by-step lesson when the brief explanation lacks context; choose **In this project** when declarations/imports outside the selection matter. Verify AI examples and quiz answers against the code and documentation before using them to teach a child. The tested model's incomplete-code and simple quiz failures are significant; changing only the output length is insufficient.

Python local origins are intentionally conservative for complex scopes, wildcard imports, dynamic assignment, and very large syntax trees. Written imports do not prove the installed package, version, or implementation. Python checking combines grammar and common structural rules; it is not a complete CPython compiler. Syntax checking does not provide type checking, dependency verification, execution, or a guarantee of runtime success. Other-language project references depend on installed editor language services. No all-language accuracy claim is supported by this sample.

IDE compatibility remains **IntelliJ 2022.3–2025.2.x**. Only Windows with Community 2022.3 and 2025.2.4 was exercised here. Intermediate versions, Ultimate-specific behavior, remote development, macOS/Linux, and later builds were not independently tested.

The optional live evaluator is `node scripts/evaluate-learning.mjs`, with `VSCODE_EXECUTABLE` pointing to the installation whose normal profile holds the Groq key. It opens a temporary development window, reads only the saved Groq key through SecretStorage, submits synthetic fixtures, writes `work/learning-live-results.json`, and closes its window. It resumes that report, counts failed attempts toward the 20-attempt cap, and stops on a provider failure. It is intentionally excluded from ordinary tests; running it with a fresh report uses provider quota. Never paste a key into source or chat to run it.
