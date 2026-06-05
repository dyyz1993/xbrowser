import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page, ElementHandle } from '../src/browser-shim.js';
import { CaptchaDetector } from '../src/captcha-detector.js';

function mockElement(visible: boolean): ElementHandle<HTMLElement> {
  return {
    isVisible: vi.fn().mockResolvedValue(visible),
  } as unknown as ElementHandle<HTMLElement>;
}

function createMockPage(options: {
  elements?: Record<string, ElementHandle<HTMLElement> | null>;
  bodyText?: string;
}): Page {
  return {
    $: vi.fn((selector: string) => {
      if (options.elements && selector in options.elements) {
        return Promise.resolve(options.elements[selector]);
      }
      return Promise.resolve(null);
    }),
    textContent: vi.fn(() => Promise.resolve(options.bodyText ?? '')),
  } as unknown as Page;
}

describe('CaptchaDetector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return not detected for clean page', async () => {
    const page = createMockPage({});
    const result = await CaptchaDetector.detect(page);
    expect(result.detected).toBe(false);
    expect(result.confidence).toBe('low');
  });

  it('should detect reCAPTCHA iframe with high confidence', async () => {
    const page = createMockPage({
      elements: {
        'iframe[src*="recaptcha"]': mockElement(true),
      },
    });
    const result = await CaptchaDetector.detect(page);
    expect(result.detected).toBe(true);
    expect(result.type).toBe('recaptcha');
    expect(result.confidence).toBe('high');
    expect(result.selector).toBe('iframe[src*="recaptcha"]');
  });

  it('should detect hCaptcha with high confidence', async () => {
    const page = createMockPage({
      elements: {
        '.h-captcha': mockElement(true),
      },
    });
    const result = await CaptchaDetector.detect(page);
    expect(result.detected).toBe(true);
    expect(result.type).toBe('hcaptcha');
    expect(result.confidence).toBe('high');
  });

  it('should detect Cloudflare Turnstile', async () => {
    const page = createMockPage({
      elements: {
        '.cf-turnstile': mockElement(true),
      },
    });
    const result = await CaptchaDetector.detect(page);
    expect(result.detected).toBe(true);
    expect(result.type).toBe('turnstile');
  });

  it('should skip invisible elements', async () => {
    const page = createMockPage({
      elements: {
        'iframe[src*="recaptcha"]': mockElement(false),
      },
    });
    const result = await CaptchaDetector.detect(page);
    expect(result.detected).toBe(false);
  });

  it('should detect via text patterns with low confidence', async () => {
    const page = createMockPage({
      bodyText: 'Please verify you are human by completing the puzzle',
    });
    const result = await CaptchaDetector.detect(page);
    expect(result.detected).toBe(true);
    expect(result.type).toBe('text-challenge');
    expect(result.confidence).toBe('low');
  });

  it('should detect "not a robot" text', async () => {
    const page = createMockPage({
      bodyText: 'Prove you are not a robot to continue',
    });
    const result = await CaptchaDetector.detect(page);
    expect(result.detected).toBe(true);
    expect(result.type).toBe('text-challenge');
  });

  it('should prefer selector match over text match', async () => {
    const page = createMockPage({
      elements: {
        '.g-recaptcha': mockElement(true),
      },
      bodyText: 'verify you are human',
    });
    const result = await CaptchaDetector.detect(page);
    expect(result.detected).toBe(true);
    expect(result.type).toBe('recaptcha');
    expect(result.confidence).toBe('high');
  });

  describe('isSolved', () => {
    it('should return true when element is gone', async () => {
      const page = createMockPage({
        elements: {},
      });
      const solved = await CaptchaDetector.isSolved(page, '.g-recaptcha');
      expect(solved).toBe(true);
    });

    it('should return true when element is hidden', async () => {
      const page = createMockPage({
        elements: {
          '.g-recaptcha': mockElement(false),
        },
      });
      const solved = await CaptchaDetector.isSolved(page, '.g-recaptcha');
      expect(solved).toBe(true);
    });

    it('should return false when CAPTCHA is still visible', async () => {
      const page = createMockPage({
        elements: {
          '.g-recaptcha': mockElement(true),
        },
      });
      const solved = await CaptchaDetector.isSolved(page, '.g-recaptcha');
      expect(solved).toBe(false);
    });

    it('should re-detect when no previous selector given', async () => {
      const page = createMockPage({});
      const solved = await CaptchaDetector.isSolved(page);
      expect(solved).toBe(true);
    });
  });
});
