/**
 * ai-chat-base helper 的单元测试
 * 验证 handleChatAttachments / batchUploadFiles / verifyUploads 的核心行为
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 共享：构造一个 mock page，模拟不同场景
function makeMockPage(opts: {
  fileChooserTriggered?: boolean;
  attachNodes?: string[]; // 模拟页面上找到的"附件"节点文本
  menuItemText?: string; // 模拟菜单项文本
  hasPlusButton?: boolean;
}) {
  const trigger = opts.fileChooserTriggered ?? true;
  const attach = opts.attachNodes ?? [];
  const menuText = opts.menuItemText ?? '';
  const hasPlus = opts.hasPlusButton ?? true;
  return {
    waitForEvent: vi.fn(async (evt: string) => {
      if (evt === 'filechooser' && trigger) {
        return { isMultiple: false, setFiles: vi.fn() };
      }
      // 等不到事件时抛错（模拟超时）
      throw new Error('timeout');
    }),
    mouse: { click: vi.fn() },
    waitForTimeout: vi.fn(),
    evaluate: vi.fn(async (fn: (...a: unknown[]) => unknown, ...args: unknown[]) => {
      // 简化：用字符串 match 判断 evaluate 的目的
      const fnSrc = fn.toString();
      if (fnSrc.includes('composer-plus-btn') || fnSrc.includes('class*="upload"')) {
        // clickAddMoreButton 的 opener 探查
        if (hasPlus) {
          return { x: 100, y: 100 };
        }
        return null;
      }
      if (fnSrc.includes('addMoreRect') || fnSrc.includes('role="menuitem"')) {
        // 找菜单项
        if (menuText) {
          return { x: 200, y: 200 };
        }
        return null;
      }
      if (fnSrc.includes('fileInputs') || fnSrc.includes('attachment')) {
        // verifyUploads
        return attach;
      }
      if (fnSrc.includes('background-image') || fnSrc.includes('filesCount')) {
        return attach.length > 0 ? attach : [];
      }
      return null;
    }),
  };
}

describe('ai-chat-base', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('verifyUploads: 文件名出现在缩略图时 verified=true', async () => {
    const { verifyUploads } = await import('../../.xcli/plugins/shared/ai-chat-base');
    const page = makeMockPage({ attachNodes: ['1.png'] });
    const r = await verifyUploads(page as never, ['/abs/1.png'], 500);
    expect(r.verified).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.found).toContain('1.png');
  });

  it('verifyUploads: 缩略图未出现时 verified=false + missing 列出', async () => {
    const { verifyUploads } = await import('../../.xcli/plugins/shared/ai-chat-base');
    const page = makeMockPage({ attachNodes: [] });
    const r = await verifyUploads(page as never, ['/abs/missing.png'], 500);
    expect(r.verified).toBe(false);
    expect(r.missing).toContain('missing.png');
  });

  it('handleChatAttachments: url 类型只记录 link 不上传', async () => {
    const { handleChatAttachments } = await import('../../.xcli/plugins/shared/ai-chat-base');
    const page = makeMockPage({});
    const tips: string[] = [];
    const r = await handleChatAttachments(page as never, 'https://example.com', undefined, 'url', tips);
    expect(r.ok).toBe(true);
    expect(tips.some(t => t.includes('URL 将通过消息发送'))).toBe(true);
  });

  it('handleChatAttachments: path+paths 都空时返回 ok (无操作)', async () => {
    const { handleChatAttachments } = await import('../../.xcli/plugins/shared/ai-chat-base');
    const page = makeMockPage({});
    const tips: string[] = [];
    const r = await handleChatAttachments(page as never, undefined, undefined, 'image', tips);
    expect(r.ok).toBe(true);
    expect(r.uploaded).toBe(0);
    expect(r.total).toBe(0);
  });
});
