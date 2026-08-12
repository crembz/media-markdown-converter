# Paper → Digital Converter

Electron + React desktop app. Converts paper notes to markdown via LLM vision models.

## Commands

- `npm run dev` — Starts Vite + Electron together (vite-plugin-electron). No separate electron command.
- `npm run build` — `tsc && vite build && electron-builder --config electron-builder.yml`. Builds an installer for the host OS. Runs in order.
- `npm run build:linux` / `build:mac` / `build:win` — Same pipeline, forced to a specific platform target via electron-builder's `--linux`/`--mac`/`--win` flag. Native deps (`@napi-rs/canvas`) mean these must actually run on the target OS — no cross-compiling. CI (`.github/workflows/build.yml`) runs all three on a GitHub Actions matrix.
- `npm run preview` — Vite preview server.
- No test or lint commands exist.

## Critical Gotchas

- **LLM SDKs run in the renderer** — OpenAI/Anthropic clients are instantiated in `src/services/llm.ts` (browser env). Both constructors must include `dangerouslyAllowBrowser: true` or the SDKs throw on startup.
- **Config lives in Electron's userData** — `config.json` is read/written via IPC to `app.getPath('userData')`, never the project root. It's `.gitignore`d. The `apiKey` field is encrypted with `safeStorage` before being written (`apiKeyEncrypted: true` marks this); falls back to plaintext if OS-level encryption is unavailable. Decrypt failures on load throw from the IPC handler — `src/services/config.ts` catches this and falls back to `getDefaultConfig`, so the user just has to re-enter the key.
- **Env vars override file config** — `VITE_LLM_PROVIDER`, `VITE_LLM_MODEL`, `VITE_LLM_API_KEY`, `VITE_LLM_BASE_URL` in `.env` take precedence over the saved `config.json` (`src/services/config.ts`). `VITE_OUTPUT_FOLDER` is NOT supported — output folder must be set in the Settings panel.
- **Platform-specific window chrome** — `electron/main.ts` sets `frame: false` with a custom-drawn title bar on Windows/Linux, but `frame: true` + `titleBarStyle: 'hiddenInset'` on macOS to use native traffic-light controls. `electronAPI.platform` (exposed via preload) drives whether `App.tsx` renders the custom `window-controls` cluster — never render it unconditionally again.
- **Renderer hardening** — `sandbox: true` on the `BrowserWindow`, a CSP is injected via `session.defaultSession.webRequest.onHeadersReceived` in production only (would break Vite HMR in dev), and `will-navigate`/`setWindowOpenHandler` route any link click (e.g. from rendered markdown) to `shell.openExternal` instead of navigating/spawning app windows. Keep these in sync if `electron/main.ts` is restructured.
- **pdfjs-dist worker** — pdfjs-dist worker is loaded from `public/pdf.worker.min.mjs` via local import in `src/utils/pdf.ts`. Vite config excludes `pdfjs-dist` from `optimizeDeps`.
- **Promise.try polyfill** — `src/main.tsx` polyfills `globalThis.Promise.try` for pdfjs-dist compatibility.
- **Conversion uses refs for conflict strategy** — `handleConvert` reads `conflictStrategyRef` and `existingFilesRef` (not state) to avoid stale closures when called from the conflict dialog buttons.
- **Convert button disabled after completion** — `batchStatus === 'done'` disables the button in `StatusBar.tsx`. Reset by loading new files.
- **Model fetch must handle /v1 in baseUrl** — `fetchAvailableModels` in `src/services/llm.ts` checks if baseUrl ends with `/v1` before appending `/v1/models`. LM Studio's default base URL includes `/v1`, so blindly appending causes `/v1/v1/models`.

## Architecture

