// MUST stay first: installs the browser globals pdfjs binds at load time.
import './pdf-node-globals';
// The legacy build, not the default one: pdfjs's default entry point assumes
// browser APIs and prints "Please use the `legacy` build in Node.js
// environments" on load. On the default build every glyph was dropped during
// rendering ("getPathGenerator - ignoring character ... isn't resolved yet"),
// producing blank page images — silently useless as OCR input.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { promises as fs } from 'fs';
import { dirname, join, sep } from 'path';
import { pathToFileURL } from 'url';

// The 14 standard PDF fonts (Helvetica, Times, Courier…) aren't embedded in
// the file, so pdfjs loads substitutes from standardFontDataUrl. It has no
// default in Node, and the fonts ship inside the package — point at that
// directory rather than pulling them over the network. This has to be a
// plain filesystem path, not a file:// URL: under Node pdfjs reads the font
// with fs, and concatenates this value with the filename directly, so the
// trailing separator is required.
const STANDARD_FONT_DATA_URL =
  join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + sep;

// Load the worker from the installed package rather than a CDN. The previous
// cdnjs URL made CLI PDF conversion depend on network access — and on cdnjs
// happening to host the exact pdfjs-dist version resolved here — so it failed
// outright offline or behind a proxy. A file:// URL (not a bare path) is what
// pdfjs hands to a dynamic import, and it keeps this working on Windows.
pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(
  require.resolve('pdfjs-dist/build/pdf.worker.min.mjs'),
).href;

export async function renderPdfPages(filePath: string): Promise<string[]> {
  // pdfjs-dist v4 rejects a Node Buffer outright ("Please provide binary data
  // as `Uint8Array`, rather than `Buffer`"), so hand it a plain view over the
  // same bytes — no copy.
  const buffer = await fs.readFile(filePath);
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const pdf = await pdfjsLib.getDocument({ data, standardFontDataUrl: STANDARD_FONT_DATA_URL }).promise;
  const pages: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 3 });

    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
    await page.render({ canvasContext: ctx, viewport }).promise;

    pages.push(canvas.toDataURL('image/png'));
  }

  return pages;
}
