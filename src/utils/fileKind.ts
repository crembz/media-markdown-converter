export type FileKind = 'document' | 'audio';

export const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.webm', '.aac'];

export const AUDIO_MIME_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm',
  '.aac': 'audio/aac',
};

function extname(filenameOrPath: string): string {
  const base = filenameOrPath.split(/[\\/]/).pop() || filenameOrPath;
  const dotIndex = base.lastIndexOf('.');
  return dotIndex === -1 ? '' : base.slice(dotIndex).toLowerCase();
}

export function isAudioFile(filenameOrPath: string): boolean {
  return AUDIO_EXTENSIONS.includes(extname(filenameOrPath));
}

export function getFileKind(filenameOrPath: string): FileKind {
  return isAudioFile(filenameOrPath) ? 'audio' : 'document';
}

export function getAudioMimeType(filenameOrPath: string): string {
  return AUDIO_MIME_TYPES[extname(filenameOrPath)] || 'audio/mpeg';
}