- `electron/main.ts` — Main process, IPC handlers (config CRUD, file dialogs, file read/write, folder operations), navigation/window-open hardening, CSP header injection, platform-aware window chrome. Config interface includes `useApiKey` boolean; on-disk `StoredConfig` additionally has `apiKeyEncrypted`.
- `electron/preload.ts` — Exposes `window.electronAPI` via `contextBridge` (contextIsolation: true, sandbox: true). Config interface includes `useApiKey` boolean. Also exposes `platform` (`process.platform`) for renderer-side OS branching.
- `src/electron.d.ts` — TypeScript declarations for `window.electronAPI`. Keep in sync with preload. Config types include `useApiKey`; also declares `platform`.
- `src/services/llm.ts` — LLM client abstraction. Anthropic, OpenAI/openai-compatible, Gemini, and LM Studio paths. API key check uses `config.useApiKey` instead of provider-based check. `fetchAvailableModels` handles provider-specific model API formats (OpenAI array, LM Studio single object, Anthropic, Gemini, Ollama).
- `src/services/config.ts` — Config loading with env → file → defaults cascade. Uses `import.meta.env.VITE_*` (not `process.env.*`). AppConfig includes `useApiKey` boolean and `outputFolder` string.
- `src/utils/prompt.ts` — OCR system prompt template.
- `src/utils/filename.ts` — `generateFilenameFromMarkdown()` extracts filename from markdown heading or first line.
- `src/utils/pdf.ts` — PDF rendering via pdfjs-dist. Scale factor 3, uses `canvasContext` option, local worker import.
- `src/main.tsx` — React entry point. Includes `Promise.try` polyfill for pdfjs-dist.
- `src/App.tsx` — App state orchestrator. Manages conversion flow via `handleConvertWithFolder` (prompts for output folder if unset, checks file conflicts, shows conflict dialog). Uses `conflictStrategyRef`/`existingFilesRef` (not state) to avoid stale closures when called from the conflict dialog buttons. `batchStatus` tracks conversion lifecycle (`idle` → `processing` → `done`/`error`). `createStreamCallback` creates per-page streaming callbacks that append to `liveOutput` state. `writeFile` calls in `handleConvert` are always `await`ed inside the surrounding try/catch — a failed write must land in `filesFailed`, never silently count as converted. Renders the custom title bar controls only when `electronAPI.platform !== 'darwin'`.
- `src/components/StatusBar.tsx` — Status text + action buttons. Convert button enabled when config exists and files are loaded. Shows "Open Output Folder" button when folder is set. Shows colored conversion summary (converted/skipped/failed) on done/error.
- `src/components/LiveOutputPanel.tsx` — Real-time streaming output during conversion. Auto-scrolls, copy button, page progress bar. Used in split view during `batchStatus === 'processing'`.
- `src/components/ConfigPanel.tsx` — LLM provider config form with provider selector, API key input, base URL input, manual model input, and "Fetch Models" button.
- `src/components/ImageUploader.tsx` — Drag-and-drop image/PDF upload.
- `src/components/ImagePreview.tsx` — Single-page image preview with page navigation.
- `electron-builder.yml` — electron-builder config: `mac`/`win`/`linux` targets, shared `icon: build/icon.png` (electron-builder auto-generates `.icns`/`.ico` from it), win signing left disabled.
- `build/icon.png` (+ source `icon.svg`) — App icon, 1024x1024.
- `.github/workflows/build.yml` — CI matrix building linux/mac/win on every push/PR, uploads installers as artifacts.
- `scripts/` — Build helper scripts (`7za-wrap.js`, `prepare-wincodesign.cjs`).

## Conventions

- **Path alias**: `@/` → `./src/` (tsconfig + vite both configured). Note: alias path has trailing slash `./src/`.
- **TypeScript**: strict mode, `noUnusedLocals`, `noUnusedParameters` enabled.
- **CSS**: BEM-like naming (`component__element--modifier`). Dark theme colors hardcoded in `src/styles.css` — no CSS framework or design tokens.
- **No monaco editor** — The markdown editor is a plain `<textarea>` (`src/components/MarkdownEditor.tsx`).
- **Service layer**: business logic in `src/services/`, UI in `src/components/`.
- **Config field `useApiKey`**: Controls whether a provider requires an API key. When `false` (e.g. LM Studio), API key field is optional and validation is skipped.
- **Conversion flow**: `handleConvertWithFolder` → checks output folder from config → checks file conflicts → shows conflict dialog → calls `handleConvert` with `conflictStrategyRef` set synchronously. Output folder is set in Settings, not prompted at conversion time.

## Dependencies

- **pdfjs-dist**: `^4.10.38` — downgraded for worker import compatibility. Worker loaded from `public/pdf.worker.min.mjs`.
- **electron-builder.yml**: External build config (not inline in package.json).
- **@anthropic-ai/sdk**: `^0.18.0`
- **openai**: `^4.28.0`

## Delegation

You are the primary orchestrator. For tasks within a subagent's domain, dispatch via `Task` — do not edit owned files directly.

### Subagents (defined in `.opencode/agents/`)

| Agent | Domain |
|---|---|
| `electron` | `electron/main.ts`, `electron/preload.ts`, Electron config, IPC handlers |
| `frontend` | `src/components/*`, `src/App.tsx`, `src/main.tsx`, `src/styles.css`, `index.html` |
| `infra` | `package.json`, `tsconfig*.json`, `vite.config.ts`, `.gitignore`, `src/services/config.ts`, `electron-builder.yml`, `scripts/`, `public/` |
| `llm` | `src/services/llm.ts`, `src/utils/prompt.ts` |

### Skill Dispatch Matrix

Load the matching skill before dispatching the subagent:

| Task shape | Skill | Subagent(s) |
|---|---|---|
| New React component | `component-scaffold` | `frontend` |
| New config field / setting | `config-extension` | `infra` + `frontend` |
| Styling / CSS changes | `dark-theme` | `frontend` |
| New LLM provider | `provider-integration` | `llm` + `infra` + `frontend` |

### Scratch Files

Subagents must write findings/changes to `.opencode/tmp/<agent>-<task-slug>.md` before returning. Read that file yourself for detail.

### Rules

- Built-in `explore` and `general` agents must never dispatch further subagents.
- Before any tool call: does the file/task belong to a subagent's domain? If yes, dispatch via `Task`.
