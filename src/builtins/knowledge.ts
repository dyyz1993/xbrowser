import type { BuiltinCommand, BuiltinContext } from './session.js';
import {
  readSiteKnowledge,
  readSiteKnowledgeMarkdown,
  listSiteKnowledge,
  addKnownIssue,
  getKnowledgePath,
} from '../recorder/site-knowledge.js';
import { existsSync } from 'fs';

export const knowledgeBuiltin: BuiltinCommand = {
  name: 'knowledge',
  description: 'View LLM-readable site knowledge base (selectors, forms, APIs)',
  aliases: ['know'],
  help: {
    usage: 'xbrowser knowledge <list|show|search|issue|path> [domain] [options]',
    description:
      'Manage auto-generated site knowledge from recordings. ' +
      'Knowledge is stored at ~/.xbrowser/knowledge/{domain}.md and is designed for LLM consumption.',
    options: [
      { name: 'list', description: 'List all domains with knowledge bases' },
      { name: 'show <domain>', description: 'Show full knowledge for a domain (markdown)' },
      { name: 'search <domain> <query>', description: 'Search selectors/APIs by keyword' },
      { name: 'selectors <domain>', description: 'List all selectors for a domain' },
      { name: 'api <domain>', description: 'List all API endpoints for a domain' },
      { name: 'issue <domain> <text>', description: 'Add a known issue to a domain' },
      { name: 'path <domain>', description: 'Show file path for a domain\'s knowledge' },
    ],
    examples: [
      { cmd: 'xbrowser knowledge list', description: 'List all known sites' },
      { cmd: 'xbrowser knowledge show juejin.cn', description: 'Show juejin.cn knowledge' },
      { cmd: 'xbrowser knowledge search juejin.cn publish', description: 'Find selectors related to "publish"' },
      { cmd: 'xbrowser knowledge selectors juejin.cn', description: 'List all selectors' },
      { cmd: 'xbrowser knowledge api juejin.cn', description: 'List API endpoints' },
      { cmd: 'xbrowser knowledge issue juejin.cn "Title selector changed"', description: 'Report an issue' },
    ],
  },
  execute: async (args, _options, _ctx: BuiltinContext) => {
    const [subcommand, ...rest] = args;

    // ── list ──
    if (!subcommand || subcommand === 'list') {
      const domains = listSiteKnowledge();
      if (domains.length === 0) {
        console.log('No site knowledge bases found.');
        console.log('Knowledge is auto-generated when you run `xbrowser record stop`.');
        return;
      }
      console.log('Site Knowledge Bases:');
      console.log('');
      for (const domain of domains) {
        const kb = readSiteKnowledge(domain);
        if (kb) {
          const pageCount = Object.keys(kb.pages).length;
          const selCount = Object.values(kb.pages).reduce((sum, p) => sum + p.selectors.length, 0);
          const apiCount = Object.keys(kb.apiEndpoints).length;
          console.log(
            `  ${domain} — ${kb.recordingCount} recordings, ${pageCount} pages, ${selCount} selectors, ${apiCount} APIs`,
          );
        }
      }
      return;
    }

    // ── show ──
    if (subcommand === 'show') {
      const domain = rest[0];
      if (!domain) {
        console.error('Usage: xbrowser knowledge show <domain>');
        process.exit(1);
      }
      const md = readSiteKnowledgeMarkdown(domain);
      if (!md) {
        console.error(`No knowledge base found for ${domain}`);
        console.error('Run `xbrowser knowledge list` to see available domains.');
        process.exit(1);
      }
      console.log(md);
      return;
    }

    // ── selectors ──
    if (subcommand === 'selectors') {
      const domain = rest[0];
      if (!domain) {
        console.error('Usage: xbrowser knowledge selectors <domain>');
        process.exit(1);
      }
      const kb = readSiteKnowledge(domain);
      if (!kb) {
        console.error(`No knowledge base found for ${domain}`);
        process.exit(1);
      }
      console.log(`Selectors for ${domain} (${kb.recordingCount} recordings):`);
      console.log('');
      for (const [pagePath, page] of Object.entries(kb.pages)) {
        if (page.selectors.length === 0) continue;
        console.log(`  ${pagePath}:`);
        for (const sel of page.selectors) {
          const status = sel.status === 'deprecated' ? ' ⚠️' : '';
          console.log(
            `    ${sel.selector.padEnd(30)} ${sel.tag.padEnd(8)} ${sel.actionType.padEnd(10)} ${sel.confidence.padEnd(6)} ${sel.timesSeen}x${status}`,
          );
          if (sel.description) console.log(`      → ${sel.description}`);
        }
        console.log('');
      }
      return;
    }

    // ── api ──
    if (subcommand === 'api') {
      const domain = rest[0];
      if (!domain) {
        console.error('Usage: xbrowser knowledge api <domain>');
        process.exit(1);
      }
      const kb = readSiteKnowledge(domain);
      if (!kb) {
        console.error(`No knowledge base found for ${domain}`);
        process.exit(1);
      }
      const endpoints = Object.values(kb.apiEndpoints);
      if (endpoints.length === 0) {
        console.log(`No API endpoints recorded for ${domain}`);
        return;
      }
      console.log(`API Endpoints for ${domain}:`);
      console.log('');
      for (const ep of endpoints.sort((a, b) => b.timesSeen - a.timesSeen)) {
        const params = ep.params.length > 0 ? ep.params.join(', ') : '-';
        console.log(`  ${ep.method} ${ep.path}  (${ep.timesSeen}x)`);
        console.log(`    Params: ${params}`);
        if (ep.responseFields.length > 0) {
          console.log(`    Response: ${ep.responseFields.slice(0, 5).join(', ')}`);
        }
        console.log('');
      }
      return;
    }

    // ── search ──
    if (subcommand === 'search') {
      const domain = rest[0];
      const query = rest.slice(1).join(' ').toLowerCase();
      if (!domain || !query) {
        console.error('Usage: xbrowser knowledge search <domain> <query>');
        process.exit(1);
      }
      const kb = readSiteKnowledge(domain);
      if (!kb) {
        console.error(`No knowledge base found for ${domain}`);
        process.exit(1);
      }
      console.log(`Search results for "${query}" in ${domain}:`);
      console.log('');

      // Search selectors
      let found = 0;
      for (const [pagePath, page] of Object.entries(kb.pages)) {
        const matches = page.selectors.filter(s =>
          s.selector.toLowerCase().includes(query) ||
          s.description.toLowerCase().includes(query) ||
          (s.text || '').toLowerCase().includes(query),
        );
        for (const m of matches) {
          console.log(`  [${pagePath}] ${m.selector} → ${m.description} (${m.actionType}, ${m.confidence}, ${m.timesSeen}x)`);
          found++;
        }
      }

      // Search API endpoints
      for (const ep of Object.values(kb.apiEndpoints)) {
        if (
          ep.path.toLowerCase().includes(query) ||
          ep.params.some(p => p.toLowerCase().includes(query))
        ) {
          console.log(`  [API] ${ep.method} ${ep.path} (${ep.timesSeen}x)`);
          found++;
        }
      }

      if (found === 0) {
        console.log('  No matches found.');
      }
      return;
    }

    // ── issue ──
    if (subcommand === 'issue') {
      const domain = rest[0];
      const text = rest.slice(1).join(' ');
      if (!domain || !text) {
        console.error('Usage: xbrowser knowledge issue <domain> <description>');
        process.exit(1);
      }
      if (!readSiteKnowledge(domain)) {
        console.error(`No knowledge base found for ${domain}`);
        process.exit(1);
      }
      addKnownIssue(domain, text);
      console.log(`Added issue to ${domain}: ${text}`);
      return;
    }

    // ── path ──
    if (subcommand === 'path') {
      const domain = rest[0];
      if (!domain) {
        console.error('Usage: xbrowser knowledge path <domain>');
        process.exit(1);
      }
      const mdPath = getKnowledgePath(domain, 'md');
      const jsonPath = getKnowledgePath(domain, 'json');
      console.log(`Markdown: ${mdPath} (${existsSync(mdPath) ? 'exists' : 'not found'})`);
      console.log(`JSON:     ${jsonPath} (${existsSync(jsonPath) ? 'exists' : 'not found'})`);
      return;
    }

    console.error(`Unknown subcommand: ${subcommand}`);
    console.error('Usage: xbrowser knowledge <list|show|selectors|api|search|issue|path>');
    process.exit(1);
  },
};
