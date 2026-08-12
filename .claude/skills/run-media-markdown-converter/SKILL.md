---
name: run-media-markdown-converter
description: Build, run, and drive the Media Markdown Converter Electron app and its bundled CLI. Use when asked to start the app, build it, take a screenshot of its UI, test document/audio conversion, or run the media-markdown-converter CLI.
---

Media Markdown Converter is an Electron + React desktop app (with a bundled
Node CLI, `media-markdown-converter`) that sends images/PDFs/audio to an LLM
provider and writes the result as markdown. For agent/automated use, drive
the GUI via the Playwright `_electron` REPL at
`.claude/skills/run-media-markdown-converter/driver.mjs`; drive the CLI by
invoking `bin/media-markdown-converter` directly — no REPL needed there.

All paths below are relative to the repo root.

## Prerequisites

None beyond Node — this machine already has a real X display (`DISPLAY=:0`,
KDE/Xwayland), so Electron launches with `--no-sandbox` and no extra system
packages. **If you're on a truly headless box with no `DISPLAY`,** you'll
need `Xvfb` plus Electron's shared-lib deps (`libnss3`, `libgbm1`,
`libasound2`, `libgtk-3-0`, `libxss1`, `libxkbcommon0`, `libatk-bridge2.0-0`,
`libcups2`, `libdrm2`) and `xvfb-run` in front of the launch command — this
was **not** verified in this session, only the real-display path was.

```bash
node --version   # verified with v26.4.0
```

## Setup

```bash
npm install
npm install --save-dev playwright-core   # driver dependency; already in package.json devDependencies
```

## Build

```bash
npx tsc            # typecheck (noEmit) — gate before vite build
npx vite build      # emits dist/ (renderer) + dist-electron/ (main, preload)
npm run build-cli   # emits dist-cli/ for the CLI
```

`npm run build-cli` used to fail — `tsconfig.cli.json` listed
`src/services/config.ts` in its `include`, which uses `import.meta.env`
(Vite/browser-only) and doesn't compile under the CLI's CommonJS target.
Nothing in the CLI's actual dependency graph (`cli.ts` → `llm.ts`,
`pdf-node.ts`, `prompt.ts`, `fileKind.ts`) imports `config.ts` — the CLI has
its own separate `PROVIDER_DEFAULTS`/`CliConfig` in `cli.ts`. Fixed by
removing that dead include entry from `tsconfig.cli.json`.

## Run (agent path) — GUI

The driver is a stdin-command REPL. No `tmux` on this machine (not
installable without an interactive sudo password), so drive it through a
FIFO + background process instead — same idea as `tmux send-keys` /
`capture-pane`, just file-based:

```bash
rm -f /tmp/driver.in /tmp/driver.log
mkfifo /tmp/driver.in
mkdir -p /tmp/shots

DISPLAY=:0 node .claude/skills/run-media-markdown-converter/driver.mjs \
  < /tmp/driver.in > /tmp/driver.log 2>&1 &
DRIVER_PID=$!
exec 3>/tmp/driver.in    # keep the FIFO open for writing across commands

wait_for() { timeout "$2" bash -c "until grep -q \"$1\" /tmp/driver.log; do sleep 0.2; done"; }

echo launch >&3
wait_for 'launched\.' 30
echo "ss landing" >&3
wait_for 'screenshot:' 10

exec 3>&-        # close the FIFO — driver sees EOF and can be quit/killed
cat /tmp/driver.log
kill "$DRIVER_PID" 2>/dev/null
```

**If `tmux` IS available** in your environment, the same commands work via
the standard `send-keys`/`capture-pane` pattern instead of the FIFO —
untested here, but the driver doesn't care how its stdin is fed.

Screenshots land in `/tmp/shots/` (override: `SCREENSHOT_DIR`).

### Driver commands

| command | what it does |
|---|---|
| `launch` | build the app first (`dist/index.html` must exist), then launch it |
| `ss [name]` | screenshot → `/tmp/shots/<name>.png` |
| `click <css-sel>` | click element via DOM (not coordinates) |
| `click-text <text>` | click first button/link/`[role=button]` matching text |
| `select <css-sel> <value>` | set a `<select>`'s value via the native setter + a real `change` event (plain `.value =` does not fire React's `onChange`) |
| `setfile <path>` | feed a file into the hidden dropzone `<input type="file">` — this is how to test upload without real OS drag-drop, which Playwright can't synthesize for `_electron` |
| `type <text>` / `press <key>` | keyboard input |
| `wait <css-sel>` | wait for element, 10s timeout |
| `eval <js>` | evaluate in the page, print JSON |
| `text [css-sel]` | print `innerText` |
| `windows` | list open windows (this app has exactly one) |
| `quit` | close app, exit |

