# Architecture

## System Overview

Media Markdown Converter is an Electron desktop application that converts paper notes (photos/PDFs) and audio recordings into digital markdown using LLM vision and audio models. The app uses a renderer-process architecture where the React UI runs in a Vite-dev-server-backed Chromium window, with a Node.js main process handling file system access and native dialogs.

```
┌─────────────────────────────────────────────────────────┐
│                      BrowserWindow                       │
│  ┌───────────────────────────────────────────────────┐  │
│  │              Renderer Process (React/Vite)        │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌─────────┐ │  │
│  │  │  Components  │  │   Services   │  │  Utils  │ │  │
│  │  │  (UI layer)  │  │ (config, llm)│  │ (pdf,   │ │  │
│  │  └──────┬──────┘  └──────┬───────┘  │ prompt) │ │  │
│  │         │                 │          └────┬────┘ │  │
│  │         │                 │               │       │  │
│  │         ▼                 ▼               │       │  │
│  │  ┌──────────────────────────────────┐     │       │  │
│  │  │   contextBridge → window.electronAPI │     │       │  │
│  │  └────────────────┬─────────────────┘     │       │  │
│  └───────────────────┼────────────────────────┘       │
│                      │ IPC (renderer → main)           │
│  ┌───────────────────┼────────────────────────┐       │
│  │      Main Process (Node.js)                │       │
│  │  ┌────────────────┴──────────────┐         │       │
│  │  │   IPC Handlers (ipcMain)      │         │       │
│  │  │   - config CRUD               │         │       │
│  │  │   - file dialogs (electron)   │         │       │
│  │  │   - file system (fs.promises) │         │       │
│  │  │   - window management         │         │       │
│  │  └───────────────────────────────┘         │       │
│  └─────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────┘
```

## Data Flow

### Conversion Pipeline

```
Image/PDF Input
    │
    ▼
┌──────────────┐
│  ImageUploader │  (drag-drop or file picker)
└──────┬───────┘
       │ readFileAsDataUri() / renderPdfPages()
       ▼
┌──────────────┐
│  ImagePreview  │  (multi-page navigation, zoom)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  handleConvert │  (batch loop, per-page conversion)
│   /WithFolder  │
└──────┬───────┘
       │ convertImageToMarkdown()
       ▼
┌──────────────┐
│   LLM Service  │  (OpenAI / Anthropic / Gemini / Ollama)
│              │  (streaming chunks → full text)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ writeFile IPC │  (save to output folder)
└──────┬───────┘
       ▼
   Markdown File
```

### Config Loading Cascade

```
Env vars (VITE_LLM_*)
    │
    ▼  (if all of provider+model+apiKey present)
Return env config immediately
    │
    │  (if env vars incomplete)
    ▼
File config (userData/config.json)
    │
    ▼  (merge with provider defaults)
getDefaultConfig(fileConfig.provider)
    │
    │  (if file read fails)
    ▼
Default config (OpenAI provider)
```

## IPC Contract

### Renderer → Main (invoke)

| Channel | Renderer Param | Main Return | Description |
|---|---|---|---|
| `load-config` | none | `Config \| null` | Read config.json from userData |
| `save-config` | `Config` | `void` | Write config.json to userData |
| `open-file-dialog` | `OpenDialogOptions?` | `string[] \| null` | Multi-select file picker |
| `save-file-dialog` | `string?` | `string \| null` | Save dialog, returns path |
| `read-file` | `path, asBase64?` | `string` | File contents as UTF-8 or base64 |
| `write-file` | `path, content` | `void` | Write text to file |
| `window-minimize` | none | `void` | Minimize window |
| `window-maximize` | none | `void` | Toggle maximize/unmaximize |
| `window-close` | none | `void` | Close window |
| `window-is-maximized` | none | `boolean` | Check maximized state |
| `open-directory-dialog` | none | `string \| null` | Folder picker |
| `open-folder` | `path` | `void` | Open folder in native file manager |
| `file-exists` | `path` | `boolean` | Check file existence |

### Main → Renderer (send)

| Channel | Payload | Description |
|---|---|---|
| `window-state-changed` | `{ maximized: boolean }` | Fired on maximize/unmaximize |

## Component Hierarchy

```
App (state orchestrator)
├── container (root wrapper)
│   ├── top-bar (title, Settings btn, window controls)
│   ├── main-panel
│   │   └── main-panel__split (during conversion)
│   │       ├── ImageUploader (dropzone, file picker)  ← initial state
│   │       ├── ImageUploader (during PDF loading)      ← loading state
│   │       ├── ImagePreview (image display, nav, zoom) ← loaded state
│   │       ├── batch-view (batch file list)
│   │       │   └── batch-file (per-file item)
│   │       └── LiveOutputPanel (real-time output during conversion)
│   │           └── textarea (read-only output)
│   └── StatusBar (status text, action buttons)
├── ConfigPanel (modal, LLM config form + output folder)   ← when showConfig
│   └── ConflictDialog (modal, file conflict)    ← when showConflictDialog
└── overlay (backdrop)
```

### Component Details

| Component | Location | Purpose |
|---|---|---|
| `App` | `src/App.tsx` | State orchestrator, conversion flow, conflict handling |
| `TopBar` | `src/App.tsx` (inline) | Title, Settings button, custom window controls |
| `ImageUploader` | `src/components/ImageUploader.tsx` | Drag-drop zone, file picker, PDF loading indicator |
| `ImagePreview` | `src/components/ImagePreview.tsx` | Image display, page navigation, zoom controls |
| `LiveOutputPanel` | `src/components/LiveOutputPanel.tsx` | Real-time streaming output during conversion, copy button |
| `StatusBar` | `src/components/StatusBar.tsx` | Status text, Convert/Abort/Open Folder buttons |
| `ConfigPanel` | `src/components/ConfigPanel.tsx` | Modal LLM config form with provider, model, API key, base URL |
| `MarkdownEditor` | `src/components/MarkdownEditor.tsx` | Editable markdown with live preview (not used in current flow) |
| `ConflictDialog` | `src/App.tsx` (inline) | File conflict resolution: skip, overwrite, rename |

