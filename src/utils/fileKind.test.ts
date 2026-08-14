import { describe, expect, it } from 'vitest';
import {
  getAudioMimeType,
  getFileKind,
  isAudioFile,
  isImageFile,
  isPdfFile,
  mimeTypeForPath,
} from './fileKind';

describe('extension matching', () => {
  it('is case-insensitive', () => {
    expect(isAudioFile('Recording.MP3')).toBe(true);
    expect(isImageFile('Scan.PNG')).toBe(true);
    expect(isPdfFile('Report.PDF')).toBe(true);
  });

  it('matches on the basename, not on directories that contain dots', () => {
    expect(isAudioFile('/home/a.mp3/notes.png')).toBe(false);
    expect(isImageFile('/home/a.mp3/notes.png')).toBe(true);
  });

  it('handles Windows separators', () => {
    expect(isImageFile('C:\\Users\\alex\\scan.jpg')).toBe(true);
  });

  it('rejects files with no extension', () => {
    expect(isAudioFile('recording')).toBe(false);
    expect(isImageFile('scan')).toBe(false);
  });
});

describe('getFileKind', () => {
  it('routes audio to the transcription path and everything else to OCR', () => {
    expect(getFileKind('interview.wav')).toBe('audio');
    expect(getFileKind('page.png')).toBe('document');
    expect(getFileKind('report.pdf')).toBe('document');
  });
});

describe('mime types', () => {
  it('maps .mp3 to audio/mpeg, not audio/mp3', () => {
    expect(getAudioMimeType('a.mp3')).toBe('audio/mpeg');
  });

  it('maps .m4a to audio/mp4', () => {
    expect(getAudioMimeType('a.m4a')).toBe('audio/mp4');
  });

  it('covers both tiff spellings', () => {
    expect(mimeTypeForPath('a.tif')).toBe('image/tiff');
    expect(mimeTypeForPath('a.tiff')).toBe('image/tiff');
  });

  it('falls back to audio/mpeg for unknown audio input', () => {
    expect(getAudioMimeType('a.unknown')).toBe('audio/mpeg');
  });
});
