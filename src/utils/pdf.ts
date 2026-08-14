import * as pdfjsLib from 'pdfjs-dist';
import PdfJsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&url';
import { JPEG_QUALITY, fitScale } from './image';

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfJsWorker;

// Upper bound on render scale. The effective scale is the smaller of this and
// whatever keeps the page within MAX_IMAGE_DIMENSION.
const RENDER_SCALE = 2;

async function renderPageToDataUri(pdf: pdfjsLib.PDFDocumentProxy, pageNum: number): Promise<string> {
  const page = await pdf.getPage(pageNum);

  // Size the canvas correctly up front. This used to render at RENDER_SCALE,
  // encode to JPEG, then decode that JPEG back into an Image and re-encode it
  // if the result was too large — a wasted decode per page, and two rounds of
  // lossy compression on the exact image the OCR model has to read. Final
  // dimensions are identical; the pixels are just cleaner.
  const unscaled = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({
    scale: fitScale(unscaled.width, unscaled.height, RENDER_SCALE),
  });

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');

  try {
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  } finally {
    // Drop the backing store now rather than waiting for GC; a long document
    // otherwise holds every page's canvas at once.
    canvas.width = 0;
    canvas.height = 0;
    page.cleanup();
  }
}

/**
 * Renders every page to its own JPEG data URI.
 *
 * One entry per page, by design: callers send them to the LLM one request at a
 * time so a local model's context isn't swamped by a large document. Do not
 * change this to concatenate or batch pages.
 */
export async function renderPdfPages(source: File | Uint8Array): Promise<string[]> {
  const data = source instanceof Uint8Array ? source : new Uint8Array(await source.arrayBuffer());

  // verbosity replaces what used to be done by swapping out console.warn and
  // console.error around the render loop to hide pdfjs's XFA chatter —
  // reassigning globals raced with anything else logging at the same time.
  const pdf = await pdfjsLib.getDocument({
    data,
    verbosity: pdfjsLib.VerbosityLevel.ERRORS,
  }).promise;

  try {
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      pages.push(await renderPageToDataUri(pdf, i));
    }
    return pages;
  } finally {
    await pdf.destroy();
  }
}
