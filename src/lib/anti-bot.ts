/**
 * xbrowser — Anti-Bot Detection
 *
 * 主动检测页面的反机器人检测机制，在执行自动化动作前拦截可疑情况。
 */

import type { Page } from '../browser-shim.js';

/**
 * 检测结果类型
 */
export interface DetectionResult {
  detected: boolean;          // 是否检测到反机器人机制
  type?: string;              // 检测类型：captcha | warning | blocked | login
  severity?: 'low' | 'medium' | 'high';  // 严重程度
  message?: string;           // 检测到的具体信息
  selector?: string;          // 触发检测的元素选择器
  actionRequired?: 'retry' | 'manual' | 'switch';  // 需要的用户操作
}

/**
 * 检测器配置
 */
export interface DetectionConfig {
  checkCaptcha?: boolean;     // 检测验证码（默认 true）
  checkWarning?: boolean;     // 检测警告文本（默认 true）
  checkBlocked?: boolean;     // 检测被阻断页面（默认 true）
  checkLogin?: boolean;       // 检测未登录状态（默认 false）
  checkWebdriver?: boolean;   // 检测 webdriver 标记暴露（默认 true）
  timeout?: number;           // 检测超时（ms，默认 5000）
}

/**
 * 常见的验证码 iframe 模式
 */
const CAPTCHA_PATTERNS = [
  { name: 'reCAPTCHA', pattern: /recaptcha/i },
  { name: 'hCaptcha', pattern: /hcaptcha/i },
  { name: 'Turnstile', pattern: /turnstile/i },
  { name: 'Cloudflare', pattern: /cloudflare/i },
  { name: 'FunCaptcha', pattern: /funcaptcha/i },
  { name: 'AWS WAF', pattern: /aws.*challenge/i },
];

/**
 * 常见的反机器人检测文本
 */
const WARNING_TEXTS = [
  { text: 'detected as bot', severity: 'high' as const },
  { text: 'suspicious activity', severity: 'high' as const },
  { text: 'unusual traffic', severity: 'high' as const },
  { text: 'please verify you are human', severity: 'medium' as const },
  { text: 'access denied', severity: 'high' as const },
  // 裸词 "blocked" 会误伤大量正常页面（"unblocked"、adblock 检测脚本文本、
  // CSS-in-JS 字符串等，实测 doubao.com），只匹配完整阻断短语
  { text: 'you have been blocked', severity: 'high' as const },
  { text: 'your access has been blocked', severity: 'high' as const },
  { text: 'access blocked', severity: 'high' as const },
  { text: 'rate limit', severity: 'medium' as const },
  { text: 'too many requests', severity: 'medium' as const },
  { text: '验证', severity: 'low' as const },
  { text: '验证码', severity: 'low' as const },
];

/**
 * 常见的阻断页面 URL 模式
 */
const BLOCKED_URL_PATTERNS = [
  { name: 'Cloudflare Challenge', pattern: /challenge-platform/i },
  { name: 'Cloudflare Captcha', pattern: /cf-challenge/i },
  { name: 'AWS WAF', pattern: /aws-waf/i },
  { name: 'Generic Captcha', pattern: /captcha/i },
];

/**
 * 执行主动检测
 */
export async function detectAntiBot(
  page: Page,
  config: DetectionConfig = {}
): Promise<DetectionResult> {
  const {
    checkCaptcha = true,
    checkWarning = true,
    checkBlocked = true,
    checkLogin = false,
    checkWebdriver = true,
  } = config;

  const result: DetectionResult = {
    detected: false,
  };

  // 1. 检测验证码
  if (checkCaptcha) {
    const captchaResult = await detectCaptcha(page);
    if (captchaResult.detected) {
      return captchaResult;
    }
  }

  // 2. 检测警告文本
  if (checkWarning) {
    const warningResult = await detectWarningText(page);
    if (warningResult.detected) {
      return warningResult;
    }
  }

  // 3. 检测阻断页面
  if (checkBlocked) {
    const blockedResult = await detectBlockedPage(page);
    if (blockedResult.detected) {
      return blockedResult;
    }
  }

  // 4. 检测 webdriver 标记暴露
  if (checkWebdriver) {
    const webdriverResult = await detectWebdriverExposure(page);
    if (webdriverResult.detected) {
      return webdriverResult;
    }
  }

  // 5. 检测未登录状态（可选）
  if (checkLogin) {
    const loginResult = await detectLoginRequired(page);
    if (loginResult.detected) {
      return loginResult;
    }
  }

  return result;
}

/**
 * 检测验证码
 */
async function detectCaptcha(page: Page): Promise<DetectionResult> {
  try {
    // 检查 iframe src
    const iframes = await page.frames();
    for (const iframe of iframes) {
      const src = iframe.url();
      for (const pattern of CAPTCHA_PATTERNS) {
        if (pattern.pattern.test(src)) {
          return {
            detected: true,
            type: 'captcha',
            severity: 'high',
            message: `Detected ${pattern.name} CAPTCHA (iframe: ${src})`,
            selector: `iframe[src*="${pattern.name.toLowerCase()}"]`,
            actionRequired: 'manual',
          };
        }
      }
    }

    // 检查常见的验证码元素
    const captchaSelectors = [
      '.g-recaptcha',
      '#captcha',
      '[class*="captcha"]',
      '[id*="captcha"]',
      'iframe[src*="recaptcha"]',
      'iframe[src*="hcaptcha"]',
      'iframe[src*="turnstile"]',
    ];

    for (const selector of captchaSelectors) {
      const element = await page.$(selector).catch(() => null);
      if (element) {
        // Must verify visibility — many sites keep CAPTCHA containers in the
        // DOM but hidden off-screen (e.g. position:absolute; top:-1000000px)
        // until the user actually triggers a challenge. Without this check,
        // every click on such a page would be falsely blocked.
        const visible = await element.isVisible().catch(() => false);
        if (!visible) continue;
        // Additionally, reject elements that have been moved far off-screen
        // (some sites hide via transform/position rather than display:none).
        try {
          const box = await element.boundingBox();
          if (box && (box.y < -1000 || box.x < -1000)) continue;
        } catch { /* ignore bounding box errors */ }

        return {
          detected: true,
          type: 'captcha',
          severity: 'high',
          message: `CAPTCHA element found: ${selector}`,
          selector,
          actionRequired: 'manual',
        };
      }
    }

    return { detected: false };
  } catch {
    return { detected: false };
  }
}

