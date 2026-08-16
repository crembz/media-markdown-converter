import { app, BrowserWindow, dialog, ipcMain, safeStorage, session, shell } from 'electron';
import { constants as fsConstants, promises as fs } from 'fs';
import { isAbsolute, join, normalize, resolve, sep } from 'path';
import { tmpdir } from 'os';
// Declared once in src/types.ts, shared with the renderer and preload.
import type { AppConfig as Config } from '../src/types';
// Value import — fileKind.ts is a dependency-free leaf module, so this pulls
// only the MIME tables into the main bundle, not the renderer's graph.
import { MIME_TYPES, mimeTypeForPath } from '../src/utils/fileKind';

const isDev = process.env.NODE_ENV === 'development';

// On-disk shape: apiKey (and every value in apiKeys, the per-provider key
// map) is replaced with its safeStorage-encrypted form (base64) whenever
// OS-level encryption is available, so no key sits in userData/config.json
// as plaintext.
interface StoredConfig extends Omit<Config, 'apiKey' | 'apiKeys'> {
  apiKey: string;
  apiKeyEncrypted?: boolean;
  apiKeys?: Record<string, string>;
  apiKeysEncrypted?: boolean;
}

let mainWindow: BrowserWindow | null = null;

// These handlers take paths from the renderer, which renders LLM-generated
// markdown. The guards below don't assume the renderer is hostile, but they
// keep a bug or an injection there from turning into arbitrary filesystem
// access: every path must be absolute and traversal-free, writes are limited
// to .md files, and reads to the media types the app actually opens.

function assertSafePath(filePath: string, label: string): string {
  if (typeof filePath !== 'string' || !filePath || !isAbsolute(filePath)) {
    throw new Error(`${label}: an absolute path is required`);
  }
  const normalized = normalize(filePath);
  if (normalized.split(sep).includes('..')) {
    throw new Error(`${label}: path traversal is not allowed`);
  }
  return normalized;
}

function assertExtension(filePath: string, allowed: string[], label: string): string {
  const normalized = assertSafePath(filePath, label);
  const ext = normalized.slice(normalized.lastIndexOf('.')).toLowerCase();
  if (!allowed.includes(ext)) {
    throw new Error(`${label}: unsupported file type "${ext}"`);
  }
  return normalized;
}

const READABLE_EXTENSIONS = Object.keys(MIME_TYPES);

function createWindow(): void {
  const isMac = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    // macOS: keep the native frame but hide the title bar so the app content
    // extends under it, using the native traffic-light controls.
    // Windows/Linux: fully frameless, with a custom title bar drawn in the renderer.
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : undefined,
    trafficLightPosition: isMac ? { x: 16, y: 14 } : undefined,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window-state-changed', { maximized: true });
  });

  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window-state-changed', { maximized: false });
  });

  // Converted markdown (user content, possibly containing links) is rendered
  // in-app. Never let it navigate this window or spawn a new Electron window —
  // send external links to the OS browser instead.
  const devServerOrigin = 'http://localhost:5173';
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isDev && url.startsWith(devServerOrigin)) return;
    event.preventDefault();
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  if (isDev) {
    mainWindow.loadURL(devServerOrigin);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  // Defense-in-depth: converted output is rendered as markdown/HTML in the
  // renderer, and LLM API keys live in that same renderer's JS (required by
  // the SDKs' dangerouslyAllowBrowser mode). A strict script-src blocks an
  // injected <script>/inline-handler from running even if some future XSS
  // vector appears. connect-src stays open since users can point providers
  // at arbitrary local/remote base URLs (LM Studio, Ollama, self-hosted).
  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https: http: ws: wss:;",
          ],
        },
      });
    });
  }

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

const userDataPath = app.getPath('userData');
const configPath = join(userDataPath, 'config.json');

ipcMain.handle('load-config', async (): Promise<Config | null> => {
  try {
    const data = await fs.readFile(configPath, 'utf-8');
    const stored = JSON.parse(data) as StoredConfig;

    let apiKey = stored.apiKey;
    if (stored.apiKeyEncrypted && stored.apiKey) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Stored API key is encrypted, but OS-level decryption is unavailable on this system.');
      }
      apiKey = safeStorage.decryptString(Buffer.from(stored.apiKey, 'base64'));
    }

    let apiKeys = stored.apiKeys;
    if (stored.apiKeysEncrypted && stored.apiKeys) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Stored API keys are encrypted, but OS-level decryption is unavailable on this system.');
      }
      apiKeys = Object.fromEntries(
        Object.entries(stored.apiKeys).map(([provider, value]) => [
          provider,
          value ? safeStorage.decryptString(Buffer.from(value, 'base64')) : value,
        ]),
      );
    }

    return { ...stored, apiKey, apiKeys };
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
});

