import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import type { PromoConfig, PromoResult } from './types.js';

const DEVTO_NEW_URL = 'https://dev.to/new';

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

function stripTitleFromMarkdown(content: string): string {
  return content.replace(/^#\s+.+$\n?/m, '').trim();
}

export async function publishToDevto(config: PromoConfig): Promise<PromoResult> {
  const cli = ab(config);

  try {
    const filePath = resolve(config.file);
    const raw = readFileSync(filePath, 'utf-8');
    const title = config.title ?? extractTitleFromMarkdown(raw);
    const body = stripTitleFromMarkdown(raw);

    execSync(`${cli} open ${DEVTO_NEW_URL}`, { encoding: 'utf-8', timeout: 30000 });

    const snapshot = execSync(`${cli} snapshot -i -s body`, { encoding: 'utf-8', timeout: 15000 });

    if (snapshot.includes('Log in') && !snapshot.includes('Notifications')) {
      const viewer = execSync(`${cli} viewer --json`, { encoding: 'utf-8', timeout: 10000 }).trim();
      return {
        success: false,
        error: `Not logged in to Dev.to. Please log in via viewer: ${viewer}`,
        platform: 'devto',
      };
    }

    execSync(`${cli} fill @e_title ${JSON.stringify(title)}`, { encoding: 'utf-8', timeout: 10000 });

    const escapedBody = JSON.stringify(body);
    execSync(`${cli} fill @e_content ${escapedBody}`, { encoding: 'utf-8', timeout: 15000 });

    if (config.tags) {
      const tags = config.tags.split(',').map(t => t.trim()).slice(0, 4).join(', ');
      execSync(`${cli} find text "tags" click`, { encoding: 'utf-8', timeout: 10000 });
      execSync(`${cli} type ${JSON.stringify(tags)}`, { encoding: 'utf-8', timeout: 10000 });
    }

    execSync(`${cli} find text "Publish" click`, { encoding: 'utf-8', timeout: 15000 });

    const postUrl = execSync(`${cli} get url`, { encoding: 'utf-8', timeout: 15000 }).trim();

    if (postUrl && postUrl !== DEVTO_NEW_URL && postUrl.includes('dev.to')) {
      return { success: true, url: postUrl, platform: 'devto' };
    }

    return { success: true, url: postUrl || undefined, platform: 'devto' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, platform: 'devto' };
  }
}
