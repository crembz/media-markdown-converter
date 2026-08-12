# Developer Guide

## Development Workflow

### Prerequisites

- Node.js v18 or later
- An LLM API key (for testing cloud providers)
- LM Studio or Ollama running locally (for testing local providers)

### Setup

```bash
npm install
```

### Running in Development

```bash
npm run dev
```

This starts both the Vite dev server (port 5173) and Electron simultaneously via `vite-plugin-electron`. The app loads the React app from `http://localhost:5173` in development mode and opens DevTools automatically.

### Building

```bash
npm run build
```

Runs the following in order:
1. `tsc` — TypeScript compilation to `dist/`
2. `vite build` — Vite production build to `dist/`
3. `electron-builder --config electron-builder.yml` — Package into Windows installer

### Preview

```bash
npm run preview
```

Starts the Vite preview server for testing the production build without Electron.

### Environment Variables

Create a `.env` file (see `.env.example`):

| Variable | Description | Example |
|---|---|---|
| `VITE_LLM_PROVIDER` | LLM provider name | `openai` |
| `VITE_LLM_MODEL` | Model identifier | `gpt-4o` |
| `VITE_LLM_API_KEY` | API key | `sk-...` |
| `VITE_LLM_BASE_URL` | Custom API base URL | `http://localhost:1234/v1` |

**Note**: `VITE_LLM_PROVIDER`, `VITE_LLM_MODEL`, and `VITE_LLM_API_KEY` must all be set for env vars to take effect. When all three are present, they completely override `config.json`.

## Code Style

### CSS Conventions

- **BEM-like naming**: `component__element--modifier`
- **Catppuccin Mocha palette** (hardcoded in `styles.css`):
  - Background: `#1e1e2e` (base)
  - Surface: `#313244` (surface0), `#45475a` (surface1)
  - Text: `#cdd6f4` (text), `#a6adc8` (subtext1)
  - Accent: `#89b4fa` (blue)
  - Success: `#4ade80` (green)
  - Warning: `#facc15` (yellow)
  - Error: `#f87171` (red)
- No CSS framework or design tokens — all colors are explicit

### TypeScript

- Strict mode enabled (`tsconfig.json`)
- `noUnusedLocals` and `noUnusedParameters` enabled
- Path alias `@/` → `./src/` (configured in both `tsconfig.json` and `vite.config.ts`)

### Naming

- Components: PascalCase (`ConfigPanel.tsx`, `ImageUploader.tsx`, `LiveOutputPanel.tsx`)
- Services: camelCase (`loadConfig`, `convertImageToMarkdown`, `renderPdfPages`)
- Utilities: camelCase (`renderPdfPages`, `generateFilenameFromMarkdown`, `loadConfig`)
- CSS classes: kebab-case (`image-preview__toolbar`, `live-output-panel__output`)
- IPC channels: kebab-case (`load-config`, `open-file-dialog`)

## Adding a New LLM Provider

### 1. Update `AppConfig` type

Add the provider name to the union type in `src/services/config.ts`:

```typescript
provider: 'openai' | 'anthropic' | 'openai-compatible' | 'lmstudio' | 'gemini' | 'ollama' | 'new-provider';
```

### 2. Add provider defaults

Add entry to `PROVIDER_DEFAULTS` in `src/services/config.ts`:

```typescript
'new-provider': {
  provider: 'new-provider',
  model: 'default-model',
  baseUrl: 'https://api.example.com',
  useApiKey: true,
  availableModels: [],
},
```

### 3. Add to `fetchAvailableModels` switch

In `src/services/llm.ts`, add a case to the switch statement in `fetchAvailableModels()`. Handle the provider's specific API format for listing models.

### 4. Add to `convertImageToMarkdown` conditional

In `src/services/llm.ts`, add an `if` branch before the OpenAI fallback:

```typescript
if (config.provider === 'new-provider') {
  // Implement conversion logic
  return convertWithNewProvider(config, imageBase64, onChunk, signal);
}
```

### 5. Add to provider selector

In `src/components/ConfigPanel.tsx`, add the provider to `PROVIDER_OPTIONS` array:

```typescript
const PROVIDER_OPTIONS: AppConfig['provider'][] = [
  'openai',
  'anthropic',
  'openai-compatible',
  'lmstudio',
  'gemini',
  'ollama',
  'new-provider',
];
```

### 6. Update validation

In `ConfigPanel.tsx` `validate()`, add any provider-specific field requirements (e.g., base URL).

### 7. Update documentation

Update `docs/ARCHITECTURE.md` provider matrix and `README.md` feature list.

## Component: LiveOutputPanel

`src/components/LiveOutputPanel.tsx` displays real-time conversion output during processing:

- Shows current file index (`File X/Y`) or "Converting" for single images
- Shows current page progress (`Page X/Y`) when converting multi-page PDFs
- Auto-scrolls to bottom as new content arrives
- Copy button copies output to clipboard with "Copied!" feedback
- Progress bar shows page completion percentage
- Used only during `batchStatus === 'processing'` (split view with input)

