import { useRef, useEffect, useState, useCallback } from 'react';

interface LiveOutputPanelProps {
  currentFile: string;
  currentFileIndex: number;
  totalFiles: number;
  convertingPage: { current: number; total: number } | null;
  isAudio: boolean;
  output: string;
}

export default function LiveOutputPanel({
  currentFile,
  currentFileIndex,
  totalFiles,
  convertingPage,
  isAudio,
  output,
}: LiveOutputPanelProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }
  }, [output]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }, [output]);

  const isSingleImage = totalFiles === 0;

  return (
    <div className="live-output-panel">
      <div className="live-output-panel__header">
        <div className="live-output-panel__info">
          <span className="live-output-panel__file">
            {isSingleImage ? 'Converting' : `File ${currentFileIndex + 1}/${totalFiles}`}
          </span>
          <span className="live-output-panel__filename">{currentFile}</span>
          {convertingPage && convertingPage.total > 1 && (
            <span className="live-output-panel__page">
              {isAudio ? 'Chunk' : 'Page'} {convertingPage.current}/{convertingPage.total}
            </span>
          )}
        </div>
        <button
          type="button"
          className="btn-secondary live-output-panel__copy"
          onClick={handleCopy}
          disabled={output.length === 0}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      <div className="live-output-panel__progress">
        <div
          className="live-output-panel__progress-bar"
          style={{
            width: convertingPage
              ? `${(convertingPage.current / convertingPage.total) * 100}%`
              : '0%',
          }}
        />
      </div>

      <textarea
        ref={textareaRef}
        className="live-output-panel__output"
        value={output}
        readOnly
        placeholder="Converted text will appear here..."
      />
    </div>
  );
}
