import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import type { PromoConfig, PromoResult } from './types.js';

function ab(config: PromoConfig): string {
  const parts = ['agent-browser'];
  if (config.cdpEndpoint) parts.push('--cdp', config.cdpEndpoint);
  if (config.session) parts.push('--session', config.session);
  return parts.join(' ');
}

export async function publishToQuora(config: PromoConfig): Promise<PromoResult> {
  const cli = ab(config);

  try {
    if (!config.search) {
      return {
        success: false,
        error: 'Quora requires --search parameter to find relevant questions',
        platform: 'quora',
      };
    }

    const filePath = resolve(config.file);
    const raw = readFileSync(filePath, 'utf-8');
    const answer = raw.trim();

    const searchUrl = `https://www.quora.com/search?q=${encodeURIComponent(config.search)}`;
    execSync(`${cli} open ${searchUrl}`, { encoding: 'utf-8', timeout: 30000 });

    const snapshot = execSync(`${cli} snapshot -i -s body`, { encoding: 'utf-8', timeout: 15000 });

    if (!snapshot.includes('Add question')) {
      const viewer = execSync(`${cli} viewer --json`, { encoding: 'utf-8', timeout: 10000 }).trim();
      return {
        success: false,
        error: `Not logged in to Quora. Please log in via viewer: ${viewer}`,
        platform: 'quora',
      };
    }

    const answerMatch = snapshot.match(/Answer\s*(?:button|link)/i);
    if (!answerMatch) {
      return {
        success: false,
        error: 'No answerable questions found for the given search query. Try a different search term.',
        platform: 'quora',
      };
    }

    execSync(`${cli} find text "Answer" click`, { encoding: 'utf-8', timeout: 10000 });

    const escapedAnswer = JSON.stringify(answer);
    execSync(`${cli} fill @e_answer ${escapedAnswer}`, { encoding: 'utf-8', timeout: 15000 });

    execSync(`${cli} find text "Submit" click`, { encoding: 'utf-8', timeout: 15000 });

    const postUrl = execSync(`${cli} get url`, { encoding: 'utf-8', timeout: 15000 }).trim();

    return { success: true, url: postUrl || undefined, platform: 'quora' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, platform: 'quora' };
  }
}
