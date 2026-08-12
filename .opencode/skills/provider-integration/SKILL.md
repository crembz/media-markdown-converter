---
name: provider-integration
description: Use when adding a new LLM provider to the app. Triggers on "add provider", "new provider", "provider support", or when integrating a new LLM API. Covers SDK setup, streaming, config defaults, and prompt compatibility.
---

# Provider Integration Skill

Use this skill when adding a new LLM provider to the Media Markdown Converter.

## Overview

The app supports three provider types: `openai`, `anthropic`, and `openai-compatible`. Adding a new provider means updating multiple files consistently.

## Step-by-Step

### 1. Add Provider to Config Type

In `src/services/config.ts`:

```ts
export interface AppConfig {
  provider: 'openai' | 'anthropic' | 'openai-compatible' | 'new-provider';
  // ...
}
```

### 2. Add Provider Defaults

In `src/services/config.ts`, extend `PROVIDER_DEFAULTS`:

```ts
const PROVIDER_DEFAULTS: Record<string, Omit<AppConfig, 'apiKey'>> = {
  // existing...
  'new-provider': {
    provider: 'new-provider' as const,
    model: 'default-model-name',
    baseUrl: 'https://api.newprovider.com',
  },
};
```

### 3. Install SDK

```bash
npm install new-provider-sdk
```

If types are needed:
```bash
npm install -D @types/new-provider-sdk
```

### 4. Implement Conversion Function

In `src/services/llm.ts`:

```ts
async function convertWithNewProvider(
  client: NewProviderClient,
  model: string,
  imageBase64: string,
  onChunk: (text: string) => void,
  signal: AbortSignal,
): Promise<string> {
  // 1. Parse image format (data URI -> base64 + media type if needed)
  // 2. Create streaming request with OCR_SYSTEM_PROMPT as system prompt
  // 3. Stream deltas, call onChunk(delta) for each
  // 4. Accumulate full text
  // 5. Return full text on completion
  // 6. Handle errors with descriptive messages
}
```

Key requirements:
- **Must stream** — no blocking full-response calls
- **Must accept AbortSignal** — pass to SDK, check `signal.throwIfAborted()`
- **Must use OCR_SYSTEM_PROMPT** — from `../utils/prompt`
- **Image format** — adapt data URI to whatever the provider expects

### 5. Wire into Main Function

In `src/services/llm.ts`, `convertImageToMarkdown`:

```ts
if (config.provider === 'new-provider') {
  const client = new NewProviderClient({ apiKey: config.apiKey /* ... */ });
  return convertWithNewProvider(client, config.model, imageBase64, onChunk, signal);
}
```

### 6. Update ConfigPanel

In `src/components/ConfigPanel.tsx`, add to `PROVIDER_OPTIONS`:

```ts
const PROVIDER_OPTIONS: AppConfig['provider'][] = [
  'openai',
  'anthropic',
  'openai-compatible',
  'new-provider',
];
```

### 7. Update AGENTS.md

Document the new provider in the provider defaults table.

## Verification Checklist

- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] Provider appears in ConfigPanel dropdown
- [ ] Default model + baseUrl auto-fill on selection
- [ ] Streaming works (onChunk called incrementally)
- [ ] Abort works (signal passed through)
- [ ] Error messages are user-friendly
- [ ] Config persists correctly (load/save round-trip)

## Common Pitfalls

- **Image format mismatch** — OpenAI uses `image_url` with data URI; Anthropic uses base64 `source` block. Check the new provider's expected format.
- **Streaming API differences** — Each SDK has different stream event types. Handle only text delta events.
- **Token limits** — Set reasonable `max_tokens` (4096 is a good default for OCR output).
- **System prompt support** — Some providers don't support system prompts. If not, prepend the prompt to the user message.
