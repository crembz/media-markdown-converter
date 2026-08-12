export interface AppConfig {
  provider: 'openai' | 'anthropic' | 'openai-compatible' | 'lmstudio' | 'gemini' | 'ollama' | 'mistral' | 'openrouter';
  model: string;
  audioModel?: string;
  apiKey: string;
  apiKeys?: Record<string, string>;
  baseUrl: string;
  useApiKey: boolean;
  availableModels: string[];
  outputFolder?: string;
}
