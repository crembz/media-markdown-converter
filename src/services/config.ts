import type { AppConfig } from '../types';
import { getDefaultConfig } from './providerDefaults';

// Re-exported so the many `from './services/config'` imports keep working;
// the definition itself lives in src/types.ts, shared with the main and
// preload processes.
export type { AppConfig };
// Provider defaults live in ./providerDefaults so the CLI can share them
// (this module uses import.meta.env, which the CLI's CommonJS build rejects).
export { getDefaultConfig };

export async function loadConfig(): Promise<AppConfig | null> {
  const envProvider = import.meta.env.VITE_LLM_PROVIDER;
  const envModel = import.meta.env.VITE_LLM_MODEL;
  const envApiKey = import.meta.env.VITE_LLM_API_KEY;
  const envBaseUrl = import.meta.env.VITE_LLM_BASE_URL;

  const hasEnvConfig = envProvider && envModel && envApiKey;

  if (hasEnvConfig) {
    return {
      provider: envProvider as AppConfig['provider'],
      model: envModel,
      apiKey: envApiKey,
      baseUrl: envBaseUrl || '',
      useApiKey: true,
      availableModels: [],
      outputFolder: '',
    };
  }

  try {
    if (typeof window === 'undefined' || typeof window.electronAPI === 'undefined') return null;
    const fileConfig = await window.electronAPI.loadConfig();

    if (fileConfig && fileConfig.provider) {
      const defaults = getDefaultConfig(fileConfig.provider);

      return {
        provider: fileConfig.provider as AppConfig['provider'],
        model: fileConfig.model || defaults.model,
        audioModel: fileConfig.audioModel || defaults.audioModel,
        apiKey: fileConfig.apiKey || envApiKey || '',
        apiKeys: fileConfig.apiKeys || {},
        baseUrl: fileConfig.baseUrl || defaults.baseUrl || envBaseUrl || '',
        baseUrls: fileConfig.baseUrls || {},
        useApiKey: fileConfig.useApiKey ?? defaults.useApiKey,
        availableModels: fileConfig.availableModels || [],
        audioModels: fileConfig.audioModels || [],
        modelsByProvider: fileConfig.modelsByProvider || {},
        audioModelsByProvider: fileConfig.audioModelsByProvider || {},
        outputFolder: fileConfig.outputFolder || '',
      };
    }
  } catch {
    // File-based config unavailable
  }

  return getDefaultConfig('openai');
}

export async function saveConfig(config: AppConfig): Promise<void> {
  if (typeof window === 'undefined' || typeof window.electronAPI === 'undefined') return;
  await window.electronAPI.saveConfig(config);
}

export function isConfigured(config: AppConfig | null): boolean {
  if (!config) return false;

  if (!config.useApiKey) {
    return !!(config.provider && config.model);
  }

  return !!(config.provider && config.model && config.apiKey);
}
