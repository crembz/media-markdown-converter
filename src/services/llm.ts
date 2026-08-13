import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { AppConfig } from '../types';
import { OCR_SYSTEM_PROMPT, AUDIO_TRANSCRIPTION_SYSTEM_PROMPT } from '../utils/prompt';

const AUDIO_CAPABLE_PROVIDERS = new Set(['openai', 'gemini', 'mistral', 'openrouter']);

// Best-effort token/cost accounting, reported via the optional onUsage
// callback alongside onChunk. Only populated for providers/paths whose
// response shape for usage is well-documented and reliably present
// (OpenAI chat completions with stream_options.include_usage, Anthropic's
// streaming usage events, Gemini's usageMetadata, OpenRouter's transcription
// endpoint's own usage field) — providers without a confidently-known usage
// shape (Mistral) simply never call onUsage rather than risk showing
// fabricated numbers.
export interface UsageInfo {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cost?: number;
}

export function mergeUsage(a: UsageInfo | undefined, b: UsageInfo | undefined): UsageInfo | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    inputTokens: (a.inputTokens ?? 0) + (b.inputTokens ?? 0),
    outputTokens: (a.outputTokens ?? 0) + (b.outputTokens ?? 0),
    totalTokens: (a.totalTokens ?? 0) + (b.totalTokens ?? 0),
    cost: a.cost !== undefined || b.cost !== undefined ? (a.cost ?? 0) + (b.cost ?? 0) : undefined,
  };
}

function extractMediaType(dataUri: string): string {
  const match = dataUri.match(/^data:([^;]+);/);
  return match ? match[1] : 'image/png';
}

function extractBase64(dataUri: string): string {
  const commaIndex = dataUri.indexOf(',');
  return commaIndex !== -1 ? dataUri.slice(commaIndex + 1) : dataUri;
}

// The input_audio content part's format field wants a plain container name
// (e.g. "mp3", "wav", "m4a") rather than a MIME subtype. Most subtypes
// already match (audio/wav -> wav), but audio/mpeg is the standard MIME
// subtype for .mp3 and doesn't — map known mismatches, otherwise pass the
// subtype straight through so any format the endpoint actually accepts
// (m4a, flac, ogg, webm, etc.) still gets sent rather than blocked
// client-side.
const AUDIO_FORMAT_SUBTYPE_ALIASES: Record<string, string> = {
  mpeg: 'mp3',
  mp4: 'm4a',
};

function getInputAudioFormat(mimeType: string): string {
  const subtype = mimeType.split('/').pop()?.toLowerCase() || 'mp3';
  return AUDIO_FORMAT_SUBTYPE_ALIASES[subtype] || subtype;
}

// A plain fetch() rejection (bad host, DNS failure, blocked by CORS/CSP,
// offline) surfaces to the caller as a bare "TypeError: Failed to fetch"
// with no indication of which request failed or why — useless once it
// reaches the UI. Wrap it with the URL so a misconfigured base URL is
// obvious instead of a dead end.
async function fetchOrThrow(url: string, init: RequestInit, label: string): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError') throw err;
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`Network request to ${label} failed (${url}): ${cause}. Check the base URL and network connection.`);
  }
}

