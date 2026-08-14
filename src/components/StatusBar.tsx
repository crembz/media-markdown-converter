import React, { memo } from 'react';
import { UsageInfo } from '../services/llm';

interface StatusBarProps {
  isProcessing: boolean;
  error: string | null;
  onConvert: () => void;
  onAbort: () => void;
  hasImage: boolean;
  hasConfig: boolean;
  convertingPage: { current: number; total: number } | null;
  isAudio: boolean;
  batchStatus: 'idle' | 'processing' | 'done' | 'error';
  totalFiles: number;
  filesConverted: number;
  filesSkipped: number;
  filesFailed: number;
  outputFolder: string | null;
  showConflictDialog: boolean;
  activeModel: string | null;
  usageInfo: UsageInfo | null;
  onConvertWithFolder: () => void;
  onOpenFolder: () => void;
}

function formatUsage(usage: UsageInfo): string | null {
  const parts: string[] = [];
  const total = usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  if (total > 0) parts.push(`${total.toLocaleString()} tokens`);
  if (usage.cost !== undefined) parts.push(`$${usage.cost.toFixed(4)}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

const SUMMARY_COLORS = {
  converted: '#4ade80',
  skipped: '#facc15',
  failed: '#f87171',
} as const;

/** Coloured "3 converted, 1 skipped" line; null when every count is zero. */
function renderSummary(converted: number, skipped: number, failed: number): React.ReactNode | null {
  const items: { label: string; color: string }[] = [];
  if (converted > 0) items.push({ label: `${converted} converted`, color: SUMMARY_COLORS.converted });
  if (skipped > 0) items.push({ label: `${skipped} skipped`, color: SUMMARY_COLORS.skipped });
  if (failed > 0) items.push({ label: `${failed} failed`, color: SUMMARY_COLORS.failed });

  if (items.length === 0) return null;

  return items.map((item, i) => (
    <span key={item.label}>
      {i > 0 && ', '}
      <span style={{ color: item.color }}>{item.label}</span>
    </span>
  ));
}

function Spinner(): React.ReactElement {
  return (
    <svg
      className="status-bar__spinner"
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ animation: 'spin 1s linear infinite', marginRight: '0.5rem' }}
    >
      <path d="M12 2v4" />
      <path d="M12 18v4" />
      <path d="M4.93 4.93l2.83 2.83" />
      <path d="M16.24 16.24l2.83 2.83" />
      <path d="M2 12h4" />
      <path d="M18 12h4" />
      <path d="M4.93 19.07l2.83-2.83" />
      <path d="M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

function StatusBar({
  isProcessing,
  error,
  onAbort,
  hasImage,
  hasConfig,
  convertingPage,
  isAudio,
  batchStatus,
  totalFiles,
  filesConverted,
  filesSkipped,
  filesFailed,
  outputFolder,
  showConflictDialog,
  activeModel,
  usageInfo,
  onConvertWithFolder,
  onOpenFolder,
}: StatusBarProps): React.ReactElement {
  // Every branch below assigns both, so no initialiser is needed — the `''`
  // one was dead in every path.
  let statusClass: string;
  let statusContent: React.ReactNode;

  if (error) {
    statusContent = error;
    statusClass = 'status-error';
  } else if (isProcessing && convertingPage) {
    statusContent = convertingPage.total > 1
      ? isAudio
        ? `Transcribing chunk ${convertingPage.current} of ${convertingPage.total}...`
        : `Converting page ${convertingPage.current} of ${convertingPage.total}...`
      : 'Converting...';
    statusClass = 'status-processing';
  } else if (isProcessing) {
    statusContent = 'Converting...';
    statusClass = 'status-processing';
  } else if (batchStatus === 'processing') {
    statusContent = `Processing files... (${filesConverted}/${totalFiles})`;
    statusClass = 'status-processing';
  } else if (batchStatus === 'done' || batchStatus === 'error') {
    // One summary for both outcomes; they differ only in the fallback text
    // shown when nothing at all was counted, and in the status class.
    const summary = renderSummary(filesConverted, filesSkipped, filesFailed);
    statusContent = summary ?? (batchStatus === 'done'
      ? 'Done — no files converted'
      : `Error — ${filesConverted} of ${totalFiles} files converted`);
    statusClass = batchStatus === 'done' ? 'status-done' : 'status-error';
  } else if (!hasConfig) {
    statusContent = 'Configure your LLM provider to begin';
    statusClass = '';
  } else if (!hasImage) {
    statusContent = 'Ready — upload an image or PDF to convert';
    statusClass = '';
  } else if (!outputFolder) {
    statusContent = 'Ready to convert — Set output folder in Settings';
    statusClass = '';
  } else {
    const displayPath = outputFolder.split(/[\\/]/).pop() || outputFolder;
    statusContent = `Ready to convert — Output: ${displayPath}`;
    statusClass = '';
  }

  const usageText = usageInfo ? formatUsage(usageInfo) : null;

  return (
    <div className="status-bar">
      <span className={`status-text ${statusClass}`}>
        {isProcessing && <Spinner />}
        {statusContent}
      </span>

      {activeModel && (
        <span className="status-bar__model" title={usageText ? 'Model in use, and token usage for the last conversion' : 'Model in use'}>
          {activeModel}
          {usageText && <span className="status-bar__usage"> · {usageText}</span>}
        </span>
      )}

      <div className="status-bar__actions">
        {!isProcessing && batchStatus !== 'processing' && (
          <button
            className="btn-primary"
            onClick={onConvertWithFolder}
            disabled={!hasConfig || !hasImage || !outputFolder || batchStatus === 'done'}
          >
            Convert
          </button>
        )}

        {hasImage && outputFolder && !showConflictDialog && !isProcessing && batchStatus !== 'processing' && (
          <button
            className="btn-secondary"
            onClick={onOpenFolder}
          >
            Open Output Folder
          </button>
        )}

        {isProcessing && (
          <button
            className="btn-danger"
            onClick={onAbort}
          >
            Abort
          </button>
        )}
      </div>
    </div>
  );
}

export default memo(StatusBar);
