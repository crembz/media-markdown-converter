import { app, BrowserWindow, dialog, ipcMain, safeStorage, session, shell } from 'electron';
import { promises as fs } from 'fs';
import { join } from 'path';

const isDev = process.env.NODE_ENV === 'development';

interface Config {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  useApiKey: boolean;
  availableModels: string[];
  outputFolder?: string;
}

// On-disk shape: apiKey is replaced with its safeStorage-encrypted form
// (base64) whenever OS-level encryption is available, so the key doesn't
// sit in userData/config.json as plaintext.
interface StoredConfig extends Omit<Config, 'apiKey'> {
  apiKey: string;
  apiKeyEncrypted?: boolean;
}

let mainWindow: BrowserWindow | null = null;

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
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https: http: ws: wss:;",
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

    if (stored.apiKeyEncrypted && stored.apiKey) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Stored API key is encrypted, but OS-level decryption is unavailable on this system.');
      }
      return { ...stored, apiKey: safeStorage.decryptString(Buffer.from(stored.apiKey, 'base64')) };
    }

    return stored;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
});

ipcMain.handle('save-config', async (_event, config: Config): Promise<void> => {
  try {
    let toStore: StoredConfig = { ...config, apiKeyEncrypted: false };

    if (config.apiKey && safeStorage.isEncryptionAvailable()) {
      toStore = {
        ...config,
        apiKey: safeStorage.encryptString(config.apiKey).toString('base64'),
        apiKeyEncrypted: true,
      };
    }

    await fs.writeFile(configPath, JSON.stringify(toStore, null, 2), 'utf-8');
  } catch (error) {
    throw new Error(`Failed to save config: ${(error as Error).message}`);
  }
});

ipcMain.handle('open-file-dialog', async (_event, options?: Electron.OpenDialogOptions): Promise<string[] | null> => {
  try {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tiff'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      ...options,
    });
    return result.canceled ? null : result.filePaths;
  } catch (error) {
    throw new Error(`File dialog error: ${(error as Error).message}`);
  }
});

ipcMain.handle('save-file-dialog', async (_event, defaultPath?: string): Promise<string | null> => {
  try {
    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: defaultPath || 'output.md',
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return result.canceled ? null : result.filePath || null;
  } catch (error) {
    throw new Error(`Save dialog error: ${(error as Error).message}`);
  }
});

ipcMain.handle('read-file', async (_event, filePath: string, asBase64 = false): Promise<string> => {
  try {
    if (asBase64) {
      const buffer = await fs.readFile(filePath);
      return buffer.toString('base64');
    }
    return await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to read file: ${(error as Error).message}`);
  }
});

ipcMain.handle('read-file-as-base64', async (_event, filePath: string): Promise<string> => {
  try {
    const buffer = await fs.readFile(filePath);
    return 'data:image/png;base64,' + buffer.toString('base64');
  } catch (error) {
    throw new Error(`Failed to read file: ${(error as Error).message}`);
  }
});

ipcMain.handle('write-file', async (_event, filePath: string, content: string): Promise<void> => {
  try {
    await fs.writeFile(filePath, content, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to write file: ${(error as Error).message}`);
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
    throw new Error(`Directory dialog error: ${(error as Error).message}`);
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
    throw new Error(`Failed to open folder: ${(error as Error).message}`);
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
