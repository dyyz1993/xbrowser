import { describe, it, expect, vi } from 'vitest';
import { detectAntiBot, formatDetectionMessage } from '../src/lib/anti-bot.js';
import type { DetectionResult } from '../src/lib/anti-bot.js';

function makeElement(options: {
  visible: boolean;
  box?: { x: number; y: number } | null;
}) {
  return {
    isVisible: vi.fn().mockResolvedValue(options.visible),
    boundingBox: vi.fn().mockResolvedValue(options.box),
  };
}

function makePage(options: {
  elements?: unknown[];
  visibleText?: string;
  url?: string;
}) {
  return {
    $: vi.fn().mockImplementation(async (_selector: string) => {
      const index = options.elements?.findIndex((element) => element) ?? -1;
      return index >= 0 ? options.elements?.[index] : null;
    }),
    evaluate: vi.fn().mockImplementation(async () => options.visibleText ?? ''),
    frames: vi.fn().mockResolvedValue([]),
    url: vi.fn().mockReturnValue(options.url ?? 'https://example.com'),
  };
}

describe('formatDetectionMessage', () => {
  it('should format not-detected result', () => {
    const result: DetectionResult = { detected: false };
    const msg = formatDetectionMessage(result);
    expect(msg).toContain('No anti-bot');
    expect(msg).toContain('✅');
  });

  it('should format high severity with alarm emoji', () => {
    const result: DetectionResult = {
      detected: true,
      type: 'captcha',
      severity: 'high',
      message: 'reCAPTCHA detected',
      actionRequired: 'manual',
    };
    const msg = formatDetectionMessage(result);
    expect(msg).toContain('🚨');
    expect(msg).toContain('reCAPTCHA detected');
    expect(msg).toContain('high');
    expect(msg).toContain('manually');
  });

  it('should format medium severity with warning emoji', () => {
    const result: DetectionResult = {
      detected: true,
      type: 'warning',
      severity: 'medium',
      message: 'Rate limited',
      actionRequired: 'retry',
    };
    const msg = formatDetectionMessage(result);
    expect(msg).toContain('⚠️');
    expect(msg).toContain('retrying');
  });

  it('should format low severity with info emoji', () => {
    const result: DetectionResult = {
      detected: true,
      type: 'warning',
      severity: 'low',
      message: '验证码',
      actionRequired: 'switch',
    };
    const msg = formatDetectionMessage(result);
    expect(msg).toContain('ℹ️');
    expect(msg).toContain('switching');
  });

  it('should handle undefined severity and action', () => {
    const result: DetectionResult = {
      detected: true,
      message: 'Something detected',
    };
    const msg = formatDetectionMessage(result);
    expect(msg).toContain('Something detected');
  });
});

describe('detectAntiBot false-positive guards', () => {
  it('ignores hidden CAPTCHA containers kept in the DOM', async () => {
    const page = makePage({ elements: [makeElement({ visible: false })] });

    await expect(
      detectAntiBot(page as never, { checkWebdriver: false }),
    ).resolves.toEqual({ detected: false });
    expect(page.$).toHaveBeenCalledWith('[class*="captcha"]');
  });

  it('ignores CAPTCHA containers moved far off-screen', async () => {
    const page = makePage({
      elements: [makeElement({ visible: true, box: { x: 0, y: -100001 } })],
    });

    await expect(
      detectAntiBot(page as never, { checkWebdriver: false }),
    ).resolves.toEqual({ detected: false });
  });

  it('does not treat hidden script/style text containing blocked as a warning', async () => {
    const page = makePage({
      elements: [],
      visibleText: 'This page is unblocked and supports adblock detection',
    });

    await expect(
      detectAntiBot(page as never, { checkWebdriver: false }),
    ).resolves.toEqual({ detected: false });
  });

  it('detects explicit visible access-blocked copy', async () => {
    const page = makePage({
      elements: [],
      visibleText: 'Access blocked after unusual traffic',
    });

    const result = await detectAntiBot(page as never, { checkWebdriver: false });

    expect(result.detected).toBe(true);
    expect(result.type).toBe('warning');
    expect(result.message).toContain('unusual traffic');
  });
});
