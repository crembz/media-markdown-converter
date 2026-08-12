import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { AppConfig } from '../types';
import { OCR_SYSTEM_PROMPT } from '../utils/prompt';

function extractMediaType(dataUri: string): string {
  const match = dataUri.match(/^data:([^;]+);/);
  return match ? match[1] : 'image/png';
}

function extractBase64(dataUri: string): string {
  const commaIndex = dataUri.indexOf(',');
  return commaIndex !== -1 ? dataUri.slice(commaIndex + 1) : dataUri;
}

async function convertWithOpenAI(
  client: OpenAI,
  model: string,
  imageBase64: string,
  onChunk: (text: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const stream = await client.chat.completions.create(
    {
      model,
      stream: true,
      messages: [
        { role: 'system', content: OCR_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: imageBase64 },
            },
          ],
        },
      ],
    },
    { signal },
  );

  let fullText = '';

  for await (const part of stream) {
    const delta = part.choices[0]?.delta?.content;
    if (delta) {
      fullText += delta;
      onChunk(delta);
    }
  }

  return fullText;
}

async function convertWithAnthropic(
  client: Anthropic,
  model: string,
  imageBase64: string,
  onChunk: (text: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const mediaType = extractMediaType(imageBase64);
  const base64Data = extractBase64(imageBase64);

  const stream = await client.messages.stream(
    {
      model,
      max_tokens: 4096,
      system: OCR_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
                data: base64Data,
              },
            },
          ],
        },
      ],
    },
    { signal },
  );

  let fullText = '';

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      const text = chunk.delta.text;
      if (text) {
        fullText += text;
        onChunk(text);
      }
    }
  }

  return fullText;
}

export async function convertImageToMarkdown(
  config: AppConfig,
  imageBase64: string,
  onChunk: (text: string) => void,
  signal: AbortSignal,
): Promise<string> {
  if (config.useApiKey && !config.apiKey) {
    throw new Error('API key is not configured. Please set your LLM API key in the config panel.');
  }

  if (!config.model) {
    throw new Error('Model is not configured. Please select a model in the config panel.');
  }

  if (!imageBase64.startsWith('data:image')) {
    throw new Error('Invalid image format. Expected a data URI (data:image/...;base64,...).');
  }

  signal.throwIfAborted();

  if (config.provider === 'anthropic') {
    const anthropicOpts: Record<string, unknown> = {
      apiKey: config.apiKey,
      dangerouslyAllowBrowser: true,
    };
    const client = new Anthropic(anthropicOpts as never);

    const result = await convertWithAnthropic(client, config.model, imageBase64, onChunk, signal);
    (client as unknown as Record<string, unknown>)['lastResponse'] = undefined;
    return result;
  }

  if (config.provider === 'gemini') {
    if (!config.apiKey) {
      throw new Error('Gemini API key is not configured. Please set your LLM API key in the config panel.');
    }
    return convertWithGemini(config.apiKey, config.model, imageBase64, onChunk, signal);
  }

  const openAIOpts: ConstructorParameters<typeof OpenAI>[0] = {
    apiKey: config.apiKey || '',
    dangerouslyAllowBrowser: true,
  };

  if ((config.provider === 'openai-compatible' || config.provider === 'lmstudio') && config.baseUrl) {
    openAIOpts.baseURL = config.baseUrl;
  }

  const client = new OpenAI(openAIOpts);

  const result = await convertWithOpenAI(client, config.model, imageBase64, onChunk, signal);
  (client as unknown as Record<string, unknown>)['lastRequest'] = undefined;
  return result;
}

async function convertWithGemini(
  apiKey: string,
  model: string,
  imageBase64: string,
  onChunk: (text: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const mediaType = extractMediaType(imageBase64);
  const base64Data = extractBase64(imageBase64);

  const fullModelName = model.startsWith('models/') ? model : `models/${model}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/${fullModelName}:streamGenerateContent`;

  const body = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: mediaType, data: base64Data } },
        ],
      },
    ],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${text}`);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          const chunks = parsed?.candidates?.[0]?.content?.parts || [];
          for (const part of chunks) {
            if (part?.text) {
              fullText += part.text;
              onChunk(part.text);
            }
          }
        } catch {
          // Skip unparseable chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return fullText;
}

export async function fetchAvailableModels(
  provider: string,
  apiKey: string,
  baseUrl: string,
): Promise<string[]> {
  switch (provider) {
    case 'openai':
    case 'openai-compatible':
    case 'lmstudio': {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }
      const modelsPath = baseUrl.endsWith('/v1') ? '/models' : '/v1/models';
      const url = `${baseUrl.replace(/\/+$/, '')}${modelsPath}`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Failed to fetch models from ${provider} (${res.status}): ${text.slice(0, 500)}`);
      }
      const data = await res.json();
      // OpenAI returns { data: [...] }, LM Studio may return a single object { id, object, created, owned_by }
      if (Array.isArray(data.data)) {
        return data.data.map((m: { id: string }) => m.id);
      }
      if (data.id && typeof data.id === 'string') {
        return [data.id];
      }
      throw new Error(`Unexpected response format from ${provider}: ${JSON.stringify(data).slice(0, 500)}`);
    }
    case 'anthropic': {
      const res = await fetch('https://api.anthropic.com/v1/messages/models', {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Failed to fetch models from Anthropic (${res.status}): ${text.slice(0, 500)}`);
      }
      const data = await res.json();
      return (data.models as { name: string }[] | undefined)?.map(m => m.name) || [];
    }
    case 'gemini': {
      const res = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models',
        { headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' } },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Failed to fetch models from Gemini (${res.status}): ${text.slice(0, 500)}`);
      }
      const data = await res.json();
      return (data.models as { name: string; supportedGenerationMethods: string[] }[] | undefined)
        ?.filter(m =>
          m.name.startsWith('models/') &&
          m.supportedGenerationMethods?.includes('generateContent')
        )
        .map(m => m.name.replace('models/', '')) || [];
    }
    case 'ollama': {
      const res = await fetch(`${baseUrl}/api/tags`);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Failed to fetch models from Ollama (${res.status}): ${text.slice(0, 500)}`);
      }
      const data = await res.json();
      return (data.models as { name: string }[] | undefined)?.map(m => m.name) || [];
    }
    default:
      return [];
  }
}
