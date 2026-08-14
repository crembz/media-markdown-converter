import type { AppConfig } from '../types';

// Per-provider defaults, shared by the Electron app and the CLI. This lives in
// its own module rather than in services/config.ts because that file uses
// `import.meta.env`, which doesn't compile under the CLI's CommonJS target —
// the CLI previously carried a hand-maintained copy of this table instead.

export const AUDIO_CAPABLE_PROVIDERS: AppConfig['provider'][] = [
  'openai',
  'gemini',
  'mistral',
  'openrouter',
];

const AUDIO_CAPABLE_PROVIDER_SET = new Set<string>(AUDIO_CAPABLE_PROVIDERS);

export function supportsAudio(provider: string): boolean {
  return AUDIO_CAPABLE_PROVIDER_SET.has(provider);
}

export const PROVIDER_DEFAULTS: Record<string, Omit<AppConfig, 'apiKey'>> = {
  openai: {
    provider: 'openai',
    model: 'gpt-4o',
    audioModel: 'gpt-4o-audio-preview',
    baseUrl: 'https://api.openai.com',
    useApiKey: true,
    availableModels: [],
  },
  anthropic: {
    provider: 'anthropic',
    model: 'claude-opus-5',
    baseUrl: 'https://api.anthropic.com',
    useApiKey: true,
    availableModels: [],
  },
  'openai-compatible': {
    provider: 'openai-compatible',
    model: '',
    baseUrl: '',
    useApiKey: true,
    availableModels: [],
  },
  lmstudio: {
    provider: 'lmstudio',
    model: '',
    baseUrl: 'http://localhost:1234/v1',
    useApiKey: false,
    availableModels: [],
  },
  gemini: {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    audioModel: 'gemini-2.5-flash',
    baseUrl: 'https://generativelanguage.googleapis.com',
    useApiKey: true,
    availableModels: [],
  },
  ollama: {
    provider: 'ollama',
    model: '',
    baseUrl: 'http://localhost:11434',
    useApiKey: false,
    availableModels: [],
  },
  mistral: {
    provider: 'mistral',
    model: 'pixtral-large-latest',
    audioModel: 'voxtral-mini-latest',
    baseUrl: 'https://api.mistral.ai/v1',
    useApiKey: true,
    availableModels: [],
  },
  openrouter: {
    provider: 'openrouter',
    model: '',
    baseUrl: 'https://openrouter.ai/api/v1',
    useApiKey: true,
    availableModels: [],
  },
};

export function getDefaultConfig(provider: string): AppConfig {
  const defaults = PROVIDER_DEFAULTS[provider];
  if (!defaults) {
    return {
      provider: 'openai-compatible',
      model: '',
      apiKey: '',
      baseUrl: '',
      useApiKey: true,
      availableModels: [],
    };
  }
  return { ...defaults, apiKey: '', outputFolder: '' };
}
