/**
 * 快速输入辅助（用于长 prompt，避免 keyboard.type 逐字敲）
 *
 * 三种策略，按输入框类型选择最快的：
 *
 * 1. textarea（doubao）：Object.getOwnPropertyDescriptor(setter) + dispatchEvent('input')
 *    直接设 value，瞬间生效。React 兼容。
 *
 * 2. contenteditable（gemini/chatgpt/qwen）：document.execCommand('insertText')
 *    瞬间写入，触发 React/Quill 状态更新。但需要 focus + user activation 上下文。
 *
 * 3. keyboard.type 兜底：前面两种都不行时，无 delay 快速键入。
 *
 * 使用方式：
 *   await fastInput(page, prompt);
 *   或指定策略：
 *   await fastInput(page, prompt, 'textarea');
 *   await fastInput(page, prompt, 'execCommand');
 */

export type InputStrategy = 'auto' | 'textarea' | 'execCommand' | 'keyboard';
type Page = import('../types').Page;

/**
 * 快速输入文本
 *
 * @param page Playwright Page
 * @param text 要输入的文本
 * @param strategy 输入策略（auto 自动检测）
 * @returns true 表示输入成功
 */
export async function fastInput(
  page: Page,
  text: string,
  strategy: InputStrategy = 'auto',
): Promise<boolean> {
  if (strategy === 'auto') {
    // 自动检测输入框类型，选择最快策略
    const detected = await page.evaluate(() => {
      const ta = document.querySelector('textarea');
      if (ta && ta.offsetParent !== null) return 'textarea'; // visible textarea
      const ed = document.querySelector('[contenteditable="true"]');
      if (ed) return 'execCommand';
      return 'keyboard';
    }).catch(() => 'keyboard' as string);

    return fastInput(page, text, detected as InputStrategy);
  }

  // strategy: textarea — value setter
  if (strategy === 'textarea') {
    return page.evaluate((t: string) => {
      const ta = document.querySelector('textarea');
      if (!ta) return false;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      )?.set;
      if (!setter) { ta.value = t; return true; }
      setter.call(ta, t);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, text).catch(() => false);
  }

  // strategy: execCommand — 适合 contenteditable
  if (strategy === 'execCommand') {
    return page.evaluate((t: string) => {
      const ed = document.activeElement as HTMLElement | null;
      if (!ed || !ed.isContentEditable) {
        // 找 contenteditable
        const found = document.querySelector('[contenteditable="true"]') as HTMLElement;
        if (!found) return false;
        found.focus();
      }
      // 分段插入（execCommand 对超长文本可能有截断）
      const chunkSize = 500;
      for (let i = 0; i < t.length; i += chunkSize) {
        const chunk = t.substring(i, i + chunkSize);
        document.execCommand('insertText', false, chunk);
      }
      return true;
    }, text).catch(() => false);
  }

  // strategy: keyboard — 兜底，无 delay
  if (strategy === 'keyboard') {
    try {
      await page.keyboard.type(text, { delay: 0 });
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * 验证输入是否写入成功
 */
export async function verifyInputWritten(
  page: Page,
  expected: string,
): Promise<boolean> {
  return page.evaluate((exp: string) => {
    const ta = document.querySelector('textarea');
    if (ta) return ta.value.includes(exp.substring(0, Math.min(20, exp.length)));
    const ed = document.querySelector('[contenteditable="true"]') as HTMLElement;
    if (ed) return (ed.textContent || '').includes(exp.substring(0, Math.min(20, exp.length)));
    return false;
  }, expected).catch(() => false);
}
