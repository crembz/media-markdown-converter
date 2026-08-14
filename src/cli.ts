import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { convertImageToMarkdown, convertAudioToMarkdown } from './services/llm';
import { renderPdfPages } from './pdf-node';
import { isAudioFile, isImageFile, isPdfFile, getFileKind, getAudioMimeType, mimeTypeForPath } from './utils/fileKind';
import { PROVIDER_DEFAULTS } from './services/providerDefaults';
import type { AppConfig } from './types';

// The on-disk .media-markdown-converter.json shape — everything optional, so
// it stays distinct from AppConfig (the resolved config the LLM layer takes).
interface ConfigFile {
  provider?: string;
  model?: string;
  audioModel?: string;
  apiKey?: string;
  baseUrl?: string;
  useApiKey?: boolean;
  availableModels?: string[];
  outputFolder?: string;
}

async function loadConfigFile(): Promise<ConfigFile | null> {
  const configPath = path.join(process.cwd(), '.media-markdown-converter.json');
  try {
    const data = await fs.promises.readFile(configPath, 'utf-8');
    return JSON.parse(data) as ConfigFile;
  } catch {
    return null;
  }
}

async function loadPages(filePath: string): Promise<string[]> {
  if (isImageFile(filePath)) {
    const buffer = await fs.promises.readFile(filePath);
    const base64 = buffer.toString('base64');
    return [`data:${mimeTypeForPath(filePath)};base64,${base64}`];
  } else if (isPdfFile(filePath)) {
    return renderPdfPages(filePath);
  } else if (isAudioFile(filePath)) {
    const buffer = await fs.promises.readFile(filePath);
    const base64 = buffer.toString('base64');
    return [`data:${getAudioMimeType(filePath)};base64,${base64}`];
  } else {
    throw new Error(`Unsupported file type: ${filePath}`);
  }
}

