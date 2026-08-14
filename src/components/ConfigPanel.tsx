import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AppConfig, getDefaultConfig } from '../services/config';
import { supportsAudio as providerSupportsAudio } from '../services/providerDefaults';
import { fetchAvailableModels, fetchAudioCapableModels, fetchVisionCapableModels } from '../services/llm';

type ConfigPanelProps = {
  config: AppConfig | null;
  onSave: (config: AppConfig) => void;
  onClose: () => void;
};

const LOCAL_PROVIDERS: AppConfig['provider'][] = ['lmstudio', 'ollama'];

// anthropic, gemini and openai are deliberately not offered here. This is a
// UI restriction only — llm.ts, PROVIDER_DEFAULTS and the CLI still support
// them fully, so `--provider anthropic`, the VITE_LLM_* env vars, and any
// config already saved with one of them keep working. Reach them through
// openai-compatible / openrouter, or add them back to this list.
const REMOTE_PROVIDERS: AppConfig['provider'][] = ['mistral', 'openai-compatible', 'openrouter'];

const PROVIDER_OPTIONS: AppConfig['provider'][] = [
  ...LOCAL_PROVIDERS,
  ...REMOTE_PROVIDERS.filter((p) => !LOCAL_PROVIDERS.includes(p)).sort(),
];

/**
 * Offered providers that can also transcribe audio. Derived from the list
 * above rather than hardcoded into the hint text, so it can never name a
 * provider the dropdown no longer offers.
 */
const AUDIO_CAPABLE_OPTIONS = PROVIDER_OPTIONS.filter(providerSupportsAudio);

// Imported rather than redeclared: llm.ts rejects audio for anything outside
// this list, so a local copy here could silently disagree with it.

