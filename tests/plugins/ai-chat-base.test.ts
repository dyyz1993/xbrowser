import { describe, expect, it, vi } from 'vitest';
import {
  createAttachmentUploadOptions,
  handleChatAttachments,
  parsePathsCsv,
} from '../../.xcli/plugins/shared/ai-chat-base.js';

function makePage() {
  return {
    evaluate: vi.fn(async () => 0),
    locator: vi.fn(() => ({
      first: () => ({ click: vi.fn() }),
    })),
    setInputFiles: vi.fn(),
    waitForTimeout: vi.fn(),
  };
}

describe('parsePathsCsv', () => {
  it('trims values and rejects empty entries', () => {
    expect(parsePathsCsv(' /a.png, b.jpg ,, ')).toEqual(['/a.png', 'b.jpg']);
  });

  it('returns an empty list without a value', () => {
    expect(parsePathsCsv(undefined)).toEqual([]);
  });
});

describe('createAttachmentUploadOptions', () => {
  it('waits for a visible attachment count', async () => {
    const page = makePage();
    const options = createAttachmentUploadOptions(page as never);

    await expect(options.waitForAttachmentCount?.(1)).rejects.toThrow(
      '等待附件预览超时：当前 0，期望 1',
    );
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });
});

describe('handleChatAttachments', () => {
  it('does not upload when path and paths are empty', async () => {
    const page = makePage();
    const tips: string[] = [];

    await handleChatAttachments(page as never, undefined, undefined, 'image', tips);

    expect(page.evaluate).not.toHaveBeenCalled();
    expect(tips).toEqual([]);
  });

  it('passes one URL through to the message instead of uploading', async () => {
    const page = makePage();
    const tips: string[] = [];

    await handleChatAttachments(
      page as never,
      'https://example.com/a',
      'https://example.com/b,https://example.com/c',
      'url',
      tips,
    );

    expect(page.evaluate).not.toHaveBeenCalled();
    expect(tips).toEqual([
      '⚠ url 模式仅支持单个链接，已忽略 2 个额外项',
      'URL 将通过消息发送: https://example.com/a',
    ]);
  });
});
