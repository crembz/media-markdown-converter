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