ipcMain.handle('save-config', async (_event, config: Config): Promise<void> => {
  try {
    const encryptionAvailable = safeStorage.isEncryptionAvailable();

    const apiKey = config.apiKey && encryptionAvailable
      ? safeStorage.encryptString(config.apiKey).toString('base64')
      : config.apiKey;

    const apiKeys = config.apiKeys && encryptionAvailable
      ? Object.fromEntries(
          Object.entries(config.apiKeys).map(([provider, value]) => [
            provider,
            value ? safeStorage.encryptString(value).toString('base64') : value,
          ]),
        )
      : config.apiKeys;

    const toStore: StoredConfig = {
      ...config,
      apiKey,
      apiKeyEncrypted: !!(config.apiKey && encryptionAvailable),
      apiKeys,
      apiKeysEncrypted: !!(config.apiKeys && encryptionAvailable),
    };

    await fs.writeFile(configPath, JSON.stringify(toStore, null, 2), 'utf-8');
  } catch (error) {
    throw new Error(`Failed to save config: ${(error as Error).message}`, { cause: error });
  }
});

ipcMain.handle('read-file-as-base64', async (_event, filePath: string): Promise<string> => {
  filePath = assertExtension(filePath, READABLE_EXTENSIONS, 'read-file-as-base64');
  try {
    const buffer = await fs.readFile(filePath);
    return `data:${mimeTypeForPath(filePath)};base64,` + buffer.toString('base64');
  } catch (error) {
    throw new Error(`Failed to read file: ${(error as Error).message}`, { cause: error });
  }
});

// Raw bytes for callers that only need the data, not a data URI — skips the
// base64 encode here and the decode on the renderer side (~33% less to copy
// across the IPC boundary). Uint8Array survives structured cloning intact.
ipcMain.handle('read-file-bytes', async (_event, filePath: string): Promise<Uint8Array> => {
  filePath = assertExtension(filePath, READABLE_EXTENSIONS, 'read-file-bytes');
  try {
    const buffer = await fs.readFile(filePath);
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  } catch (error) {
    throw new Error(`Failed to read file: ${(error as Error).message}`, { cause: error });
  }
});

