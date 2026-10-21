import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page } from '../../src/browser-shim.js';
import type { BrowserCommandContext } from '../../src/context.js';

function createMockPage(): Page {
  return {
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    press: vi.fn().mockResolvedValue(undefined),
    selectOption: vi.fn().mockResolvedValue([]),
    check: vi.fn().mockResolvedValue(undefined),
    hover: vi.fn().mockResolvedValue(undefined),
    dblclick: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue({}),
    evaluate: vi.fn().mockResolvedValue(undefined),
    mouse: {
      move: vi.fn().mockResolvedValue(undefined),
      down: vi.fn().mockResolvedValue(undefined),
      up: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
      dblclick: vi.fn().mockResolvedValue(undefined),
      wheel: vi.fn().mockResolvedValue(undefined),
    },
    locator: vi.fn().mockReturnValue({
      first: vi.fn().mockReturnValue({
        evaluate: vi.fn().mockResolvedValue(undefined),
        screenshot: vi.fn().mockResolvedValue(Buffer.from('')),
      }),
    }),
  } as unknown as Page;
}

describe('Interaction Commands', () => {
  let mockPage: Page;

  beforeEach(() => {
    mockPage = createMockPage();
  });

  it('click should click on selector', async () => {
    await mockPage.click('#btn');
    expect(mockPage.click).toHaveBeenCalledWith('#btn');
  });

  it('fill should fill input field', async () => {
    await mockPage.fill('#input', 'hello');
    expect(mockPage.fill).toHaveBeenCalledWith('#input', 'hello');
  });

  it('type should type text', async () => {
    await mockPage.type('#input', 'text', { delay: 50 });
    expect(mockPage.type).toHaveBeenCalledWith('#input', 'text', { delay: 50 });
  });

  it('press should press a key', async () => {
    await mockPage.press('body', 'Enter');
    expect(mockPage.press).toHaveBeenCalledWith('body', 'Enter');
  });

  it('selectOption should select values', async () => {
    await mockPage.selectOption('#select', ['val1']);
    expect(mockPage.selectOption).toHaveBeenCalledWith('#select', ['val1']);
  });

  it('check should check checkbox', async () => {
    await mockPage.check('#checkbox');
    expect(mockPage.check).toHaveBeenCalledWith('#checkbox');
  });

  it('hover should hover over element', async () => {
    await mockPage.hover('#elem');
    expect(mockPage.hover).toHaveBeenCalledWith('#elem');
  });

  it('dblclick should double click', async () => {
    await mockPage.dblclick('#elem');
    expect(mockPage.dblclick).toHaveBeenCalledWith('#elem');
  });

  it('mouse.click should click at coordinates', async () => {
    await mockPage.mouse.click(100, 200);
    expect(mockPage.mouse.click).toHaveBeenCalledWith(100, 200);
  });

  it('mouse.move should move mouse', async () => {
    await mockPage.mouse.move(100, 200, { steps: 5 });
    expect(mockPage.mouse.move).toHaveBeenCalledWith(100, 200, { steps: 5 });
  });

  it('mouse.wheel should scroll', async () => {
    await mockPage.mouse.wheel(0, 500);
    expect(mockPage.mouse.wheel).toHaveBeenCalledWith(0, 500);
  });

  it('evaluate should run JS expression', async () => {
    await mockPage.evaluate('1+1');
    expect(mockPage.evaluate).toHaveBeenCalledWith('1+1');
  });

  describe('--frame OOPIF routing (click/fill handlers)', () => {
    function createFrameCtx(): { ctx: BrowserCommandContext; page: Page } {
      const page = createMockPage();
      (page as unknown as Record<string, unknown>).clickInFrame = vi.fn().mockResolvedValue({ x: 54, y: 247 });
      (page as unknown as Record<string, unknown>).fillInFrame = vi.fn().mockResolvedValue({ value: '403357' });
      const ctx = {
        page,
        browser: {},
        browserContext: {},
        sessionId: 'test-session',
        args: [],
        options: {},
        cwd: '/tmp',
        storage: { get: vi.fn(), set: vi.fn(), delete: vi.fn(), clear: vi.fn(), keys: vi.fn() },
        output: { mode: 'text', showTips: false, color: false, emoji: false },
        error: vi.fn(),
        config: {},
        site: {} as never,
        cliName: 'xbrowser',
      } as unknown as BrowserCommandContext;
      return { ctx, page };
    }

    it('click --frame resolves selector inside the OOPIF and returns frame-local coords', async () => {
      const { ctx, page } = createFrameCtx();
      const { clickCommand } = await import('../../src/commands/interaction.js');
      const result = await clickCommand.handler(
        { selector: '.tc-fg-item.tc-slider-normal', waitCaptcha: false, waitCaptchaTimeout: 180000, frame: 'captcha.gtimg.com' },
        ctx
      );
      expect(page.clickInFrame).toHaveBeenCalledWith('captcha.gtimg.com', '.tc-fg-item.tc-slider-normal');
      expect(page.click).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        data: { selector: '.tc-fg-item.tc-slider-normal', frame: 'captcha.gtimg.com', x: 54, y: 247 },
        tips: [],
      });
    });

    it('fill --frame uses fillInFrame and reports readback value', async () => {
      const { ctx, page } = createFrameCtx();
      const { fillCommand } = await import('../../src/commands/interaction.js');
      const result = await fillCommand.handler(
        { selector: '#sms-code', value: '403357', frame: 'captcha.gtimg.com' },
        ctx
      );
      expect(page.fillInFrame).toHaveBeenCalledWith('captcha.gtimg.com', '#sms-code', '403357');
      expect(page.fill).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        data: { selector: '#sms-code', value: '403357', cleared: true, frame: 'captcha.gtimg.com' },
        tips: [],
      });
    });

    it('global ctx.frame applies when command-level --frame absent', async () => {
      const { ctx, page } = createFrameCtx();
      ctx.frame = 'pay.example.com';
      const { clickCommand } = await import('../../src/commands/interaction.js');
      await clickCommand.handler(
        { selector: '#pay-btn', waitCaptcha: false, waitCaptchaTimeout: 180000 },
        ctx
      );
      expect(page.clickInFrame).toHaveBeenCalledWith('pay.example.com', '#pay-btn');
    });
  });
});
