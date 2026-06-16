/**
 * file-upload helper 的单元测试
 * 验证决策树、5 种 pattern 顺序、超时/失败处理
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { uploadFile, clickButtonByText, type UploadOptions } from '../../.xcli/plugins/shared/file-upload';
import * as fs from 'fs';
import * as path from 'path';

// Mock page
function createMockPage() {
  return {
    locator: vi.fn(() => ({
      first: vi.fn(() => ({
        count: vi.fn(() => 1),
        click: vi.fn(),
        setInputFiles: vi.fn(),
      })),
      count: vi.fn(() => 1),
    })),
    setInputFiles: vi.fn(),
    click: vi.fn(),
    evaluate: vi.fn(),
    context: vi.fn(() => ({
      waitForEvent: vi.fn(() => Promise.resolve({ setFiles: vi.fn() })),
    })),
  };
}

describe('uploadFile helper (CDP safe)', () => {
  let mockPage: ReturnType<typeof createMockPage>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPage = createMockPage();
    // 创建临时测试文件
    const tmpFile = '/tmp/test-upload.txt';
    if (!fs.existsSync(tmpFile)) fs.writeFileSync(tmpFile, 'test content');
  });

  it('should return method=none when file does not exist', async () => {
    const result = await uploadFile(mockPage as never, '/tmp/nonexistent-file-xxx.png');
    expect(result.ok).toBe(false);
    expect(result.method).toBe('none');
    expect(result.tips[0]).toContain('文件不存在');
  });

  it('should try filechooser first when triggerButton is provided', async () => {
    const result = await uploadFile(mockPage as never, '/tmp/test-upload.txt', {
      triggerButton: 'button:has-text("Upload")',
    });
    expect(result.method).toBe('filechooser');
    expect(result.ok).toBe(true);
  });

  it('should fallback to setInputFiles when no trigger button', async () => {
    const result = await uploadFile(mockPage as never, '/tmp/test-upload.txt');
    expect(result.method).toBe('setInputFiles');
    expect(result.ok).toBe(true);
  });

  it('should not throw on failure — return ok=false with tips', async () => {
    const failingPage = {
      locator: vi.fn(() => ({ first: vi.fn(() => ({ count: vi.fn(() => 0) })) })),
      evaluate: vi.fn(() => Promise.reject(new Error('eval failed'))),
      context: vi.fn(() => ({ waitForEvent: vi.fn(() => Promise.reject(new Error('timeout'))) })),
    };
    const result = await uploadFile(failingPage as never, '/tmp/test-upload.txt', {
      triggerButton: 'bad',
    });
    expect(result.ok).toBe(false);
    expect(result.tips.length).toBeGreaterThan(0);
  });
});

describe('clickButtonByText', () => {
  it('should call page.evaluate to find rect, then page.mouse.click for real mouse event', async () => {
    const mockPage = {
      evaluate: vi.fn(() => Promise.resolve({ x: 100, y: 200 })),
      mouse: { click: vi.fn(() => Promise.resolve()) },
    };
    const result = await clickButtonByText(mockPage as never, '参考图');
    expect(mockPage.evaluate).toHaveBeenCalledWith(expect.any(Function), '参考图');
    expect(mockPage.mouse.click).toHaveBeenCalledWith(100, 200);
    expect(result).toBe(true);
  });

  it('should return false when target text not found', async () => {
    const mockPage = {
      evaluate: vi.fn(() => Promise.resolve(null)),
      mouse: { click: vi.fn() },
    };
    const result = await clickButtonByText(mockPage as never, '不存在');
    expect(result).toBe(false);
    expect(mockPage.mouse.click).not.toHaveBeenCalled();
  });
});
