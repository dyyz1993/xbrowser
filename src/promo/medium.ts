import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import type { PromoConfig, PromoResult } from './types.js';

const MEDIUM_NEW_URL = 'https://medium.com/new-story';

function ab(config: PromoConfig): string {
  const parts = ['agent-browser'];
  if (config.cdpEndpoint) parts.push('--cdp', config.cdpEndpoint);
  if (config.session) parts.push('--session', config.session);
  return parts.join(' ');
}

function extractTitleFromMarkdown(content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  if (match) return match[1].trim();
  const lines = content.split('\n').filter(l => l.trim().length > 0);
  return lines[0] ? lines[0].replace(/^#+\s*/, '').trim() : 'Untitled';
}

function markdownToPlainText(content: string): string {
  return content
    .replace(/^#+\s+.+$/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/!\[.*?\]\(.+?\)/g, '')
    .trim();
}

export async function publishToMedium(config: PromoConfig): Promise<PromoResult> {
  const cli = ab(config);

  try {
    const filePath = resolve(config.file);
    const raw = readFileSync(filePath, 'utf-8');
    const title = config.title ?? extractTitleFromMarkdown(raw);
    const body = markdownToPlainText(raw);

    execSync(`${cli} open ${MEDIUM_NEW_URL}`, { encoding: 'utf-8', timeout: 30000 });

    const snapshot = execSync(`${cli} snapshot -i -s body`, { encoding: 'utf-8', timeout: 15000 });

    if (snapshot.includes('Sign in') && !snapshot.includes('Write')) {
      const viewer = execSync(`${cli} viewer --json`, { encoding: 'utf-8', timeout: 10000 }).trim();
      return {
        success: false,
        error: `Not logged in to Medium. Please log in via viewer: ${viewer}`,
        platform: 'medium',
      };
    }

    execSync(`${cli} click @e_title`, { encoding: 'utf-8', timeout: 10000 });
    execSync(`${cli} type ${JSON.stringify(title)}`, { encoding: 'utf-8', timeout: 10000 });

    execSync(`${cli} click @e_content`, { encoding: 'utf-8', timeout: 10000 });
    const lines = body.split('\n');
    for (const line of lines) {
      execSync(`${cli} type ${JSON.stringify(line)}`, { encoding: 'utf-8', timeout: 10000 });
      execSync(`${cli} keyboard Enter`, { encoding: 'utf-8', timeout: 5000 });
    }

    if (config.tags) {
      execSync(`${cli} find text "Tags" click`, { encoding: 'utf-8', timeout: 10000 });
      const tags = config.tags.split(',').map(t => t.trim()).join(', ');
      execSync(`${cli} type ${JSON.stringify(tags)}`, { encoding: 'utf-8', timeout: 10000 });
    }

    execSync(`${cli} find text "Publish" click`, { encoding: 'utf-8', timeout: 15000 });

    const postUrl = execSync(`${cli} get url`, { encoding: 'utf-8', timeout: 15000 }).trim();

    return { success: true, url: postUrl || undefined, platform: 'medium' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, platform: 'medium' };
  }
}
