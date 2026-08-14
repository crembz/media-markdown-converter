// Single source of truth for supported extensions and their MIME types.
// The same tables previously existed in three places (electron/main.ts, here,
// and inline in src/cli.ts) and had already drifted — main.ts knew about .tif,
// the CLI's copy did not.
//
// Deliberately dependency-free: electron/main.ts imports this as a value, so
// anything added here ends up in the main-process bundle.

export type FileKind = 'document' | 'audio';

export const AUDIO_MIME_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm',
  '.aac': 'audio/aac',
};

export const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
};

export const MIME_TYPES: Record<string, string> = {
  ...IMAGE_MIME_TYPES,
  ...AUDIO_MIME_TYPES,
  '.pdf': 'application/pdf',
};

export const AUDIO_EXTENSIONS = Object.keys(AUDIO_MIME_TYPES);
export const IMAGE_EXTENSIONS = Object.keys(IMAGE_MIME_TYPES);

function extname(filenameOrPath: string): string {
  const base = filenameOrPath.split(/[\\/]/).pop() || filenameOrPath;
  const dotIndex = base.lastIndexOf('.');
  return dotIndex === -1 ? '' : base.slice(dotIndex).toLowerCase();
}

export function isAudioFile(filenameOrPath: string): boolean {
  return extname(filenameOrPath) in AUDIO_MIME_TYPES;
}

export function isImageFile(filenameOrPath: string): boolean {
  return extname(filenameOrPath) in IMAGE_MIME_TYPES;
}

export function isPdfFile(filenameOrPath: string): boolean {
  return extname(filenameOrPath) === '.pdf';
}

export function getFileKind(filenameOrPath: string): FileKind {
  return isAudioFile(filenameOrPath) ? 'audio' : 'document';
}

export function getAudioMimeType(filenameOrPath: string): string {
  return AUDIO_MIME_TYPES[extname(filenameOrPath)] || 'audio/mpeg';
}

/**
 * MIME type for any supported file. Falls back to image/png for unknown
 * extensions, matching the previous behaviour of the read-file-as-base64 IPC
 * handler — uploads are already extension-filtered before they reach here.
 */
export function mimeTypeForPath(filenameOrPath: string): string {
  return MIME_TYPES[extname(filenameOrPath)] || 'image/png';
}
