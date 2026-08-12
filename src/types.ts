export interface AppConfig {
  provider: 'openai' | 'anthropic' | 'openai-compatible' | 'lmstudio' | 'gemini' | 'ollama' | 'mistral';
  model: string;
  apiKey: string;
  baseUrl: string;
  useApiKey: boolean;
  availableModels: string[];
  outputFolder?: string;
}
