import type { Page } from 'playwright';

/**
 * Result of a CAPTCHA detection scan.
 */
export interface CaptchaDetectionResult {
  detected: boolean;
  type?: string;
  selector?: string;
  confidence: 'high' | 'medium' | 'low';
}

interface CaptchaSelectorRule {
  selector: string;
  type: string;
  confidence: 'high' | 'medium' | 'low';
}

const CAPTCHA_SELECTORS: CaptchaSelectorRule[] = [
  { selector: 'iframe[src*="recaptcha"]', type: 'recaptcha', confidence: 'high' },
  { selector: '.g-recaptcha', type: 'recaptcha', confidence: 'high' },
  { selector: '#recaptcha', type: 'recaptcha', confidence: 'high' },
  { selector: '[data-sitekey]', type: 'recaptcha', confidence: 'medium' },

  { selector: 'iframe[src*="hcaptcha"]', type: 'hcaptcha', confidence: 'high' },
  { selector: '.h-captcha', type: 'hcaptcha', confidence: 'high' },

  { selector: 'iframe[src*="challenges.cloudflare.com"]', type: 'turnstile', confidence: 'high' },
  { selector: '.cf-turnstile', type: 'turnstile', confidence: 'high' },

  { selector: 'iframe[src*="captcha"]', type: 'generic', confidence: 'medium' },
  { selector: '[data-captcha]', type: 'generic', confidence: 'medium' },
  { selector: '.captcha-container', type: 'generic', confidence: 'medium' },
  { selector: '#captcha', type: 'generic', confidence: 'medium' },
  { selector: '.captcha-image', type: 'generic', confidence: 'medium' },
  { selector: '#captcha_image', type: 'generic', confidence: 'medium' },
];

const CAPTCHA_TEXT_PATTERNS = [
  'verify you are human',
  'prove you are not a robot',
  'complete the challenge',
  'are you a robot',
  'human verification',
  'security check',
  "prove you're human",
  'not a robot',
];

/**
 * Detect CAPTCHAs on the current page using selector-based rules and text patterns.
 *
 * Supports reCAPTCHA, hCaptcha, Cloudflare Turnstile, and generic CAPTCHAs.
 */
export class CaptchaDetector {
  /**
   * Scan the page for visible CAPTCHA elements or challenge text.
   *
   * @param page - The Playwright page to scan.
   * @returns Detection result with type, selector, and confidence level.
   */
  static async detect(page: Page): Promise<CaptchaDetectionResult> {
    for (const rule of CAPTCHA_SELECTORS) {
      try {
        const el = await page.$(rule.selector);
        if (el) {
          const visible = await el.isVisible().catch(() => false);
          if (visible) {
            return {
              detected: true,
              type: rule.type,
              selector: rule.selector,
              confidence: rule.confidence,
            };
          }
        }
      } catch {
        // selector might not be valid on this page, continue
      }
    }

    try {
      const bodyText = await page.textContent('body').catch(() => '');
      if (bodyText) {
        const lower = bodyText.toLowerCase();
        for (const pattern of CAPTCHA_TEXT_PATTERNS) {
          if (lower.includes(pattern)) {
            return {
              detected: true,
              type: 'text-challenge',
              confidence: 'low',
            };
          }
        }
      }
    } catch {
      // ignore text extraction failures
    }

    return { detected: false, confidence: 'low' };
  }

  /**
   * Check whether a previously detected CAPTCHA has been solved.
   *
   * @param page - The Playwright page to check.
   * @param previousSelector - The selector from a previous detection result.
   * @returns `true` if the CAPTCHA is no longer visible.
   */
  static async isSolved(page: Page, previousSelector?: string): Promise<boolean> {
    if (previousSelector) {
      try {
        const el = await page.$(previousSelector);
        if (!el) return true;
        const visible = await el.isVisible().catch(() => false);
        if (!visible) return true;
      } catch {
        return true;
      }
    }

    const result = await this.detect(page);
    return !result.detected;
  }
}
