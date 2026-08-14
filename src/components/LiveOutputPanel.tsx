import { useRef, useEffect, useState, useCallback, memo } from 'react';

interface LiveOutputPanelProps {
  currentFile: string;
  currentFileIndex: number;
  totalFiles: number;
  convertingPage: { current: number; total: number } | null;
  isAudio: boolean;
  output: string;
  /**
   * The conversion has finished and this panel is showing the final result
   * rather than a stream in progress. It stays mounted in that state until new
   * input is loaded, so the text can still be read and copied.
   */
  isComplete: boolean;
}

function LiveOutputPanel({
  currentFile,
  currentFileIndex,
  totalFiles,
  convertingPage,
  isAudio,
  output,
  isComplete,
}: LiveOutputPanelProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }
  }, [output]);

  // Clear the pending "Copied!" reset on unmount, so it can't fire a state
  // update against an unmounted component.
  useEffect(() => () => {
    if (copiedTimerRef.current !== null) clearTimeout(copiedTimerRef.current);
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      if (copiedTimerRef.current !== null) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }, [output]);

  const isSingleImage = totalFiles === 0;

  const label = isComplete
    ? (isSingleImage ? 'Converted' : `${totalFiles} file${totalFiles === 1 ? '' : 's'} converted`)
    : (isSingleImage ? 'Converting' : `File ${currentFileIndex + 1}/${totalFiles}`);

  return (
    <div className="live-output-panel">
      <div className="live-output-panel__header">
        <div className="live-output-panel__info">
          <span className="live-output-panel__file">{label}</span>
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
            // Held at full once finished. convertingPage is cleared when the
            // run ends, so without this the bar would snap back to empty just
            // as the result appears.
            width: isComplete
              ? '100%'
              : convertingPage
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

// Memoized: App re-renders on every flushed batch of streamed output.
export default memo(LiveOutputPanel);