function sortModels(models: string[]): string[] {
  return [...models].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export default function ConfigPanel({ config, onSave, onClose }: ConfigPanelProps) {
  const [provider, setProvider] = useState<AppConfig['provider']>('openai');
  const [model, setModel] = useState('');
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, string>>({});
  const [audioModel, setAudioModel] = useState('');
  const [audioModelsByProvider, setAudioModelsByProvider] = useState<Record<string, string>>({});
  const [apiKey, setApiKey] = useState('');
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [baseUrl, setBaseUrl] = useState('');
  const [baseUrls, setBaseUrls] = useState<Record<string, string>>({});
  const [useApiKey, setUseApiKey] = useState(true);
  const [showApiKey, setShowApiKey] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [audioModels, setAudioModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showManualModel, setShowManualModel] = useState(false);
  const [showManualAudioModel, setShowManualAudioModel] = useState(false);
  const [outputFolder, setOutputFolder] = useState('');
  // Identifies the newest model fetch. A slow response for a provider the user
  // has since switched away from used to overwrite the new provider's lists.
  const fetchTokenRef = useRef(0);
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
      // Backward compat: configs saved before per-provider model maps
      // existed only have the legacy flat model/audioModel fields — seed
      // the maps with them under the current provider so switching away
      // and back still recalls them, same pattern as apiKeys/baseUrls below.
      const models = { ...(config.modelsByProvider || {}) };
      if (config.model && !models[config.provider]) {
        models[config.provider] = config.model;
      }
      setModelsByProvider(models);
      setModel(models[config.provider] ?? config.model);

      const legacyAudioModel = config.audioModel || getDefaultConfig(config.provider).audioModel;
      const audioModelsMap = { ...(config.audioModelsByProvider || {}) };
      if (legacyAudioModel && !audioModelsMap[config.provider]) {
        audioModelsMap[config.provider] = legacyAudioModel;
      }
      setAudioModelsByProvider(audioModelsMap);
      setAudioModel(audioModelsMap[config.provider] ?? legacyAudioModel ?? '');
      // Backward compat: configs saved before per-provider keys existed only
      // have the legacy flat apiKey field — seed the map with it under the
      // current provider so switching away and back still recalls it.
      const keys = { ...(config.apiKeys || {}) };
      if (config.apiKey && !keys[config.provider]) {
        keys[config.provider] = config.apiKey;
      }
      setApiKeys(keys);
      setApiKey(keys[config.provider] ?? config.apiKey ?? '');
      // Same backward-compat seeding for the per-provider URL map.
      const urls = { ...(config.baseUrls || {}) };
      if (config.baseUrl && !urls[config.provider]) {
        urls[config.provider] = config.baseUrl;
      }
      setBaseUrls(urls);
      setBaseUrl(urls[config.provider] ?? config.baseUrl ?? '');
      setUseApiKey(config.useApiKey);
    } else {
      syncDefaults('openai');
    }
    setErrors({});
    setAvailableModels(sortModels(config?.availableModels || []));
    setAudioModels(sortModels(config?.audioModels || []));
    setFetchError(null);
    setOutputFolder(config?.outputFolder || '');
  }, [config, syncDefaults]);

  // Any in-flight fetch resolving after unmount must not set state.
  useEffect(() => () => { fetchTokenRef.current += 1; }, []);

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as AppConfig['provider'];
    // Invalidates any in-flight model fetch for the previous provider.
    fetchTokenRef.current += 1;
    setFetchingModels(false);
    setProvider(next);
    syncDefaults(next);
    // Recall this provider's previously-selected model, or suggest the
    // provider's default if it's never been configured before — same
    // recall-then-fall-back-to-default technique as baseUrl below.
    setModel(modelsByProvider[next] || getDefaultConfig(next).model);
    setAudioModel(audioModelsByProvider[next] || getDefaultConfig(next).audioModel || '');
    // Recall this provider's previously-saved key, or blank the field if
    // none was ever entered — API keys are per-provider, not shared state
    // that should carry over when switching.
    setApiKey(apiKeys[next] || '');
    // Same for the base URL: if the user already customized it for this
    // provider, keep that instead of overwriting with the provider default
    // that syncDefaults just set.
    if (baseUrls[next]) {
      setBaseUrl(baseUrls[next]);
    }
    setAvailableModels([]);
    setAudioModels([]);
    setFetchError(null);
    setShowManualModel(false);
    setShowManualAudioModel(false);
    setErrors({});
  };

  const supportsAudio = providerSupportsAudio(provider);

  const handleFetchModels = async () => {
    const token = (fetchTokenRef.current += 1);
    const requestedProvider = provider;

    setFetchingModels(true);
    setFetchError(null);
    try {
      const [models, audioCapableModels] = await Promise.all([
        requestedProvider === 'openrouter'
          ? fetchVisionCapableModels(requestedProvider, apiKey, baseUrl)
          : fetchAvailableModels(requestedProvider, apiKey, baseUrl),
        supportsAudio ? fetchAudioCapableModels(requestedProvider, apiKey, baseUrl) : Promise.resolve([]),
      ]);
      if (token !== fetchTokenRef.current) return;
      setAvailableModels(sortModels(models));
      setAudioModels(sortModels(audioCapableModels));
      setFetchingModels(false);
    } catch (e) {
      if (token !== fetchTokenRef.current) return;
      setFetchError(e instanceof Error ? e.message : 'Failed to fetch models');
      setFetchingModels(false);
    }
  };

  const handleModelSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value === '__other__') {
      setShowManualModel(true);
    } else {
      setShowManualModel(false);
      const value = e.target.value;
      setModel(value);
      setModelsByProvider(prev => ({ ...prev, [provider]: value }));
      if (errors.model) setErrors(prev => ({ ...prev, model: '' }));
    }
  };

  const handleManualModelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setModel(value);
    setModelsByProvider(prev => ({ ...prev, [provider]: value }));
    if (errors.model) setErrors(prev => ({ ...prev, model: '' }));
  };

  const handleAudioModelSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value === '__other__') {
      setShowManualAudioModel(true);
    } else {
      setShowManualAudioModel(false);
      const value = e.target.value;
      setAudioModel(value);
      setAudioModelsByProvider(prev => ({ ...prev, [provider]: value }));
    }
  };

  const handleManualAudioModelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setAudioModel(value);
    setAudioModelsByProvider(prev => ({ ...prev, [provider]: value }));
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
      baseUrls: { ...baseUrls, [provider]: baseUrl },
      useApiKey,
      availableModels,
      audioModels: supportsAudio ? audioModels : [],
      modelsByProvider: { ...modelsByProvider, [provider]: model },
      audioModelsByProvider: { ...audioModelsByProvider, [provider]: audioModel },
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
            {/* A config saved with a provider that is no longer offered still
                needs an option of its own — without one the select renders
                blank and misrepresents what the app will actually use. It
                stays selectable so switching away from it isn't a one-way
                door, but it isn't in the list for anyone else. */}
            {!PROVIDER_OPTIONS.includes(provider) && (
              <option value={provider}>{provider} (current)</option>
            )}
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
            {availableModels.length > 0 && !showManualModel ? (
              <select
                id="model"
                value={model || ''}
                onChange={handleModelSelect}
                aria-invalid={!!errors.model}
              >
                <option value="" disabled>
                  Select a model
                </option>
                {/* A configured model that isn't in the fetched list still
                    needs an option of its own, or the select renders blank and
                    React warns about a value with no matching option — which
                    is what the old '__custom__' sentinel did. */}
                {model && !availableModels.includes(model) && (
                  <option value={model}>{model} (current)</option>
                )}
                {availableModels.map((m) => (
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
            {provider === 'openrouter'
              ? 'Showing vision-capable models from OpenRouter\'s catalog. Pick "Other..." to enter any model manually.'
              : 'Showing all models from this endpoint. Pick "Other..." to enter any model manually.'}
          </span>
        </div>

        <div className="form-group">
          <label htmlFor="audioModel">Audio Model</label>
          {supportsAudio ? (
            <>
              <div className="model-row">
                {audioModels.length > 0 && !showManualAudioModel ? (
                  <select
                    id="audioModel"
                    value={audioModel || ''}
                    onChange={handleAudioModelSelect}
                  >
                    <option value="" disabled>
                      Select a model
                    </option>
                    {audioModel && !audioModels.includes(audioModel) && (
                      <option value={audioModel}>{audioModel} (current)</option>
                    )}
                    {audioModels.map((m) => (
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
                Showing audio-capable models from this endpoint. Pick "Other..." to enter any model manually.
              </span>
            </>
          ) : (
            <span className="form-hint">
              {provider} does not support audio transcription. Switch to {AUDIO_CAPABLE_OPTIONS.join(' or ')} to transcribe audio.
            </span>
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
              const value = e.target.value;
              setBaseUrl(value);
              setBaseUrls(prev => ({ ...prev, [provider]: value }));
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

    </div>
  );
}