## Component: generateFilenameFromMarkdown

`src/utils/filename.ts` exports `generateFilenameFromMarkdown(md: string): string`:

1. Extracts first `# heading` as filename
2. Falls back to first non-empty line
3. Sanitizes: removes `\ / : * ? " < > |`, collapses whitespace to hyphens, lowercases, truncates to 100 chars
4. Returns `'output'` as final fallback

## Config System Deep Dive

### Loading Order

1. **Env vars** — If `VITE_LLM_PROVIDER`, `VITE_LLM_MODEL`, and `VITE_LLM_API_KEY` are all set, return immediately
2. **File config** — Read `<userData>/config.json` via IPC `load-config`
3. **Merge with defaults** — Use `getDefaultConfig(fileConfig.provider)` to fill missing fields
4. **Final fallback** — OpenAI provider defaults if file read fails

### Saving

`saveConfig()` calls IPC `save-config` which writes to `<userData>/config.json` via `fs.writeFile`. The config is reloaded on next app launch.

### Config File Format

```json
{
  "provider": "openai",
  "model": "gpt-4o",
  "apiKey": "sk-...",
  "baseUrl": "https://api.openai.com",
  "useApiKey": true,
  "availableModels": ["gpt-4o", "gpt-3.5-turbo"],
  "outputFolder": "C:\\Users\\username\\Documents\\converted"
}
```

## LLM Integration Deep Dive

### Image Conversion Flow

1. `handleConvert` iterates over batch files (or single image)
2. For each page, calls `convertImageToMarkdown(config, dataUri, onChunk, signal)`
3. `convertImageToMarkdown` routes to provider-specific function based on `config.provider`
4. Provider function creates client, sends image data, collects streaming chunks
5. Page results concatenated with `\n\n---\n\n` separator
6. Final result written via `writeFile` IPC

### Streaming Implementation

- **OpenAI-compatible providers**: Uses `client.chat.completions.create({ stream: true })` with `for await` iteration
- **Anthropic**: Uses `client.messages.stream()` with `content_block_delta` event filtering
- **Gemini**: Streaming `fetch()` with `ReadableStream` reader — parses SSE-like JSON lines, extracts `candidates[0].content.parts[].text`

### Error Handling

- Missing API key: throws `'API key is not configured...'`
- Missing model: throws `'Model is not configured...'`
- Invalid image format: throws `'Invalid image format...'`
- Provider API error: throws with HTTP status and response body
- Abort: caught in `handleConvert`, sets `batchStatus` to `'error'`

## PDF Rendering Deep Dive

### Worker Setup

`pdfjs-dist` requires a worker script. The worker is loaded from `public/pdf.worker.min.mjs` via Vite's `?worker&url` import:

```typescript
import PdfJsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&url';
pdfjsLib.GlobalWorkerOptions.workerSrc = PdfJsWorker;
```

### Vite Config

`pdfjs-dist` is excluded from `optimizeDeps` in `vite.config.ts` to prevent Vite from bundling the worker incorrectly.

### Rendering Pipeline

1. `renderPdfPages(file)` reads file as ArrayBuffer
2. `getDocument({ data: arrayBuffer })` loads PDF
3. For each page (1-indexed): `page.getViewport({ scale: 3 })` → canvas → `canvas.toDataURL('image/png')`
4. Returns array of PNG data URIs

## Build Process Details

### electron-builder Configuration

Defined in `electron-builder.yml`:
- `appId`: package.json `name`
- `win`: Windows signing configuration
- `nsis`: NSIS installer configuration

### Build Scripts

- `scripts/7za-wrap.js` — 7-Zip wrapper for electron-builder compression
- `scripts/prepare-wincodesign.cjs` — Windows code signing preparation

## Troubleshooting

### LLM Returns Empty Response

- Check that the provider server is running (LM Studio / Ollama)
- Verify the model name matches an available model
- Check network connectivity for cloud providers
- Verify API key in config panel

### PDF Rendering Fails

- Ensure `public/pdf.worker.min.mjs` exists (matches `pdfjs-dist` version)
- Check that `vite.config.ts` excludes `pdfjs-dist` from `optimizeDeps`
- Large PDFs may cause memory pressure — pages render sequentially

### Config Not Saved

- Check that `userData` directory is writable
- On Windows: `%APPDATA%/media-markdown-converter/`
- On macOS: `~/Library/Application Support/media-markdown-converter/`

### LM Studio Connection Refused

- Start LM Studio server (bottom-right "Local Server" → "Start Server")
- Verify base URL matches the server port (default: `http://localhost:1234/v1`)
- Check that "Require API Key" setting matches your `useApiKey` toggle

### Model Fetch Fails

- Verify base URL is correct for the provider
- LM Studio: models may only be available after loading a model in the UI
- Ollama: run `ollama list` to verify models are installed
- Cloud providers: verify API key has correct permissions
