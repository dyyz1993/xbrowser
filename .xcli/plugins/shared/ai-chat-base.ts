/**
 * Shared utilities for AI assistant plugins (chatgpt, claude, deepseek, doubao, qianwen, yuanbao).
 *
 * Extracted to eliminate duplication of buildTips(), uploadFileViaDataTransfer(),
 * and handleAttachment() across the 6 plugins.
 *
 * Import like:  import { buildTips, uploadFileViaDataTransfer, handleAttachment } from '../shared/ai-chat-base.js';
 */

import type { CommandContext } from '@dyyz1993/xcli-core';
import type { Page } from '../types.js';
import path from 'path';
import fs from 'fs';

/**
 * Build standard tips array for AI plugin commands.
 *
 * Adds a --cdp recommendation (if not using CDP) and the current session ID.
 */
export function buildTips(ctx: CommandContext): string[] {
  const tips: string[] = [];
  const ctxAny = ctx as unknown as Record<string, unknown>;
  const options = ctxAny.options as Record<string, unknown> | undefined;
  const cdp = ctxAny.cdpEndpoint || options?.cdp;
  if (!cdp) tips.push('建议使用 --cdp 9221 连接到已登录的浏览器');
  tips.push(`Session: ${ctxAny.sessionId || 'default'}`);
  return tips;
}

/**
 * MIME type map covering image / document / code / audio / video / ebook formats.
 *
 * Union of all MIME maps across the 6 plugins (superset).
 */
const MIME_MAP: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
  '.json': 'application/json', '.csv': 'text/csv', '.html': 'text/html',
  '.ts': 'text/typescript', '.tsx': 'text/typescript', '.js': 'text/javascript',
  '.py': 'text/x-python', '.yaml': 'text/yaml', '.yml': 'text/yaml',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.mobi': 'application/x-mobipocket-ebook', '.epub': 'application/epub+zip',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
};

/**
 * Upload a file by injecting it via DataTransfer + File API, bypassing the
 * OS file picker. Works around React state management resets that prevent
 * Playwright's setInputFiles from working on AI chat sites.
 *
 * Returns true if the file input accepted the file.
 */
export async function uploadFileViaDataTransfer(page: Page, absPath: string): Promise<boolean> {
  const data = fs.readFileSync(absPath);
  const b64 = data.toString('base64');
  const ext = path.extname(absPath).toLowerCase();
  const mime = MIME_MAP[ext] || 'application/octet-stream';

  const result = await page.evaluate(({ b64data, filename, mimeType }) => {
    const fi = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (!fi) return false;

    const byteChars = atob(b64data);
    const byteNums = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteNums[i] = byteChars.charCodeAt(i);
    }
    const file = new File([byteNums], filename, { type: mimeType });

    const dt = new DataTransfer();
    dt.items.add(file);
    Object.defineProperty(fi, 'files', { value: dt.files });
    fi.dispatchEvent(new Event('change', { bubbles: true }));
    return fi.files.length > 0;
  }, { b64data: b64, filename: path.basename(absPath), mimeType: mime }) as boolean;

  return result;
}

/**
 * Handle an attachment for a chat command.
 *
 * - If attachType is 'url', the file path is logged as a message-to-send (no upload).
 * - Otherwise, resolves the path, checks existence, and uploads via DataTransfer.
 *
 * Appends status messages to the tips array.
 */
export async function handleAttachment(
  page: Page,
  filePath: string,
  attachType: string,
  tips: string[]
): Promise<void> {
  if (attachType === 'url') {
    tips.push(`URL 将通过消息发送: ${filePath}`);
    return;
  }

  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    tips.push(`⚠ 附件文件不存在: ${filePath}，跳过附件`);
    return;
  }

  await page.waitForTimeout(500);
  const success = await uploadFileViaDataTransfer(page, absPath);
  if (success) {
    tips.push(`已上传附件: ${path.basename(absPath)}`);
    await page.waitForTimeout(1000);
  } else {
    tips.push('⚠ 上传失败，找不到 file input');
  }
}
