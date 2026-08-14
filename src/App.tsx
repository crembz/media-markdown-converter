import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppConfig, loadConfig, saveConfig } from './services/config';
import { convertImageToMarkdown, convertAudioToMarkdown, mergeUsage, UsageInfo } from './services/llm';
import { renderPdfPages } from './utils/pdf';
import { getFileKind, getAudioMimeType, type FileKind } from './utils/fileKind';
import { PAGE_SEPARATOR, stripExtension, timestampedMarkdownName } from './utils/markdown';
import type { BatchFile, MediaFileType } from './types';
import ImageUploader from './components/ImageUploader';
import ImagePreview from './components/ImagePreview';
import StatusBar from './components/StatusBar';
import ConfigPanel from './components/ConfigPanel';
import LiveOutputPanel from './components/LiveOutputPanel';
import BatchFileList from './components/BatchFileList';

type ConflictStrategy = 'rename' | 'overwrite' | 'skip';

/**
 * One file to convert. The batch and single-file flows used to run two
 * near-identical ~100-line loops; both now describe their work as jobs and
 * share one loop. `loadPages` is deferred so batch entries are only read from
 * disk when their turn comes.
 */
interface ConversionJob {
  filename: string;
  kind: FileKind;
  /** Index into batchFiles, so the list can highlight the current file. */
  index: number;
  loadPages: () => Promise<string[]>;
  /** Set for batch entries, which are read from disk; undefined for a file
   *  dropped straight into the window. Lets long audio be split by path. */
  sourcePath?: string;
}

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [convertingPage, setConvertingPage] = useState<{ current: number; total: number } | null>(null);
  const [batchFiles, setBatchFiles] = useState<Array<BatchFile | null>>([]);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [batchStatus, setBatchStatus] = useState<'idle' | 'processing' | 'done' | 'error'>('idle');
  const [filesConverted, setFilesConverted] = useState(0);
  const [filesSkipped, setFilesSkipped] = useState(0);
  const [filesFailed, setFilesFailed] = useState(0);
  const outputFolder = config?.outputFolder || null;
  const [currentFilename, setCurrentFilename] = useState<string | null>(null);
  const [existingFiles, setExistingFiles] = useState<string[]>([]);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [liveOutput, setLiveOutput] = useState('');
  const [usageInfo, setUsageInfo] = useState<UsageInfo | null>(null);

  // Read (not subscribed to) inside handleConvert, which the conflict dialog
  // calls immediately after setting them — state wouldn't be visible yet.
  // conflictStrategy is a ref only: it was previously mirrored from state that
  // nothing ever set to a non-null value, so the mirroring effect never fired
  // and the ref kept the previous run's strategy forever.
  const conflictStrategyRef = useRef<ConflictStrategy | null>(null);
  const existingFilesRef = useRef(existingFiles);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Streamed deltas are coalesced and flushed once per animation frame.
  // Applying every chunk immediately re-rendered the whole app per token.
  const pendingChunksRef = useRef('');
  const flushHandleRef = useRef<number | null>(null);

  const cancelPendingChunks = useCallback(() => {
    if (flushHandleRef.current !== null) {
      cancelAnimationFrame(flushHandleRef.current);
      flushHandleRef.current = null;
    }
    pendingChunksRef.current = '';
  }, []);

  const handleStreamChunk = useCallback((chunk: string) => {
    pendingChunksRef.current += chunk;
    if (flushHandleRef.current !== null) return;

    flushHandleRef.current = requestAnimationFrame(() => {
      flushHandleRef.current = null;
      const pending = pendingChunksRef.current;
      pendingChunksRef.current = '';
      if (pending) setLiveOutput((prev) => prev + pending);
    });
  }, []);

  /**
   * Replaces the live output with an authoritative value (end of page, end of
   * file, or a reset). Drops any queued deltas first — otherwise a pending
   * flush could land afterwards and re-append text already included here.
   */
  const setLiveOutputNow = useCallback((text: string) => {
    cancelPendingChunks();
    setLiveOutput(text);
  }, [cancelPendingChunks]);

  useEffect(() => cancelPendingChunks, [cancelPendingChunks]);

  // Accumulates usage across every request the current file's conversion
  // makes (e.g. one per page for a multi-page PDF) so the total shown
  // reflects the whole file, not just the last page.
  const handleUsage = useCallback((usage: UsageInfo) => {
    setUsageInfo(prev => mergeUsage(prev ?? undefined, usage) ?? null);
  }, []);

  // Audio files aren't paginated (convertingPage is otherwise always {1, 1}
  // for them), but a long recording sent through OpenRouter does get split
  // into several sequential chunks — reusing convertingPage's {current,
  // total} shape for that lets the same progress UI show real progress
  // ("chunk 2 of 5") instead of a meaningless "page 1 of 1".
  const handleAudioProgress = useCallback((current: number, total: number) => {
    setConvertingPage({ current, total });
  }, []);

  useEffect(() => {
    existingFilesRef.current = existingFiles;
  }, [existingFiles]);

  useEffect(() => {
    loadConfig().then(setConfig);
  }, []);

  useEffect(() => {
    if (typeof window.electronAPI === 'undefined') return;

    window.electronAPI.isMaximized().then(setIsMaximized);

    const unsubscribe = window.electronAPI.onWindowStateChanged((data) => {
      setIsMaximized(data.maximized);
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  // Shared by every "new input arrived" handler; they previously repeated
  // these eleven setters almost verbatim.
  const resetConversionState = useCallback(() => {
    setCurrentPage(0);
    setError(null);
    setConvertingPage(null);
    setBatchStatus('idle');
    setFilesConverted(0);
    setFilesSkipped(0);
    setFilesFailed(0);
    setUsageInfo(null);
    setLiveOutputNow('');
    conflictStrategyRef.current = null;
    setExistingFiles([]);
    setShowConflictDialog(false);
  }, [setLiveOutputNow]);

  const handleSingleFileLoaded = useCallback((loadedPages: string[], filename: string) => {
    resetConversionState();
    setPages(loadedPages);
    setBatchFiles([]);
    setCurrentFilename(filename);
  }, [resetConversionState]);

  const handleImageLoaded = useCallback((dataUri: string, filename: string) => {
    handleSingleFileLoaded([dataUri], filename);
  }, [handleSingleFileLoaded]);

  const handlePdfLoaded = useCallback((pdfPages: string[], filename: string) => {
    handleSingleFileLoaded(pdfPages, filename);
  }, [handleSingleFileLoaded]);

  const handleAudioLoaded = useCallback((dataUri: string, filename: string) => {
    handleSingleFileLoaded([dataUri], filename);
  }, [handleSingleFileLoaded]);

  const handleFilesSelected = useCallback((files: BatchFile[]) => {
    resetConversionState();
    setPages([]);
    setBatchFiles(files);
    setCurrentFileIndex(0);
    setCurrentFilename(null);
  }, [resetConversionState]);

  const handleRemoveImage = useCallback(() => {
    resetConversionState();
    setPages([]);
    setBatchFiles([]);
    setCurrentFilename(null);
  }, [resetConversionState]);

  const loadPagesFromPath = useCallback(async (filePath: string, fileType: MediaFileType): Promise<string[]> => {
    // Returning [] here made a pathless entry look like a zero-page document:
    // the conversion loop did nothing and the file was neither written nor
    // reported. Fail loudly instead — callers already handle the rejection.
    if (!filePath) {
      throw new Error('This file has no readable path. Load it again with "Browse Files".');
    }

    if (fileType === 'pdf') {
      // Raw bytes straight into pdfjs. This used to come back as a base64
      // data URI that was decoded here with a per-character loop and wrapped
      // in a File — an extra encode, decode and copy of the whole document.
      const bytes = await window.electronAPI.readFileBytes(filePath);
      return renderPdfPages(bytes);
    }

    return [await window.electronAPI.readFileAsBase64(filePath)];
  }, []);

  const handleConvert = useCallback(async () => {
    if (!config || !outputFolder) return;

    abortControllerRef.current?.abort();

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const strategy = conflictStrategyRef.current;
    const existing = existingFilesRef.current;
    // Tracked locally rather than read back from filesFailed state, since
    // state updates aren't visible synchronously within this same closure.
    let hadFailure = false;

    const jobs: ConversionJob[] = batchFiles.length > 0
      ? batchFiles.flatMap((file, index) => (file
        ? [{
          filename: file.filename,
          kind: (file.fileType === 'audio' ? 'audio' : 'document') as FileKind,
          index,
          loadPages: () => loadPagesFromPath(file.filePath, file.fileType),
          sourcePath: file.filePath,
        }]
        : []))
      : currentFilename
        ? [{
          filename: currentFilename,
          kind: getFileKind(currentFilename),
          index: 0,
          loadPages: async () => pages,
        }]
        : [];

    setIsProcessing(true);
    setError(null);
    setBatchStatus('processing');
    setFilesConverted(0);
    setFilesSkipped(0);
    setFilesFailed(0);
    setLiveOutputNow('');

    try {
      for (const job of jobs) {
        if (abortController.signal.aborted) break;

        const baseName = stripExtension(job.filename);
        const mdName = `${baseName}.md`;

        if (strategy === 'skip' && existing.includes(mdName)) {
          setFilesSkipped((prev) => prev + 1);
          continue;
        }

        setCurrentFileIndex(job.index);

        try {
          const jobPages = await job.loadPages();
          setConvertingPage({ current: 1, total: jobPages.length });
          setUsageInfo(null);
          // Each file's live output stands alone, so clear the previous
          // file's text rather than streaming this one onto the end of it.
          setLiveOutputNow('');

          let result = '';

          if (job.kind === 'audio') {
            result = await convertAudioToMarkdown(
              config,
              jobPages[0],
              getAudioMimeType(job.filename),
              handleStreamChunk,
              abortController.signal,
              handleUsage,
              handleAudioProgress,
              job.sourcePath,
            );
            setLiveOutputNow(result);
          } else {
            // One request per page, deliberately — sending a whole document at
            // once would exhaust a local model's context. Do not batch these.
            for (let p = 0; p < jobPages.length; p++) {
              if (abortController.signal.aborted) break;

              setConvertingPage({ current: p + 1, total: jobPages.length });

              result += await convertImageToMarkdown(
                config,
                jobPages[p],
                handleStreamChunk,
                abortController.signal,
                handleUsage,
              );

              if (p < jobPages.length - 1) result += PAGE_SEPARATOR;

              setLiveOutputNow(result);
            }
          }

          if (abortController.signal.aborted) break;

          // An empty result used to fall through every branch: not written,
          // not counted as converted, not counted as failed — the file simply
          // vanished from the summary. Treat it as a failure instead.
          if (!result) {
            throw new Error(`No text was produced for ${job.filename}`);
          }

          const targetName = strategy === 'rename' && existing.includes(mdName)
            ? timestampedMarkdownName(baseName)
            : mdName;

          // Always awaited inside this try/catch: a failed write must land in
          // filesFailed, never silently count as converted.
          await window.electronAPI.writeFile(`${outputFolder}/${targetName}`, result);
          setFilesConverted((prev) => prev + 1);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'An unknown error occurred';
          console.error(`Failed to convert ${job.filename}:`, err);
          setError(message);
          setFilesFailed((prev) => prev + 1);
          hadFailure = true;
        }
      }

      if (abortController.signal.aborted) {
        setBatchStatus('error');
      } else {
        // A failure shouldn't leave the Convert button permanently disabled
        // (batchStatus === 'done' disables it) — falling back to 'error' lets
        // the user retry immediately instead of reloading the file(s).
        setBatchStatus(hadFailure ? 'error' : 'done');
        conflictStrategyRef.current = null;
        setExistingFiles([]);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unknown error occurred';
      if (message !== 'The operation was aborted') {
        setError(message);
        setBatchStatus('error');
      }
    } finally {
      setIsProcessing(false);
      setConvertingPage(null);
      abortControllerRef.current = null;
    }
  }, [
    config, pages, batchFiles, outputFolder, currentFilename, loadPagesFromPath,
    handleStreamChunk, handleUsage, handleAudioProgress, setLiveOutputNow,
  ]);

  const handleAbort = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const handleOpenFolder = useCallback(async () => {
    if (!outputFolder) return;
    try {
      await window.electronAPI.openFolder(outputFolder);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to open output folder');
    }
  }, [outputFolder]);

  const handleConvertWithFolder = useCallback(async () => {
    if (typeof window.electronAPI === 'undefined') return;
    if (!outputFolder) return;

    const targetFiles = batchFiles.length > 0
      ? batchFiles.flatMap((f) => (f ? [`${stripExtension(f.filename)}.md`] : []))
      : currentFilename ? [`${stripExtension(currentFilename)}.md`] : [];

    const existing: string[] = [];
    for (const filename of targetFiles) {
      if (await window.electronAPI.fileExists(`${outputFolder}/${filename}`)) {
        existing.push(filename);
      }
    }

    if (existing.length > 0) {
      setExistingFiles(existing);
      setShowConflictDialog(true);
      return;
    }

    await handleConvert();
  }, [outputFolder, batchFiles, currentFilename, handleConvert]);

  const handleConfigSaved = useCallback(async (savedConfig: AppConfig) => {
    try {
      await saveConfig(savedConfig);
      setConfig(savedConfig);
      setShowConfig(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save configuration');
    }
  }, []);

  const handleSelectBatchFile = useCallback(async (index: number) => {
    const file = batchFiles[index];
    if (!file) return;

    setCurrentFileIndex(index);
    try {
      const loaded = await loadPagesFromPath(file.filePath, file.fileType);
      setPages(loaded);
      setCurrentPage(0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load file preview');
    }
  }, [batchFiles, loadPagesFromPath]);

  const dismissConflictDialog = useCallback(() => {
    setShowConflictDialog(false);
    conflictStrategyRef.current = null;
    setExistingFiles([]);
  }, []);

  const startWithStrategy = useCallback((strategy: ConflictStrategy) => {
    conflictStrategyRef.current = strategy;
    setShowConflictDialog(false);
    void handleConvert();
  }, [handleConvert]);

  const hasPages = pages.length > 0;
  const hasBatchFiles = batchFiles.length > 0;
  const currentImage = hasPages ? pages[currentPage] ?? pages[0]! : null;
  const isMac = typeof window.electronAPI !== 'undefined' && window.electronAPI.platform === 'darwin';
  const validFileCount = useMemo(
    () => batchFiles.reduce((n, file) => (file ? n + 1 : n), 0),
    [batchFiles],
  );

  // Which model is/will be used for whatever's currently loaded — audio
  // files use the separate audioModel (falling back to model, matching
  // convertAudioToMarkdown's own fallback), everything else uses model.
  const currentFileKind = hasBatchFiles
    ? batchFiles[currentFileIndex]?.fileType ?? null
    : currentFilename ? getFileKind(currentFilename) : null;
  const isAudio = currentFileKind === 'audio';
  const activeModel = config
    ? (isAudio ? (config.audioModel || config.model) : config.model)
    : null;

  // The panel stays up after a successful run so the result can be read and
  // copied, and is torn down only when new input arrives — every "file
  // loaded" handler runs resetConversionState, which puts batchStatus back to
  // 'idle'. A run that produced no text (everything skipped) has nothing to
  // show, so it doesn't linger. A failed run isn't held open either: the
  // status bar carries the error, and the Convert button stays enabled.
  const showLiveOutput = batchStatus === 'processing'
    || (batchStatus === 'done' && liveOutput.length > 0);

  // Rendered once and placed into either layout below. Both branches used to
  // carry their own full copy of this tree.
  const mainContent = hasBatchFiles ? (
    <BatchFileList
      files={batchFiles}
      currentIndex={currentFileIndex}
      showClear={!hasPages && !pdfLoading}
      onSelect={handleSelectBatchFile}
      onClear={handleRemoveImage}
    />
  ) : (!hasPages || pdfLoading) ? (
    <ImageUploader
      onImageSelect={handleImageLoaded}
      onPdfSelect={handlePdfLoaded}
      onAudioSelect={handleAudioLoaded}
      onFilesSelected={handleFilesSelected}
      onLoadingState={setPdfLoading}
      onError={setError}
    />
  ) : (
    <ImagePreview
      image={currentImage!}
      onReplace={handleRemoveImage}
      totalPages={pages.length}
      currentPage={currentPage}
      onPageChange={setCurrentPage}
    />
  );

  return (
    <div className="container">
      <div className={`top-bar ${isMac ? 'top-bar--mac' : ''}`}>
        <h1>Media → Markdown Converter</h1>
        <div className="top-bar__controls">
          <button className="btn-secondary" onClick={() => setShowConfig(true)}>
            Settings
          </button>
          {!isMac && (
            <div className="window-controls">
              <button className="window-controls__btn window-controls__btn--minimize" onClick={() => window.electronAPI.minimizeWindow()}>
                <svg width="12" height="12" viewBox="0 0 12 12"><line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1.5"/></svg>
              </button>
              <button className="window-controls__btn window-controls__btn--maximize" onClick={() => window.electronAPI.maximizeWindow()}>
                {isMaximized ? (
                  <svg width="12" height="12" viewBox="0 0 12 12"><rect x="3" y="3" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.5"/><line x1="3" y1="7" x2="9" y2="7" stroke="currentColor" strokeWidth="1.5"/><line x1="9" y1="3" x2="9" y2="7" stroke="currentColor" strokeWidth="1.5"/></svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
                )}
              </button>
              <button className="window-controls__btn window-controls__btn--close" onClick={() => window.electronAPI.closeWindow()}>
                <svg width="12" height="12" viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="1.5"/><line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="1.5"/></svg>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="main-panel">
        {showLiveOutput ? (
          <div className="main-panel__split">
            <div className="main-panel__content">{mainContent}</div>
            <LiveOutputPanel
              currentFile={batchFiles[currentFileIndex]?.filename ?? (currentFilename ?? 'document')}
              currentFileIndex={currentFileIndex}
              totalFiles={validFileCount}
              convertingPage={convertingPage}
              isAudio={isAudio}
              output={liveOutput}
              isComplete={batchStatus === 'done'}
            />
          </div>
        ) : (
          <div className="main-panel__content">{mainContent}</div>
        )}
      </div>

      <StatusBar
        isProcessing={isProcessing}
        error={error}
        hasImage={hasPages || hasBatchFiles}
        hasConfig={!!config}
        convertingPage={convertingPage}
        isAudio={isAudio}
        batchStatus={batchStatus}
        totalFiles={validFileCount}
        filesConverted={filesConverted}
        filesSkipped={filesSkipped}
        filesFailed={filesFailed}
        outputFolder={outputFolder}
        showConflictDialog={showConflictDialog}
        activeModel={activeModel}
        usageInfo={usageInfo}
        onConvert={handleConvert}
        onAbort={handleAbort}
        onConvertWithFolder={handleConvertWithFolder}
        onOpenFolder={handleOpenFolder}
      />

      {showConfig && (
        <ConfigPanel
          config={config}
          onSave={handleConfigSaved}
          onClose={() => setShowConfig(false)}
        />
      )}

      {showConflictDialog && (
        <div className="overlay" onClick={dismissConflictDialog}>
          <div className="modal conflict-dialog" onClick={(e) => e.stopPropagation()}>
            <h2 className="conflict-dialog__title">Existing files found</h2>
            <p className="conflict-dialog__text">
              The following files already exist in the output folder:
            </p>
            <ul className="conflict-dialog__list">
              {existingFiles.map(f => (
                <li key={f} className="conflict-dialog__file">{f}</li>
              ))}
            </ul>
            <p className="conflict-dialog__question">How would you like to proceed?</p>
            <div className="conflict-dialog__actions">
              <button className="btn-secondary" onClick={() => startWithStrategy('skip')}>
                Skip existing files
              </button>
              <button className="btn-primary" onClick={() => startWithStrategy('overwrite')}>
                Overwrite existing
              </button>
              <button className="btn-secondary" onClick={() => startWithStrategy('rename')}>
                Rename &amp; process
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
