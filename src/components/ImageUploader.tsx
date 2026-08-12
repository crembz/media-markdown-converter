import { useCallback, useState } from 'react';
import { useDropzone, type DropzoneOptions } from 'react-dropzone';

interface ImageUploaderProps {
  onImageSelect: (dataUri: string, filename: string) => void;
  onPdfSelect: (pages: string[], filename: string) => void;
  onFilesSelected: (files: Array<{ filePath: string; filename: string; fileType: 'image' | 'pdf' }>) => void;
  onLoadingState: (loading: boolean) => void;
  onError?: (message: string) => void;
}

const ACCEPTED_TYPES: Record<string, string[]> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/tiff': ['.tiff', '.tif'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
};

function compressCanvas(canvas: HTMLCanvasElement, quality: number): string {
  return canvas.toDataURL('image/jpeg', quality);
}

function resizeIfNeeded(dataUri: string, maxWidth: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const img = new Image();
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
      resolve(compressCanvas(canvas, 0.75));
    };
    img.onerror = () => reject(new Error('Failed to load image for resizing'));
    img.src = dataUri;
  });
}

async function readFileAsDataUri(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        resolve(result);
      } else {
        reject(new Error('Failed to read file as DataURL'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('File read error'));
    reader.readAsDataURL(file);
  });
}

async function processUploadedImage(file: File, dataUri: string): Promise<string> {
  if (file.size > 2 * 1024 * 1024) {
    return resizeIfNeeded(dataUri, 2048);
  }
  return dataUri;
}

export default function ImageUploader({ onImageSelect, onPdfSelect, onFilesSelected, onLoadingState, onError }: ImageUploaderProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;

      setError(null);

      if (acceptedFiles.length === 1) {
        const file = acceptedFiles[0];
        try {
          if (file.type === 'application/pdf') {
            setIsLoading(true);
            onLoadingState(true);
            const pages = await (await import('../utils/pdf')).renderPdfPages(file);
            onPdfSelect(pages, file.name);
          } else {
            const dataUri = await readFileAsDataUri(file);
            const processed = await processUploadedImage(file, dataUri);
            onImageSelect(processed, file.name);
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Failed to process file';
          setError(message);
          onError?.(message);
        } finally {
          setIsLoading(false);
          onLoadingState(false);
        }
      } else {
        setIsLoading(true);
        onLoadingState(true);
        const batchFiles: Array<{ filePath: string; filename: string; fileType: 'image' | 'pdf' }> = [];

        for (const file of acceptedFiles) {
          const isPdf = file.type === 'application/pdf';
          batchFiles.push({
            filePath: file.path || '',
            filename: file.name,
            fileType: isPdf ? 'pdf' : 'image',
          });
        }

        onLoadingState(false);
        setIsLoading(false);

        if (batchFiles.length > 0) {
          onFilesSelected(batchFiles);
        }
      }
    },
    [onImageSelect, onPdfSelect, onFilesSelected, onLoadingState, onError],
  );

  const dropzoneOptions: DropzoneOptions = {
    onDrop,
    accept: ACCEPTED_TYPES,
    multiple: true,
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone(dropzoneOptions);

  return (
    <div className="image-uploader">
      <div
        className={`dropzone ${isDragActive ? 'dropzone--active' : ''} ${isLoading ? 'dropzone--loading' : ''}`}
        {...getRootProps()}
      >
        <input {...getInputProps()} />

        <div className="dropzone__content">
          {isLoading ? (
            <p className="dropzone__text">Rendering PDF pages...</p>
          ) : error ? (
            <p className="dropzone__text dropzone__text--error">{error}</p>
          ) : (
            <>
              <svg
                className="dropzone__icon"
                xmlns="http://www.w3.org/2000/svg"
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>

              <p className="dropzone__text">
                {isDragActive
                  ? 'Drop the files here'
                  : 'Drag & drop images or PDFs, or click to browse'}
              </p>

              <p className="dropzone__hint">PNG, JPG, TIFF, WEBP, PDF — multiple files supported</p>
            </>
          )}
        </div>
      </div>

      <button
        type="button"
        className="btn-secondary"
        disabled={isLoading}
        onClick={() => {
          setError(null);
          const input = document.querySelector('.dropzone input[type="file"]');
          if (input instanceof HTMLInputElement) {
            input.click();
          }
        }}
      >
        Browse Files
      </button>
    </div>
  );
}
