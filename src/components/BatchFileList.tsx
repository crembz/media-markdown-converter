import { memo } from 'react';
import type { BatchFile } from '../types';

interface BatchFileListProps {
  files: Array<BatchFile | null>;
  currentIndex: number;
  showClear: boolean;
  onSelect: (index: number) => void;
  onClear: () => void;
}

const TYPE_LABELS: Record<BatchFile['fileType'], string> = {
  pdf: 'PDF',
  audio: 'Audio',
  image: 'Image',
};

// Extracted from App.tsx, where this markup appeared twice — once in the
// converting split view and once in the idle view — and had to be edited in
// lockstep. Memoized because App re-renders on every streamed output update.
function BatchFileList({ files, currentIndex, showClear, onSelect, onClear }: BatchFileListProps) {
  const validCount = files.reduce((n, file) => (file ? n + 1 : n), 0);

  return (
    <div className="batch-view">
      <div className="batch-view__header">
        <span className="batch-view__count">{validCount} files loaded</span>
        {showClear && (
          <button className="btn-secondary batch-view__clear" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
      <div className="batch-view__content">
        {files.map((file, index) => (
          <div
            key={file ? `${file.filePath}:${index}` : `invalid:${index}`}
            className={`batch-file ${file ? 'batch-file--valid' : 'batch-file--error'} ${currentIndex === index ? 'batch-file--current' : ''}`}
            onClick={() => onSelect(index)}
          >
            <span className="batch-file__name">{file?.filename ?? 'Failed to load'}</span>
            <span className="batch-file__pages">{file ? TYPE_LABELS[file.fileType] : 'Failed'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default memo(BatchFileList);
