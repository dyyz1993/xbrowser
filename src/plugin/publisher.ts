import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve, relative, basename, posix } from 'path';
import { createHash } from 'crypto';
import { PluginMetadataParser } from './metadata-parser.js';

export interface AuthConfig {
  token: string;
  registry: string;
}

export interface PublishOptions {
  registry: string;
  token: string;
  dryRun?: boolean;
}

export interface PublishResult {
  name: string;
  version: string;
  slug: string;
  description: string;
  author: string;
  commands: string[];
  tags: string[];
  sites: string[];
  fileCount: number;
  size: number;
  checksum: string;
  formData: FormData;
}

const IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  '.DS_Store',
  'dist',
  '.env',
  '.env.local',
  '*.log',
];

function shouldIgnore(name: string): boolean {
  return IGNORE_PATTERNS.some((pattern) => {
    if (pattern.startsWith('*')) return name.endsWith(pattern.slice(1));
    return name === pattern;
  });
}

function collectFiles(dir: string, base: string = dir): { path: string; content: Buffer }[] {
  const files: { path: string; content: Buffer }[] = [];

  if (!existsSync(dir)) return files;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (shouldIgnore(entry.name)) continue;

    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath, base));
    } else if (entry.isFile()) {
      const relPath = relative(base, fullPath).split('/').join(posix.sep);
      files.push({ path: relPath, content: readFileSync(fullPath) });
    }
  }

  return files;
}

function extractCommandsFromCode(code: string): string[] {
  const commands: string[] = [];
  const commandRegex = /(?:site|plugin)\s*\.\s*command\s*\(\s*['"`]([^'"`]+)['"`]/g;
  let match: RegExpExecArray | null;
  while ((match = commandRegex.exec(code)) !== null) {
    commands.push(match[1]);
  }
  return commands;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/^@[^/]+\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function createTarball(
  pluginDir: string,
  _options: PublishOptions
): Promise<PublishResult> {
  const indexPath = resolve(pluginDir, 'index.ts');
  const pkgPath = resolve(pluginDir, 'package.json');

  if (!existsSync(indexPath)) {
    throw new Error('No index.ts found. A plugin must have an index.ts entry file.');
  }

  let packageJson: Record<string, unknown> = {};
  if (existsSync(pkgPath)) {
    packageJson = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  }

  const xbrowserMeta = (packageJson.xbrowser || {}) as Record<string, unknown>;
  const name = (xbrowserMeta.name as string) || (packageJson.name as string) || basename(pluginDir);
  const version = (xbrowserMeta.version as string) || (packageJson.version as string) || '1.0.0';
  const description = (xbrowserMeta.description as string) || (packageJson.description as string) || '';
  const author = PluginMetadataParser.extractAuthor(packageJson.author);
  const slug = slugify((xbrowserMeta.slug as string) || name);

  if (!description) {
    throw new Error('Plugin must have a description. Add "description" to package.json or xbrowser metadata.');
  }

  const indexCode = readFileSync(indexPath, 'utf-8');
  const detectedCommands = extractCommandsFromCode(indexCode);

  const commands = ((xbrowserMeta.commands as string[]) || detectedCommands.length > 0)
    ? (xbrowserMeta.commands as string[]) || detectedCommands
    : detectedCommands;

  const tags = (xbrowserMeta.tags as string[]) || [];
  const sites = (xbrowserMeta.sites as string[]) || [];

  const files = collectFiles(pluginDir);
  const totalSize = files.reduce((sum, f) => sum + f.content.length, 0);

  const hash = createHash('sha256');
  for (const f of files) {
    hash.update(f.content);
  }
  const checksum = `sha256-${hash.digest('hex').slice(0, 16)}`;

  const formData = new FormData();
  const metadataBlob = new Blob(
    [
      JSON.stringify({
        name,
        slug,
        version,
        description,
        author,
        commands,
        tags,
        sites,
        license: (xbrowserMeta.license as string) || (packageJson.license as string) || 'MIT',
        homepageUrl: (xbrowserMeta.homepage as string) || (packageJson.homepage as string) || null,
        repositoryUrl:
          (xbrowserMeta.repository as string) ||
          ((packageJson.repository as { url?: string })?.url) ||
          null,
        npmPackage: (packageJson.name as string) || null,
      }),
    ],
    { type: 'application/json' }
  );
  formData.append('metadata', metadataBlob, 'metadata.json');

  for (const file of files) {
    const blob = new Blob([new Uint8Array(file.content)]);
    formData.append('files', blob, file.path);
  }

  formData.append('checksum', checksum);

  return {
    name,
    version,
    slug,
    description,
    author,
    commands,
    tags,
    sites,
    fileCount: files.length,
    size: totalSize,
    checksum,
    formData,
  };
}