ipcMain.handle('write-file', async (_event, filePath: string, content: string): Promise<void> => {
  // The app only ever writes converted markdown.
  filePath = assertExtension(filePath, ['.md'], 'write-file');
  try {
    await fs.writeFile(filePath, content, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to write file: ${(error as Error).message}`, { cause: error });
  }
});

ipcMain.handle('window-minimize', (): void => {
  mainWindow?.minimize();
});

ipcMain.handle('window-maximize', (): void => {
  if (mainWindow?.isMaximized()) {
    mainWindow?.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle('window-close', (): void => {
  mainWindow?.close();
});

ipcMain.handle('window-is-maximized', (): boolean => {
  return mainWindow?.isMaximized() ?? false;
});

ipcMain.handle('open-directory-dialog', async (): Promise<string | null> => {
  try {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0] || null;
  } catch (error) {
    throw new Error(`Directory dialog error: ${(error as Error).message}`, { cause: error });
  }
});

ipcMain.handle('open-folder', async (_event, folderPath: string): Promise<void> => {
  try {
    await fs.access(folderPath);
    if (process.platform === 'win32') {
      const { spawn } = await import('child_process');
      spawn('explorer', [folderPath], { detached: true, stdio: 'ignore' });
    } else if (process.platform === 'darwin') {
      const { execFile } = await import('child_process');
      await new Promise<void>((resolve, reject) => {
        execFile('open', [folderPath], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } else {
      const { execFile } = await import('child_process');
      await new Promise<void>((resolve, reject) => {
        execFile('xdg-open', [folderPath], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  } catch (error) {
    throw new Error(`Failed to open folder: ${(error as Error).message}`, { cause: error });
  }
});

ipcMain.handle('file-exists', async (_event, filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
});

// ffmpeg-static resolves its binary as `path.join(__dirname, 'ffmpeg')` and
// does no asar rewriting of its own. In a packaged build __dirname is inside
// app.asar, so the path it hands back is
// resources/app.asar/node_modules/ffmpeg-static/ffmpeg. Electron's fs shim
// makes that path readable (electron-builder's asarUnpack leaves the real
// bytes in app.asar.unpacked and marks the asar entry unpacked), but spawn()
// goes to the kernel directly, which walks app.asar — a regular file — as a
// directory component and fails with ENOTDIR. Point spawn at the unpacked
// copy instead. Unpackaged runs contain no 'app.asar' segment, so this is a
// no-op in dev.
function resolveFfmpegBinary(rawPath: string): string {
  return rawPath.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`);
}

// Splits a long audio recording into sequential MP3 chunks via ffmpeg,
// run here in the main process rather than decoding in the renderer.
// OpenRouter's dedicated transcription endpoint died on long single
// requests even when the upstream provider completed successfully server
// side (confirmed live: a long single-file request failed client-side with
// a bare network error, yet OpenRouter's own request log showed it routed
// and returned OK) — so this isn't purely the documented 60s processing
// timeout, but some other client/connection-duration limit on long-lived
// requests. Splitting into small, fast-uploading chunks sidesteps it either
// way. MP3 instead of WAV keeps each chunk's upload small (a 5-minute WAV
// chunk is ~50MB; the equivalent MP3 is a fraction of that), which reduces
// how long any single request's connection stays open. ffmpeg also
// processes audio as a stream rather than loading the whole file into
// memory (unlike the Web Audio API's decodeAudioData, used by an earlier,
// since-removed version of this splitting logic, which held the *entire*
// recording as raw Float32 PCM at once — a GB+ allocation for anything past
// ~20-30 minutes that was crashing the renderer outright).
//
// Two entry points share this: split-audio-file takes a path and hands it
// straight to ffmpeg, while split-audio takes base64 for callers that only
// hold the bytes (a single file dropped into the window). Prefer the path
// form — the base64 form sends the whole recording across IPC, after the
// renderer already read it from disk through this same process, so a long
// recording crossed the boundary twice at ~1.33x its size.
async function splitAudioFile(sourcePath: string, chunkSeconds: number, deleteSource: boolean): Promise<{ dir: string; files: string[] }> {
  const os = await import('os');
  const { spawn } = await import('child_process');
  const resolvedFfmpeg = (await import('ffmpeg-static')).default;
  if (!resolvedFfmpeg) {
    throw new Error('ffmpeg binary not available (ffmpeg-static failed to resolve a path for this platform)');
  }
  const ffmpegPath = resolveFfmpegBinary(resolvedFfmpeg);
  // Surface a missing/unexecutable binary as itself rather than as a bare
  // spawn errno, which reads as a mystery once the asar indirection is in play.
  try {
    await fs.access(ffmpegPath, fsConstants.X_OK);
  } catch {
    throw new Error(`ffmpeg binary is missing or not executable at ${ffmpegPath}`);
  }

  const tempDir = await fs.mkdtemp(join(os.tmpdir(), 'mmc-audio-'));

  try {
    const inputPath = sourcePath;

    const outputPattern = join(tempDir, 'chunk_%04d.mp3');
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpegPath, [
        '-i', inputPath,
        '-f', 'segment',
        '-segment_time', String(chunkSeconds),
        '-c:a', 'libmp3lame',
        '-b:a', '128k',
        '-reset_timestamps', '1',
        '-y',
        outputPattern,
      ]);
      let stderr = '';
      proc.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-1000)}`));
      });
    });

    // Only ever removes a temp copy this process wrote; never the user's file.
    if (deleteSource) await fs.unlink(inputPath).catch(() => {});

    const entries = await fs.readdir(tempDir);
    const files = entries.filter((f) => f.endsWith('.mp3')).sort().map((f) => join(tempDir, f));
    if (files.length === 0) {
      throw new Error('ffmpeg produced no output audio segments');
    }
    return { dir: tempDir, files };
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

ipcMain.handle('split-audio-file', async (_event, filePath: string, chunkSeconds: number) => {
  return splitAudioFile(assertSafePath(filePath, 'split-audio-file'), chunkSeconds, false);
});

ipcMain.handle('split-audio', async (_event, audioBase64: string, chunkSeconds: number) => {
  const os = await import('os');
  const stagingDir = await fs.mkdtemp(join(os.tmpdir(), 'mmc-audio-in-'));
  const inputPath = join(stagingDir, 'input');
  try {
    await fs.writeFile(inputPath, Buffer.from(audioBase64, 'base64'));
    return await splitAudioFile(inputPath, chunkSeconds, true);
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
  }
});

// Recursive delete, so this is the one handler where an unchecked path would
// be genuinely destructive: it previously removed whatever the renderer named.
// Confined to the temp directories this process creates.
ipcMain.handle('cleanup-temp-dir', async (_event, dirPath: string): Promise<void> => {
  const target = resolve(assertSafePath(dirPath, 'cleanup-temp-dir'));
  const tempRoot = resolve(tmpdir());

  if (!target.startsWith(tempRoot + sep)) {
    throw new Error('cleanup-temp-dir: only directories under the system temp directory can be removed');
  }
  if (!target.slice(tempRoot.length + 1).startsWith('mmc-audio-')) {
    throw new Error('cleanup-temp-dir: only this app\'s own temp directories can be removed');
  }

  await fs.rm(target, { recursive: true, force: true }).catch(() => {});
});
