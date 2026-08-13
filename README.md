# Media Markdown Converter

Desktop app that converts paper notes (photos/PDFs) and audio recordings into digital markdown using LLM vision and audio models.

## Features

- Drag & drop images, PDFs, or audio files
- Batch processing for multiple files (documents and audio can be mixed in one batch)
- Configurable LLM provider (OpenAI, Anthropic, LM Studio, Gemini, Ollama, OpenRouter, or OpenAI-compatible)
- Audio transcription (OpenAI, Gemini, Mistral, and OpenRouter) with best-effort timestamps and speaker labels
- Fetch available models from provider API, filtered to what actually works for the field being configured where the provider's catalog supports it (vision-capable models on OpenRouter, audio-capable models everywhere audio is supported)
- Manual model input as fallback
- Model and Audio Model selections are remembered per provider, so switching providers and back recalls what you last picked instead of resetting
- Status bar shows the model in use and token usage/cost for the last conversion where the provider reports it
- Conflict resolution when output files already exist (rename, overwrite, skip)
- Real-time streaming output during conversion
- Editable markdown output
- Dark theme UI

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)
- An API key for your chosen LLM provider (not required for LM Studio or Ollama)

## Getting Started

```bash
npm install
```

### Development

```bash
npm run dev
```

### Build

```bash
npm run build
```

Builds an installer for the host OS. To build for a specific platform:

```bash
npm run build:linux   # AppImage + deb
npm run build:mac     # dmg + zip
npm run build:win     # nsis installer
```

