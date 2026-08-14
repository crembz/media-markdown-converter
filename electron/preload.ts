import * as electron from 'electron';
import { contextBridge, ipcRenderer } from 'electron';
import type { AppConfig, ElectronAPI } from '../src/types';

// Both shapes are declared once in src/types.ts; re-exported here so anything
// importing them from the preload entry point still resolves.
export type { AppConfig as Config, ElectronAPI };

// getPathForFile arrived in Electron 29 and is the only way to get a dropped
// file's path from Electron 32 onward, where the non-standard File.path was
// removed. This project is still on 28, so neither API is available on both
// sides of the upgrade — probe for webUtils and fall back. Drop the fallback
// (and this cast) once the minimum is Electron 29.
const webUtils = (electron as unknown as {
  webUtils?: { getPathForFile(file: File): string };
}).webUtils;

const electronAPI: ElectronAPI = {
  platform: process.platform,

  loadConfig: async (): Promise<AppConfig | null> => {
    return ipcRenderer.invoke('load-config');
  },

  saveConfig: async (config: AppConfig): Promise<void> => {
    return ipcRenderer.invoke('save-config', config);
  },

  getPathForFile: (file: File): string => {
    if (webUtils) return webUtils.getPathForFile(file);
    // Electron 28 and earlier: the renderer-only File.path extension.
    return (file as File & { path?: string }).path ?? '';
  },

  readFileAsBase64: async (filePath: string): Promise<string> => {
    return ipcRenderer.invoke('read-file-as-base64', filePath);
  },

  readFileBytes: async (filePath: string): Promise<Uint8Array> => {
    return ipcRenderer.invoke('read-file-bytes', filePath);
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

  splitAudio: async (audioBase64: string, chunkSeconds: number): Promise<{ dir: string; files: string[] }> => {
    return ipcRenderer.invoke('split-audio', audioBase64, chunkSeconds);
  },

  splitAudioFile: async (filePath: string, chunkSeconds: number): Promise<{ dir: string; files: string[] }> => {
    return ipcRenderer.invoke('split-audio-file', filePath, chunkSeconds);
  },

  cleanupTempDir: async (dirPath: string): Promise<void> => {
    return ipcRenderer.invoke('cleanup-temp-dir', dirPath);
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Global type declared in src/App.tsx to avoid duplicate declaration
