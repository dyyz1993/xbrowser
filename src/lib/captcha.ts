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
  // Single evaluate instead of page.$ per selector: the DOM agent can be
  // permanently unresponsive on freshly-attached tab sessions (d07), where
  // every DOM.getDocument call hung to its timeout. Runtime.evaluate works
  // everywhere — one round trip, no DOM dependency.
  const hit = await page.evaluate<{ type: string; selector: string; iframeUrl?: string } | null>(`
    (function() {
      var S = ${JSON.stringify(CAPTCHA_SELECTORS)};
      for (var type in S) {
        var sel = S[type];
        var el;
        try { el = document.querySelector(sel); } catch (e) { continue; }
        if (el) {
          var url = el.getAttribute && el.getAttribute('src');
          return { type: type, selector: sel, iframeUrl: url || undefined };
        }
      }
      return null;
    })()
  `).catch(() => null);
  if (!hit) return null;
  return { type: hit.type as CaptchaInfo['type'], selector: hit.selector, iframeUrl: hit.iframeUrl || undefined };
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
