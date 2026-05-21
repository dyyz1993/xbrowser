import { existsSync, readdirSync, readFileSync } from 'fs';
import { resolve, relative, basename, posix } from 'path';
import { createHash } from 'crypto';
import { gzipSync } from 'zlib';
import { PluginMetadataParser } from './metadata-parser.js';
import { NPM_REGISTRY_URL } from '../config.js';
import { readJsonFile } from '../utils/json-file.js';
import { ensureProxyFetch } from '../utils/proxy-fetch.js';

/**
 * Authentication configuration for publishing to a registry.
 */
export interface AuthConfig {
  token: string;
  registry: string;
}

export type StorageType = 'npm' | 'r2';

/**
 * Options for publishing a plugin.
 */
export interface PublishOptions {
  registry: string;
  token: string;
  dryRun?: boolean;
  storage?: StorageType;
}

export interface CommandDocParam {
  name: string;
  type: string;
  description: string;
  required: boolean;
  default?: unknown;
}

export interface CommandDocExample {
  cmd: string;
  description: string;
}

export interface CommandDoc {
  name: string;
  description: string;
  parameters: CommandDocParam[];
  examples?: CommandDocExample[];
}

/**
 * Result of creating a plugin tarball for publishing.
 */
export interface PublishResult {
  name: string;
  version: string;
  slug: string;
  description: string;
  author: string;
  commands: string[];
  commandsDocs: CommandDoc[];
  readme: string | null;
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

function extractCommandDocsFromCode(code: string): CommandDoc[] {
  const docs: CommandDoc[] = [];

  const commandStartRegex = /\b\w+\s*\.\s*command\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*\{/g;

  let startMatch: RegExpExecArray | null;
  while ((startMatch = commandStartRegex.exec(code)) !== null) {
    const cmdName = startMatch[1];
    const startPos = startMatch.index + startMatch[0].length;

    const header = extractCommandHeader(code, startPos);

    const descMatch = header.match(/description\s*:\s*['"`]([\s\S]*?)['"`]/);
    const description = descMatch ? descMatch[1].trim() : '';

    const parameters = extractParameters(header);

    const examples = extractExamples(header);

    docs.push({
      name: cmdName,
      description,
      parameters,
      examples: examples.length > 0 ? examples : undefined,
    });
  }

  return docs;
}

function extractCommandHeader(code: string, startPos: number): string {
  let depth = 1;
  let i = startPos;
  while (i < code.length && depth > 0) {
    const ch = code[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) break;
    }
    i++;
  }

  const fullBlock = code.slice(startPos, i);

  const handlerIdx = fullBlock.search(/\bhandler\s*:/);
  if (handlerIdx !== -1) {
    return fullBlock.slice(0, handlerIdx);
  }

  return fullBlock;
}

function extractParameters(block: string): CommandDocParam[] {
  const params: CommandDocParam[] = [];

  const zodObjectRegex = /z\.object\s*\(\s*\{([\s\S]*?)\}\s*\)/;
  const objMatch = block.match(zodObjectRegex);
  if (!objMatch) return params;

  const objBody = objMatch[1];

  const normalized = objBody
    .replace(/\n\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/z\s*\.\s*/g, 'z.');

  const fieldRegex = /(\w+)\s*:\s*z\.(\w+)([^(]*)/g;
  let fieldMatch: RegExpExecArray | null;

  while ((fieldMatch = fieldRegex.exec(normalized)) !== null) {
    const pName = fieldMatch[1];
    const zType = fieldMatch[2];
    const restStart = fieldMatch.index + fieldMatch[0].length;

    let rest = '';
    let depth = 0;
    let j = restStart;
    while (j < normalized.length) {
      if (normalized[j] === '(') depth++;
      else if (normalized[j] === ')') {
        if (depth === 0) break;
        depth--;
      } else if (depth === 0 && (normalized[j] === ',' || normalized[j] === '}')) {
        break;
      }
      rest += normalized[j];
      j++;
    }

    const isOptional = rest.includes('.optional()');

    const defaultMatch = rest.match(/\.default\s*\(\s*([^)]+)\s*\)/);
    let defaultValue: unknown = undefined;
    if (defaultMatch) {
      const raw = defaultMatch[1].trim();
      if (raw === 'true') defaultValue = true;
      else if (raw === 'false') defaultValue = false;
      else if (raw.startsWith("'") || raw.startsWith('"')) defaultValue = raw.slice(1, -1);
      else if (!isNaN(Number(raw))) defaultValue = Number(raw);
      else defaultValue = raw;
    }

    const descMatch = rest.match(/\.describe\s*\(\s*['"`]([\s\S]*?)['"`]\s*\)/);
    const pDesc = descMatch ? descMatch[1].trim() : '';

    let pType = zType;
    const enumMatch = rest.match(/\.enum\s*\(\s*\[([^\]]+)\]\s*\)/);
    if (enumMatch) {
      pType = `enum: ${enumMatch[1].trim()}`;
    }

    params.push({
      name: pName,
      type: pType,
      description: pDesc,
      required: !isOptional,
      ...(defaultValue !== undefined ? { default: defaultValue } : {}),
    });
  }

  return params;
}

function extractExamples(block: string): CommandDocExample[] {
  const examples: CommandDocExample[] = [];

  const examplesRegex = /examples\s*:\s*\[([\s\S]*?)\]\s*,?\s*(?:result|handler|\}\s*\)|$)/;
  const exMatch = block.match(examplesRegex);
  if (!exMatch) {
    const fallbackRegex = /examples\s*:\s*\[([\s\S]*?)\]\s*[,}\n]/;
    const fbMatch = block.match(fallbackRegex);
    if (!fbMatch) return examples;

    const exBody = fbMatch[1];
    const objRegex = /\{\s*cmd\s*:\s*'([^']+)'\s*,\s*description\s*:\s*'([^']+)'\s*\}/g;
    let objMatch: RegExpExecArray | null;
    while ((objMatch = objRegex.exec(exBody)) !== null) {
      examples.push({ cmd: objMatch[1], description: objMatch[2].trim() });
    }
    if (examples.length === 0) {
      const objRegex2 = /\{\s*cmd\s*:\s*"([^"]+)"\s*,\s*description\s*:\s*"([^"]+)"\s*\}/g;
      let objMatch2: RegExpExecArray | null;
      while ((objMatch2 = objRegex2.exec(exBody)) !== null) {
        examples.push({ cmd: objMatch2[1], description: objMatch2[2].trim() });
      }
    }
    return examples;
  }

  const exBody2 = exMatch[1];
  const objRegex = /\{\s*cmd\s*:\s*'([^']+)'\s*,\s*description\s*:\s*'([^']+)'\s*\}/g;
  let objMatch: RegExpExecArray | null;
  while ((objMatch = objRegex.exec(exBody2)) !== null) {
    examples.push({ cmd: objMatch[1], description: objMatch[2].trim() });
  }
  if (examples.length === 0) {
    const objRegex2 = /\{\s*cmd\s*:\s*"([^"]+)"\s*,\s*description\s*:\s*"([^"]+)"\s*\}/g;
    let objMatch2: RegExpExecArray | null;
    while ((objMatch2 = objRegex2.exec(exBody2)) !== null) {
      examples.push({ cmd: objMatch2[1], description: objMatch2[2].trim() });
    }
  }

  return examples;
}

function readReadme(pluginDir: string): string | null {
  const candidates = ['README.md', 'readme.md', 'Readme.md'];
  for (const name of candidates) {
    const path = resolve(pluginDir, name);
    if (existsSync(path)) {
      return readFileSync(path, 'utf-8');
    }
  }
  return null;
}

const SITE_TAG_MAP: Record<string, string[]> = {
  'baidu.com': ['baidu', 'search-engine'],
  'google.com': ['google', 'search-engine'],
  'bing.com': ['bing', 'search-engine'],
  'douyin.com': ['douyin', 'social-media', 'video'],
  'tiktok.com': ['tiktok', 'social-media', 'video'],
  'instagram.com': ['instagram', 'social-media', 'photo'],
  'twitter.com': ['twitter', 'social-media'],
  'x.com': ['twitter', 'social-media'],
  'facebook.com': ['facebook', 'social-media'],
  'weibo.com': ['weibo', 'social-media'],
  'zhihu.com': ['zhihu', 'q&a', 'knowledge'],
  'xiaohongshu.com': ['xiaohongshu', 'social-media', 'lifestyle'],
  'csdn.net': ['csdn', 'developer', 'knowledge'],
  'juejin.cn': ['juejin', 'developer'],
  'github.com': ['github', 'developer', 'code'],
  'reddit.com': ['reddit', 'social-media', 'forum'],
  'medium.com': ['medium', 'blog', 'knowledge'],
  'taobao.com': ['taobao', 'e-commerce'],
  'jd.com': ['jd', 'e-commerce'],
  'pinterest.com': ['pinterest', 'social-media', 'photo'],
  'youtube.com': ['youtube', 'video', 'social-media'],
  'bilibili.com': ['bilibili', 'video', 'social-media'],
};

function extractTagsFromCode(code: string, existingTags: string[]): string[] {
  const tags = new Set(existingTags);

  const urlMatch = code.match(/url\s*:\s*['"`](https?:\/\/[^'"`]+)['"`]/);
  if (urlMatch) {
    try {
      const hostname = new URL(urlMatch[1]).hostname.replace(/^www\./, '');
      const mapped = SITE_TAG_MAP[hostname];
      if (mapped) {
        for (const tag of mapped) tags.add(tag);
      } else {
        const domain = hostname.split('.')[0];
        tags.add(domain);
      }
    } catch {
      // invalid URL, skip
    }
  }

  const nameMatch = code.match(/name\s*:\s*['"`]([^'"`]+)['"`]/);
  if (nameMatch && !tags.has(nameMatch[1])) {
    tags.add(nameMatch[1]);
  }

  return Array.from(tags);
}

function extractSitesFromCode(code: string, existingSites: string[]): string[] {
  const sites = new Set(existingSites);

  const urlMatch = code.match(/url\s*:\s*['"`](https?:\/\/[^'"`]+)['"`]/);
  if (urlMatch) {
    try {
      const hostname = new URL(urlMatch[1]).hostname.replace(/^www\./, '');
      sites.add(hostname);
    } catch {
      // invalid URL, skip
    }
  }

  return Array.from(sites);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/^@[^/]+\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function validateNpmPackageExists(packageName: string, version: string): Promise<void> {
  await ensureProxyFetch();
  const encodedName = encodeURIComponent(packageName);
  const res = await fetch(`${NPM_REGISTRY_URL}/${encodedName}/${version}`);
  if (!res.ok) {
    throw new Error(
      `Package ${packageName}@${version} not found on npm. ` +
        `Publish to npm first, or use --storage r2 to upload directly.`
    );
  }
}

/**
 * Create a publishable tarball from a plugin directory.
 *
 * Collects plugin files, extracts metadata from package.json, detects
 * registered commands from source code, and prepares a FormData payload
 * for uploading to the marketplace or an npm-based registry.
 *
 * @param pluginDir - Path to the plugin directory containing `index.ts`.
 * @param options - Publish options including registry, token, storage type, and dry-run flag.
 * @returns A PublishResult with metadata and the prepared FormData.
 * @throws If `index.ts` is missing or the plugin has no description.
 */
export async function createTarball(
  pluginDir: string,
  options: PublishOptions
): Promise<PublishResult> {
  const indexPath = resolve(pluginDir, 'index.ts');
  const pkgPath = resolve(pluginDir, 'package.json');

  if (!existsSync(indexPath)) {
    throw new Error('No index.ts found. A plugin must have an index.ts entry file.');
  }

  let packageJson: Record<string, unknown> = {};
  if (existsSync(pkgPath)) {
    packageJson = readJsonFile<Record<string, unknown>>(pkgPath, {});
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
  const commandsDocs = extractCommandDocsFromCode(indexCode);
  const detectedCommands = commandsDocs.map((d) => d.name);

  const commands = ((xbrowserMeta.commands as string[]) || detectedCommands.length > 0)
    ? (xbrowserMeta.commands as string[]) || detectedCommands
    : detectedCommands;

  const readme = readReadme(pluginDir);

  const tags = extractTagsFromCode(indexCode, (xbrowserMeta.tags as string[]) || []);
  const sites = extractSitesFromCode(indexCode, (xbrowserMeta.sites as string[]) || []);

  const storage = options.storage || 'r2';

  if (storage === 'npm') {
    const packageName = (packageJson.name as string) || name;
    await validateNpmPackageExists(packageName, version);
  }

  const formData = new FormData();
  const metadata: Record<string, unknown> = {
    name,
    slug,
    version,
    description,
    author,
    commands,
    commandsDocs,
    readme,
    tags,
    sites,
    license: (xbrowserMeta.license as string) || (packageJson.license as string) || 'MIT',
    homepageUrl: (xbrowserMeta.homepage as string) || (packageJson.homepage as string) || null,
    repositoryUrl:
      (xbrowserMeta.repository as string) ||
      ((packageJson.repository as { url?: string })?.url) ||
      null,
    npmPackage: (packageJson.name as string) || null,
    storageType: storage,
  };

  const metadataBlob = new Blob([JSON.stringify(metadata)], { type: 'application/json' });
  formData.append('metadata', metadataBlob, 'metadata.json');

  let totalSize = 0;
  let checksum = '';

  if (storage === 'r2') {
    const files = collectFiles(pluginDir);
    const manifest = files.map(f => ({
      path: f.path,
      content: f.content.toString('base64'),
    }));
    const manifestJson = JSON.stringify(manifest);
    const gzipped = gzipSync(Buffer.from(manifestJson));
    totalSize = gzipped.length;

    const hash = createHash('sha256');
    hash.update(gzipped);
    checksum = `sha256-${hash.digest('hex').slice(0, 16)}`;

    const blob = new Blob([new Uint8Array(gzipped)]);
    formData.append('files', blob, `${slug}-${version}.tar.gz`);

    formData.append('checksum', checksum);

    return {
      name,
      version,
      slug,
      description,
      author,
      commands,
      commandsDocs,
      readme,
      tags,
      sites,
      fileCount: files.length,
      size: totalSize,
      checksum,
      formData,
    };
  }

  formData.append('checksum', 'npm-managed');

  return {
    name,
    version,
    slug,
    description,
    author,
    commands,
    commandsDocs,
    readme,
    tags,
    sites,
    fileCount: 0,
    size: 0,
    checksum: 'npm-managed',
    formData,
  };
}
