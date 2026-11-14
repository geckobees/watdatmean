# Changelog

## 0.1.2

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
