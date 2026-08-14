// Single source of truth for the shapes shared across the three processes.
//
// AppConfig and the electronAPI surface each used to be redeclared in five
// places (here, src/services/config.ts, electron/main.ts, electron/preload.ts,
// and twice inline in src/electron.d.ts), kept in sync by hand. They are
// type-only declarations, so `import type` from the main and preload bundles
// erases completely — nothing from src/ is pulled into those builds at
// runtime.

export interface AppConfig {
  provider: 'openai' | 'anthropic' | 'openai-compatible' | 'lmstudio' | 'gemini' | 'ollama' | 'mistral' | 'openrouter';
  model: string;
  audioModel?: string;
  apiKey: string;
  apiKeys?: Record<string, string>;
  baseUrl: string;
  baseUrls?: Record<string, string>;
  useApiKey: boolean;
  availableModels: string[];
  audioModels?: string[];
  modelsByProvider?: Record<string, string>;
  audioModelsByProvider?: Record<string, string>;
  outputFolder?: string;
}

export type MediaFileType = 'image' | 'pdf' | 'audio';

/** An entry in a multi-file batch, converted from disk by path. */
export interface BatchFile {
  filePath: string;
  filename: string;
  fileType: MediaFileType;
}

// The contract electron/preload.ts implements and the renderer consumes via
// window.electronAPI. Deliberately free of Electron's own types so the CLI
// build — which type-checks the renderer's declarations but never imports
// electron — can compile it.
export interface ElectronAPI {
  platform: NodeJS.Platform;
  loadConfig(): Promise<AppConfig | null>;
  saveConfig(config: AppConfig): Promise<void>;
  readFileAsBase64(path: string): Promise<string>;
  /** Raw bytes — cheaper than readFileAsBase64 when no data URI is needed. */
  readFileBytes(path: string): Promise<Uint8Array>;
  writeFile(path: string, content: string): Promise<void>;
  /**
   * Absolute path of a File from a drop or file picker, or '' when it has no
   * path on disk. Replaces the non-standard File.path property, which Electron
   * removed in v32.
   */
  getPathForFile(file: File): string;
  minimizeWindow(): Promise<void>;
  maximizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  isMaximized(): Promise<boolean>;
  onWindowStateChanged(callback: (data: { maximized: boolean }) => void): () => void;
  openFolder(path: string): Promise<void>;
  openDirectoryDialog(): Promise<string | null>;
  fileExists(path: string): Promise<boolean>;
  splitAudio(audioBase64: string, chunkSeconds: number): Promise<{ dir: string; files: string[] }>;
  /** Preferred over splitAudio when the file is already on disk — avoids
   *  sending the whole recording across IPC as base64. */
  splitAudioFile(filePath: string, chunkSeconds: number): Promise<{ dir: string; files: string[] }>;
  cleanupTempDir(dirPath: string): Promise<void>;
}