async function convertWithOpenAI(
  client: OpenAI,
  model: string,
  imageBase64: string,
  onChunk: (text: string) => void,
  signal: AbortSignal,
  onUsage?: (usage: UsageInfo) => void,
): Promise<string> {
  const stream = await client.chat.completions.create(
    {
      model,
      stream: true,
      // The final SSE chunk (empty choices[]) carries usage totals only
      // when this is explicitly requested.
      stream_options: { include_usage: true },
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
    if (part.usage) {
      onUsage?.({
        inputTokens: part.usage.prompt_tokens,
        outputTokens: part.usage.completion_tokens,
        totalTokens: part.usage.total_tokens,
      });
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
  onUsage?: (usage: UsageInfo) => void,
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
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      const text = chunk.delta.text;
      if (text) {
        fullText += text;
        onChunk(text);
      }
    } else if (chunk.type === 'message_start') {
      inputTokens = chunk.message.usage.input_tokens;
    } else if (chunk.type === 'message_delta') {
      // Cumulative output token count so far — the last message_delta
      // before message_stop carries the final total.
      outputTokens = chunk.usage.output_tokens ?? outputTokens;
    }
  }

  if (inputTokens !== undefined || outputTokens !== undefined) {
    onUsage?.({
      inputTokens,
      outputTokens,
      totalTokens: inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined,
    });
  }

  return fullText;
}

export async function convertImageToMarkdown(
  config: AppConfig,
  imageBase64: string,
  onChunk: (text: string) => void,
  signal: AbortSignal,
  onUsage?: (usage: UsageInfo) => void,
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

    const result = await convertWithAnthropic(client, config.model, imageBase64, onChunk, signal, onUsage);
    (client as unknown as Record<string, unknown>)['lastResponse'] = undefined;
    return result;
  }

  if (config.provider === 'gemini') {
    if (!config.apiKey) {
      throw new Error('Gemini API key is not configured. Please set your LLM API key in the config panel.');
    }
    return convertWithGemini(config.apiKey, config.model, imageBase64, onChunk, signal, onUsage);
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

  const result = await convertWithOpenAI(client, config.model, imageBase64, onChunk, signal, onUsage);
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
  onUsage?: (usage: UsageInfo) => void,
): Promise<string> {
  const stream = await client.chat.completions.create(
    {
      model,
      stream: true,
      // The final SSE chunk (empty choices[]) carries usage totals only
      // when this is explicitly requested.
      stream_options: { include_usage: true },
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
    if (part.usage) {
      onUsage?.({
        inputTokens: part.usage.prompt_tokens,
        outputTokens: part.usage.completion_tokens,
        totalTokens: part.usage.total_tokens,
      });
    }
  }

  return fullText;
}

function geminiUsage(usageMetadata: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } | undefined): UsageInfo | undefined {
  if (!usageMetadata) return undefined;
  return {
    inputTokens: usageMetadata.promptTokenCount,
    outputTokens: usageMetadata.candidatesTokenCount,
    totalTokens: usageMetadata.totalTokenCount,
  };
}

async function convertAudioWithGemini(
  apiKey: string,
  model: string,
  audioBase64: string,
  mimeType: string,
  onChunk: (text: string) => void,
  signal: AbortSignal,
  onUsage?: (usage: UsageInfo) => void,
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
    const usage = geminiUsage(data?.usageMetadata);
    if (usage) onUsage?.(usage);
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';
  let usage: UsageInfo | undefined;

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
          // Gemini reports cumulative totals-so-far on each chunk, so the
          // last one seen by the time the stream ends is the final total.
          usage = geminiUsage(parsed?.usageMetadata) ?? usage;
        } catch {
          // Skip unparseable chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (usage) onUsage?.(usage);
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

// Dedicated transcription endpoints (OpenRouter's /audio/transcriptions,
// OpenAI's own whisper-1/gpt-4o-transcribe endpoint) return one unbroken
// block of plain text with no paragraph structure at all — unlike the
// prompted OpenAI/Gemini chat-completions path, which is explicitly
// instructed to format its own output (see AUDIO_TRANSCRIPTION_SYSTEM_PROMPT),
// or Mistral's endpoint, which returns real segment timestamps to group by.
// Break it into readable paragraphs client-side by grouping a handful of
// sentences at a time, rather than shipping one giant line. This is a plain
// regex heuristic, not real sentence-boundary detection — it'll occasionally
// misfire on abbreviations ("Dr.", "U.S.") and start a paragraph slightly
// early, but that's a minor readability quirk, not a correctness problem
// (no text is ever dropped or altered).
const SENTENCES_PER_PARAGRAPH = 4;

function paragraphFormatFlatTranscript(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;

  const sentences = trimmed.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) ?? [trimmed];
  const paragraphs: string[] = [];
  for (let i = 0; i < sentences.length; i += SENTENCES_PER_PARAGRAPH) {
    const paragraph = sentences.slice(i, i + SENTENCES_PER_PARAGRAPH).join('').trim();
    if (paragraph) paragraphs.push(paragraph);
  }
  return paragraphs.join('\n\n');
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

  const res = await fetchOrThrow(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
    signal,
  }, 'Mistral transcription API');

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Mistral transcription API error (${res.status}): ${text.slice(0, 500)}`);
  }

  const data = await res.json();
  const fullText = formatMistralTranscript(data);

  onChunk(fullText);
  return fullText;
}

// Single call to OpenRouter's dedicated transcription endpoint, for models
// tagged output_modalities=transcription (e.g. openai/gpt-transcribe,
// whisper variants) that Chat Completions rejects outright. Same JSON shape
// as the input_audio content part used for chat, just posted directly
// without the messages/chat wrapper. Response has no segments/diarization
// data (unlike Mistral's own endpoint), so output is plain transcribed text.
async function postOpenRouterTranscription(
  apiKey: string,
  baseUrl: string,
  model: string,
  audioBase64: string,
  audioFormat: string,
  signal: AbortSignal,
): Promise<{ text: string; usage?: UsageInfo }> {
  const url = `${baseUrl.replace(/\/+$/, '')}/audio/transcriptions`;

  const res = await fetchOrThrow(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-Title': 'Media Markdown Converter',
    },
    body: JSON.stringify({
      model,
      input_audio: { data: audioBase64, format: audioFormat },
    }),
    signal,
  }, 'OpenRouter transcription API');

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenRouter transcription API error (${res.status}): ${text.slice(0, 500)}`);
  }

  const data = await res.json();
  // OpenRouter's STT usage shape: { input_tokens, output_tokens, total_tokens, cost, seconds }
  const rawUsage = data?.usage;
  const usage: UsageInfo | undefined = rawUsage
    ? {
        inputTokens: rawUsage.input_tokens,
        outputTokens: rawUsage.output_tokens,
        totalTokens: rawUsage.total_tokens,
        cost: rawUsage.cost,
      }
    : undefined;

  return { text: data?.text || '', usage };
}

