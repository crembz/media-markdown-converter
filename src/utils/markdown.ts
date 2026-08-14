/** Written between pages of a multi-page document in the combined output. */
export const PAGE_SEPARATOR = '\n\n---\n\n';

export function stripExtension(filename: string): string {
  const basenameStart = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\')) + 1;
  const dotIndex = filename.lastIndexOf('.');

  // A dot that opens the basename is part of the name (".env"), not an
  // extension — the previous regex stripped the whole thing and returned an
  // empty name. A dot belonging to a parent directory isn't an extension
  // either.
  if (dotIndex <= basenameStart) return filename;

  return filename.slice(0, dotIndex);
}

/** `notes.md` -> `notes_2026-08-13T09-41-07.md`, for the "rename" conflict strategy. */
export function timestampedMarkdownName(baseName: string, now = new Date()): string {
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${baseName}_${timestamp}.md`;
}
