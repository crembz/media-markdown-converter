# Media Markdown Converter

Electron + React desktop app. Converts paper notes and audio recordings to markdown via LLM vision and audio models.

## Commands

- `npm run dev` — Starts Vite + Electron together (vite-plugin-electron). No separate electron command.
- `npm run build` — `tsc && vite build && electron-builder --config electron-builder.yml`. Builds an installer for the host OS. Runs in order.
- `npm run build:linux` / `build:mac` / `build:win` — Same pipeline, forced to a specific platform target via electron-builder's `--linux`/`--mac`/`--win` flag. Native deps (`@napi-rs/canvas`) mean these must actually run on the target OS — no cross-compiling. CI (`.github/workflows/build.yml`) runs all three on a GitHub Actions matrix.
- `npm run preview` — Vite preview server.
- `npm test` — Vitest unit tests over the pure helpers (`vitest run`); `npm run test:watch` for the watcher. Config is `vitest.config.ts`, deliberately separate from `vite.config.ts` so a test run doesn't load the Electron plugins.
- `npm run lint` — ESLint (flat config in `eslint.config.js`). Narrow by design: hook rules, unused code, `preserve-caught-error`, `prefer-const`. Two `react-hooks/set-state-in-effect` warnings are known and documented in the config.

## Critical Gotchas

- **LLM SDKs run in the renderer** — OpenAI/Anthropic clients are instantiated in `src/services/llm.ts` (browser env). Both constructors must include `dangerouslyAllowBrowser: true` or the SDKs throw on startup.
- **Config lives in Electron's userData** — `config.json` is read/written via IPC to `app.getPath('userData')`, never the project root. It's `.gitignore`d. The `apiKey` field is encrypted with `safeStorage` before being written (`apiKeyEncrypted: true` marks this); falls back to plaintext if OS-level encryption is unavailable. Decrypt failures on load throw from the IPC handler — `src/services/config.ts` catches this and falls back to `getDefaultConfig`, so the user just has to re-enter the key.
- **Env vars override file config** — `VITE_LLM_PROVIDER`, `VITE_LLM_MODEL`, `VITE_LLM_API_KEY`, `VITE_LLM_BASE_URL` in `.env` take precedence over the saved `config.json` (`src/services/config.ts`). `VITE_OUTPUT_FOLDER` is NOT supported — output folder must be set in the Settings panel.
- **Platform-specific window chrome** — `electron/main.ts` sets `frame: false` with a custom-drawn title bar on Windows/Linux, but `frame: true` + `titleBarStyle: 'hiddenInset'` on macOS to use native traffic-light controls. `electronAPI.platform` (exposed via preload) drives whether `App.tsx` renders the custom `window-controls` cluster — never render it unconditionally again.
- **Renderer hardening** — `sandbox: true` on the `BrowserWindow`, a CSP is injected via `session.defaultSession.webRequest.onHeadersReceived` in production only (would break Vite HMR in dev), and `will-navigate`/`setWindowOpenHandler` route any link click (e.g. from rendered markdown) to `shell.openExternal` instead of navigating/spawning app windows. Keep these in sync if `electron/main.ts` is restructured.
- **Shared types live in `src/types.ts`** — `AppConfig` and `ElectronAPI` are declared there once and imported by the renderer, `electron/main.ts`, `electron/preload.ts`, and `src/electron.d.ts`. They were previously redeclared in five places and kept in sync by hand. These are `import type`, so they erase completely. Main also *value*-imports `src/utils/fileKind.ts` for the MIME tables — that is safe only because it's a dependency-free leaf module; don't value-import anything from `src/` that pulls in the renderer's module graph.
- **pdfjs-dist worker** — pdfjs-dist worker is loaded from `public/pdf.worker.min.mjs` via local import in `src/utils/pdf.ts`. Vite config excludes `pdfjs-dist` from `optimizeDeps`.
- **pdfjs in Node is a different setup entirely** (`src/pdf-node.ts`, CLI only) — it needs the **legacy** build (`pdfjs-dist/legacy/build/pdf.mjs`; the default build silently drops every glyph and renders blank pages), `Path2D`/`DOMMatrix` globals from `@napi-rs/canvas` installed *before* pdfjs is evaluated (hence the separate `src/pdf-node-globals.ts`, which must stay the first import), a `Uint8Array` rather than a `Buffer` (v4 rejects Buffers), a locally-resolved `workerSrc` as a `file://` URL, and `standardFontDataUrl` as a plain path with a trailing separator (a `file://` URL fails — Node reads it with `fs`). All five are required; removing any one breaks CLI PDF conversion.
- **Promise.try polyfill** — lives in `src/polyfills.ts`, imported first by `src/main.tsx`. It cannot go inline in `main.tsx`: ES imports are evaluated before any statement in the importing file, so it would run after pdfjs was already loaded. It also only installs when `Promise.try` is missing.
- **Conversion uses refs for conflict strategy** — `handleConvert` reads `conflictStrategyRef` and `existingFilesRef` (not state) to avoid stale closures when called from the conflict dialog buttons. `conflictStrategyRef` is a ref *only*; it was previously mirrored from state nothing ever set, so it silently kept the previous run's strategy. Reset it explicitly, not via a setter.
- **Convert button disabled after completion** — `batchStatus === 'done'` disables the button in `StatusBar.tsx`. Reset by loading new files.
- **Model fetch must handle /v1 in baseUrl** — `fetchAvailableModels` in `src/services/llm.ts` checks if baseUrl ends with `/v1` before appending `/v1/models`. LM Studio's default base URL includes `/v1`, so blindly appending causes `/v1/v1/models`.

