import type { Page } from '../types.js';
import * as path from 'path';
import * as fs from 'fs';

/**
 * 通过「粘贴」方式上传文件到 AI 聊天输入框（contenteditable editor）。
 *
 * 原理：很多 AI 站点（yuanbao/doubao/chatgpt 等）支持 Ctrl+V 粘贴图片。
 * 此方法在 evaluate 里读取文件 buffer → 转 base64 → 构造 Blob + DataTransfer +
 * ClipboardEvent('paste') → dispatch 到输入框。编辑器的 paste handler 读
 * clipboardData.items 处理图片上传。
 *
 * 优点：不需要找上传按钮（各站点 UI 差异大），直接粘贴最通用。
 *
 * @param page       Playwright/CDP Page
 * @param editorSel  输入框 selector（contenteditable editor）
 * @param filePaths  文件绝对路径列表
 * @returns { pasted: number, errors: string[] }
 */
export async function pasteFiles(
  page: Page,
  editorSel: string,
  filePaths: string[],
): Promise<{ pasted: number; errors: string[] }> {
  const errors: string[] = [];
  const valid: { name: string; mime: string; base64: string }[] = [];

  for (const fp of filePaths) {
    const abs = path.resolve(fp);
    if (!fs.existsSync(abs)) { errors.push(`文件不存在: ${abs}`); continue; }
    const buf = fs.readFileSync(abs);
    const ext = path.extname(fp).toLowerCase();
    const mime: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf',
    };
    valid.push({ name: path.basename(abs), mime: mime[ext] || 'application/octet-stream', base64: buf.toString('base64') });
  }

  if (valid.length === 0) return { pasted: 0, errors };

  // 在 evaluate 里构造 paste 事件
  const result = await page.evaluate(
    ({ sel, files }) => {
      const editor = document.querySelector(sel) as HTMLElement | null;
      if (!editor) return { error: `editor not found: ${sel}` };
      editor.focus();

      let pastedCount = 0;
      for (const file of files) {
        try {
          // base64 → Uint8Array → Blob
          const binary = atob(file.base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const blob = new Blob([bytes], { type: file.mime });
          const fileObj = new File([blob], file.name, { type: file.mime });

          // 构造 DataTransfer + ClipboardEvent
          const dt = new DataTransfer();
          dt.items.add(fileObj);

          const pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: dt,
          });

          editor.dispatchEvent(pasteEvent);
          pastedCount++;
        } catch {
          // 忽略单个文件错误，继续
        }
      }
      return { pasted: pastedCount };
    },
    { sel: editorSel, files: valid },
  ).catch((e: unknown) => ({ error: (e as Error).message }));

  if ('error' in result && result.error) {
    errors.push(result.error);
    return { pasted: 0, errors };
  }
  return { pasted: (result as { pasted: number }).pasted, errors };
}
