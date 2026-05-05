import type { BuiltinCommand } from './session.js';
import { NPMSearcher } from '../plugin/npm-search.js';
import { PluginMetadataParser } from '../plugin/metadata-parser.js';
import type { SearchOptions } from '../plugin/types.js';

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
  description: 'Search for xbrowser plugins on npm registry',
  help: {
    usage: 'xbrowser plugin search <query> [options]',
    description: 'Search npm registry for xbrowser-compatible plugins',
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

      console.log(`Searching npm registry for xbrowser plugins...${query ? ` (query: "${query}")` : ''}`);

      const results = await NPMSearcher.search(searchOptions);

      if (results.length === 0) {
        console.log('No plugins found.');
        return;
      }

      console.log(`Found ${results.length} plugin(s):\n`);

      results.forEach((result, idx) => {
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

        console.log('');
      });
    } catch (e: unknown) {
      console.error('Error:', e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  },
};

export { handleSearchHelp };