/**
 * 检测警告文本
 */
async function detectWarningText(page: Page): Promise<DetectionResult> {
  try {
    // 只扫可见文本（innerText）：textContent('body') 会把 <script>/<style>
    // 和隐藏元素的文本也算进来，正常页面里的脚本文本（如 adblock 检测脚本）
    // 会造成大面积误判（实测 doubao.com 因脚本文本含 "blocked" 被 fill 拒绝）
    const pageText = ((await page
      .evaluate(() => document.body?.innerText || '')
      .catch(() => '')) as string) || '';
    const lowerText = pageText.toLowerCase();

    for (const { text, severity } of WARNING_TEXTS) {
      if (lowerText.includes(text.toLowerCase())) {
        return {
          detected: true,
          type: 'warning',
          severity,
          message: `Anti-bot warning text found: "${text}"`,
          actionRequired: severity === 'high' ? 'manual' : 'retry',
        };
      }
    }

    return { detected: false };
  } catch {
    return { detected: false };
  }
}

/**
 * 检测阻断页面
 */
async function detectBlockedPage(page: Page): Promise<DetectionResult> {
  try {
    const url = page.url();

    for (const { name, pattern } of BLOCKED_URL_PATTERNS) {
      if (pattern.test(url)) {
        return {
          detected: true,
          type: 'blocked',
          severity: 'high',
          message: `Blocked page detected: ${name} (${url})`,
          actionRequired: 'manual',
        };
      }
    }

    return { detected: false };
  } catch {
    return { detected: false };
  }
}

/**
 * 检测 webdriver 标记暴露
 */
async function detectWebdriverExposure(page: Page): Promise<DetectionResult> {
  try {
    const webdriver = await page.evaluate<{ webdriver: boolean; webdriverScriptFn: boolean; webdriverEvaluate: boolean; chrome: boolean; permissions: unknown } | null>(() => {
      return {
        webdriver: navigator.webdriver,
        webdriverScriptFn: !!window.__webdriver_script_fn,
        webdriverEvaluate: !!window.__webdriver_evaluate,
        chrome: !!window.chrome,
        permissions: navigator.permissions,
      };
    }).catch(() => null);

    if (!webdriver) {
      return { detected: false };
    }

    const issues: string[] = [];
    if (webdriver.webdriver === true) {
      issues.push('navigator.webdriver === true');
    }
    if (webdriver.webdriverScriptFn) {
      issues.push('__webdriver_script_fn present');
    }
    if (webdriver.webdriverEvaluate) {
      issues.push('__webdriver_evaluate present');
    }
    if (!webdriver.chrome) {
      issues.push('window.chrome missing');
    }
    if (!webdriver.permissions) {
      issues.push('navigator.permissions missing');
    }

    if (issues.length > 0) {
      return {
        detected: true,
        type: 'warning',
        severity: 'high',
        message: `Automation markers exposed: ${issues.join(', ')}`,
        actionRequired: 'manual',
      };
    }

    return { detected: false };
  } catch {
    return { detected: false };
  }
}

/**
 * 检测未登录状态
 */
async function detectLoginRequired(page: Page): Promise<DetectionResult> {
  try {
    const loginSelectors = [
      'a[href*="login"]',
      'a[href*="signin"]',
      'a[href*="sign-in"]',
      'button:has-text("Log in")',
      'button:has-text("Sign in")',
      'button:has-text("Login")',
      'button:has-text("登录")',
    ];

    for (const selector of loginSelectors) {
      const element = await page.$(selector).catch(() => null);
      if (element) {
        // 简单的启发式：如果页面顶部有明显登录按钮，可能未登录
        const rect = await element.boundingBox().catch(() => null);
        if (rect && rect.y < 200) {  // 顶部区域
          return {
            detected: true,
            type: 'login',
            severity: 'medium',
            message: 'Login button detected in page header',
            selector,
            actionRequired: 'manual',
          };
        }
      }
    }

    return { detected: false };
  } catch {
    return { detected: false };
  }
}

/**
 * 格式化检测结果为用户友好的消息
 */
export function formatDetectionMessage(result: DetectionResult): string {
  if (!result.detected) {
    return '✅ No anti-bot detection detected.';
  }

  const emoji = result.severity === 'high' ? '🚨' : result.severity === 'medium' ? '⚠️' : 'ℹ️';
  const action = result.actionRequired === 'manual' ? 'Please handle manually' :
                 result.actionRequired === 'retry' ? 'Consider retrying with delay' :
                 'Consider switching to a different session';

  return `${emoji} Detection: ${result.message}\n  Type: ${result.type}\n  Severity: ${result.severity}\n  Action: ${action}`;
}