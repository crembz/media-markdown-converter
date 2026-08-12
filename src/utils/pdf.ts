import * as pdfjsLib from 'pdfjs-dist';
import PdfJsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&url';

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfJsWorker;

const pdfjsLogger = {
  warn: () => {},
  error: (msg: string) => {
    if (msg.includes('XFA') || msg.includes('xfa') || msg.includes('rich text')) return;
  },
};
(pdfjsLib.GlobalWorkerOptions as unknown as Record<string, unknown>).logger = pdfjsLogger;

function compressImage(canvas: HTMLCanvasElement, quality: number): string {
  const dataUri = canvas.toDataURL('image/jpeg', quality);
  return dataUri;
}

async function resizeIfNeeded(dataUri: string, maxWidth: number): Promise<string> {
  const img = new Image();
  const promise = new Promise<string>((resolve, reject) => {
    img.onload = () => {
      if (img.width <= maxWidth && img.height <= maxWidth) {
        resolve(dataUri);
        return;
      }
      const canvas = document.createElement('canvas');
      const scale = Math.min(maxWidth / img.width, maxWidth / img.height);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }
      resolve(compressImage(canvas, 0.75));
    };
    img.onerror = () => reject(new Error('Failed to load rendered page image for resizing'));
    img.src = dataUri;
  });
  return promise;
}

async function renderPageToDataUri(pdf: pdfjsLib.PDFDocumentProxy, pageNum: number): Promise<string> {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: 2 });

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');

  await page.render({ canvasContext: ctx, viewport }).promise;

  let dataUri = compressImage(canvas, 0.75);

  return resizeIfNeeded(dataUri, 2048);
}

export async function renderPdfPages(file: File): Promise<string[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages: string[] = [];

  const silentWarn = console.warn.bind(console);
  const silentError = console.error.bind(console);
  console.warn = (...args: unknown[]) => {
    const msg = args[0];
    if (typeof msg === 'string' && (msg.includes('XFA') || msg.includes('xfa') || msg.includes('rich text'))) return;
    silentWarn(...args);
  };
  console.error = (...args: unknown[]) => {
    const msg = args[0];
    if (typeof msg === 'string' && (msg.includes('XFA') || msg.includes('xfa') || msg.includes('rich text'))) return;
    silentError(...args);
  };

  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      pages.push(await renderPageToDataUri(pdf, i));
    }
  } finally {
    console.warn = silentWarn;
    console.error = silentError;
  }

  return pages;
}
