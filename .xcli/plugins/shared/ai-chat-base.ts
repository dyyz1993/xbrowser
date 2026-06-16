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

/**
 * 解析 chat 命令的 --path / --paths 参数并批量上传（AGENTS.md §10.0.3.1）
 *
 * 适用场景：chat 命令的内嵌附件上传，替代旧的 --attach / --attachType。
 * 6 个 AI 聊天插件（doubao/chatgpt/claude/deepseek/qianwen/yuanbao）统一调用。
 *
 * @param page - Playwright Page
 * @param path - 单文件路径（可选）
 * @param paths - 多文件 CSV 路径（可选）
 * @param attachType - 'image' | 'file' | 'url'（url 模式：把第一个 path 视为 URL 推入 tips）
 * @param tips - 状态消息数组（in/out 复用）
 *
 * @example
 * ```typescript
 * // chatgpt chat "分析这3张图" --paths a.jpg,b.png,c.jpg
 * await handleChatAttachments(page, undefined, params.paths, 'image', tips);
 * ```
 */
export async function handleChatAttachments(
  page: Page,
  path: string | undefined,
  paths: string | undefined,
  attachType: string,
  tips: string[],
): Promise<void> {
  // 1. 合并 list
  const list: string[] = [
    ...(path ? [path] : []),
    ...(paths ? paths.split(',').map((s) => s.trim()).filter(Boolean) : []),
  ];
  if (list.length === 0) return;

  // 2. url 类型：只发第一个 URL 进消息（无文件上传）
  if (attachType === 'url') {
    if (list.length > 1) {
      tips.push(`⚠ url 模式仅支持单个链接，已忽略 ${list.length - 1} 个额外项`);
    }
    tips.push(`URL 将通过消息发送: ${list[0]}`);
    return;
  }

  // 3. 批量上传（image / file 模式）
  const r = await batchUploadFiles(page, list, '+');
  for (const e of r.errors) tips.push(`⚠ ${e}`);
  if (r.uploaded > 0) {
    tips.push(`✓ 已上传 ${r.uploaded}/${list.length} 个附件`);
  } else {
    tips.push('⚠ 上传失败，找不到 file input');
  }
}

/**
 * 批量上传多个文件到常驻的 file input（AGENTS.md §10.0.3.1）
 *
 * 适用场景：
 * - 聊天附件：input 一直挂着，第一个直接注入；后续需点 "+" 按钮
 * - 与 uploadFileViaDataTransfer 配合使用（无触发按钮场景）
 *
 * @param page - Playwright Page
 * @param filePaths - 文件绝对路径列表
 * @param addMoreButtonText - "+" 按钮文本（默认 "+"，可传 "添加"/"继续添加"）
 * @param maxFiles - 最大文件数（默认 50，与豆包限制一致）
 * @returns { files: string[], uploaded: number, errors: string[] }
 *
 * @example
 * ```typescript
 * const r = await batchUploadFiles(page, ['/abs/a.jpg', '/abs/b.png']);
 * // → { files: [...], uploaded: 2, errors: [] }
 * ```
 */
export async function batchUploadFiles(
  page: Page,
  filePaths: string[],
  addMoreButtonText = '+',
  maxFiles = 50,
): Promise<{ files: string[]; uploaded: number; errors: string[] }> {
  const absPaths: string[] = [];
  const errors: string[] = [];

  // 1. 校验
  if (filePaths.length > maxFiles) {
    errors.push(`超出最大文件数 (${filePaths.length}/${maxFiles})`);
    return { files: [], uploaded: 0, errors };
  }
  for (const fp of filePaths) {
    const abs = path.resolve(fp);
    if (!fs.existsSync(abs)) {
      errors.push(`文件不存在: ${abs}`);
      continue;
    }
    absPaths.push(abs);
  }
  if (absPaths.length === 0) {
    return { files: [], uploaded: 0, errors };
  }

  // 2. 循环上传
  const uploaded: string[] = [];
  for (let i = 0; i < absPaths.length; i++) {
    if (i > 0) {
      // 后续文件：点 "+" 添加按钮
      const clicked = await clickAddMoreButton(page, addMoreButtonText);
      if (!clicked) {
        errors.push(`第 ${i + 1}/${absPaths.length} 个文件：找不到"${addMoreButtonText}"按钮`);
        break;
      }
      await page.waitForTimeout(500);
    }
    const ok = await uploadFileViaDataTransfer(page, absPaths[i]!);
    if (ok) {
      uploaded.push(absPaths[i]!);
    } else {
      errors.push(`第 ${i + 1}/${absPaths.length} 个文件上传失败: ${path.basename(absPaths[i]!)}`);
    }
  }

  return { files: uploaded, uploaded: uploaded.length, errors };
}

/**
 * 点击"添加更多"按钮（真实鼠标事件，避开 CDP Firewall）
 */
async function clickAddMoreButton(page: Page, buttonText: string): Promise<boolean> {
  return page.evaluate((text: string) => {
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], [class*="add"], [class*="plus"]'));
    const btn = candidates.find((b) => {
      const t = (b.textContent || '').trim();
      const aria = b.getAttribute('aria-label') || '';
      return t === text || t === '添加' || t === '继续添加' || aria.includes('添加') || aria.includes('attach');
    }) as HTMLElement | undefined;
    if (btn) {
      const r = btn.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        const x = r.x + r.width / 2;
        const y = r.y + r.height / 2;
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
        return true;
      }
    }
    return false;
  }, buttonText);
}

/**
 * 工具：把 --paths CSV 拆成数组（与 file-upload.ts 同名，重复定义避免循环依赖）
 */
export function parsePathsCsv(csv: string | undefined): string[] {
  if (!csv) return [];
  return csv.split(',').map((s) => s.trim()).filter(Boolean);
}
