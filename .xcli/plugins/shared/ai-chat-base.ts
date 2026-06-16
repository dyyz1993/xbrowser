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
): Promise<{ ok: boolean; uploaded: number; total: number }> {
  // 1. 合并 list
  const list: string[] = [
    ...(path ? [path] : []),
    ...(paths ? paths.split(',').map((s) => s.trim()).filter(Boolean) : []),
  ];
  if (list.length === 0) return { ok: true, uploaded: 0, total: 0 };

  // 2. url 类型：只发第一个 URL 进消息（无文件上传）
  if (attachType === 'url') {
    if (list.length > 1) {
      tips.push(`⚠ url 模式仅支持单个链接，已忽略 ${list.length - 1} 个额外项`);
    }
    tips.push(`URL 将通过消息发送: ${list[0]}`);
    return { ok: true, uploaded: 0, total: 1 };
  }

  // 3. 批量上传（image / file 模式）
  // 目标文本"添加照片和文件"匹配 chatgpt 的 Radix 菜单子项；
  // doubao / qianwen / claude / deepseek / yuanbao 找不到时，clickAddMoreButton
  // 会自动 fallback 到点 [+] / 媒体按钮 / aria 含"附件"的触发器。
  const r = await batchUploadFiles(page, list, '添加照片和文件');
  for (const e of r.errors) tips.push(`⚠ ${e}`);
  const ok = r.uploaded === list.length && r.errors.length === 0;
  if (ok) {
    tips.push(`✓ 已上传并验证 ${r.uploaded}/${list.length} 个附件`);
  } else if (r.uploaded > 0) {
    tips.push(`⚠ 上传 ${r.uploaded}/${list.length} 个附件，但部分强校验未通过`);
  } else {
    tips.push('⚠ 上传失败，找不到 file input 或缩略图未出现');
  }
  return { ok, uploaded: r.uploaded, total: list.length };
}

/**
 * **强校验**：上传后必须确认页面上出现了缩略图 / 附件节点，否则视为失败。
 *
 * 这一步是必须的（教训：2026-06-15 豆包实战 + 2026-06-16 chatgpt 实战）。
 * 之前 helper 调用 setInputFiles 后只 return true，没看页面真实状态，
 * 导致"上传没真发生"但代码以为成功了。
 *
 * 检测策略（3 选 1 即视为成功）：
 * - 缩略图：`<img>` 的 alt/src 包含文件名
 * - 附件节点：[data-testid*="attachment"] / [class*="attachment"] / [aria-label*="附件"]
 * - file input 的 files 数量 > 0
 *
 * @param page - 浏览器页面
 * @param filePaths - 期望上传的文件路径列表
 * @param timeoutMs - 最长等待时间（默认 3000ms）
 * @returns { verified: boolean, missing: string[] } — verified 是否全上传；missing 未出现的文件名
 */
export async function verifyUploads(
  page: Page,
  filePaths: string[],
  timeoutMs = 3000,
): Promise<{ verified: boolean; missing: string[]; found: string[] }> {
  const names = filePaths.map((fp) => path.basename(fp).toLowerCase());
  const deadline = Date.now() + timeoutMs;
  const found = new Set<string>();
  while (Date.now() < deadline) {
    const present = await page.evaluate((candidates: string[]) => {
      const result: string[] = [];
      // 1) 找 input.files 数量
      const fileInputs = document.querySelectorAll('input[type="file"]');
      let filesCount = 0;
      fileInputs.forEach((fi) => {
        if ((fi as HTMLInputElement).files) filesCount += (fi as HTMLInputElement).files!.length;
      });
      // 2) 找缩略图 / 附件节点
      const thumbs = document.querySelectorAll(
        'img, [data-testid*="attachment"], [class*="attachment"], [class*="preview"], [class*="upload-preview"], [class*="file-item"], [aria-label*="附件"], [aria-label*="attachment"]',
      );
      const allText = Array.from(thumbs)
        .map((el) => {
          const t = (el.textContent || '').toLowerCase();
          const a = (el.getAttribute('alt') || '').toLowerCase();
          const s = (el.getAttribute('src') || '').toLowerCase();
          const aria = (el.getAttribute('aria-label') || '').toLowerCase();
          return `${t} ${a} ${s} ${aria}`;
        })
        .join('\n');
      for (const name of candidates) {
        // 文件名匹配（不含扩展名也算，chatgpt 会剥扩展名）
        const base = name.replace(/\.[^.]+$/, '');
        if (allText.includes(name) || allText.includes(base)) {
          result.push(name);
        }
      }
      // 3) 如果 file input.files > 0 且候选数 > 0，认为上传中
      if (result.length === 0 && filesCount >= candidates.length) {
        return candidates.slice(0, filesCount);
      }
      // 4) ChatGPT 等站点：上传后 input.files 被清空，缩略图是 blob: img
      // 如果 blob img 数量 >= 候选数，按数量匹配
      if (result.length === 0) {
        const blobImgs = document.querySelectorAll('img[src^="blob:"]');
        if (blobImgs.length >= candidates.length) {
          return candidates.slice();
        }
      }
      return result;
    }, names);
    for (const n of present) found.add(n);
    if (found.size >= names.length) break;
    await page.waitForTimeout(300);
  }
  const missing = names.filter((n) => !found.has(n));
  return { verified: missing.length === 0, missing, found: Array.from(found) };
}

