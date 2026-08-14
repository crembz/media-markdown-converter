import { describe, expect, it } from 'vitest';
import {
  chunkTextDelta,
  formatMistralTranscript,
  formatTimestamp,
  getInputAudioFormat,
  mergeUsage,
  paragraphFormatFlatTranscript,
} from './llm';

describe('mergeUsage', () => {
  it('returns the other side when one is missing', () => {
    expect(mergeUsage(undefined, { inputTokens: 5 })).toEqual({ inputTokens: 5 });
    expect(mergeUsage({ inputTokens: 5 }, undefined)).toEqual({ inputTokens: 5 });
    expect(mergeUsage(undefined, undefined)).toBeUndefined();
  });

  it('sums token counts across pages', () => {
    const merged = mergeUsage(
      { inputTokens: 10, outputTokens: 3, totalTokens: 13 },
      { inputTokens: 4, outputTokens: 1, totalTokens: 5 },
    );
    expect(merged).toMatchObject({ inputTokens: 14, outputTokens: 4, totalTokens: 18 });
  });

  it('leaves cost undefined when neither side reported one', () => {
    expect(mergeUsage({ inputTokens: 1 }, { inputTokens: 2 })?.cost).toBeUndefined();
  });

  it('keeps a cost reported by only one side', () => {
    expect(mergeUsage({ cost: 0.25 }, { inputTokens: 2 })?.cost).toBe(0.25);
  });
});

describe('getInputAudioFormat', () => {
  it('maps the mpeg subtype to mp3', () => {
    expect(getInputAudioFormat('audio/mpeg')).toBe('mp3');
  });

  it('maps the mp4 subtype to m4a', () => {
    expect(getInputAudioFormat('audio/mp4')).toBe('m4a');
  });

  it('passes other subtypes through rather than blocking them client-side', () => {
    expect(getInputAudioFormat('audio/flac')).toBe('flac');
    expect(getInputAudioFormat('audio/ogg')).toBe('ogg');
  });
});

describe('formatTimestamp', () => {
  it('renders zero-padded hh:mm:ss', () => {
    expect(formatTimestamp(0)).toBe('00:00:00');
    expect(formatTimestamp(61)).toBe('00:01:01');
    expect(formatTimestamp(3661)).toBe('01:01:01');
  });

  it('clamps negatives to zero rather than emitting a negative clock', () => {
    expect(formatTimestamp(-5)).toBe('00:00:00');
  });
});

describe('chunkTextDelta', () => {
  it('does not prefix a space on the first chunk', () => {
    expect(chunkTextDelta('', 'hello')).toBe('hello');
  });

  it('separates consecutive chunks, which carry no boundary punctuation', () => {
    expect(chunkTextDelta('hello', 'world')).toBe(' world');
  });

  it('stays empty when the chunk is empty, so no stray space is added', () => {
    expect(chunkTextDelta('hello', '')).toBe('');
  });
});

describe('paragraphFormatFlatTranscript', () => {
  it('groups sentences into paragraphs of four', () => {
    const text = 'One. Two. Three. Four. Five. Six.';
    const out = paragraphFormatFlatTranscript(text);
    expect(out.split('\n\n')).toEqual(['One. Two. Three. Four.', 'Five. Six.']);
  });

  it('returns a single paragraph when there is less than one group', () => {
    expect(paragraphFormatFlatTranscript('Just one sentence.')).toBe('Just one sentence.');
  });

  it('handles text with no terminal punctuation', () => {
    expect(paragraphFormatFlatTranscript('no punctuation here')).toBe('no punctuation here');
  });

  it('is empty for empty or whitespace-only input', () => {
    expect(paragraphFormatFlatTranscript('')).toBe('');
    expect(paragraphFormatFlatTranscript('   \n ')).toBe('');
  });

  it('never drops text', () => {
    const text = 'A. B! C? D. E. F. G.';
    const out = paragraphFormatFlatTranscript(text);
    expect(out.replace(/\n+/g, ' ')).toBe(text);
  });
});

describe('formatMistralTranscript', () => {
  it('falls back to the flat text when there are no segments', () => {
    expect(formatMistralTranscript({ text: 'flat' })).toBe('flat');
    expect(formatMistralTranscript({ text: 'flat', segments: [] })).toBe('flat');
  });

  it('merges consecutive segments from the same speaker into one block', () => {
    const out = formatMistralTranscript({
      segments: [
        { text: 'Hello there.', start: 0, end: 2, speaker_id: 'a' },
        { text: 'How are you?', start: 2, end: 4, speaker_id: 'a' },
      ],
    });
    expect(out).toBe('**Speaker 1 · 00:00:00**\n\nHello there. How are you?');
  });

  it('starts a new block when the speaker changes, numbering by first appearance', () => {
    const out = formatMistralTranscript({
      segments: [
        { text: 'First.', start: 0, end: 1, speaker_id: 'a' },
        { text: 'Second.', start: 1, end: 2, speaker_id: 'b' },
        { text: 'Third.', start: 2, end: 3, speaker_id: 'a' },
      ],
    });
    expect(out).toContain('**Speaker 1 · 00:00:00**');
    expect(out).toContain('**Speaker 2 · 00:00:01**');
    // Speaker a keeps its number when it comes back.
    expect(out.split('\n\n')).toContain('**Speaker 1 · 00:00:02**');
  });

  it('breaks a block on a long silence even for the same speaker', () => {
    const out = formatMistralTranscript({
      segments: [
        { text: 'Before the pause.', start: 0, end: 5, speaker_id: 'a' },
        { text: 'After the pause.', start: 300, end: 305, speaker_id: 'a' },
      ],
    });
    expect(out.match(/\*\*Speaker 1/g)).toHaveLength(2);
    expect(out).toContain('**Speaker 1 · 00:05:00**');
  });

  it('omits speaker labels entirely when diarization is absent', () => {
    const out = formatMistralTranscript({
      segments: [{ text: 'No speaker id.', start: 0, end: 1 }],
    });
    expect(out).toBe('**00:00:00**\n\nNo speaker id.');
  });

  it('skips blank segments', () => {
    const out = formatMistralTranscript({
      segments: [
        { text: '   ', start: 0, end: 1, speaker_id: 'a' },
        { text: 'Real content.', start: 1, end: 2, speaker_id: 'a' },
      ],
    });
    expect(out).toBe('**Speaker 1 · 00:00:01**\n\nReal content.');
  });
});
