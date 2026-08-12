import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { AppConfig } from '../types';
import { OCR_SYSTEM_PROMPT, AUDIO_TRANSCRIPTION_SYSTEM_PROMPT } from '../utils/prompt';

const AUDIO_CAPABLE_PROVIDERS = new Set(['openai', 'gemini', 'mistral', 'openrouter']);

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

  if (config.provider === 'mistral' && config.model.toLowerCase().includes('ocr')) {
    if (!config.apiKey) {
      throw new Error('Mistral API key is not configured. Please set your LLM API key in the config panel.');
    }
    return convertWithMistralOcr(config.apiKey, config.baseUrl || 'https://api.mistral.ai/v1', config.model, imageBase64, onChunk, signal);
  }

  const openAIOpts: ConstructorParameters<typeof OpenAI>[0] = {
    apiKey: config.apiKey || 'not-needed',
    dangerouslyAllowBrowser: true,
  };

  if ((config.provider === 'openai-compatible' || config.provider === 'lmstudio' || config.provider === 'ollama' || config.provider === 'mistral' || config.provider === 'openrouter') && config.baseUrl) {
    openAIOpts.baseURL = config.provider === 'ollama' && !config.baseUrl.endsWith('/v1')
      ? `${config.baseUrl.replace(/\/+$/, '')}/v1`
      : config.baseUrl;
  }

  if (config.provider === 'openrouter') {
    openAIOpts.defaultHeaders = { 'X-Title': 'Media Markdown Converter' };
  }

  const client = new OpenAI(openAIOpts);

  const result = await convertWithOpenAI(client, config.model, imageBase64, onChunk, signal);
  (client as unknown as Record<string, unknown>)['lastRequest'] = undefined;
  return result;
}