// OpenRouter's /audio/transcriptions endpoint is synchronous (no partial
// results while the upstream provider works), and per OpenRouter's own docs
// (https://openrouter.ai/docs/guides/overview/multimodal/stt) "upstream
// providers time out after 60 seconds per request" — a long recording that
// takes the model longer than that to transcribe gets its connection killed
// outright (surfaces to fetch() as a bare network failure, nothing shows up
// in OpenRouter's own request logs since no response was ever generated).
// Their documented fix is to split longer recordings, so anything past this
// budget gets cut into 5-minute chunks short enough that even a slow model
// should comfortably finish each one inside the timeout, transcribed
// sequentially, and stitched back together.
const OPENROUTER_TRANSCRIPTION_CHUNK_SECONDS = 300;

// Whisper-style transcripts don't carry chunk-boundary punctuation, so
// stitching consecutive chunks needs a separating space — computed once and
// used for both the accumulated return value and the onChunk delta so the
// live-streamed preview matches the final text exactly instead of gluing
// chunk boundaries together with no space.
function chunkTextDelta(fullTextSoFar: string, chunkText: string): string {
  return fullTextSoFar && chunkText ? ` ${chunkText}` : chunkText;
}

async function convertAudioWithOpenRouterTranscription(
  apiKey: string,
  baseUrl: string,
  model: string,
  audioBase64: string,
  audioFormat: string,
  onChunk: (text: string) => void,
  signal: AbortSignal,
  onUsage?: (usage: UsageInfo) => void,
  onProgress?: (current: number, total: number) => void,
): Promise<string> {
  // Splitting is done by ffmpeg over IPC in Electron's main process — it
  // streams the file rather than loading it whole, so this stays cheap
  // regardless of the recording's length or format (mp3/m4a/wav/ogg/etc all
  // go through the same path). Only available in the desktop app, not the
  // standalone Node CLI, which keeps the old single-request behavior there
  // (fine for short files; long ones still hit the 60s timeout above, same
  // as before this fix).
  if (typeof window === 'undefined' || typeof window.electronAPI === 'undefined') {
    const { text, usage } = await postOpenRouterTranscription(apiKey, baseUrl, model, audioBase64, audioFormat, signal);
    const formatted = paragraphFormatFlatTranscript(text);
    if (usage) onUsage?.(usage);
    onChunk(formatted);
    return formatted;
  }

  const { dir, files } = await window.electronAPI.splitAudio(audioBase64, OPENROUTER_TRANSCRIPTION_CHUNK_SECONDS);

  try {
    // A recording shorter than the chunk length still round-trips through
    // ffmpeg (segmenting naturally produces a single output file when the
    // source is already under the target length), so this loop handles
    // both cases uniformly without a separate short-file fast path.
    let fullText = '';
    let usageTotal: UsageInfo | undefined;
    for (let i = 0; i < files.length; i++) {
      signal.throwIfAborted();
      onProgress?.(i + 1, files.length);
      const chunkDataUri = await window.electronAPI.readFileAsBase64(files[i]);
      const { text: chunkText, usage: chunkUsage } = await postOpenRouterTranscription(apiKey, baseUrl, model, extractBase64(chunkDataUri), 'mp3', signal);
      const delta = chunkTextDelta(fullText, chunkText);
      fullText += delta;
      usageTotal = mergeUsage(usageTotal, chunkUsage);
      onChunk(delta);
    }
    // Chunk-by-chunk streaming above sends the model's raw, unbroken text as
    // it arrives — reformat the fully assembled transcript into paragraphs
    // once at the end rather than per chunk, so a paragraph break never ends
    // up sitting awkwardly at a chunk boundary that split mid-sentence.
    const formatted = paragraphFormatFlatTranscript(fullText);
    if (usageTotal) onUsage?.(usageTotal);
    return formatted;
  } finally {
    void window.electronAPI.cleanupTempDir(dir).catch(() => {});
  }
}

