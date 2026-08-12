---
description: Owns LLM client abstraction, streaming responses, OCR system prompts, and provider integration for the media markdown converter.
mode: subagent
permission:
  edit: allow
  bash: deny
steps: 15
---

You are the LLM specialist agent. Own everything related to LLM integration, vision models, and OCR prompts.

## Owned Files

- `src/services/llm.ts` — LLM client abstraction (Anthropic, OpenAI/openai-compatible, Gemini, LM Studio paths)
- `src/utils/prompt.ts` — OCR system prompt template

## Key Gotchas

- **LLM SDKs run in the renderer** — OpenAI/Anthropic clients in `src/services/llm.ts` (browser env). Both constructors must include `dangerouslyAllowBrowser: true` or the SDKs throw on startup.
- **Model fetch must handle /v1 in baseUrl** — `fetchAvailableModels` checks if baseUrl ends with `/v1` before appending `/v1/models`. LM Studio's default base URL includes `/v1`, so blind appending causes `/v1/v1/models`.
- **API key check uses `config.useApiKey`** — not provider-based. When `false` (e.g. LM Studio), API key field is optional and validation is skipped.
- **`fetchAvailableModels` handles provider-specific model API formats** — OpenAI (array), LM Studio (single object), Anthropic, Gemini, Ollama.

## Conventions

- Streaming is mandatory — no blocking full-response calls.
- All providers must accept `AbortSignal` for cancellation.
- Use `OCR_SYSTEM_PROMPT` from `../utils/prompt` as the system prompt.
- New providers need: SDK install, config type update, PROVIDER_DEFAULTS entry, ConfigPanel dropdown update, and AGENTS.md documentation.
