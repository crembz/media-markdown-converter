import React, { useState, useEffect, useCallback } from 'react';
import { AppConfig, getDefaultConfig } from '../services/config';
import { fetchAvailableModels } from '../services/llm';

type ConfigPanelProps = {
  config: AppConfig | null;
  onSave: (config: AppConfig) => void;
  onClose: () => void;
};

const LOCAL_PROVIDERS: AppConfig['provider'][] = ['lmstudio', 'ollama'];

const PROVIDER_OPTIONS: AppConfig['provider'][] = [
  ...LOCAL_PROVIDERS,
  ...(['anthropic', 'gemini', 'mistral', 'openai', 'openai-compatible', 'openrouter'] as AppConfig['provider'][])
    .filter((p) => !LOCAL_PROVIDERS.includes(p))
    .sort(),
];

const AUDIO_CAPABLE_PROVIDERS: AppConfig['provider'][] = ['openai', 'gemini', 'mistral', 'openrouter'];

function sortModels(models: string[]): string[] {
  return [...models].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

// Curated fallback when a provider's fetched catalog has no models with
// "ocr" in the name (true for everyone except Mistral) — the best-known
// vision-capable models per provider, in ranked order (not alphabetical).
// Not derived from any live ranking API; update by hand as models change.
const TOP_OCR_MODELS: Partial<Record<AppConfig['provider'], string[]>> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o4-mini'],
  anthropic: ['claude-opus-4-20250514', 'claude-sonnet-4-20250514', 'claude-3-7-sonnet-latest', 'claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
  mistral: ['mistral-ocr-latest', 'pixtral-large-latest', 'pixtral-12b-latest', 'mistral-medium-latest', 'mistral-small-latest'],
  openrouter: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-2.5-flash', 'mistralai/pixtral-large-latest', 'qwen/qwen2.5-vl-72b-instruct'],
};

function getOcrModelOptions(provider: AppConfig['provider'], models: string[]): string[] {
  const ocrNamed = models.filter((m) => m.toLowerCase().includes('ocr'));
  if (ocrNamed.length > 0) return ocrNamed;
  return TOP_OCR_MODELS[provider] || [];
}

// Name fragments that indicate a model can process/transcribe audio.
// "ocr" providers name their vision model plainly (gpt-4o, gemini-2.5-flash)
// so there's no single keyword to reuse — audio-capable variants call it out
// explicitly (gpt-4o-audio-preview, voxtral, whisper, gpt-4o-transcribe).
const AUDIO_MODEL_KEYWORDS = ['audio', 'voxtral', 'whisper', 'transcribe'];

// Curated fallback when a provider's fetched catalog has no models matching
// AUDIO_MODEL_KEYWORDS — the best-known audio-capable models per provider,
// in ranked order. Gemini has no distinctly-branded audio variant (the same
// multimodal models take audio input), so it reuses the OCR list. Not
// derived from any live ranking API; update by hand as models change.
const TOP_AUDIO_MODELS: Partial<Record<AppConfig['provider'], string[]>> = {
  openai: ['gpt-4o-audio-preview', 'gpt-4o-mini-audio-preview', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1'],
  gemini: TOP_OCR_MODELS.gemini,
  mistral: ['voxtral-mini-latest', 'voxtral-small-latest', 'voxtral-mini-2602', 'voxtral-small-2507', 'voxtral-mini-transcribe-realtime-2602'],
  openrouter: ['openai/gpt-4o-audio-preview', 'openai/whisper-1', 'mistralai/voxtral-small-latest', 'mistralai/voxtral-mini-latest', 'google/gemini-2.5-flash'],
};

function getAudioModelOptions(provider: AppConfig['provider'], models: string[]): string[] {
  const audioNamed = models.filter((m) => {
    const lower = m.toLowerCase();
    return AUDIO_MODEL_KEYWORDS.some((k) => lower.includes(k));
  });
  if (audioNamed.length > 0) return audioNamed;
  return TOP_AUDIO_MODELS[provider] || [];
}

export default function ConfigPanel({ config, onSave, onClose }: ConfigPanelProps) {
  const [provider, setProvider] = useState<AppConfig['provider']>('openai');
  const [model, setModel] = useState('');
  const [audioModel, setAudioModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [baseUrl, setBaseUrl] = useState('');
  const [useApiKey, setUseApiKey] = useState(true);
  const [showApiKey, setShowApiKey] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showManualModel, setShowManualModel] = useState(false);
  const [showManualAudioModel, setShowManualAudioModel] = useState(false);
  const [outputFolder, setOutputFolder] = useState('');
  const syncDefaults = useCallback(
    (prov: AppConfig['provider']) => {
      const defaults = getDefaultConfig(prov);
      setModel(defaults.model);
      setAudioModel(defaults.audioModel || '');
      setBaseUrl(defaults.baseUrl);
      setUseApiKey(defaults.useApiKey);
    },
    [],
  );

  useEffect(() => {
    if (config) {
      setProvider(config.provider);
      setModel(config.model);
      setAudioModel(config.audioModel || getDefaultConfig(config.provider).audioModel || '');
      // Backward compat: configs saved before per-provider keys existed only
      // have the legacy flat apiKey field — seed the map with it under the
      // current provider so switching away and back still recalls it.
      const keys = { ...(config.apiKeys || {}) };
      if (config.apiKey && !keys[config.provider]) {
        keys[config.provider] = config.apiKey;
      }
      setApiKeys(keys);
      setApiKey(keys[config.provider] ?? config.apiKey ?? '');
      setBaseUrl(config.baseUrl);
      setUseApiKey(config.useApiKey);
    } else {
      syncDefaults('openai');
    }
    setErrors({});
    setAvailableModels(sortModels(config?.availableModels || []));
    setFetchError(null);
    setOutputFolder(config?.outputFolder || '');
  }, [config, syncDefaults]);

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as AppConfig['provider'];
    setProvider(next);
    syncDefaults(next);
    // Recall this provider's previously-saved key, or blank the field if
    // none was ever entered — API keys are per-provider, not shared state
    // that should carry over when switching.
    setApiKey(apiKeys[next] || '');
    setAvailableModels([]);
    setFetchError(null);
    setShowManualModel(false);
    setShowManualAudioModel(false);
    setErrors({});
  };

  const supportsAudio = AUDIO_CAPABLE_PROVIDERS.includes(provider);
  const ocrModelOptions = getOcrModelOptions(provider, availableModels);
  const audioModelOptions = supportsAudio ? getAudioModelOptions(provider, availableModels) : [];

  const handleFetchModels = async () => {
    setFetchingModels(true);
    setFetchError(null);
    try {
      const models = await fetchAvailableModels(provider, apiKey, baseUrl);
      setAvailableModels(sortModels(models));
      setFetchingModels(false);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : 'Failed to fetch models');
      setFetchingModels(false);
    }
  };

  const handleModelSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value === '__other__') {
      setShowManualModel(true);
    } else {
      setShowManualModel(false);
      setModel(e.target.value);
      if (errors.model) setErrors(prev => ({ ...prev, model: '' }));
    }
  };

  const handleManualModelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setModel(e.target.value);
    if (errors.model) setErrors(prev => ({ ...prev, model: '' }));
  };

  const handleAudioModelSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value === '__other__') {
      setShowManualAudioModel(true);
    } else {
      setShowManualAudioModel(false);
      setAudioModel(e.target.value);
    }
  };

  const handleManualAudioModelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAudioModel(e.target.value);
  };

  const validate = (): boolean => {
    const next: Record<string, string> = {};

    if (!provider) next.provider = 'Provider is required';
    if (!model.trim()) next.model = 'Model is required';
    if (useApiKey && !apiKey.trim()) next.apiKey = 'API key is required';
    if ((provider === 'openai-compatible' || provider === 'lmstudio' || provider === 'ollama') && !baseUrl.trim()) {
      next.baseUrl = 'Base URL is required';
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    onSave({
      provider,
      model,
      audioModel: supportsAudio ? (audioModel || undefined) : undefined,
      apiKey,
      apiKeys: { ...apiKeys, [provider]: apiKey },
      baseUrl,
      useApiKey,
      availableModels,
      outputFolder: outputFolder || undefined,
    });
  };

  const handleClose = () => {
    setErrors({});
    onClose();
  };

  const isLocalProvider = provider === 'lmstudio' || provider === 'ollama';

  const handleBrowseFolder = async () => {
    if (typeof window.electronAPI === 'undefined') return;
    const folder = await window.electronAPI.openDirectoryDialog();
    if (folder) {
      setOutputFolder(folder);
    }
  };

  return (
    <div className="config-overlay" onClick={handleClose}>
      <div className="config-panel" onClick={(e) => e.stopPropagation()}>
        <h2>LLM Configuration</h2>

        <div className="form-group">
          <label htmlFor="provider">Provider</label>
          <select
            id="provider"
            value={provider}
            onChange={handleProviderChange}
            aria-invalid={!!errors.provider}
          >
            {PROVIDER_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          {errors.provider && <span className="error">{errors.provider}</span>}
        </div>

        <div className="form-group">
          <label htmlFor="apiKey">API Key</label>
          {isLocalProvider && (
            <label className="use-apikey-toggle">
              <input
                type="checkbox"
                checked={useApiKey}
                onChange={(e) => setUseApiKey(e.target.checked)}
              />
              Use API Key
            </label>
          )}
          <div className="password-input">
            <input
              id="apiKey"
              type={showApiKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => {
                const value = e.target.value;
                setApiKey(value);
                setApiKeys(prev => ({ ...prev, [provider]: value }));
                if (errors.apiKey) setErrors(prev => ({ ...prev, apiKey: '' }));
              }}
              placeholder="sk-..."
              disabled={isLocalProvider && !useApiKey}
              aria-invalid={!!errors.apiKey}
            />
            <button
              type="button"
              className="toggle-visibility"
              onClick={() => setShowApiKey(v => !v)}
              aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
            >
              {showApiKey ? 'Hide' : 'Show'}
            </button>
          </div>
          {errors.apiKey && <span className="error">{errors.apiKey}</span>}
        </div>

        <div className="form-group">
          <label htmlFor="model">Model</label>
          <div className="model-row">
            {!showManualModel ? (
              <select
                id="model"
                value={ocrModelOptions.includes(model) ? model : '__custom__'}
                onChange={handleModelSelect}
                aria-invalid={!!errors.model}
              >
                {ocrModelOptions.length > 0 && (
                  <option value="" disabled>
                    Select a model
                  </option>
                )}
                {ocrModelOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                <option value="__other__">Other...</option>
              </select>
            ) : (
              <input
                id="model"
                type="text"
                value={model}
                onChange={handleManualModelChange}
                placeholder="Enter model name"
                aria-invalid={!!errors.model}
              />
            )}
            <button
              type="button"
              className="btn-fetch"
              onClick={handleFetchModels}
              disabled={fetchingModels}
              title="Fetch available models from the configured endpoint"
            >
              {fetchingModels ? 'Fetching...' : 'Fetch Models'}
            </button>
          </div>
          {fetchError && (
            <div className="fetch-error">
              <span className="error">{fetchError}</span>
              <button type="button" className="btn-retry" onClick={handleFetchModels}>
                Retry
              </button>
            </div>
          )}
          {errors.model && <span className="error">{errors.model}</span>}
          <span className="form-hint">
            Limited to OCR-named models{availableModels.filter((m) => m.toLowerCase().includes('ocr')).length === 0 ? ' — none found, showing well-known vision-capable models instead' : ''}. Pick "Other..." to enter any model manually.
          </span>
        </div>

        <div className="form-group">
          <label htmlFor="audioModel">Audio Model</label>
          {supportsAudio ? (
            <>
              <div className="model-row">
                {!showManualAudioModel ? (
                  <select
                    id="audioModel"
                    value={audioModelOptions.includes(audioModel) ? audioModel : '__custom__'}
                    onChange={handleAudioModelSelect}
                  >
                    {audioModelOptions.length > 0 && (
                      <option value="" disabled>
                        Select a model
                      </option>
                    )}
                    {audioModelOptions.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                    <option value="__other__">Other...</option>
                  </select>
                ) : (
                  <input
                    id="audioModel"
                    type="text"
                    value={audioModel}
                    onChange={handleManualAudioModelChange}
                    placeholder="Model used for audio transcription"
                  />
                )}
              </div>
              <span className="form-hint">
                Limited to audio/transcription-capable models{availableModels.filter((m) => AUDIO_MODEL_KEYWORDS.some((k) => m.toLowerCase().includes(k))).length === 0 ? ' — none found, showing well-known audio-capable models instead' : ''}. Pick "Other..." to enter any model manually.
              </span>
            </>
          ) : (
            <span className="form-hint">{provider} does not support audio transcription. Switch to OpenAI, Gemini, Mistral, or OpenRouter to transcribe audio.</span>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="baseUrl">
            Base URL
            {provider === 'openai-compatible' && (
              <span className="required-badge">Required</span>
            )}
            {provider === 'lmstudio' && (
              <span className="required-badge">Required</span>
            )}
            {provider === 'ollama' && (
              <span className="required-badge">Required</span>
            )}
          </label>
          <input
            id="baseUrl"
            type="url"
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value);
              if (errors.baseUrl) setErrors(prev => ({ ...prev, baseUrl: '' }));
            }}
            placeholder="https://api.openai.com"
            aria-invalid={!!errors.baseUrl}
          />
          {errors.baseUrl && <span className="error">{errors.baseUrl}</span>}
        </div>

        <div className="form-group">
          <label htmlFor="outputFolder">Output Folder</label>
          <div className="output-folder-row">
            <input
              id="outputFolder"
              type="text"
              value={outputFolder}
              readOnly
              placeholder="No folder set"
            />
            <div className="output-folder-actions">
              <button
                type="button"
                className="btn-browse"
                onClick={handleBrowseFolder}
              >
                Browse
              </button>
              {outputFolder && (
                <button
                  type="button"
                  className="btn-clear"
                  onClick={() => setOutputFolder('')}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="config-actions">
          <button type="button" className="btn-cancel" onClick={handleClose}>
            Cancel
          </button>
          <button type="button" className="btn-save" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .config-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .config-panel {
    background: #1e1e2e;
    color: #cdd6f4;
    border-radius: 12px;
    padding: 32px;
    width: 420px;
    max-width: 90vw;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }

  .config-panel h2 {
    margin: 0 0 24px;
    font-size: 1.25rem;
    color: #cdd6f4;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 16px;
  }

  .form-group label {
    font-size: 0.85rem;
    color: #a6adc8;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .required-badge {
    font-size: 0.7rem;
    background: #f38ba8;
    color: #1e1e2e;
    padding: 1px 6px;
    border-radius: 4px;
    font-weight: 600;
  }

  .form-group select,
  .form-group input {
    background: #313244;
    border: 1px solid #45475a;
    border-radius: 6px;
    color: #cdd6f4;
    padding: 8px 12px;
    font-size: 0.9rem;
    outline: none;
    transition: border-color 0.15s;
  }

  .form-group select:focus,
  .form-group input:focus {
    border-color: #89b4fa;
  }

  .form-group input[aria-invalid='true'],
  .form-group select[aria-invalid='true'] {
    border-color: #f38ba8;
  }

  .error {
    font-size: 0.75rem;
    color: #f38ba8;
  }

  .form-hint {
    font-size: 0.75rem;
    color: #a6adc8;
  }

  .use-apikey-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.8rem;
    color: #a6adc8;
    cursor: pointer;
    margin-bottom: 4px;
  }

  .use-apikey-toggle input[type='checkbox'] {
    accent-color: #89b4fa;
    width: 14px;
    height: 14px;
    cursor: pointer;
  }

  .password-input {
    display: flex;
    gap: 8px;
  }

  .password-input input {
    flex: 1;
  }

  .toggle-visibility {
    background: #313244;
    border: 1px solid #45475a;
    border-radius: 6px;
    color: #a6adc8;
    padding: 0 12px;
    font-size: 0.8rem;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s;
  }

  .toggle-visibility:hover {
    background: #45475a;
  }

  .model-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .model-row select {
    flex: 1;
    min-width: 0;
    max-width: 200px;
  }

  .btn-fetch {
    background: #89b4fa;
    border: none;
    color: #1e1e2e;
    padding: 8px 14px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 600;
    white-space: nowrap;
    transition: opacity 0.15s;
  }

  .btn-fetch:hover:not(:disabled) {
    opacity: 0.85;
  }

  .btn-fetch:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .fetch-error {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .btn-retry {
    background: transparent;
    border: 1px solid #89b4fa;
    color: #89b4fa;
    padding: 2px 10px;
    border-radius: 4px;
    font-size: 0.75rem;
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn-retry:hover {
    background: rgba(137, 180, 250, 0.15);
  }

  .config-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 24px;
  }

  .btn-cancel {
    background: transparent;
    border: 1px solid #45475a;
    color: #a6adc8;
    padding: 8px 20px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.9rem;
    transition: background 0.15s;
  }

  .btn-cancel:hover {
    background: #313244;
  }

  .btn-save {
    background: #89b4fa;
    border: none;
    color: #1e1e2e;
    padding: 8px 20px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 600;
    transition: opacity 0.15s;
  }

  .btn-save:hover {
    opacity: 0.85;
  }

  .output-folder-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .output-folder-row input {
    flex: 1;
  }

  .output-folder-actions {
    display: flex;
    gap: 6px;
  }

  .btn-browse {
    background: #89b4fa;
    border: none;
    color: #1e1e2e;
    padding: 8px 14px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 600;
    white-space: nowrap;
    transition: opacity 0.15s;
  }

  .btn-browse:hover {
    opacity: 0.85;
  }

  .btn-clear {
    background: transparent;
    border: 1px solid #45475a;
    color: #a6adc8;
    padding: 8px 12px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.8rem;
    transition: background 0.15s;
  }

  .btn-clear:hover {
    background: #313244;
  }
`;
