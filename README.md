# Paper → Digital Converter

Desktop app that converts paper notes (photos/PDFs) into digital markdown using LLM vision models.

## Features

- Drag & drop images or PDFs
- Batch processing for multiple files
- Configurable LLM provider (OpenAI, Anthropic, LM Studio, Gemini, Ollama, or OpenAI-compatible)
- Fetch available models from provider API
- Manual model input as fallback
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

1. **Select provider** — OpenAI, Anthropic, LM Studio, Gemini, Ollama, or OpenAI-compatible
2. **Enter API key** — required for cloud providers (optional for LM Studio/Ollama)
3. **Set base URL** — required for LM Studio and Ollama (e.g., `http://localhost:1234/v1` for LM Studio)
4. **Fetch models** — click "Fetch Models" to load available models, or enter a model name manually
5. **Select model** — choose from the fetched list or use the manual input field
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

### Environment Variables (Optional)

Override config by setting these in a `.env` file:

| Variable | Description |
|---|---|
| `VITE_LLM_PROVIDER` | `openai`, `anthropic`, `lmstudio`, `gemini`, `ollama`, or custom provider name |
| `VITE_LLM_MODEL` | Model name (e.g. `gpt-4o`, `claude-sonnet-4-20250514`) |
| `VITE_LLM_API_KEY` | API key |
| `VITE_LLM_BASE_URL` | Custom API base URL (for LM Studio, Ollama, or OpenAI-compatible providers) |

## Command Line Interface

Convert paper notes from the terminal:

```bash
# Build CLI first
npm run build-cli

# Convert a single file
paper-converter --files notes.png --output ./output

# Convert multiple files
paper-converter --files img1.png img2.jpg scan.pdf --output ./markdown

# Use a specific provider
paper-converter --files page.png --output ./out --provider lmstudio --baseUrl http://localhost:1234/v1

# Stream output to stdout
paper-converter --files notes.png --output ./out --stream

# Validate config without converting
paper-converter --files notes.png --output ./out --dry-run
```

### Options

| Option | Description |
|---|---|
| `--files <paths...>` | Input image/PDF files (required) |
| `--output <dir>` | Output directory for markdown files (required) |
| `--provider <name>` | LLM provider (`openai`, `anthropic`, `lmstudio`, `gemini`, `ollama`) |
| `--model <name>` | Model name |
| `--apiKey <key>` | API key |
| `--baseUrl <url>` | API base URL |
| `--stream` | Stream output to stdout |
| `--dry-run` | Validate config without converting |

### Configuration File

Create `.paper-converter.json` in your working directory to persist settings:

```json
{
  "provider": "lmstudio",
  "model": "my-model",
  "apiKey": "",
  "baseUrl": "http://localhost:1234/v1",
  "useApiKey": false
}
```

CLI flags override the config file.

## Usage

1. **Configure** your LLM provider and set output folder in the settings panel
2. **Upload** images or PDFs via drag & drop or file picker
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
- **UI**: Custom dark theme (Catppuccin Mocha palette)

## Security

- **API keys** are encrypted at rest via Electron's `safeStorage` (backed by the OS keychain/credential store) before being written to the app's config file. If OS-level encryption isn't available on your system, keys fall back to plaintext storage.
- **Renderer hardening**: `contextIsolation` and a sandboxed renderer are enabled, a Content-Security-Policy restricts script execution in production builds, and external links (e.g. inside converted markdown) always open in your default browser rather than navigating the app window.
- The CLI's `.paper-converter.json` config file stores its API key in plaintext (no Electron `safeStorage` available outside the app) — keep it out of version control (it's `.gitignore`d by default) or supply the key via `--apiKey` instead.

## License

MIT