## LLM Provider Matrix

| Provider | SDK / Transport | Streaming | Base URL Default | API Key Required |
|---|---|---|---|---|
| OpenAI | `openai` npm package | Yes (streaming API) | `https://api.openai.com` | Yes |
| Anthropic | `@anthropic-ai/sdk` | Yes (stream API) | `https://api.anthropic.com` | Yes |
| OpenAI-Compatible | `openai` npm package | Yes (streaming API) | (user-provided) | Yes |
| LM Studio | `openai` npm package | Yes (streaming API) | `http://localhost:1234/v1` | No (optional) |
| Gemini | REST `fetch()` with `ReadableStream` | Yes (SSE-like JSON lines) | `https://generativelanguage.googleapis.com` | Yes |
| Ollama | REST `fetch()` | No (non-streaming) | `http://localhost:11434` | No |

### Model Fetch API Formats

Each provider returns model data in a different format:

- **OpenAI / OpenAI-Compatible / LM Studio**: `GET /v1/models` → `{ data: [{ id, ... }] }`
- **LM Studio (fallback)**: Single object `{ id, ... }` (not wrapped in array)
- **Anthropic**: `GET /v1/messages/models` → `{ models: [{ name, ... }] }`
- **Gemini**: `GET /v1beta/models` → `{ models: [{ name, supportedGenerationMethods }] }` — filters for `generateContent` support; conversion uses `POST /v1beta/models/{model}:streamGenerateContent` for streaming
- **Ollama**: `GET /api/tags` → `{ models: [{ name, ... }] }`

### URL Handling Gotcha

LM Studio's default base URL ends with `/v1`. The `fetchAvailableModels` function checks `baseUrl.endsWith('/v1')` to avoid appending a duplicate `/v1/models` path. OpenAI-compatible providers without `/v1` suffix get `/v1` appended automatically.

## Config System

### AppConfig Interface

```typescript
interface AppConfig {
  provider: 'openai' | 'anthropic' | 'openai-compatible' | 'lmstudio' | 'gemini' | 'ollama';
  model: string;
  apiKey: string;
  baseUrl: string;
  useApiKey: boolean;          // false = API key is optional (local providers)
  availableModels: string[];   // cached from fetchAvailableModels
  outputFolder?: string;       // set in Settings, not prompted at conversion time
}
```

### Provider Defaults

| Provider | Default Model | Default Base URL | useApiKey |
|---|---|---|---|
| openai | gpt-4o | https://api.openai.com | true |
| anthropic | claude-sonnet-4-20250514 | https://api.anthropic.com | true |
| openai-compatible | (empty) | (empty) | true |
| lmstudio | (empty) | http://localhost:1234/v1 | false |
| gemini | gemini-2.5-flash | https://generativelanguage.googleapis.com | true |
| ollama | (empty) | http://localhost:11434 | false |

### Config Storage

Config is stored at `<userData>/config.json` where `userData` is:
- **Windows**: `%APPDATA%/media-markdown-converter/config.json`
- **macOS**: `~/Library/Application Support/media-markdown-converter/config.json`
- **Linux**: `~/.config/media-markdown-converter/config.json`

### useApiKey Field

The `useApiKey` boolean controls validation behavior:
- `true` → API key required, validation enforced
- `false` → API key optional, validation skipped (for local providers like LM Studio and Ollama)

## PDF Rendering

PDFs are rendered to image pages using `pdfjs-dist` at scale factor 3 for OCR quality. The worker is loaded from `public/pdf.worker.min.mjs` via Vite's `?worker&url` import. Each page is rendered to a canvas, then converted to a PNG data URI.

### Key Details

- `canvasContext` option used (not `canvas` element) for compatibility
- Scale factor 3 balances OCR accuracy with memory usage
- Pages are rendered sequentially (not parallel) to avoid memory pressure
- `GlobalWorkerOptions.workerSrc` set once at module load time

## Known Technical Decisions

### Stale Closure Prevention

`handleConvert` reads `conflictStrategyRef` and `existingFilesRef` (not state) to avoid stale closures when called from the conflict dialog buttons. The refs are updated synchronously via `useEffect` before the callback executes.

### Promise.try Polyfill

`globalThis.Promise.try` is polyfilled in `main.tsx` for pdfjs-dist compatibility. The pdfjs-dist library uses `Promise.try()` which is not available in all browser environments.

### Frameless Window

`electron/main.ts:20` sets `frame: false` for a custom title bar. This means:
- No native window controls (close, minimize, maximize)
- Custom window controls implemented in `App.tsx` via `window.electronAPI`
- Drag-to-move not available by default (requires CSS `-webkit-app-region: drag`)

### Env Var Precedence

`VITE_LLM_PROVIDER`, `VITE_LLM_MODEL`, `VITE_LLM_API_KEY` in `.env` take precedence over saved `config.json`. If all three are set, `loadConfig()` returns immediately without reading the file. `VITE_LLM_BASE_URL` is used as a fallback for the base URL.

### LLM SDK Browser Requirement

Both `openai` and `@anthropic-ai/sdk` are instantiated in the renderer process (browser env). Both constructors must include `dangerouslyAllowBrowser: true` or they throw on startup. This is a security warning bypass — the SDKs are designed for Node.js but work in the browser with proper CORS and API key handling.
