import type { BuiltinCommand } from './session.js';
import { NPMSearcher } from '../plugin/npm-search.js';
import { PluginMetadataParser } from '../plugin/metadata-parser.js';
import type { SearchOptions } from '../plugin/types.js';
import { XBrowserPluginLoader } from '../plugin/loader.js';
import { getPluginLoader } from '../utils/plugin-singleton.js';
import { createStubContext } from '../utils/stub-context.js';

export interface PluginSearchResult {
  source: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  homepage?: string;
  tags?: string[];
  downloads?: number;
  slug?: string;
  commands?: string[];
  links?: { npm: string; homepage?: string; repository?: string };
}

async function searchFromMarketplacePlugin(
  options: SearchOptions,
  loader: XBrowserPluginLoader,
): Promise<PluginSearchResult[]> {
  const sites = loader.getCore().loader.getSites();
  // 只找 marketplace site（由 marketplace 插件注册）
  const marketplaceSite = sites.find(s => s.name === 'marketplace');
  if (!marketplaceSite) return [];

  const searchCmd = marketplaceSite.getCommand('search');
  if (!searchCmd) return [];

  try {
    const result = await searchCmd.handler(
      {
        query: options.query,
        tag: options.tag,
        site: options.site,
        limit: options.limit,
      },
      createStubContext('marketplace'),
    );

    const items = extractItems(result);
    return items.map((item) => ({
      source: 'marketplace',
      name: String(item.name || ''),
      version: String(item.version || 'latest'),
      description: String(item.description || ''),
      author: String(item.author || ''),
      homepage: typeof item.homepage === 'string' ? item.homepage : undefined,
      tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
      downloads: typeof item.downloads === 'number' ? item.downloads : 0,
      slug: String(item.slug || ''),
      commands: Array.isArray(item.commands) ? item.commands.map(String) : [],
    }));
  } catch {
    // marketplace 插件搜索失败，静默跳过
    return [];
  }
}

function extractItems(result: unknown): Array<Record<string, unknown>> {
  if (!result || typeof result !== 'object') return [];
  const r = result as Record<string, unknown>;
  if ('data' in r) {
    const data = r.data as Record<string, unknown>;
    if (data && 'items' in data && Array.isArray(data.items)) {
      return data.items as Array<Record<string, unknown>>;
    }
  }
  if ('items' in r && Array.isArray(r.items)) {
    return r.items as Array<Record<string, unknown>>;
  }
  return [];
}

function handleSearchHelp(): string {
  return [
    'Usage: xbrowser plugin search <query> [options]',
    '',
    'Options:',
    '  --tag <tag>          Filter by plugin tag',
    '  --site <site>        Filter by target site',
    '  --limit <number>     Limit results (default: 20)',
    '',
    'Examples:',
    '  xbrowser plugin search scraper',
    '  xbrowser plugin search ecommerce --tag data-extraction',
    '  xbrowser plugin search amazon --site amazon.com',
  ].join('\n');
}

export const pluginSearchBuiltin: BuiltinCommand = {
  name: 'plugin search',
  description: 'Search for xbrowser plugins on npm registry and marketplace',
  help: {
    usage: 'xbrowser plugin search <query> [options]',
    description: 'Search npm registry and installed plugin search providers for xbrowser-compatible plugins',
    options: [
      { name: '--tag <tag>', description: 'Filter by plugin tag' },
      { name: '--site <site>', description: 'Filter by target site' },
      { name: '--limit <number>', description: 'Limit results (default: 20)' },
    ],
    examples: [
      { cmd: 'xbrowser plugin search scraper', description: 'Search for scraper plugins' },
      { cmd: 'xbrowser plugin search ecommerce --tag data-extraction', description: 'Filter by tag' },
      { cmd: 'xbrowser plugin search amazon --site amazon.com', description: 'Filter by site' },
    ],
  },
  execute: async (args, options) => {
    const query = args[0] || '';

    try {
      const searchOptions: SearchOptions = {
        query,
        tag: options['tag'] as string | undefined,
        site: options['site'] as string | undefined,
        limit: options['limit'] ? Number.parseInt(String(options['limit'])) : 20,
      };

      console.log(
        `Searching for xbrowser plugins...${query ? ` (query: "${query}")` : ''}`
      );

      const loader = await getPluginLoader();

      const [npmSettled, pluginSettled] = await Promise.allSettled([
        NPMSearcher.search(searchOptions),
        searchFromMarketplacePlugin(searchOptions, loader),
      ]);

      const npmResults = npmSettled.status === 'fulfilled' ? npmSettled.value : [];
      const pluginResults = pluginSettled.status === 'fulfilled' ? pluginSettled.value : [];

      if (npmSettled.status === 'rejected') {
        console.warn(`Warning: npm search failed: ${npmSettled.reason}`);
      }

      const total = npmResults.length + pluginResults.length;

      if (total === 0) {
        console.log('No plugins found.');
        return;
      }

      console.log(`Found ${total} plugin(s) (npm: ${npmResults.length}, plugins: ${pluginResults.length}):\n`);

      if (npmResults.length > 0) {
        console.log('--- npm ---\n');
        npmResults.forEach((result, idx) => {
          const metadata = PluginMetadataParser.fromNPMResult(result);
          console.log(`${idx + 1}. ${result.name}`);
          console.log(`   ${result.description}`);
          console.log(`   Version: ${result.version}`);
          console.log(`   Author: ${typeof result.author === 'string' ? result.author : result.author?.name}`);

          if (metadata?.tags && metadata.tags.length > 0) {
            console.log(`   Tags: ${metadata.tags.join(', ')}`);
          }

          if (result.links?.homepage) {
            console.log(`   Homepage: ${result.links.homepage}`);
          }

          if (result.links?.npm) {
            console.log(`   NPM: ${result.links.npm}`);
          }

          const shortName = result.name.replace(/^@[^/]+\//, '');
          console.log(`   Install: xbrowser plugin install ${shortName}`);
          console.log('');
        });
      }

      if (pluginResults.length > 0) {
        console.log('--- marketplace ---\n');
        pluginResults.forEach((result, idx) => {
          console.log(`${idx + 1}. ${result.name} [marketplace]`);
          console.log(`   ${result.description}`);
          console.log(`   Version: ${result.version}`);
          if (result.author) console.log(`   Author: ${result.author}`);
          if (result.downloads) console.log(`   Downloads: ${result.downloads}`);

          if (result.tags && result.tags.length > 0) {
            console.log(`   Tags: ${result.tags.join(', ')}`);
          }

          if (result.commands && result.commands.length > 0) {
            console.log(`   Commands: ${result.commands.join(', ')}`);
          }

          if (result.homepage) {
            console.log(`   Homepage: ${result.homepage}`);
          }

          if (result.slug) {
            console.log(`   Install: xbrowser plugin install ${result.slug} --from-marketplace`);
          }
          console.log('');
        });
      }
    } catch (e: unknown) {
      console.error('Error:', e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  },
};

export { handleSearchHelp };
