import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { z } from 'zod/v4';

/**
 * kimi 插件 — Kimi AI 助手（www.kimi.com）
 *
 * S187: 从 scaffold 实现为可用的 chat 插件。
 * DOM 结构探针于 2026-08-31（.chat-input-editor contenteditable），
 * 站点改版时需复测选择器。
 *
 * 输入：paste ClipboardEvent（与掘金/豆包同款，React 编辑器兼容）
 * 发送：Enter（kimi 默认 Enter 发送）
 * 回复：轮询消息容器的文本增量，稳定后返回
 */
const EDITOR_SEL = ".chat-input-editor, .ProseMirror, [contenteditable='true']";

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'kimi',
    url: 'https://www.kimi.com',
    description: 'Kimi AI 助手（chat 对话）',
    requiresLogin: true,
  });

  site.command('chat', {
    description: '发送消息并等待 Kimi 回复',
    scope: 'browser',
    parameters: z.object({
      message: z.string().describe('消息内容'),
      timeout: z.number().optional().describe('等待回复超时秒数（默认 60）'),
    }),
    examples: [
      { cmd: 'xbrowser kimi chat "你好"', description: '发送消息' },
      { cmd: 'xbrowser kimi chat "分析这段代码" --timeout 120', description: '长回复加大超时' },
    ],
    handler: async (params: { message: string; timeout?: number }, ctx: { page?: any }) => {
      const page = ctx?.page;
      if (!page) throw new Error('需要浏览器页面');

      // 1. 确保在 kimi 首页
      if (!String(page.url()).includes('kimi.com')) {
        await page.goto('https://www.kimi.com');
        await page.waitForTimeout(4000);
      }

      // 2. 等待编辑器就绪
      const editorReady = await page
        .waitForSelector(EDITOR_SEL, { timeout: 20000 })
        .then(() => true)
        .catch(() => false);
      if (!editorReady) throw new Error('kimi 编辑器未找到（可能未登录或站点改版）');

      // 3. 记录现有回复块数量（用于识别新回复）
      const before = Number(
        await page.evaluate("(function(){return document.querySelectorAll('[class*=message], article').length})()"),
      );

      // 4. paste 输入（ProseMirror 类编辑器兼容，execCommand 同理不可用）
      await page.evaluate(
        `(function(){
          var text = ${JSON.stringify(params.message)};
          var ce = document.querySelector(".chat-input-editor, .ProseMirror, [contenteditable='true']");
          ce.focus();
          var dt = new DataTransfer();
          dt.setData('text/plain', text);
          ce.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        })()`,
      );
      await page.waitForTimeout(600);

      // 5. Enter 发送
      await page.keyboard.press('Enter');

      // 6. 轮询新回复出现并稳定（3 次采样相同 = 完成）
      const timeoutMs = (params.timeout ?? 60) * 1000;
      const t0 = Date.now();
      let lastText = '';
      let stableCount = 0;
      let response = '';
      while (Date.now() - t0 < timeoutMs) {
        await page.waitForTimeout(1500);
        response = String(
          await page.evaluate(`(function(){
            var blocks = document.querySelectorAll('[class*=message], article');
            if (blocks.length <= ${before}) return '';
            var last = blocks[blocks.length - 1];
            return (last.innerText || '').trim();
          })()`),
        );
        if (response && response === lastText) {
          stableCount++;
          if (stableCount >= 3) break;
        } else {
          stableCount = 0;
          lastText = response;
        }
      }

      if (!response) throw new Error('未捕获到回复（超时）');
      return { response, durationMs: Date.now() - t0 };
    },
  });
}
