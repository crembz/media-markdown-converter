export interface BatchFileEntry {
  pages: string[];
  filename: string;
}

interface ElectronAPI {
  platform: NodeJS.Platform;
  loadConfig(): Promise<{ provider: string; model: string; audioModel?: string; apiKey: string; apiKeys?: Record<string, string>; baseUrl: string; useApiKey: boolean; availableModels: string[]; outputFolder?: string } | null>;
  saveConfig(config: { provider: string; model: string; audioModel?: string; apiKey: string; apiKeys?: Record<string, string>; baseUrl: string; useApiKey: boolean; availableModels: string[]; outputFolder?: string }): Promise<void>;
  openFileDialog(options?: Electron.OpenDialogOptions): Promise<string[] | null>;
  saveFileDialog(defaultPath?: string): Promise<string | null>;
  readFile(path: string, asBase64?: boolean): Promise<string>;
  readFileAsBase64(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  minimizeWindow(): Promise<void>;
  maximizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  isMaximized(): Promise<boolean>;
  onWindowStateChanged(callback: (data: { maximized: boolean }) => void): () => void;
  openFolder(path: string): Promise<void>;
  openDirectoryDialog(): Promise<string | null>;
  fileExists(path: string): Promise<boolean>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