## Architecture

- `electron/main.ts` — Main process: IPC handlers (config CRUD, directory dialog, file read/write, folder operations, audio splitting), navigation/window-open hardening, CSP header injection, platform-aware window chrome. Imports `AppConfig` from `src/types.ts`; on-disk `StoredConfig` additionally has `apiKeyEncrypted`. Renderer-supplied paths go through `assertSafePath`/`assertExtension` first — absolute and traversal-free, writes limited to `.md`, reads to known media types — and `cleanup-temp-dir` is confined to this app's own `mmc-audio-*` directories under the system temp dir.
- `electron/preload.ts` — Implements the `ElectronAPI` contract from `src/types.ts` and exposes it as `window.electronAPI` via `contextBridge` (contextIsolation: true, sandbox: true). Also exposes `platform` (`process.platform`) for renderer-side OS branching, and `getPathForFile` — use that instead of `File.path`, which Electron removed in v32; it probes for `webUtils` (Electron 29+) and falls back to `File.path` on the current v28, so the fallback branch is what actually runs today.
- `src/types.ts` — Single source of truth for `AppConfig` and `ElectronAPI`.
- `src/electron.d.ts` — Just binds `window.electronAPI` to `ElectronAPI` from `src/types.ts`. Nothing to keep in sync by hand any more.
- `src/services/llm.ts` — LLM client abstraction. Anthropic, OpenAI/openai-compatible, Gemini, and LM Studio paths. API key check uses `config.useApiKey` instead of provider-based check. `fetchAvailableModels` handles provider-specific model API formats (OpenAI array, LM Studio single object, Anthropic, Gemini, Ollama).
- `src/services/config.ts` — Config loading with env → file → defaults cascade. Uses `import.meta.env.VITE_*` (not `process.env.*`). AppConfig includes `useApiKey` boolean and `outputFolder` string.
- `src/utils/prompt.ts` — OCR system prompt template.
- `src/utils/markdown.ts` — `PAGE_SEPARATOR`, `stripExtension()`, `timestampedMarkdownName()` (the "rename" conflict strategy).
- `src/utils/image.ts` — `MAX_IMAGE_DIMENSION`, `fitScale()`, `resizeIfNeeded()`, shared by the PDF renderer and the uploader.
- `src/services/providerDefaults.ts` — `PROVIDER_DEFAULTS`, `getDefaultConfig()`, `supportsAudio()`. Shared with the CLI.
- `src/components/BatchFileList.tsx` — memoized batch list, rendered once and placed into either layout.
- `src/utils/pdf.ts` — PDF rendering via pdfjs-dist (renderer). Scale factor 2, uses `canvasContext` option, local worker import. Each page is rendered to its own data URI and sent to the LLM as a separate request — deliberate, so local models don't blow their context on a large document. Do not batch pages into one request.
- `src/main.tsx` — React entry point. Imports `./polyfills` first.
- `src/App.tsx` — App state orchestrator. Batch and single-file conversion share **one** loop: both build a list of `ConversionJob`s (filename, kind, index, deferred `loadPages`, optional `sourcePath`) and `handleConvert` runs it. They used to be two near-identical ~100-line branches — do not fork them again. `handleConvertWithFolder` checks conflicts and shows the dialog first. `batchStatus` tracks the lifecycle (`idle` → `processing` → `done`/`error`). Streamed deltas are coalesced through `handleStreamChunk` and flushed once per animation frame; anything setting an authoritative value must use `setLiveOutputNow`, which cancels the queued flush first (otherwise a late flush re-appends text). An empty conversion result is thrown so it lands in `filesFailed` rather than vanishing from the summary, and `writeFile` is always `await`ed inside the try/catch. The main panel tree is built once into `mainContent` and placed into either the split or plain layout. Renders the custom title bar controls only when `electronAPI.platform !== 'darwin'`.
- `src/components/StatusBar.tsx` — Status text + action buttons. Convert button enabled when config exists and files are loaded. Shows "Open Output Folder" button when folder is set. Shows colored conversion summary (converted/skipped/failed) on done/error.
- `src/components/LiveOutputPanel.tsx` — Real-time streaming output during conversion. Auto-scrolls, copy button, page progress bar. Used in split view during `batchStatus === 'processing'`.
- `src/components/ConfigPanel.tsx` — LLM provider config form with provider selector, API key input, base URL input, manual model input, and "Fetch Models" button.
- `src/components/ImageUploader.tsx` — Drag-and-drop image/PDF upload.
- `src/components/ImagePreview.tsx` — Single-page image preview with page navigation.
- `electron-builder.yml` — electron-builder config: `mac`/`win`/`linux` targets, shared `icon: build/icon.png` (electron-builder auto-generates `.icns`/`.ico` from it), win signing left disabled.
- `build/icon.png` (+ source `icon.svg`) — App icon, 1024x1024.
- `.github/workflows/build.yml` — two jobs: `sanity` (tsc + vite build only, runs on every push/PR to main) and `package` (full electron-builder matrix across linux/mac/win, runs only on `v*` tag pushes, uploads installers as artifacts). Split this way so routine commits don't pay for three full native packaging builds — only tagged releases do.
- `scripts/` — Build helper scripts (`7za-wrap.js`, `prepare-wincodesign.cjs`).

## Conventions

- **Path alias**: `@/` → `./src/` (tsconfig + vite both configured). Note: alias path has trailing slash `./src/`.
- **TypeScript**: strict mode, `noUnusedLocals`, `noUnusedParameters` enabled.
- **CSS**: BEM-like naming (`component__element--modifier`). Dark theme colors hardcoded in `src/styles.css` — no CSS framework or design tokens. All of it lives in `styles.css`; ConfigPanel used to inject its own via an inline `<style>` tag, don't reintroduce that.
- **Service layer**: business logic in `src/services/`, UI in `src/components/`.
- **Shared tables have one home**: provider defaults + audio-capability in `src/services/providerDefaults.ts` (importable by the CLI, unlike `services/config.ts`, which uses `import.meta.env`), MIME/extension tables in `src/utils/fileKind.ts`, image downscaling in `src/utils/image.ts`, filename/separator helpers in `src/utils/markdown.ts`.
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
