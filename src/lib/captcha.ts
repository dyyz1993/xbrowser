import type { Page } from '../browser-shim.js';

export interface CaptchaInfo {
  type: 'hcaptcha' | 'recaptcha' | 'turnstile' | 'unknown';
  selector: string;
  iframeUrl?: string;
}

const CAPTCHA_SELECTORS: Record<string, string> = {
  hcaptcha: 'iframe[src*="hcaptcha.com"]',
  recaptcha: 'iframe[src*="recaptcha"]',
  turnstile: 'iframe[src*="challenges.cloudflare.com/turnstile"]',
  generic: '#captcha, .captcha-container, [class*="captcha"]',
};

export async function detectCaptcha(page: Page): Promise<CaptchaInfo | null> {
  for (const [type, selector] of Object.entries(CAPTCHA_SELECTORS)) {
    const el = await page.$(selector);
    if (el) {
      const iframeUrl = await el.getAttribute('src').catch(() => undefined);
      return { type: type as CaptchaInfo['type'], selector, iframeUrl: iframeUrl || undefined };
    }
  }
  return null;
}

export async function waitForCaptchaSolved(
  page: Page,
  captchaInfo: CaptchaInfo,
  timeoutMs: number = 180000,
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    await page.waitForTimeout(2000);

    const el = await page.$(captchaInfo.selector);
    if (!el) {
      return true;
    }

    if (captchaInfo.type === 'hcaptcha') {
      const isChecked = await page.evaluate(() => {
        const cb = document.querySelector('.hcaptcha-checkbox-check');
        return cb?.getAttribute('aria-checked') === 'true';
      }).catch(() => false);
      if (isChecked) return true;
    }

    if (captchaInfo.type === 'recaptcha') {
      const textarea = await page.$('#g-recaptcha-response').catch(() => null);
      if (textarea) {
        const value = await textarea.getAttribute('value').catch(() => '');
        if (value && value.length > 0) return true;
      }
    }
  }

  return false;
}