export async function main() {
  const program = new Command();
  program
    .name('media-markdown-converter')
    .description('Convert paper notes (images/PDFs) and audio recordings to markdown using LLM vision/audio models')
    .requiredOption('-f, --files <paths...>', 'Input image/PDF files')
    .requiredOption('-o, --output <dir>', 'Output directory for markdown files')
    .option('-p, --provider <name>', 'LLM provider (openai, anthropic, lmstudio, gemini, ollama, mistral, openrouter)')
    .option('-m, --model <name>', 'Model name')
    .option('--audioModel <name>', 'Model name for audio transcription (openai, gemini, mistral, openrouter only)')
    .option('-k, --apiKey <key>', 'API key')
    .option('-b, --baseUrl <url>', 'API base URL')
    .option('--stream', 'Stream output to stdout')
    .option('--dry-run', 'Validate config without converting')
    .parse();

  const opts = program.opts();

  for (const file of opts.files) {
    if (!fs.existsSync(file)) {
      console.error(`Error: File not found: ${file}`);
      process.exit(1);
    }

    if (!isImageFile(file) && !isPdfFile(file) && !isAudioFile(file)) {
      console.error(`Error: Unsupported file type: ${file}`);
      process.exit(1);
    }
  }

  const outputDir = path.resolve(opts.output);
  try {
    await fs.promises.mkdir(outputDir, { recursive: true });
  } catch (err: unknown) {
    console.error(`Error creating output directory: ${(err as Error).message}`);
    process.exit(1);
  }

  const configFile = await loadConfigFile();

  const provider = opts.provider || configFile?.provider || 'openai';
  const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS['openai-compatible'];

  const configUseApiKey: boolean = opts.apiKey !== undefined
    ? true
    : (configFile?.useApiKey ?? defaults.useApiKey) ?? true;

  // Typed as the real AppConfig rather than a CLI-local look-alike, so the
  // calls below no longer need `as never` to reach the LLM layer.
  const config: AppConfig = {
    provider: (opts.provider || configFile?.provider || defaults.provider) as AppConfig['provider'],
    model: opts.model || configFile?.model || defaults.model,
    audioModel: opts.audioModel || configFile?.audioModel || defaults.audioModel,
    apiKey: opts.apiKey || configFile?.apiKey || '',
    baseUrl: opts.baseUrl || configFile?.baseUrl || defaults.baseUrl,
    useApiKey: configUseApiKey,
    availableModels: [],
    outputFolder: outputDir,
  };

  if (opts.dryRun) {
    console.log('Config validated successfully:');
    console.log(`  Provider: ${config.provider}`);
    console.log(`  Model: ${config.model}`);
    console.log(`  Base URL: ${config.baseUrl || '(default)'}`);
    if (config.useApiKey) {
      console.log(`  API Key: ${config.apiKey ? '*** (configured)' : '(not set - will be required at runtime)'}`);
    } else {
      console.log('  API Key: (not required for this provider)');
    }
    console.log(`  Output: ${outputDir}`);
    return;
  }

  if (config.useApiKey && !config.apiKey) {
    console.error('Error: API key is required for this provider.');
    console.error('Set it with --apiKey or in .media-markdown-converter.json');
    process.exit(1);
  }

  let totalConverted = 0;
  let totalFailed = 0;

  // One controller for the whole run, so Ctrl-C actually cancels the in-flight
  // request. Previously every call got `new AbortController().signal`, which
  // nothing could ever abort, leaving SIGINT to kill the process mid-write.
  const abortController = new AbortController();
  let interrupted = false;
  const onInterrupt = () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    console.error('\nInterrupted — finishing the current request. Press Ctrl-C again to force quit.');
    abortController.abort();
  };
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onInterrupt);

  const onChunk = (chunk: string) => {
    if (opts.stream) process.stdout.write(chunk);
  };

  for (const filePath of opts.files) {
    if (interrupted) break;

    const filename = path.basename(filePath);
    const baseName = path.basename(filePath, path.extname(filePath));
    const outputPath = path.join(outputDir, `${baseName}.md`);

    console.log(`Processing: ${filename}`);

    try {
      const pages = await loadPages(filePath);
      let fullResult = '';

      if (getFileKind(filePath) === 'audio') {
        fullResult = await convertAudioToMarkdown(
          config,
          pages[0],
          getAudioMimeType(filePath),
          onChunk,
          abortController.signal,
        );
      } else {
        // One request per page, deliberately — a whole document in a single
        // request would blow a local model's context. Do not batch these.
        for (let i = 0; i < pages.length; i++) {
          if (pages.length > 1) {
            console.log(`  Page ${i + 1}/${pages.length}`);
          }

          const pageResult = await convertImageToMarkdown(
            config,
            pages[i],
            onChunk,
            abortController.signal,
          );

          fullResult += pageResult;

          if (i < pages.length - 1) {
            fullResult += '\n\n---\n\n';
          }
        }
      }

      // --stream is about echoing progress to stdout; it used to also silently
      // discard the output file, so a long transcription could scroll past and
      // be gone. Always write, whether or not it was streamed.
      if (opts.stream) console.log();
      await fs.promises.writeFile(outputPath, fullResult, 'utf-8');
      console.log(`  Saved to: ${outputPath}`);

      totalConverted++;
    } catch (err: unknown) {
      console.error(`  Error: ${(err as Error).message}`);
      totalFailed++;
    }
  }

  // Via the emitter interface: Electron's typings augment `process` with a
  // narrower off() overload that only accepts its own 'loaded' event.
  const emitter = process as NodeJS.EventEmitter;
  emitter.off('SIGINT', onInterrupt);
  emitter.off('SIGTERM', onInterrupt);

  console.log(`\nDone! ${totalConverted} converted, ${totalFailed} failed.`);
  if (interrupted) process.exitCode = 130;
  else if (totalFailed > 0) process.exitCode = 1;
}
