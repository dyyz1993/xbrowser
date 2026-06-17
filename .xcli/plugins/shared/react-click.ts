import type { Page } from '../types.js';

/**
 * 直接调用元素的 React onClick handler（绕过 DOM 事件系统 + isTrusted 检查）。
 *
 * 适用场景：cdp-tunnel 隔离 page 上 Input.dispatchMouseEvent 卡死/丢失，
 * 而 el.click()（合成事件）被网站的 isTrusted 检查拦截。
 * 此方法从 React fiber props 取出 onClick 函数直接调用，不经过事件分发，
 * 因此没有 isTrusted 问题。
 *
 * @param page    Playwright/CDP Page
 * @param selector  目标元素 CSS 选择器
 * @param opts    可选：parentSearch 沿祖先链向上搜索 onClick 的最大层数（默认 8）
 * @returns { called: boolean, error?: string }
 */
export async function reactClick(
  page: Page,
  selector: string,
  opts: { parentSearch?: number } = {},
): Promise<{ called: boolean; error?: string }> {
  const maxDepth = opts.parentSearch ?? 8;
  const result = await page.evaluate(
    ({ sel, maxDepth }) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return { called: false, error: `element not found: ${sel}` };

      // 从 React fiber props 取 onClick
      const getOnClick = (node: Element | null): ((e: unknown) => void) | null => {
        if (!node) return null;
        const pKey = Object.keys(node).find((k) => k.startsWith('__reactProps'));
        if (!pKey) return null;
        const props = (node as unknown as Record<string, unknown>)[pKey] as Record<string, unknown>;
        const handler = props?.onClick;
        return typeof handler === 'function' ? (handler as (e: unknown) => void) : null;
      };

      // 先查目标元素本身，再沿祖先链向上
      let onClick = getOnClick(el);
      let searchEl: Element | null = el;
      let depth = 0;
      while (!onClick && searchEl && depth < maxDepth) {
        searchEl = searchEl.parentElement;
        onClick = getOnClick(searchEl);
        depth++;
      }

      if (!onClick) return { called: false, error: `no onClick found within ${maxDepth} ancestors` };

      try {
        // 构造伪事件对象（React 合成事件的主要字段）
        onClick({
          type: 'click',
          currentTarget: el,
          target: el,
          preventDefault: () => {},
          stopPropagation: () => {},
          isTrusted: true,
          nativeEvent: { isTrusted: true },
        });
        return { called: true };
      } catch (e) {
        return { called: false, error: (e as Error).message };
      }
    },
    { sel: selector, maxDepth },
  );
  return result as { called: boolean; error?: string };
}
