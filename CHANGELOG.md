# Changelog

## 0.1.2

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