async function convertAudioWithOpenAI(
  client: OpenAI,
  model: string,
  audioBase64: string,
  audioFormat: string,
  onChunk: (text: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const stream = await client.chat.completions.create(
    {
      model,
      stream: true,
      messages: [
        { role: 'system', content: AUDIO_TRANSCRIPTION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'input_audio',
              input_audio: { data: audioBase64, format: audioFormat },
            },
          ],
        } as never,
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

async function convertAudioWithGemini(
  apiKey: string,
  model: string,
  audioBase64: string,
  mimeType: string,
  onChunk: (text: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const fullModelName = model.startsWith('models/') ? model : `models/${model}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/${fullModelName}:streamGenerateContent`;

  const body = {
    contents: [
      {
        parts: [
          { text: AUDIO_TRANSCRIPTION_SYSTEM_PROMPT },
          { inline_data: { mime_type: mimeType, data: audioBase64 } },
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

interface MistralTranscriptSegment {
  text?: string;
  start?: number;
  end?: number;
  speaker_id?: string | number;
}

function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
}

// A silence gap longer than this restarts a block even if the same speaker
// resumes, so one person's long monologue doesn't collapse into a single
// unbroken paragraph.
const SPEAKER_BLOCK_GAP_SECONDS = 30;

interface TranscriptBlock {
  speakerId: string | number | undefined;
  start: number | undefined;
  texts: string[];
  lastEnd: number | undefined;
}

function formatTranscriptBlock(block: TranscriptBlock, speakerLabel: string | null): string {
  const timestamp = block.start !== undefined ? formatTimestamp(block.start) : undefined;
  const headerParts = [speakerLabel, timestamp].filter((p): p is string => !!p);
  const header = headerParts.length > 0 ? `**${headerParts.join(' · ')}**` : '';
  const body = block.texts.join(' ');
  return header ? `${header}\n\n${body}` : body;
}

function formatMistralTranscript(data: { text?: string; segments?: MistralTranscriptSegment[] }): string {
  const segments = data.segments;
  if (!segments || segments.length === 0) {
    return data.text || '';
  }

  const speakerOrder: Array<string | number> = [];
  const blocks: string[] = [];
  let current: TranscriptBlock | null = null;

  const flush = () => {
    if (!current || current.texts.length === 0) return;
    let speakerLabel: string | null = null;
    if (current.speakerId !== undefined) {
      let idx = speakerOrder.indexOf(current.speakerId);
      if (idx === -1) {
        speakerOrder.push(current.speakerId);
        idx = speakerOrder.length - 1;
      }
      speakerLabel = `Speaker ${idx + 1}`;
    }
    blocks.push(formatTranscriptBlock(current, speakerLabel));
  };

  for (const seg of segments) {
    const text = seg.text?.trim();
    if (!text) continue;

    const speakerId = seg.speaker_id ?? undefined;
    const gap = current?.lastEnd !== undefined && seg.start !== undefined
      ? seg.start - current.lastEnd
      : 0;
    const sameSpeaker = current !== null && current.speakerId === speakerId;
    const withinGap = gap <= SPEAKER_BLOCK_GAP_SECONDS;

    if (current && sameSpeaker && withinGap) {
      current.texts.push(text);
      current.lastEnd = seg.end ?? current.lastEnd;
    } else {
      flush();
      current = { speakerId, start: seg.start, texts: [text], lastEnd: seg.end };
    }
  }
  flush();

  return blocks.join('\n\n') || data.text || '';
}

// Mistral's chat completions endpoint doesn't accept audio for OCR-style
// prompting like OpenAI/Gemini do — Voxtral audio input is only served via
// this dedicated transcription endpoint, which returns structured segments
// (with real speaker diarization and timestamps, not a prompted estimate)
// rather than streamed text, so the response is reassembled into markdown
// here instead of via AUDIO_TRANSCRIPTION_SYSTEM_PROMPT.
async function convertAudioWithMistral(
  apiKey: string,
  baseUrl: string,
  model: string,
  audioBase64: string,
  mimeType: string,
  onChunk: (text: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const url = `${baseUrl.replace(/\/+$/, '')}/audio/transcriptions`;

  const byteChars = atob(audioBase64);
  const byteArray = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteArray[i] = byteChars.charCodeAt(i);
  }
  const blob = new Blob([byteArray], { type: mimeType });

  const form = new FormData();
  form.append('file', blob, `audio.${mimeType.split('/').pop() || 'mp3'}`);
  form.append('model', model);
  form.append('diarize', 'true');
  form.append('timestamp_granularities', 'segment');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Mistral transcription API error (${res.status}): ${text.slice(0, 500)}`);
  }

  const data = await res.json();
  const fullText = formatMistralTranscript(data);

  onChunk(fullText);
  return fullText;
}

export async function convertAudioToMarkdown(
  config: AppConfig,
  audioBase64: string,
  mimeType: string,
  onChunk: (text: string) => void,
  signal: AbortSignal,
): Promise<string> {
  if (config.useApiKey && !config.apiKey) {
    throw new Error('API key is not configured. Please set your LLM API key in the config panel.');
  }

  const audioModel = config.audioModel || config.model;
  if (!audioModel) {
    throw new Error('Audio model is not configured. Please select an audio model in the config panel.');
  }

  if (!AUDIO_CAPABLE_PROVIDERS.has(config.provider)) {
    throw new Error(`${config.provider} does not support audio transcription. Switch to OpenAI, Gemini, Mistral, or OpenRouter.`);
  }

  signal.throwIfAborted();

  const rawBase64 = audioBase64.indexOf(',') !== -1 ? audioBase64.slice(audioBase64.indexOf(',') + 1) : audioBase64;

  if (config.provider === 'gemini') {
    if (!config.apiKey) {
      throw new Error('Gemini API key is not configured. Please set your LLM API key in the config panel.');
    }
    return convertAudioWithGemini(config.apiKey, audioModel, rawBase64, mimeType, onChunk, signal);
  }

  if (config.provider === 'mistral') {
    if (!config.apiKey) {
      throw new Error('Mistral API key is not configured. Please set your LLM API key in the config panel.');
    }
    return convertAudioWithMistral(config.apiKey, config.baseUrl || 'https://api.mistral.ai/v1', audioModel, rawBase64, mimeType, onChunk, signal);
  }

  // openai / openrouter — both use the OpenAI-compatible chat completions API
  const openAIOpts: ConstructorParameters<typeof OpenAI>[0] = {
    apiKey: config.apiKey || 'not-needed',
    dangerouslyAllowBrowser: true,
  };
  if (config.provider === 'openrouter' && config.baseUrl) {
    openAIOpts.baseURL = config.baseUrl;
    openAIOpts.defaultHeaders = { 'X-Title': 'Media Markdown Converter' };
  } else if (config.baseUrl) {
    openAIOpts.baseURL = config.baseUrl;
  }
  const client = new OpenAI(openAIOpts);
  const audioFormat = mimeType.split('/').pop() || 'mp3';

  return convertAudioWithOpenAI(client, audioModel, rawBase64, audioFormat, onChunk, signal);
}

async function convertWithMistralOcr(
  apiKey: string,
  baseUrl: string,
  model: string,
  imageBase64: string,
  onChunk: (text: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const url = `${baseUrl.replace(/\/+$/, '')}/ocr`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      document: { type: 'image_url', image_url: imageBase64 },
    }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Mistral OCR API error (${res.status}): ${text.slice(0, 500)}`);
  }

  const data = await res.json();
  const fullText = (data.pages as { markdown: string }[] | undefined)
    ?.map(p => p.markdown)
    .join('\n\n---\n\n') || '';

  onChunk(fullText);
  return fullText;
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
    case 'lmstudio':
    case 'mistral':
    case 'openrouter': {
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
