import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import type { PromoConfig, PromoResult } from './types.js';

const CSDN_EDITOR_URL = 'https://mp.csdn.net/mp_blog/creation/editor';

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

export async function publishToCsdn(config: PromoConfig): Promise<PromoResult> {
  const cli = ab(config);

  try {
    const filePath = resolve(config.file);
    const raw = readFileSync(filePath, 'utf-8');
    const title = config.title ?? extractTitleFromMarkdown(raw);
    const body = raw.replace(/^#\s+.+$\n?/m, '').trim();

    execSync(`${cli} open ${CSDN_EDITOR_URL}`, { encoding: 'utf-8', timeout: 30000 });

    const snapshot = execSync(`${cli} snapshot -i -s body`, { encoding: 'utf-8', timeout: 15000 });

    if (snapshot.includes('登录') && !snapshot.includes('写文章')) {
      const viewer = execSync(`${cli} viewer --json`, { encoding: 'utf-8', timeout: 10000 }).trim();
      return {
        success: false,
        error: `Not logged in to CSDN. Please log in via viewer: ${viewer}`,
        platform: 'csdn',
      };
    }

    execSync(`${cli} fill @e_title ${JSON.stringify(title)}`, { encoding: 'utf-8', timeout: 10000 });

    const escapedBody = JSON.stringify(body);
    execSync(`${cli} fill @e_content ${escapedBody}`, { encoding: 'utf-8', timeout: 15000 });

    if (config.tags) {
      const tags = config.tags.split(',').map(t => t.trim());
      for (const tag of tags) {
        execSync(`${cli} find text "添加标签" click`, { encoding: 'utf-8', timeout: 10000 });
        execSync(`${cli} type ${JSON.stringify(tag)}`, { encoding: 'utf-8', timeout: 10000 });
        execSync(`${cli} keyboard Enter`, { encoding: 'utf-8', timeout: 5000 });
      }
    }

    execSync(`${cli} find text "发布" click`, { encoding: 'utf-8', timeout: 15000 });

    const postUrl = execSync(`${cli} get url`, { encoding: 'utf-8', timeout: 15000 }).trim();

    return { success: true, url: postUrl || undefined, platform: 'csdn' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, platform: 'csdn' };
  }
}
