/**
 * TipsManager 弹窗事件检测的单元测试
 * 验证 filechooser / dialog 事件自动检测并转成 SmartTip
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock anti-bot detection，避免在单元测试里触发真实的反检测
vi.mock('../../src/anti-bot-detection.js', () => ({
  detectAntiBot: vi.fn().mockResolvedValue({ detected: false }),
  formatDetectionMessage: vi.fn().mockReturnValue(''),
}));

import { getTipsManager, resetTipsManager } from '../../src/tips/index.js';
import type { SmartTip } from '../../src/tips/types.js';

// 构造一个 mock page，模拟 EventEmitter（on/off）
function makeMockPage() {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();

  return {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(handler);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const arr = listeners.get(event);
      if (arr) {
        const idx = arr.indexOf(handler);
        if (idx >= 0) arr.splice(idx, 1);
      }
    }),
    // mock evaluate：返回空数组（无弹窗 DOM 元素）+ 安全的反检测值
    evaluate: vi.fn(async (fn: unknown) => {
      if (typeof fn === 'string') {
        // anti-bot detection 调 evaluate 传字符串
        if (fn.includes('chrome')) return { runtime: { onConnect: true } };
        if (fn.includes('webdriver')) return false;
        if (fn.includes('permissions')) return { state: 'granted' };
        return '';
      }
      // DomWatcher 调 evaluate 传函数 → 返回空数组
      return [];
    }),
    url: vi.fn(() => 'https://example.com'),
    // 模拟触发事件
    _emit(event: string, ...args: unknown[]) {
      const arr = listeners.get(event);
      if (arr) arr.forEach(h => h(...args));
    },
  };
}

describe('TipsManager — CDP 弹窗事件检测', () => {
  let page: ReturnType<typeof makeMockPage>;
  let tipsManager: ReturnType<typeof getTipsManager>;

  beforeEach(() => {
    resetTipsManager();
    page = makeMockPage();
    tipsManager = getTipsManager();
  });

  it('检测到 filechooser 事件后应生成 SmartTip', async () => {
    // beforeCommand 挂监听
    await tipsManager.beforeCommand(page as never, 'click', { selector: '#upload-btn' });

    // 模拟 filechooser 事件触发
    page._emit('filechooser', {
      selector: '#upload-files',
      isMultiple: true,
      setFiles: vi.fn(),
    });

    // afterCommand 收集 Tips
    const tips = await tipsManager.afterCommand();

    // 应该有至少 1 个 filechooser tip
    const fcTip = tips.find(t => t.category === 'filechooser');
    expect(fcTip).toBeDefined();
    expect(fcTip!.message).toContain('文件选择弹窗');
    expect(fcTip!.message).toContain('多选');
    expect(fcTip!.message).toContain('#upload-files');
    expect(fcTip!.message).toContain('click'); // 触发命令名
    expect(fcTip!.suggestions.length).toBeGreaterThan(0);
  });

  it('检测到 dialog 事件后应生成 SmartTip', async () => {
    await tipsManager.beforeCommand(page as never, 'click', { selector: '#alert-btn' });

    page._emit('dialog', {
      type: () => 'alert',
      message: () => '确认删除？',
      accept: vi.fn(),
      dismiss: vi.fn(),
    });

    const tips = await tipsManager.afterCommand();

    const dialogTip = tips.find(t => t.category === 'dialog');
    expect(dialogTip).toBeDefined();
    expect(dialogTip!.message).toContain('[alert]');
    expect(dialogTip!.message).toContain('确认删除？');
    expect(dialogTip!.message).toContain('click');
  });

  it('没有弹窗事件时不应生成 CDP Tips', async () => {
    await tipsManager.beforeCommand(page as never, 'goto', { url: 'https://example.com' });

    const tips = await tipsManager.afterCommand();

    // 没有弹窗 → 没有 filechooser/dialog tip
    const cdpTips = tips.filter(t => t.category === 'filechooser' || t.category === 'dialog');
    expect(cdpTips.length).toBe(0);
  });

  it('多次弹窗事件应全部收集', async () => {
    await tipsManager.beforeCommand(page as never, 'click', { selector: '#multi-btn' });

    page._emit('filechooser', { selector: '#f1', isMultiple: false, setFiles: vi.fn() });
    page._emit('dialog', { type: () => 'confirm', message: () => '继续？', accept: vi.fn(), dismiss: vi.fn() });

    const tips = await tipsManager.afterCommand();

    expect(tips.some(t => t.category === 'filechooser')).toBe(true);
    expect(tips.some(t => t.category === 'dialog')).toBe(true);
  });

  it('afterCommand 后检测到的事件应清空（不跨命令累积）', async () => {
    await tipsManager.beforeCommand(page as never, 'click', { selector: '#btn' });
    page._emit('filechooser', { selector: '#f1', isMultiple: false, setFiles: vi.fn() });

    const tips1 = await tipsManager.afterCommand();
    expect(tips1.some(t => t.category === 'filechooser')).toBe(true);

    // 第二次命令不应看到第一次的弹窗
    await tipsManager.beforeCommand(page as never, 'goto', { url: 'https://example.com' });
    const tips2 = await tipsManager.afterCommand();
    expect(tips2.some(t => t.category === 'filechooser')).toBe(false);
  });

  it('page.on 只应挂一次（不重复注册）', async () => {
    await tipsManager.beforeCommand(page as never, 'click', { selector: '#a' });
    await tipsManager.beforeCommand(page as never, 'click', { selector: '#b' });
    await tipsManager.beforeCommand(page as never, 'click', { selector: '#c' });

    // dialog + filechooser + popup = 3 次（不管 beforeCommand 调几次）
    const onCalls = (page.on as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => c[0] === 'dialog' || c[0] === 'filechooser' || c[0] === 'popup'
    );
    expect(onCalls.length).toBe(3);
  });

  it('检测到 popup 事件（window.open）应生成 SmartTip', async () => {
    await tipsManager.beforeCommand(page as never, 'click', { selector: '#open-window-btn' });

    page._emit('popup', { url: 'https://ads.example.com/popup', windowName: 'ad' });

    const tips = await tipsManager.afterCommand();

    const popupTip = tips.find(t => t.category === 'popup');
    expect(popupTip).toBeDefined();
    expect(popupTip!.message).toContain('新窗口弹窗');
    expect(popupTip!.message).toContain('https://ads.example.com/popup');
    expect(popupTip!.message).toContain('click');
  });

  it('filechooser + dialog + popup 三种事件同时检测', async () => {
    await tipsManager.beforeCommand(page as never, 'click', { selector: '#complex-btn' });

    page._emit('filechooser', { selector: '#f1', isMultiple: false, setFiles: vi.fn() });
    page._emit('dialog', { type: () => 'confirm', message: () => 'OK?', accept: vi.fn(), dismiss: vi.fn() });
    page._emit('popup', { url: 'https://example.com/new' });

    const tips = await tipsManager.afterCommand();

    expect(tips.some(t => t.category === 'filechooser')).toBe(true);
    expect(tips.some(t => t.category === 'dialog')).toBe(true);
    expect(tips.some(t => t.category === 'popup')).toBe(true);
    expect(tips.length).toBeGreaterThanOrEqual(3);
  });
});