/**
 * 批量上传多个文件（AGENTS.md §10.0.3.1）
 *
 * 流程：每个文件循环——
 *   1) 监听 page.waitForEvent('filechooser')（CDP 原生，避开系统文件框）
 *   2) 用 clickAddMoreButton 触发按钮（第一个文件也点对应触发器）
 *   3) chooser.setFiles 注入
 *   4) 等 1500ms 上传完成
 *
 * 与旧版差异：
 * - 之前用 DataTransfer 注入隐藏 input（chatgpt/doubao 走不通）
 * - 现在用 filechooser 事件 + 真实鼠标点击触发器（isTrusted=true）
 * - chatgpt "添加照片和文件" 路径：点 composer-plus-btn → 菜单弹 → 点 "添加照片和文件" → filechooser 触发
 *
 * @param page - Playwright Page 或 XBPage
 * @param filePaths - 文件绝对路径列表
 * @param addMoreButtonText - "+" 按钮文本（默认 "+"，可传 "添加"/"继续添加"）
 * @param maxFiles - 最大文件数（默认 50）
 */
export async function batchUploadFiles(
  page: Page,
  filePaths: string[],
  addMoreButtonText = '+',
  maxFiles = 50,
): Promise<{ files: string[]; uploaded: number; errors: string[] }> {
  const absPaths: string[] = [];
  const errors: string[] = [];
  const uploaded: string[] = [];

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

  // 2. 直走 pointer 事件链 + file input 注入
  // 流程：pointerdown "+" → 等 Radix 菜单 → pointerdown "添加照片和文件" → 直接 setInputFiles 到 #upload-files
  {
    // 先点 "+" 打开菜单
    const openerClicked = await clickAddMoreButton(page, addMoreButtonText);
    if (!openerClicked) {
      errors.push(`找不到"${addMoreButtonText}"触发按钮`);
      return { files: [], uploaded: 0, errors };
    }
    // 菜单点击后 ChatGPT 的 #upload-files input 已经准备好，直接注入
    await page.waitForTimeout(500);
    const p = page as unknown as { setInputFiles?: (s: string, f: unknown[]) => Promise<void> };
    if (typeof p.setInputFiles !== 'function') {
      errors.push('page.setInputFiles 不可用');
      return { files: [], uploaded: 0, errors };
    }
    const payloads = absPaths.map(fp => {
      const buf = fs.readFileSync(fp);
      const ext = path.extname(fp).toLowerCase();
      const mime = MIME_MAP[ext] || 'application/octet-stream';
      return { name: path.basename(fp), mimeType: mime, buffer: buf };
    });
    try {
      await p.setInputFiles('#upload-files', payloads);
    } catch {
      errors.push('setInputFiles 注入失败');
      return { files: [], uploaded: 0, errors };
    }
    uploaded.push(...absPaths);
    await page.waitForTimeout(3000);
  }

  // 3. 强制校验
  const verify = await verifyUploads(page, absPaths, 5000);
  if (!verify.verified) {
    errors.push(`强校验未通过：未在页面上找到 ${verify.missing.length} 个文件（missing=${verify.missing.join(', ')}）`);
  }

  return { files: uploaded, uploaded: verify.verified ? uploaded.length : verify.found.length, errors };
}

/**
 * 点击"添加更多"按钮（真实鼠标事件，避开 CDP Firewall）
 *
 * 三轮匹配：aria-label 包含 → 严格文本 → 模糊文本包含。
 * 候选元素覆盖 button / [role=button/menuitem] / class 含 add/plus/attach/upload。
 * 返回坐标后在 page 域调 page.mouse.click（真实事件，isTrusted=true）。
 *
 * 第 0 步特殊处理（chatgpt 等 Radix 菜单站点）：
 * - 如果目标文本是 "添加照片和文件" / "添加文件" / "上传图片" 这类**菜单子项**，
 *   但当前没找到任何匹配 → 自动尝试点 [#composer-plus-btn, button[aria-label*="添加"], [id*="plus"]]
 *   打开菜单，等 500ms 后再匹配。
 */