Note: `@napi-rs/canvas` (used by the CLI's PDF rendering) and electron-builder's packaging step both require native binaries for the target OS — cross-compiling a macOS or Windows build from Linux (or vice versa) isn't supported. Build each platform on its own OS, or use the GitHub Actions workflow in [.github/workflows/build.yml](.github/workflows/build.yml), which builds all three on every push via a CI matrix.

## Configuration

On first launch, configure your LLM provider in the app settings panel:

1. **Select provider** — OpenAI, Anthropic, LM Studio, Gemini, Ollama, OpenRouter, or OpenAI-compatible. Each provider remembers its own API key, base URL, Model, and Audio Model: switching providers recalls whatever you last set for that provider (or leaves fields blank/at their default if you've never configured it) rather than carrying over whatever was in the fields for the last provider.
2. **Enter API key** — required for cloud providers (optional for LM Studio/Ollama)
3. **Set base URL** — required for LM Studio and Ollama (e.g., `http://localhost:1234/v1` for LM Studio)
4. **Fetch models** — click "Fetch Models" to load available models, or enter a model name manually
5. **Select model** — the Model dropdown shows every model the provider's endpoint returns, unfiltered, except on OpenRouter, where it's filtered to vision-capable models (its catalog is large — around 400 models — and mostly not vision-capable, so filtering surfaces the ones that actually work for document/image conversion). Pick "Other..." to enter any model manually if you'd rather not fetch, the endpoint doesn't support listing models, or you want a model outside the filtered list
6. **Set output folder** — click "Browse" to choose where converted markdown files will be saved

### LM Studio Setup

1. Start LM Studio server (bottom-right "Local Server" → "Start Server")
2. Set base URL to `http://localhost:1234/v1` (or your custom port)
3. Set "Require API Key" to "Never" or enter your key if configured
4. Click "Fetch Models" to see loaded models

### Ollama Setup

1. Start Ollama (`ollama serve`)
2. Pull a model (`ollama pull llama3.2`)
3. Base URL defaults to `http://localhost:11434`
4. Click "Fetch Models" to see available models

### OpenRouter Setup

1. Select `openrouter` as the provider — base URL is pre-filled with `https://openrouter.ai/api/v1`
2. Enter your [OpenRouter API key](https://openrouter.ai/keys)
3. Click "Fetch Models" — the Model dropdown is filtered to OpenRouter's vision-capable models automatically, or enter a model slug manually (e.g. `openai/gpt-4o`, `google/gemini-2.5-flash`)
4. OpenRouter also supports audio transcription (see below) — routed through the OpenAI-compatible chat completions path, so pick an audio-capable model on OpenRouter for the Audio Model field

### Audio Transcription

Drag in an audio file (`.mp3`, `.wav`, `.m4a`, `.flac`, `.ogg`, `.webm`, `.aac`) and it's routed to a transcription pipeline instead of the document OCR pipeline — the output is still a single markdown file.

**Only OpenAI, Gemini, Mistral, and OpenRouter support audio transcription.** Anthropic, Ollama, LM Studio, and generic OpenAI-compatible providers will show an error if you try to convert an audio file with one of them selected — switch providers first.

Each supported provider gets its own **Audio Model** field in the settings panel (separate from the document/vision model, since the audio-capable model is often different — e.g. OpenAI's `gpt-4o-audio-preview` vs. its vision model `gpt-4o`). Unlike the Model field, the Audio Model dropdown is filtered to audio-capable models: on OpenRouter it queries the catalog's dedicated transcription models directly (the same set as [openrouter.ai/models?output_modalities=transcription](https://openrouter.ai/models?output_modalities=transcription) — e.g. `openai/whisper-1`, `openai/gpt-transcribe`, `mistralai/voxtral-mini-transcribe`); on OpenAI and Mistral, where the `/models` endpoint doesn't expose modality info, it matches well-known audio model naming (`audio`, `whisper`, `transcribe` for OpenAI; `voxtral` for Mistral); on Gemini every returned model already supports audio input. Pick "Other..." to enter any model manually if the one you want isn't listed.

The transcript is grouped into blocks by speaker turn, not one line per utterance: each block is a bold header (`**Speaker 1 · 00:01:23**`, or just `**00:01:23**` if speakers can't be distinguished) on its own line, followed by the full turn as a paragraph. Consecutive sentences from the same speaker are merged into one block; a new block starts only on a speaker change or a pause of roughly 30 seconds or more.

**OpenRouter and long recordings:** OpenRouter's dedicated transcription models (the ones from the `output_modalities=transcription` list above) go through a synchronous endpoint that's unreliable for long single requests — OpenRouter's docs cite a 60-second upstream processing timeout, but testing here showed a long single-file request can also fail client-side (a bare network error) even when OpenRouter's own request log shows it was routed and returned OK, pointing at a client/connection-duration limit rather than purely that documented timeout. Either way, the desktop app works around it by splitting recordings into sequential 5-minute MP3 chunks via a bundled `ffmpeg` binary ([`ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static)), transcribing each one in turn, and stitching the results back together; this doesn't affect OpenAI, Gemini, or Mistral, which aren't subject to this limit. MP3 (128kbps) rather than WAV keeps each chunk's upload small and fast — a 5-minute WAV chunk is roughly 50MB, the equivalent MP3 a fraction of that — which is the main lever against a connection-duration issue regardless of its exact cause. Splitting happens in Electron's main process and processes the file as a stream, so it stays cheap regardless of the recording's length or format (mp3/m4a/wav/ogg/etc. are all handled the same way) — an earlier version of this fix decoded audio in the renderer instead, which could exhaust memory and crash the window on long recordings; ffmpeg replaced that entirely. This splitting is desktop-app-only (the standalone CLI has no bundled ffmpeg), so long files converted via the CLI still risk the same failure unsplit.

Output format differs by provider:

- **OpenAI and Gemini** transcribe by prompting the model to write markdown directly in this grouped shape. **This is best-effort, not guaranteed diarization or grouping** — block boundaries, timestamps, and speaker attribution are the model's own judgment calls and may be imprecise, especially with overlapping speech or similar-sounding voices.
- **Mistral** uses its dedicated Voxtral transcription endpoint with `diarize: true` and segment-level timestamps, which does real speaker diarization rather than a prompted guess. The grouping into blocks (by speaker + the 30-second gap rule) is done deterministically in code from those real segments, not left to the model — so both the labels and the grouping are more reliable than the prompted providers.
- **OpenRouter's dedicated transcription models, and OpenAI's own whisper-1/gpt-4o-transcribe fallback,** return plain, unstructured text with no speaker labels or timestamps — these are raw speech-to-text endpoints, not chat models that can follow formatting instructions. The app groups that flat text into readable paragraphs client-side (a few sentences per paragraph) so output isn't one giant unbroken line; there's no speaker/timestamp information for these to include, since the endpoint itself doesn't return any.

### Environment Variables (Optional)

Override config by setting these in a `.env` file:

| Variable | Description |
|---|---|
| `VITE_LLM_PROVIDER` | `openai`, `anthropic`, `lmstudio`, `gemini`, `ollama`, or custom provider name |
| `VITE_LLM_MODEL` | Model name (e.g. `gpt-4o`, `claude-sonnet-4-20250514`) |
| `VITE_LLM_API_KEY` | API key |
| `VITE_LLM_BASE_URL` | Custom API base URL (for LM Studio, Ollama, or OpenAI-compatible providers) |

## Command Line Interface

Convert paper notes and audio recordings from the terminal:

```bash
# Build CLI first
npm run build-cli

# Convert a single file
media-markdown-converter --files notes.png --output ./output

# Convert multiple files
media-markdown-converter --files img1.png img2.jpg scan.pdf --output ./markdown

# Use a specific provider
media-markdown-converter --files page.png --output ./out --provider lmstudio --baseUrl http://localhost:1234/v1

# Stream output to stdout
media-markdown-converter --files notes.png --output ./out --stream

# Validate config without converting
media-markdown-converter --files notes.png --output ./out --dry-run
```

### Options

| Option | Description |
|---|---|
| `--files <paths...>` | Input image/PDF/audio files (required) |
| `--output <dir>` | Output directory for markdown files (required) |
| `--provider <name>` | LLM provider (`openai`, `anthropic`, `lmstudio`, `gemini`, `ollama`, `mistral`, `openrouter`) |
| `--model <name>` | Model name (used for images/PDFs) |
| `--audioModel <name>` | Model name for audio transcription (`openai`, `gemini`, `mistral`, `openrouter` only) |
| `--apiKey <key>` | API key |
| `--baseUrl <url>` | API base URL |
| `--stream` | Stream output to stdout |
| `--dry-run` | Validate config without converting |

Audio files (`.mp3`, `.wav`, `.m4a`, `.flac`, `.ogg`, `.webm`, `.aac`) in `--files` are automatically routed to transcription instead of OCR — same provider restrictions as the GUI apply (OpenAI, Gemini, Mistral, OpenRouter only).

### Configuration File

Create `.media-markdown-converter.json` in your working directory to persist settings:

```json
{
  "provider": "lmstudio",
  "model": "my-model",
  "audioModel": "",
  "apiKey": "",
  "baseUrl": "http://localhost:1234/v1",
  "useApiKey": false
}
```

CLI flags override the config file.

## Usage

1. **Configure** your LLM provider and set output folder in the settings panel
2. **Upload** images, PDFs, or audio files via drag & drop or file picker
3. **Convert** — click Convert (output folder must be set in Settings)
4. **Edit** — review and edit the generated markdown in the output panel
5. **Save** — the markdown is saved to your chosen folder automatically

### Batch Conversion

Upload multiple files at once. After selecting an output folder, choose how to handle existing files:

- **Skip existing files** — leave unchanged files untouched
- **Overwrite existing** — replace existing files
- **Rename & process** — keep both files with a timestamped rename

## Tech Stack

- **Framework**: Electron + React
- **Build**: Vite + electron-builder
- **PDF Rendering**: pdfjs-dist
- **LLM Integration**: OpenAI SDK, Anthropic SDK
- **Audio processing**: bundled `ffmpeg` (via `ffmpeg-static`), for splitting long recordings before transcription on OpenRouter
- **UI**: Custom dark theme (Catppuccin Mocha palette)

## Security

- **API keys** are encrypted at rest via Electron's `safeStorage` (backed by the OS keychain/credential store) before being written to the app's config file. If OS-level encryption isn't available on your system, keys fall back to plaintext storage.
- **Renderer hardening**: `contextIsolation` and a sandboxed renderer are enabled, a Content-Security-Policy restricts script execution in production builds, and external links (e.g. inside converted markdown) always open in your default browser rather than navigating the app window.
- The CLI's `.media-markdown-converter.json` config file stores its API key in plaintext (no Electron `safeStorage` available outside the app) — keep it out of version control (it's `.gitignore`d by default) or supply the key via `--apiKey` instead.

## License

MIT
