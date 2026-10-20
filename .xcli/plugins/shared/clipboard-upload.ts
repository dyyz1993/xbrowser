import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { uploadFileViaDataTransfer } from './ai-chat-base.js';
import type { Page } from '../types.js';

const execFileAsync = promisify(execFile);

export interface ClipboardUploadOptions {
  editorSelector: string;
  initialCount?: number;
  waitForAttachmentCount?: (expected: number) => Promise<number>;
  /** Test-only hook: skips real osascript and preview verification. */
  exec?: (args: string[]) => Promise<void>;
  verifyPaste?: (filePath: string, expectedCount: number) => Promise<void>;
  browserName?: string;
}

function appleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function runAppleScript(args: string[]): Promise<void> {
  await execFileAsync('osascript', args, { timeout: 5000 });
}

async function writeClipboardImage(filePath: string, exec?: ClipboardUploadOptions['exec']): Promise<void> {
  const extension = path.extname(filePath).toLowerCase();
  const flavor = extension === '.jpg' || extension === '.jpeg' ? '«class JPEG»' : '«class PNGf»';
  const run = exec ?? runAppleScript;
  await run([
    '-e',
    `set the clipboard to (read (POSIX file "${appleScriptString(filePath)}") as ${flavor})`,
  ]);
}

async function focusBrowser(browserName: string, exec?: ClipboardUploadOptions['exec']): Promise<void> {
  const run = exec ?? runAppleScript;
  await run(['-e', `tell application "${browserName}" to activate`]);
}

async function sendSystemPaste(exec?: ClipboardUploadOptions['exec']): Promise<void> {
  const run = exec ?? runAppleScript;
  await run([
    '-e',
    'tell application "System Events" to keystroke "v" using command down',
  ]);
}

export async function pasteImagesFromClipboard(
  page: Page,
  filePaths: string[],
  options: ClipboardUploadOptions,
): Promise<{ ok: boolean; pasted: number; reason?: string }> {
  let pasted = 0;
  const initialCount = options.initialCount ?? 0;
  for (const filePath of filePaths) {
    try {
      await (page as Page & { bringToFront?: () => Promise<void> }).bringToFront?.();
      const editor = page.locator(options.editorSelector).first();
      await editor.click({ timeout: 5000 });
      await writeClipboardImage(filePath, options.exec);
      await focusBrowser(options.browserName ?? 'Google Chrome', options.exec);
      await page.waitForTimeout(200);
      await sendSystemPaste(options.exec);
      if (options.verifyPaste) {
        await options.verifyPaste(filePath, initialCount + pasted + 1);
      } else {
        await options.waitForAttachmentCount?.(initialCount + pasted + 1);
      }
      pasted += 1;
    } catch (error) {
      return {
        ok: false,
        pasted,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return { ok: true, pasted };
}

export async function setImagesOnFileInput(
  page: Page,
  filePaths: string[],
): Promise<boolean> {
  const inputCount = await page.evaluate(() => document.querySelectorAll('input[type="file"]').length);
  if (inputCount === 0) return false;

  const files = await Promise.all(filePaths.map(async filePath => {
    const extension = path.extname(filePath).toLowerCase();
    const mimeType = extension === '.jpg' || extension === '.jpeg'
      ? 'image/jpeg'
      : extension === '.webp' ? 'image/webp' : extension === '.gif' ? 'image/gif' : 'image/png';
    return {
      name: path.basename(filePath),
      mimeType,
      buffer: await fs.promises.readFile(filePath),
    };
  }));
  await page.setInputFiles('input[type="file"]', files);
  return true;
}

export interface GeneralUploadOptions extends ClipboardUploadOptions {
  browserName?: string;
}

/**
 * Unified site upload strategy: trusted clipboard paste first, then a
 * deterministic file-input/DataTransfer fallback. Paste success is always
 * verified by caller-provided DOM attachment counting.
 */
export async function uploadImagesPreferClipboard(
  page: Page,
  filePaths: string[],
  options: GeneralUploadOptions,
): Promise<UploadPreferClipboardResult> {
  if (filePaths.length === 0) return { files: [], uploaded: 0, method: 'file-input', errors: [] };
  const errors: string[] = [];
  const absPaths = filePaths.map((filePath) => path.resolve(filePath)).filter((filePath) => {
    if (fs.existsSync(filePath)) return true;
    errors.push(`文件不存在: ${filePath}`);
    return false;
  });
  if (absPaths.length === 0) return { files: [], uploaded: 0, method: 'file-input', errors };

  const paste = await pasteImagesFromClipboard(page, absPaths, options);
  if (paste.ok) {
    return { files: absPaths, uploaded: absPaths.length, method: 'paste', errors };
  }
  if (paste.pasted > 0) {
    errors.push(`剪贴板部分成功后状态不确定: ${paste.reason ?? 'unknown error'}`);
  }

  const remaining = absPaths.slice(paste.pasted);
  const fallbackErrors = errors.length;
  for (const [index, filePath] of remaining.entries()) {
    const uploaded = await uploadFileViaDataTransfer(page, filePath);
    if (!uploaded) errors.push(`第 ${paste.pasted + index + 1}/${absPaths.length} 个文件上传失败: ${path.basename(filePath)}`);
  }
  const uploaded = remaining.length - (errors.length - fallbackErrors);
  const failed = new Set(errors.map((error) => error.split(': ').at(-1)));
  return {
    files: absPaths.filter((filePath) => !failed.has(path.basename(filePath))),
    uploaded,
    method: 'file-input',
    errors,
    reason: paste.reason,
  };
}

export interface UploadPreferClipboardResult {
  files: string[];
  uploaded: number;
  method: 'paste' | 'file-input';
  errors: string[];
  reason?: string;
}