async function clickAddMoreButton(page: Page, buttonText: string): Promise<boolean> {
  // cdp-tunnel 下 page.mouse.click 不生效，统一用 DOM 指针事件链
  // Radix 等组件需要 pointerdown → mousedown → pointerup → mouseup → click 才能打开菜单

  // 先试直接找到目标并 click
  let clicked = await findAndClickByText(page, buttonText);
  if (clicked) return true;

  // 没找到时，可能是 chatgpt 风格：需要先点 "+" 按钮打开菜单
  const openerClicked = await page.evaluate(() => {
    const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
    const firePointerEvents = (el: HTMLElement): boolean => {
      const r = el.getBoundingClientRect();
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerId: 1, pointerType: 'mouse' };
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
      el.click();
      return true;
    };
    const candidates = Array.from(
      document.querySelectorAll(
        'button, [role="button"], [id*="plus"], [id*="attach"], [id*="upload"], [class*="upload"]',
      ),
    ) as HTMLElement[];
    const openKeywords = ['添加', '附件', 'attach', 'upload', 'file', 'image', '媒体'];
    for (const el of candidates) {
      if (el.offsetParent === null) continue;
      const aria = norm(el.getAttribute('aria-label') || '');
      const id = norm(el.id || '');
      const cls = norm(el.className || '');
      // 命中 chatgpt 的 composer-plus-btn 或类似
      if (id.includes('composer-plus') || id.includes('plus-btn') || id.includes('attach-btn')) {
        return firePointerEvents(el);
      }
      // aria-label 含"添加照片"/"附件"
      for (const k of openKeywords) {
        if (aria.includes(k)) return firePointerEvents(el);
      }
      // 文本是 "+"（单个字符的 + 按钮）
      const t = norm((el.textContent || '').trim());
      if (t === '+' || t === '＋' || t === 'attach' || aria === 'attach') {
        return firePointerEvents(el);
      }
      // class 含 upload/attach
      if (cls.includes('upload') || cls.includes('attach')) {
        return firePointerEvents(el);
      }
    }
    return false;
  });

  if (openerClicked) {
    await page.waitForTimeout(1000); // 等 Radix 菜单挂载

    // 先 hover 目标元素（Radix 菜单子项可能需要 hover 才渲染/激活）
    await page.evaluate((text: string) => {
      const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
      const target = norm(text);
      const candidates = Array.from(
        document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], button, [class*="add"]'),
      ) as HTMLElement[];
      for (const el of candidates) {
        if (el.offsetParent === null) continue;
        const t = norm((el.textContent || '').trim());
        const aria = norm(el.getAttribute('aria-label') || '');
        if (t.includes(target) || aria.includes(target)) {
          const r = el.getBoundingClientRect();
          el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
          el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
          el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
          break;
        }
      }
    }, buttonText);
    await page.waitForTimeout(300); // 等 hover 渲染

    clicked = await findAndClickByText(page, buttonText);
    if (clicked) return true;
  }
  return false;
}

/**
 * 在页面上找文本匹配的元素并发完整指针事件链（Radix 需要 pointerdown）
 */
async function findAndClickByText(page: Page, buttonText: string): Promise<boolean> {
  return page.evaluate((text: string) => {
    const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
    const firePointerEvents = (el: HTMLElement): boolean => {
      const r = el.getBoundingClientRect();
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerId: 1, pointerType: 'mouse' };
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
      el.click();
      return true;
    };
    const target = norm(text);
    const candidates = Array.from(
      document.querySelectorAll(
        'button, [role="button"], [role="menuitem"], [role="menuitemradio"], [class*="add"], [class*="plus"], [class*="attach"], [class*="upload"]',
      ),
    ) as HTMLElement[];
    // 1) aria-label 匹配
    for (const el of candidates) {
      if (el.offsetParent === null) continue;
      const aria = norm(el.getAttribute('aria-label') || '');
      if (aria && (aria === target || aria.includes(target))) return firePointerEvents(el);
    }
    // 2) 严格文本匹配
    for (const el of candidates) {
      if (el.offsetParent === null) continue;
      const t = norm((el.textContent || '').trim());
      if (t === target) return firePointerEvents(el);
    }
    // 3) 模糊包含匹配
    for (const el of candidates) {
      if (el.offsetParent === null) continue;
      const t = norm((el.textContent || '').trim());
      if (t && t.includes(target)) return firePointerEvents(el);
    }
    return false;
  }, buttonText);
}

