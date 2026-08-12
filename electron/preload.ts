import { contextBridge, ipcRenderer } from 'electron';

export interface Config {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  useApiKey: boolean;
  availableModels: string[];
  outputFolder?: string;
}

export interface ElectronAPI {
  platform: NodeJS.Platform;
  loadConfig(): Promise<Config | null>;
  saveConfig(config: Config): Promise<void>;
  openFileDialog(filters?: string[][]): Promise<string[] | null>;
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

const electronAPI: ElectronAPI = {
  platform: process.platform,

  loadConfig: async (): Promise<Config | null> => {
    return ipcRenderer.invoke('load-config');
  },

  saveConfig: async (config: Config): Promise<void> => {
    return ipcRenderer.invoke('save-config', config);
  },

  openFileDialog: async (filters?: string[][]): Promise<string[] | null> => {
    return ipcRenderer.invoke('open-file-dialog', { filters });
  },

  saveFileDialog: async (defaultPath?: string): Promise<string | null> => {
    return ipcRenderer.invoke('save-file-dialog', defaultPath);
  },

  readFile: async (filePath: string, asBase64 = false): Promise<string> => {
    return ipcRenderer.invoke('read-file', filePath, asBase64);
  },

  readFileAsBase64: async (filePath: string): Promise<string> => {
    return ipcRenderer.invoke('read-file-as-base64', filePath);
  },

  writeFile: async (filePath: string, content: string): Promise<void> => {
    return ipcRenderer.invoke('write-file', filePath, content);
  },

  minimizeWindow: async (): Promise<void> => {
    return ipcRenderer.invoke('window-minimize');
  },

  maximizeWindow: async (): Promise<void> => {
    return ipcRenderer.invoke('window-maximize');
  },

  closeWindow: async (): Promise<void> => {
    return ipcRenderer.invoke('window-close');
  },

  isMaximized: async (): Promise<boolean> => {
    return ipcRenderer.invoke('window-is-maximized');
  },

  onWindowStateChanged: (callback: (data: { maximized: boolean }) => void): () => void => {
    const listener = (_event: Electron.IpcRendererEvent, data: { maximized: boolean }) => {
      callback(data);
    };
    ipcRenderer.on('window-state-changed', listener);
    return () => {
      ipcRenderer.removeListener('window-state-changed', listener);
    };
  },

  openFolder: async (path: string): Promise<void> => {
    return ipcRenderer.invoke('open-folder', path);
  },

  openDirectoryDialog: async (): Promise<string | null> => {
    return ipcRenderer.invoke('open-directory-dialog');
  },

  fileExists: async (path: string): Promise<boolean> => {
    return ipcRenderer.invoke('file-exists', path);
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Global type declared in src/App.tsx to avoid duplicate declaration