// OpenAI's own dedicated /v1/audio/transcriptions endpoint (multipart file
// upload, not the JSON input_audio shape) — same fallback trigger as the
// OpenRouter version above, for whisper-1/gpt-4o(-mini)-transcribe.
async function convertAudioWithOpenAITranscription(
  apiKey: string,
  model: string,
  audioBase64: string,
  mimeType: string,
  onChunk: (text: string) => void,
  signal: AbortSignal,
  onUsage?: (usage: UsageInfo) => void,
): Promise<string> {
  const url = 'https://api.openai.com/v1/audio/transcriptions';

  const byteChars = atob(audioBase64);
  const byteArray = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteArray[i] = byteChars.charCodeAt(i);
  }
  const blob = new Blob([byteArray], { type: mimeType });

  const form = new FormData();
  form.append('file', blob, `audio.${mimeType.split('/').pop() || 'mp3'}`);
  form.append('model', model);

  const res = await fetchOrThrow(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal,
  }, 'OpenAI transcription API');

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenAI transcription API error (${res.status}): ${text.slice(0, 500)}`);
  }

  const data = await res.json();
  const fullText = paragraphFormatFlatTranscript(data?.text || '');

  // Only the newer gpt-4o(-mini)-transcribe models return this; whisper-1
  // doesn't, so this is expected to silently no-op for that model.
  const rawUsage = data?.usage;
  if (rawUsage?.input_tokens !== undefined || rawUsage?.output_tokens !== undefined) {
    onUsage?.({
      inputTokens: rawUsage.input_tokens,
      outputTokens: rawUsage.output_tokens,
      totalTokens: rawUsage.total_tokens,
    });
  }

  onChunk(fullText);
  return fullText;
}

export async function convertAudioToMarkdown(
  config: AppConfig,
  audioBase64: string,
  mimeType: string,
  onChunk: (text: string) => void,
  signal: AbortSignal,
  onUsage?: (usage: UsageInfo) => void,
  onProgress?: (current: number, total: number) => void,
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
    return convertAudioWithGemini(config.apiKey, audioModel, rawBase64, mimeType, onChunk, signal, onUsage);
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
  }
  // Plain 'openai' deliberately does NOT get baseURL overridden here (matches
  // convertImageToMarkdown's document path) — config.baseUrl for openai
  // defaults to "https://api.openai.com" (no /v1), which is a display value
  // only; overriding with it breaks every request since the SDK's own
  // default baseURL ("https://api.openai.com/v1") is what's actually correct.
  const client = new OpenAI(openAIOpts);
  const audioFormat = getInputAudioFormat(mimeType);

  try {
    return await convertAudioWithOpenAI(client, audioModel, rawBase64, audioFormat, onChunk, signal, onUsage);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Some models (e.g. openai/gpt-transcribe, whisper-1) are dedicated
    // transcription models and reject Chat Completions outright, telling us
    // exactly which endpoint to use instead. Retry there automatically
    // rather than trying to pre-filter which models are chat-compatible —
    // the server already knows better than any client-side guess.
    const needsTranscriptionEndpoint = /transcription model|audio\/transcriptions endpoint/i.test(message);
    if (!needsTranscriptionEndpoint) throw err;

    if (config.provider === 'openrouter') {
      return convertAudioWithOpenRouterTranscription(
        config.apiKey,
        config.baseUrl || 'https://openrouter.ai/api/v1',
        audioModel,
        rawBase64,
        audioFormat,
        onChunk,
        signal,
        onUsage,
        onProgress,
      );
    }

    return convertAudioWithOpenAITranscription(config.apiKey, audioModel, rawBase64, mimeType, onChunk, signal, onUsage);
  }
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
  onUsage?: (usage: UsageInfo) => void,
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
    const usage = geminiUsage(data?.usageMetadata);
    if (usage) onUsage?.(usage);
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';
  let usage: UsageInfo | undefined;

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
          usage = geminiUsage(parsed?.usageMetadata) ?? usage;
        } catch {
          // Skip unparseable chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (usage) onUsage?.(usage);
  return fullText;
}

// Raw model list from an OpenAI-compatible /models endpoint, kept
// unnarrowed so callers can inspect provider-specific fields (e.g.
// OpenRouter's architecture.input_modalities/output_modalities) beyond just
// the id that fetchAvailableModels narrows down to.
async function fetchOpenAICompatibleModelsRaw(
  provider: string,
  apiKey: string,
  baseUrl: string,
  queryString?: string,
): Promise<Record<string, unknown>[]> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const modelsPath = baseUrl.endsWith('/v1') ? '/models' : '/v1/models';
  const url = `${baseUrl.replace(/\/+$/, '')}${modelsPath}${queryString ? `?${queryString}` : ''}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to fetch models from ${provider} (${res.status}): ${text.slice(0, 500)}`);
  }
  const data = await res.json();
  // OpenAI returns { data: [...] }, LM Studio may return a single object { id, object, created, owned_by }
  if (Array.isArray(data.data)) {
    return data.data;
  }
  if (data.id && typeof data.id === 'string') {
    return [data];
  }
  throw new Error(`Unexpected response format from ${provider}: ${JSON.stringify(data).slice(0, 500)}`);
}

// Name-based fallback for providers whose /models endpoint doesn't expose
// modality metadata — OpenAI and Mistral only return { id, object, owned_by }
// so audio capability has to be inferred from well-known model naming.
const AUDIO_MODEL_NAME_PATTERNS: Record<string, RegExp> = {
  openai: /audio|whisper|transcribe/i,
  mistral: /voxtral/i,
};

// convertAudioWithMistral always posts to Mistral's dedicated
// /audio/transcriptions endpoint regardless of which voxtral variant is
// selected (no chat-completions fallback like OpenAI/OpenRouter have), and
// that endpoint 400s with "Invalid model" for anything except the
// transcription-flavored voxtral-mini models — voxtral-small-* is
// chat/vision-only, voxtral-mini-tts-* is text-to-speech (wrong direction),
// and voxtral-mini-*-realtime-* is a separate streaming API. Exclude those
// so the dropdown doesn't offer models that are guaranteed to fail.
const AUDIO_MODEL_NAME_EXCLUDE_PATTERNS: Partial<Record<string, RegExp>> = {
  mistral: /small|tts|realtime/i,
};

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
      const models = await fetchOpenAICompatibleModelsRaw(provider, apiKey, baseUrl);
      return models.map((m) => m.id as string);
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

// Subset of fetchAvailableModels' results that can actually be used as an
// audioModel — narrower than "every model this provider returns" since most
// providers mix text-only and audio-capable models in the same /models list.
export async function fetchAudioCapableModels(
  provider: string,
  apiKey: string,
  baseUrl: string,
): Promise<string[]> {
  switch (provider) {
    // OpenRouter's dedicated transcription models (openai/whisper-1,
    // openai/gpt-transcribe, mistralai/voxtral-mini-transcribe, etc.) are
    // filtered out of the default /models listing entirely — they only show
    // up when the request asks for them via ?output_modalities=transcription
    // (same filter as https://openrouter.ai/models?output_modalities=transcription).
    // General audio-input chat models (gpt-audio, voxtral-small, Gemini) stay
    // in the default listing and aren't what this dropdown is for.
    case 'openrouter': {
      const models = await fetchOpenAICompatibleModelsRaw(provider, apiKey, baseUrl, 'output_modalities=transcription');
      return models.map((m) => m.id as string);
    }
    // OpenAI and Mistral don't expose modality metadata on /models, so fall
    // back to matching well-known audio model naming.
    case 'openai':
    case 'mistral': {
      const models = await fetchOpenAICompatibleModelsRaw(provider, apiKey, baseUrl);
      const pattern = AUDIO_MODEL_NAME_PATTERNS[provider];
      const excludePattern = AUDIO_MODEL_NAME_EXCLUDE_PATTERNS[provider];
      return models
        .map((m) => m.id as string)
        .filter((id) => pattern.test(id) && !excludePattern?.test(id));
    }
    // Every Gemini model returned by fetchAvailableModels already supports
    // generateContent, and Gemini's generative models are multimodal
    // (audio included), so the full list doubles as the audio-capable list.
    case 'gemini':
      return fetchAvailableModels(provider, apiKey, baseUrl);
    default:
      return [];
  }
}

// Subset of fetchAvailableModels' results that can actually take image
// input — OpenRouter's catalog is large (~400 models) and mixes text-only
// models in with vision-capable ones, unlike the smaller catalogs from
// OpenAI/Anthropic/Gemini where filtering isn't as valuable. Unlike the
// transcription-model filter above, vision-capable models aren't hidden
// from the default /models listing — they're already there with real
// architecture.input_modalities metadata, so no special query string is
// needed, just a client-side filter (confirmed live: 241 of 409 models on
// OpenRouter had "image" in input_modalities as of this check).
export async function fetchVisionCapableModels(
  provider: string,
  apiKey: string,
  baseUrl: string,
): Promise<string[]> {
  switch (provider) {
    case 'openrouter': {
      const models = await fetchOpenAICompatibleModelsRaw(provider, apiKey, baseUrl);
      return models
        .filter((m) => {
          const architecture = m.architecture as { input_modalities?: string[] } | undefined;
          return !!architecture?.input_modalities?.includes('image');
        })
        .map((m) => m.id as string);
    }
    default:
      return [];
  }
}
