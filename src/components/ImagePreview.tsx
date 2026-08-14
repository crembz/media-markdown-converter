import { useState, useRef, useCallback, useEffect, memo } from 'react';

interface ImagePreviewProps {
  image: string;
  onReplace: () => void;
  totalPages?: number;
  currentPage?: number;
  onPageChange?: (page: number) => void;
}

function extractFilenameFromDataUri(dataUri: string): string | null {
  const nameMatch = dataUri.match(/name=([^&]+)/);
  if (nameMatch && nameMatch[1]) {
    return decodeURIComponent(nameMatch[1]);
  }

  const segments = dataUri.split(',');
  if (segments.length < 2) return null;

  const header = segments[0];
  const filenameMatch = header.match(/;name=([^;]+)/);
  if (filenameMatch && filenameMatch[1]) {
    return decodeURIComponent(filenameMatch[1]);
  }

  const mimeMatch = header.match(/data:([^;]+)/);
  if (mimeMatch && mimeMatch[1]) {
    const mime = mimeMatch[1];
    const [category, ext] = mime.split('/');
    if (ext) {
      return `${category || 'image'}.${ext}`;
    }
  }

  return null;
}

function extractDimensions(img: HTMLImageElement): { width: number; height: number } {
  return {
    width: img.naturalWidth,
    height: img.naturalHeight,
  };
}

function ImagePreview({ image, onReplace, totalPages, currentPage, onPageChange }: ImagePreviewProps) {
  const [scale, setScale] = useState<number>(1);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isMultiPage = totalPages && totalPages > 1;
  const isAudio = image.startsWith('data:audio/');

  const filename = extractFilenameFromDataUri(image);

  const handleLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const target = e.currentTarget;
      setDimensions(extractDimensions(target));
    },
    [],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setScale((prev) => Math.min(Math.max(prev + delta, 0.25), 4));
    },
    [],
  );

  const handleResetZoom = useCallback(() => {
    setScale(1);
  }, []);

  const handlePrevPage = useCallback(() => {
    if (onPageChange && currentPage && currentPage > 0) {
      onPageChange(currentPage - 1);
    }
  }, [onPageChange, currentPage]);

  const handleNextPage = useCallback(() => {
    if (onPageChange && currentPage && totalPages && currentPage < totalPages - 1) {
      onPageChange(currentPage + 1);
    }
  }, [onPageChange, currentPage, totalPages]);

  useEffect(() => {
    setScale(1);
    setDimensions(null);
  }, [image]);

  if (isAudio) {
    return (
      <div className="image-preview">
        <div className="image-preview__toolbar">
          {filename && <span className="image-preview__filename">{filename}</span>}
          <span className="image-preview__spacer" />
          <button type="button" className="btn-secondary" onClick={onReplace}>
            Replace
          </button>
        </div>

        <div className="image-preview__container">
          <audio controls src={image} style={{ width: '100%', maxWidth: 480 }} />
        </div>
      </div>
    );
  }

  return (
    <div className="image-preview">
      <div className="image-preview__toolbar">
        {filename && <span className="image-preview__filename">{filename}</span>}
        {dimensions && (
          <span className="image-preview__dimensions">
            {dimensions.width} &times; {dimensions.height}
          </span>
        )}
        {isMultiPage && (
          <span className="image-preview__pagenum">
            Page {currentPage! + 1} / {totalPages}
          </span>
        )}
        <span className="image-preview__zoom">{Math.round(scale * 100)}%</span>
        {isMultiPage && (
          <>
            <button type="button" className="btn-secondary" onClick={handlePrevPage} disabled={!currentPage}>
              Prev
            </button>
            <button type="button" className="btn-secondary" onClick={handleNextPage} disabled={currentPage !== undefined && currentPage >= (totalPages! - 1)}>
              Next
            </button>
          </>
        )}
        <button type="button" className="btn-secondary" onClick={handleResetZoom}>
          Reset Zoom
        </button>
        <button type="button" className="btn-secondary" onClick={onReplace}>
          Replace
        </button>
      </div>

      <div
        ref={containerRef}
        className="image-preview__container"
        onWheel={handleWheel}
      >
        <img
          src={image}
          alt="Uploaded document"
          className="image-preview__image"
          style={{ transform: `scale(${scale})` }}
          onLoad={handleLoad}
        />
      </div>
    </div>
  );
}

// Memoized: the `image` prop is a large data URI and App re-renders often
// during conversion; without this the preview re-renders on every update.
export default memo(ImagePreview);
