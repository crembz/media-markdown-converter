import { describe, expect, it } from 'vitest';
import { PAGE_SEPARATOR, stripExtension, timestampedMarkdownName } from './markdown';

describe('stripExtension', () => {
  it('drops the final extension', () => {
    expect(stripExtension('notes.png')).toBe('notes');
    expect(stripExtension('scan.tar.gz')).toBe('scan.tar');
  });

  it('leaves names without an extension alone', () => {
    expect(stripExtension('README')).toBe('README');
  });

  it('does not eat a leading dot on a dotfile', () => {
    expect(stripExtension('.env')).toBe('.env');
    expect(stripExtension('.png')).toBe('.png');
  });

  it('ignores dots that belong to a parent directory', () => {
    expect(stripExtension('/home/alex/v1.2/notes')).toBe('/home/alex/v1.2/notes');
  });
});

describe('timestampedMarkdownName', () => {
  it('appends a filesystem-safe timestamp', () => {
    const name = timestampedMarkdownName('notes', new Date('2026-08-14T09:41:07.123Z'));
    expect(name).toBe('notes_2026-08-14T09-41-07.md');
  });

  it('produces a name with no characters that are illegal on Windows', () => {
    const name = timestampedMarkdownName('notes', new Date('2026-01-02T03:04:05.000Z'));
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
  });
});

describe('PAGE_SEPARATOR', () => {
  it('is a markdown thematic break padded by blank lines', () => {
    expect(PAGE_SEPARATOR).toBe('\n\n---\n\n');
  });
});