Verified end-to-end this session: `launch` → `ss` (landing) → `click-text
Settings` → `ss` (settings modal, all fields incl. Audio Model render) →
`quit`; separately, `setfile /tmp/fixtures/test-page.png` and `setfile
/tmp/fixtures/test-audio.wav` both correctly swap the dropzone for the
image/audio preview (zoom toolbar for images, native `<audio controls>`
for audio) and the status bar shows "Ready to convert."

**Do not go past `setfile` to `click-text Convert`** — see Gotchas below,
this machine has a real saved API key.

## Run (agent path) — CLI

No driver needed; it's a one-shot process.

```bash
npm run build-cli   # only needed after source changes
node bin/media-markdown-converter --files <path...> --output <dir> \
  --provider <name> --model <name> [--audioModel <name>] [--apiKey <key>] \
  [--baseUrl <url>] [--stream] [--dry-run]
```

`--dry-run` validates config and file-type support without making any
network call — safe to run with a fake `--apiKey`:

```bash
node bin/media-markdown-converter --files test-page.png --output /tmp/out \
  --provider openai --model gpt-4o --apiKey fake-key --dry-run
# → "Config validated successfully: ..."
```

Audio files (`.mp3/.wav/.m4a/.flac/.ogg/.webm/.aac`) are auto-routed to
transcription; unsupported extensions exit 1 with `Error: Unsupported file
type: <path>` before any network call.

## Run (human path)

```bash
npm run dev   # Vite + Electron, opens a real window; Ctrl-C to quit
```

## Test

No test suite in this repo (no `test` script, no `*.test.*`/`*.spec.*`
files). The closest thing to a correctness gate is the build itself:

```bash
npx tsc --noEmit && npx vite build && npm run build-cli
```

## Gotchas

- **This machine has a real, previously-saved provider config with an
  encrypted API key**, at `~/.config/media-markdown-converter/config.json`
  (Electron's default userData path, shared between `npm run dev` and this
  driver since both launch the same app identity — there's no separate
  "test mode" profile). Launching the driver loads that real config
  (provider `mistral`, a real encrypted key, a real output folder). Never
  print/cat that file's `apiKey` field, and never click `Convert` through
  the driver — that would make a real, billed API call. `--dry-run` on the
  CLI path is safe; the GUI has no dry-run equivalent, so stop at
  `setfile`/screenshot.
- **`setfile` is the only way to test uploads** — `_electron` can't
  synthesize OS-level drag-and-drop. `page.setInputFiles('input[type="file"]')`
  on react-dropzone's hidden input is the standard workaround.
- **`<select>` needs the native-setter + dispatchEvent dance** — React
  ignores a plain `el.value = x`; you must call the prototype's `value`
  setter and then dispatch a real `change` event, or the app's state never
  updates (the driver's `select` command does this).
- **A FIFO write-end must stay open across commands** — opening and closing
  `/tmp/driver.in` per command causes the reader (`readline` on the FIFO's
  fd) to see EOF and exit after the first line. Hold it open with
  `exec 3>/tmp/driver.in` for the whole session, close with `exec 3>&-` at
  the end.
- **`tmux`/`screen`/`dtach` aren't installed and `sudo` needs an
  interactive password** on this machine — couldn't install any of them.
  The FIFO approach above needs neither.
- **pdfjs-dist prints `Warning: Please use the legacy build in Node.js
  environments.`** on every CLI invocation — cosmetic, not an error, comes
  from `pdf-node.ts`'s use of `pdfjs-dist`.

## Troubleshooting

- **`npm run build-cli` fails with `import.meta` / `Property 'env' does
  not exist on type 'ImportMeta'` errors in `config.ts`**: this was a
  pre-existing dead include in `tsconfig.cli.json` (see Build above) —
  should already be fixed; if it recurs, check nothing re-added
  `src/services/config.ts` to that file's `include` array.
- **CLI: `Error: Unsupported file type: <path>`**: expected for any
  extension outside the supported image/PDF/audio lists — not a bug.
- **CLI: `Error: 401 Incorrect API key provided...`**: expected with a
  fake `--apiKey` — confirms the request pipeline reached the real
  provider, which is what you want when smoke-testing without real
  credentials.
- **Driver: `launch` prints `ERROR: dist/index.html missing`**: run the
  Build step (`npx tsc && npx vite build`) first.
