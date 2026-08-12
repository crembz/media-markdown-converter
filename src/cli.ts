import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { convertImageToMarkdown } from './services/llm';
import { renderPdfPages } from './pdf-node';

interface CliConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  useApiKey: boolean;
  availableModels: string[];
  outputFolder?: string;
}

interface ConfigFile {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  useApiKey?: boolean;
  availableModels?: string[];
  outputFolder?: string;
}

const PROVIDER_DEFAULTS: Record<string, Omit<ConfigFile, 'apiKey' | 'availableModels' | 'outputFolder'>> = {
  openai: {
    provider: 'openai',
    model: 'gpt-4o',
    baseUrl: 'https://api.openai.com',
    useApiKey: true,
  },
  anthropic: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    baseUrl: 'https://api.anthropic.com',
    useApiKey: true,
  },
  'openai-compatible': {
    provider: 'openai-compatible',
    model: '',
    baseUrl: '',
    useApiKey: true,
  },
  lmstudio: {
    provider: 'lmstudio',
    model: '',
    baseUrl: 'http://localhost:1234/v1',
    useApiKey: false,
  },
  gemini: {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    baseUrl: 'https://generativelanguage.googleapis.com',
    useApiKey: true,
  },
  ollama: {
    provider: 'ollama',
    model: '',
    baseUrl: 'http://localhost:11434',
    useApiKey: false,
  },
  mistral: {
    provider: 'mistral',
    model: 'pixtral-large-latest',
    baseUrl: 'https://api.mistral.ai/v1',
    useApiKey: true,
  },
};

async function loadConfigFile(): Promise<ConfigFile | null> {
  const configPath = path.join(process.cwd(), '.paper-converter.json');
  try {
    const data = await fs.promises.readFile(configPath, 'utf-8');
    return JSON.parse(data) as ConfigFile;
  } catch {
    return null;
  }
}

function isSupportedImage(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tiff', '.tif'].includes(ext);
}

function isPdfFile(filename: string): boolean {
  return path.extname(filename).toLowerCase() === '.pdf';
}

async function loadPages(filePath: string): Promise<string[]> {
  if (isSupportedImage(filePath)) {
    const buffer = await fs.promises.readFile(filePath);
    const base64 = buffer.toString('base64');
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
      '.webp': 'image/webp',
      '.tiff': 'image/tiff',
      '.tif': 'image/tiff',
    };
    const mimeType = mimeTypes[ext] || 'image/png';
    return [`data:${mimeType};base64,${base64}`];
  } else if (isPdfFile(filePath)) {
    return renderPdfPages(filePath);
  } else {
    throw new Error(`Unsupported file type: ${filePath}`);
  }
}

export async function main() {
  const program = new Command();
  program
    .name('paper-converter')
    .description('Convert paper notes (images/PDFs) to markdown using LLM vision models')
    .requiredOption('-f, --files <paths...>', 'Input image/PDF files')
    .requiredOption('-o, --output <dir>', 'Output directory for markdown files')
    .option('-p, --provider <name>', 'LLM provider (openai, anthropic, lmstudio, gemini, ollama, mistral)')
    .option('-m, --model <name>', 'Model name')
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

    if (!isSupportedImage(file) && !isPdfFile(file)) {
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

  const config: CliConfig = {
    provider: opts.provider || configFile?.provider || defaults.provider,
    model: opts.model || configFile?.model || defaults.model,
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
    console.error('Set it with --apiKey or in .paper-converter.json');
    process.exit(1);
  }

  let totalConverted = 0;
  let totalFailed = 0;

  for (const filePath of opts.files) {
    const filename = path.basename(filePath);
    const baseName = path.basename(filePath, path.extname(filePath));
    const outputPath = path.join(outputDir, `${baseName}.md`);

    console.log(`Processing: ${filename}`);

    try {
      const pages = await loadPages(filePath);
      let fullResult = '';

      for (let i = 0; i < pages.length; i++) {
        if (pages.length > 1) {
          console.log(`  Page ${i + 1}/${pages.length}`);
        }

        const pageResult = await convertImageToMarkdown(
          config as never,
          pages[i],
          (chunk) => {
            if (opts.stream) {
              process.stdout.write(chunk);
            }
          },
          new AbortController().signal,
        );

        fullResult += pageResult;

        if (i < pages.length - 1) {
          fullResult += '\n\n---\n\n';
        }
      }

      if (!opts.stream) {
        await fs.promises.writeFile(outputPath, fullResult, 'utf-8');
        console.log(`  Saved to: ${outputPath}`);
      } else {
        console.log();
      }

      totalConverted++;
    } catch (err: unknown) {
      console.error(`  Error: ${(err as Error).message}`);
      totalFailed++;
    }
  }

  console.log(`\nDone! ${totalConverted} converted, ${totalFailed} failed.`);
}
