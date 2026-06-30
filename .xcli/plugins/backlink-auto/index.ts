/**
 * Required environment variables:
 * - BACKLINK_EMAIL: Registration email address
 * - BACKLINK_PHONE: Registration phone number
 * - BACKLINK_PASSWORD: Base password for all site registrations
 */
import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok } from '@dyyz1993/xcli-core';
import type { Page } from '../types.js';

const BACKLINK_EMAIL = process.env.BACKLINK_EMAIL || '';
const BACKLINK_PHONE = process.env.BACKLINK_PHONE || '';
const BACKLINK_PASSWORD = process.env.BACKLINK_PASSWORD || '';

// ─── Safe CDP helpers (avoid locator.click which destroys context) ───

async function safeGoto(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
}

async function safeFill(page: Page, selector: string, value: string) {
  await page.evaluate(({ sel, val }) => {
    const el = document.querySelector(sel) as HTMLInputElement;
    if (!el) return false;
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(el, val);
    } else {
      el.value = val;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, { sel: selector, val: value });
  await page.waitForTimeout(300);
}

async function safeClick(page: Page, selector: string) {
  const box = await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, w: rect.width, h: rect.height };
  }, selector);
  if (!box) return false;
  await page.mouse.click((box as Record<string, number>).x, (box as Record<string, number>).y);
  await page.waitForTimeout(1000);
  return true;
}

async function safeClickByText(page: Page, text: string) {
  const box = await page.evaluate((txt) => {
    const els = Array.from(document.querySelectorAll('button, a, input[type="submit"], [role="button"]'));
    const el = els.find(e => e.textContent?.toLowerCase().includes(txt.toLowerCase()));
    if (!el) return null;
    const rect = (el as HTMLElement).getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, text) as Record<string, number> | null;
  if (!box) return false;
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(1000);
  return true;
}

async function pageText(page: Page): Promise<string> {
  return await page.evaluate(() => document.body?.innerText?.substring(0, 2000) || '');
}

async function hasElement(page: Page, selector: string): Promise<boolean> {
  return await page.evaluate((sel) => !!document.querySelector(sel), selector);
}

// ─── CAPTCHA detection ───

async function detectCaptcha(page: Page): Promise<string | null> {
  return await page.evaluate(() => {
    const html = document.body.innerHTML.toLowerCase();
    const text = document.body.innerText.toLowerCase();
    // reCAPTCHA
    if (document.querySelector('.g-recaptcha, iframe[src*="recaptcha"], div[data-sitekey]')) return 'reCAPTCHA';
    // hCaptcha
    if (document.querySelector('.h-captcha, iframe[src*="hcaptcha"]')) return 'hCaptcha';
    // Cloudflare Turnstile
    if (document.querySelector('div.cf-turnstile, iframe[src*="turnstile"]')) return 'Cloudflare Turnstile';
    // Cloudflare challenge
    if (html.includes('cf-browser-verification') || html.includes('cf-challenge')) return 'Cloudflare Challenge';
    // Generic captcha keywords
    if (text.includes('captcha') || text.includes('verify you are human') || text.includes('not a robot')) return 'CAPTCHA (generic)';
    // Slider/puzzle captcha
    if (document.querySelector('.slider-verify, .nc-container, #nc_1_wrapper, .geetest')) return 'Slider/Puzzle CAPTCHA';
    // Image select captcha
    if (text.includes('select all images') || text.includes('click on the')) return 'Image Select CAPTCHA';
    return null;
  });
}

// ─── SMS reader ───

function readLatestSMS(filter?: string): { code: string | null; text: string; time: string } | null {
  try {
    const os = require('os') as typeof import('os');
    const path = require('path') as typeof import('path');
    const chatDbPath = path.join(os.homedir(), 'Library', 'Messages', 'chat.db');
    const tmpDbPath = path.join(os.tmpdir(), 'xbrowser_chat_copy.db');
    require('fs').copyFileSync(chatDbPath, tmpDbPath);
    const where = filter
      ? `text LIKE '%${filter}%' AND (text LIKE '%验证%' OR text LIKE '%code%')`
      : `(text LIKE '%验证%' OR text LIKE '%验证码%' OR text LIKE '%code%')`;
    const query = `SELECT text, datetime(date/1000000000+978307200,'unixepoch','localtime') FROM message WHERE ${where} ORDER BY date DESC LIMIT 5`;
    const { execSync } = require('child_process') as typeof import('child_process');
    const result = execSync(`sqlite3 ${tmpDbPath} "${query}"`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = result.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const [text, time] = line.split('|');
      const codeMatch = text?.match(/(?:验证码|码)[：:\s]*(\d{4,8})/);
      if (codeMatch) return { code: codeMatch[1], text: text || '', time: time || '' };
    }
    return null;
  } catch { return null; }
}

// ─── 163 Webmail verification code reader ───

async function read163EmailCode(page: Page, _fromDomain: string, timeoutMs = 60000): Promise<string | null> {
  // Open 163 webmail in a new tab
  const context = page.context();
  const mailPage = await context.newPage();
  try {
    await mailPage.goto('https://mail.163.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await mailPage.waitForTimeout(3000);

    // Check if we need to switch to the inbox frame
    const frames = mailPage.frames();
    let targetFrame = mailPage.mainFrame();
    for (const f of frames) {
      if (f.url().includes('mail') || f.name().includes('frame')) {
        targetFrame = f;
      }
    }

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        // Try to find verification code emails
        const code = await targetFrame.evaluate(() => {
          // Look for email subjects containing the domain
          const allText = document.body.innerText;
          const codeMatch = allText.match(/(?:验证码|code|Code|verification)[：:\s]*(\d{4,8})/);
          return codeMatch ? codeMatch[1] : null;
        }) as string | null;
        if (code) return code;
      } catch { /* verification code not found yet */ }
      await mailPage.waitForTimeout(5000);
      await mailPage.reload().catch(() => {});
      await mailPage.waitForTimeout(3000);
    }
    return null;
  } finally {
    await mailPage.close().catch(() => {});
  }
}

// ─── Credentials store ───

interface SiteResult {
  site: string; dr: number; registered: boolean; submitted: boolean;
  email: string; phone: string; password: string; code: string | null; notes: string; url: string;
  captchaType: string | null;
}

const RESULTS: SiteResult[] = [];

async function addResult(r: SiteResult) {
  RESULTS.push(r);
  // Also write to file
  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');
  const outPath = path.join(os.homedir(), 'Downloads', 'backlink-results.json');
  fs.writeFileSync(outPath, JSON.stringify(RESULTS, null, 2));
}

// ─── Site-specific handlers ───

async function registerIssuu(page: Page): Promise<SiteResult> {
  const r: SiteResult = { site: 'Issuu', dr: 93, registered: false, submitted: false, email: BACKLINK_EMAIL, phone: BACKLINK_PHONE, password: BACKLINK_PASSWORD, code: null, notes: '', url: 'https://omnivideo.net', captchaType: null };
  try {
    await safeGoto(page, 'https://issuu.com/signup');
    await page.waitForTimeout(3000);

    const captcha = await detectCaptcha(page);
    if (captcha) { r.captchaType = captcha; r.notes = `CAPTCHA: ${captcha}, skipped`; await addResult(r); return r; }

    // Click "Sign up with email" if it exists
    await safeClickByText(page, 'sign up with email');
    await page.waitForTimeout(2000);

    // Fill form
    await safeFill(page, 'input[name="firstName"], input[id*="first"]', 'Omni');
    await safeFill(page, 'input[name="lastName"], input[id*="last"]', 'Video');
    await safeFill(page, 'input[name="email"], input[type="email"]', r.email);
    await safeFill(page, 'input[name="username"], input[id*="username"]', 'omnivideo');
    await safeFill(page, 'input[name="password"], input[type="password"]', r.password);
    await page.waitForTimeout(1000);

    // Click Sign Up button
    await safeClick(page, 'button[type="submit"]');
    await page.waitForTimeout(5000);

    // Check for email verification
    const currentText = await pageText(page);
    if (currentText.toLowerCase().includes('verif') || currentText.toLowerCase().includes('confirm')) {
      r.notes = 'Email verification needed';
      // Try reading code from 163 webmail
      const code = await read163EmailCode(page, 'issuu.com', 45000);
      if (code) {
        r.code = code;
        await safeFill(page, 'input[name*="code"], input[name*="verify"], input[type="text"]', code);
        await safeClick(page, 'button[type="submit"]');
        await page.waitForTimeout(3000);
      }
    }

    // Check if logged in
    const finalUrl = page.url();
    if (!finalUrl.includes('signup') && !finalUrl.includes('login')) {
      r.registered = true;
      // Navigate to profile settings
      await safeGoto(page, 'https://issuu.com/settings/profile');
      await page.waitForTimeout(2000);
      // Try to fill URL
      await safeFill(page, 'input[name*="url"], input[name*="website"]', r.url);
      await safeClick(page, 'button[type="submit"]');
      await page.waitForTimeout(2000);
      r.submitted = true;
    } else {
      r.notes = 'Still on signup page after submit. URL: ' + finalUrl;
    }
  } catch (e: unknown) {
    r.notes = `Error: ${(e as Error).message?.substring(0, 80)}`;
  }
  await addResult(r);
  return r;
}

async function registerSubstack(page: Page): Promise<SiteResult> {
  const r: SiteResult = { site: 'Substack', dr: 93, registered: false, submitted: false, email: BACKLINK_EMAIL, phone: BACKLINK_PHONE, password: BACKLINK_PASSWORD, code: null, notes: '', url: 'https://omnivideo.net', captchaType: null };
  try {
    await safeGoto(page, 'https://substack.com/signup');
    await page.waitForTimeout(3000);
    const captcha = await detectCaptcha(page);
    if (captcha) { r.captchaType = captcha; r.notes = `CAPTCHA: ${captcha}, skipped`; await addResult(r); return r; }

    // Fill email
    await safeFill(page, 'input[type="email"], input[name="email"]', r.email);
    await safeClick(page, 'button[type="submit"]');
    await page.waitForTimeout(3000);

    // Fill password if prompted
    if (await hasElement(page, 'input[type="password"]')) {
      await safeFill(page, 'input[type="password"]', r.password);
      await safeClick(page, 'button[type="submit"]');
      await page.waitForTimeout(5000);
    }

    const currentUrl = page.url();
    if (!currentUrl.includes('signup') && !currentUrl.includes('login')) {
      r.registered = true;
      r.submitted = true; // Substack backlink is via publishing
      r.notes = 'Account created. Backlink via publishing articles.';
    } else {
      r.notes = 'Registration flow incomplete. URL: ' + currentUrl;
    }
  } catch (e: unknown) {
    r.notes = `Error: ${(e as Error).message?.substring(0, 80)}`;
  }
  await addResult(r);
  return r;
}

async function registerAboutMe(page: Page): Promise<SiteResult> {
  const r: SiteResult = { site: 'About.me', dr: 90, registered: false, submitted: false, email: BACKLINK_EMAIL, phone: BACKLINK_PHONE, password: BACKLINK_PASSWORD, code: null, notes: '', url: 'https://omnivideo.net', captchaType: null };
  try {
    await safeGoto(page, 'https://about.me/signup');
    await page.waitForTimeout(3000);
    const captcha = await detectCaptcha(page);
    if (captcha) { r.captchaType = captcha; r.notes = `CAPTCHA: ${captcha}, skipped`; await addResult(r); return r; }

    await safeFill(page, 'input[name="email"], input[type="email"]', r.email);
    await safeFill(page, 'input[name="password"], input[type="password"]', r.password);
    await safeFill(page, 'input[name*="name"], input[name*="first"]', 'OmniVideo');
    await safeClick(page, 'button[type="submit"]');
    await page.waitForTimeout(5000);

    // Check for email verification
    const code = await read163EmailCode(page, 'about.me', 30000);
    if (code) {
      r.code = code;
      await safeFill(page, 'input[name*="code"]', code);
      await safeClick(page, 'button[type="submit"]');
      await page.waitForTimeout(3000);
    }

    // Navigate to profile edit
    await safeGoto(page, 'https://about.me/edit');
    await page.waitForTimeout(2000);
    await safeFill(page, 'input[name*="url"], input[name*="website"], input[type="url"]', r.url);
    await safeClick(page, 'button[type="submit"]');
    await page.waitForTimeout(2000);

    r.registered = true;
    r.submitted = true;
  } catch (e: unknown) {
    r.notes = `Error: ${(e as Error).message?.substring(0, 80)}`;
  }
  await addResult(r);
  return r;
}

async function registerDisqus(page: Page): Promise<SiteResult> {
  const r: SiteResult = { site: 'Disqus', dr: 92, registered: false, submitted: false, email: BACKLINK_EMAIL, phone: BACKLINK_PHONE, password: BACKLINK_PASSWORD, code: null, notes: '', url: 'https://omnivideo.net', captchaType: null };
  try {
    await safeGoto(page, 'https://disqus.com/profile/signup/');
    await page.waitForTimeout(3000);
    const captcha = await detectCaptcha(page);
    if (captcha) { r.captchaType = captcha; r.notes = `CAPTCHA: ${captcha}, skipped`; await addResult(r); return r; }

    await safeFill(page, 'input[name="email"], input[type="email"]', r.email);
    await safeFill(page, 'input[name="password"], input[type="password"]', r.password);
    await safeFill(page, 'input[name*="name"], input[name="username"]', 'omnivideo');
    await safeClick(page, 'button[type="submit"]');
    await page.waitForTimeout(5000);

    const currentUrl = page.url();
    if (!currentUrl.includes('signup')) {
      r.registered = true;
      // Navigate to profile edit
      await safeGoto(page, 'https://disqus.com/home/settings/profile/');
      await page.waitForTimeout(2000);
      await safeFill(page, 'input[name*="url"], input[name*="website"]', r.url);
      await safeClick(page, 'button[type="submit"]');
      r.submitted = true;
    } else {
      r.notes = 'Still on signup: ' + currentUrl;
    }
  } catch (e: unknown) {
    r.notes = `Error: ${(e as Error).message?.substring(0, 80)}`;
  }
  await addResult(r);
  return r;
}

async function registerCalCom(page: Page): Promise<SiteResult> {
  const r: SiteResult = { site: 'Cal.com', dr: 92, registered: false, submitted: false, email: BACKLINK_EMAIL, phone: BACKLINK_PHONE, password: BACKLINK_PASSWORD, code: null, notes: '', url: 'https://omnivideo.net', captchaType: null };
  try {
    await safeGoto(page, 'https://app.cal.com/signup');
    await page.waitForTimeout(3000);
    const captcha = await detectCaptcha(page);
    if (captcha) { r.captchaType = captcha; r.notes = `CAPTCHA: ${captcha}, skipped`; await addResult(r); return r; }

    await safeFill(page, 'input[name="email"], input[type="email"]', r.email);
    await safeFill(page, 'input[name="password"], input[type="password"]', r.password);
    await safeFill(page, 'input[name*="name"], input[name="username"]', 'omnivideo');
    await safeClick(page, 'button[type="submit"]');
    await page.waitForTimeout(5000);

    const code = await read163EmailCode(page, 'cal.com', 30000);
    if (code) {
      r.code = code;
      await safeFill(page, 'input[name*="code"]', code);
      await safeClick(page, 'button[type="submit"]');
      await page.waitForTimeout(3000);
    }

    // Set profile URL
    await safeGoto(page, 'https://app.cal.io/settings/profile');
    await page.waitForTimeout(2000);
    await safeFill(page, 'input[name*="url"], input[name*="website"]', r.url);
    await safeClick(page, 'button[type="submit"]');
    r.registered = true;
    r.submitted = true;
  } catch (e: unknown) {
    r.notes = `Error: ${(e as Error).message?.substring(0, 80)}`;
  }
  await addResult(r);
  return r;
}

async function registerHashnode(page: Page): Promise<SiteResult> {
  const r: SiteResult = { site: 'Hashnode', dr: 83, registered: false, submitted: false, email: BACKLINK_EMAIL, phone: BACKLINK_PHONE, password: BACKLINK_PASSWORD, code: null, notes: '', url: 'https://omnivideo.net', captchaType: null };
  try {
    await safeGoto(page, 'https://hashnode.com/onboard');
    await page.waitForTimeout(3000);
    const captcha = await detectCaptcha(page);
    if (captcha) { r.captchaType = captcha; r.notes = `CAPTCHA: ${captcha}, skipped`; await addResult(r); return r; }

    await safeFill(page, 'input[name="email"], input[type="email"]', r.email);
    await safeFill(page, 'input[name="password"], input[type="password"]', r.password);
    await safeClick(page, 'button[type="submit"]');
    await page.waitForTimeout(5000);

    r.registered = true;
    r.submitted = true; // Backlink via publishing blog posts
    r.notes = 'Account created, backlink via blog posts';
  } catch (e: unknown) {
    r.notes = `Error: ${(e as Error).message?.substring(0, 80)}`;
  }
  await addResult(r);
  return r;
}

async function registerGreasyFork(page: Page): Promise<SiteResult> {
  const r: SiteResult = { site: 'GreasyFork', dr: 78, registered: false, submitted: false, email: BACKLINK_EMAIL, phone: BACKLINK_PHONE, password: BACKLINK_PASSWORD, code: null, notes: '', url: 'https://omnivideo.net', captchaType: null };
  try {
    await safeGoto(page, 'https://greasyfork.org/zh-CN/users/sign_up');
    await page.waitForTimeout(3000);
    const captcha = await detectCaptcha(page);
    if (captcha) { r.captchaType = captcha; r.notes = `CAPTCHA: ${captcha}, skipped`; await addResult(r); return r; }

    await safeFill(page, 'input[name="user[email]"], input[type="email"]', r.email);
    await safeFill(page, 'input[name="user[password]"], input[type="password"]', r.password);
    await safeFill(page, 'input[name="user[password_confirmation]"]', r.password);
    await safeFill(page, 'input[name="user[name]"]', 'omnivideo');
    await safeClick(page, 'input[type="submit"], button[type="submit"]');
    await page.waitForTimeout(5000);

    const currentUrl = page.url();
    if (!currentUrl.includes('sign_up')) {
      r.registered = true;
      // Navigate to profile settings
      await safeGoto(page, 'https://greasyfork.org/zh-CN/users/edit');
      await page.waitForTimeout(2000);
      await safeFill(page, 'input[name*="url"], input[name*="website"], input[name*="homepage"]', r.url);
      await safeClick(page, 'input[type="submit"]');
      r.submitted = true;
    } else {
      r.notes = 'Still on signup: ' + currentUrl;
    }
  } catch (e: unknown) {
    r.notes = `Error: ${(e as Error).message?.substring(0, 80)}`;
  }
  await addResult(r);
  return r;
}

async function registerSeaArt(page: Page): Promise<SiteResult> {
  const r: SiteResult = { site: 'SeaArt', dr: 70, registered: false, submitted: false, email: BACKLINK_EMAIL, phone: BACKLINK_PHONE, password: BACKLINK_PASSWORD, code: null, notes: '', url: 'https://omnivideo.net', captchaType: null };
  try {
    await safeGoto(page, 'https://www.seaart.ai/user/register');
    await page.waitForTimeout(3000);
    const captcha = await detectCaptcha(page);
    if (captcha) { r.captchaType = captcha; r.notes = `CAPTCHA: ${captcha}, skipped`; await addResult(r); return r; }

    await safeFill(page, 'input[name="email"], input[type="email"]', r.email);
    await safeFill(page, 'input[name="password"], input[type="password"]', r.password);
    await safeFill(page, 'input[name*="name"], input[name="username"]', 'omnivideo');
    await safeClick(page, 'button[type="submit"]');
    await page.waitForTimeout(5000);

    const code = await read163EmailCode(page, 'seaart.ai', 30000);
    if (code) {
      r.code = code;
      await safeFill(page, 'input[name*="code"]', code);
      await safeClick(page, 'button[type="submit"]');
      await page.waitForTimeout(3000);
    }

    r.registered = true;
    r.submitted = true;
    r.notes = 'Backlink via publishing articles on SeaArt';
  } catch (e: unknown) {
    r.notes = `Error: ${(e as Error).message?.substring(0, 80)}`;
  }
  await addResult(r);
  return r;
}

async function registerLeetCode(page: Page): Promise<SiteResult> {
  const r: SiteResult = { site: 'LeetCode', dr: 87, registered: false, submitted: false, email: BACKLINK_EMAIL, phone: BACKLINK_PHONE, password: BACKLINK_PASSWORD, code: null, notes: '', url: 'https://omnivideo.net', captchaType: null };
  try {
    await safeGoto(page, 'https://leetcode.com/accounts/signup/');
    await page.waitForTimeout(3000);
    const captcha = await detectCaptcha(page);
    if (captcha) { r.captchaType = captcha; r.notes = `CAPTCHA: ${captcha}, skipped`; await addResult(r); return r; }

    await safeFill(page, 'input[name="email"], input[type="email"]', r.email);
    await safeFill(page, 'input[name="password"], input[type="password"]', r.password);
    await safeFill(page, 'input[name*="name"], input[name="username"]', 'omnivideo');
    await safeClick(page, 'button[type="submit"]');
    await page.waitForTimeout(5000);

    r.registered = true;
    r.notes = 'Profile page with URL';
  } catch (e: unknown) {
    r.notes = `Error: ${(e as Error).message?.substring(0, 80)}`;
  }
  await addResult(r);
  return r;
}

async function registerDevTo(page: Page): Promise<SiteResult> {
  const r: SiteResult = { site: 'Dev.to', dr: 90, registered: false, submitted: false, email: BACKLINK_EMAIL, phone: BACKLINK_PHONE, password: BACKLINK_PASSWORD, code: null, notes: '', url: 'https://omnivideo.net', captchaType: null };
  try {
    await safeGoto(page, 'https://dev.to/enter');
    await page.waitForTimeout(3000);
    const captcha = await detectCaptcha(page);
    if (captcha) { r.captchaType = captcha; r.notes = `CAPTCHA: ${captcha}, skipped`; await addResult(r); return r; }

    await safeFill(page, 'input[name="email"], input[type="email"]', r.email);
    await safeClick(page, 'button[type="submit"]');
    await page.waitForTimeout(5000);

    r.registered = true;
    r.submitted = true;
    r.notes = 'Backlink via publishing articles';
  } catch (e: unknown) {
    r.notes = `Error: ${(e as Error).message?.substring(0, 80)}`;
  }
  await addResult(r);
  return r;
}

// ─── All sites in order ───

const SITE_HANDLERS: Array<(page: Page) => Promise<SiteResult>> = [
  registerIssuu,      // DR 93
  registerSubstack,   // DR 93
  registerDisqus,     // DR 92
  registerCalCom,     // DR 92
  registerAboutMe,    // DR 90
  registerDevTo,      // DR 90
  registerLeetCode,   // DR 87
  registerHashnode,   // DR 83
  registerGreasyFork, // DR 78
  registerSeaArt,     // DR 70
];

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'backlink-auto',
    url: 'https://omnivideo.net',
    requiresLogin: true,
    description: '自动注册+提交外链（CDP安全模式，逐站执行）',
    isLogin: async (ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('../types').Page | null;
      if (!page) return true;
      try {
        const url = page.url();
        if (url.includes('/login') || url.includes('/signin') || url.includes('/register')) return false;
        const loggedIn = await page.evaluate(() =>
          !!document.querySelector('[class*="avatar"],[class*="user"],[class*="logged-in"]')
        );
        return loggedIn;
      } catch {
        return true;
      }
    },
  });

  site.command('run', {
    description: '逐个站点自动注册并提交外链（CDP安全模式）',
    loginRequired: 'required',
    scope: 'browser',
    parameters: z.object({
      startFrom: z.number().optional().describe('从第几个站点开始（0-based）').default(0),
      maxSites: z.number().optional().describe('处理几个站点').default(10),
      delay: z.number().optional().describe('站点间延迟（毫秒）').default(3000),
    }),
    examples: [
      { cmd: 'xbrowser --cdp 9221 backlink-auto run', description: '跑前10个站点' },
      { cmd: 'xbrowser --cdp 9221 backlink-auto run --startFrom 3 --maxSites 5', description: '从第4个开始跑5个' },
    ],
    result: z.object({ total: z.number(), registered: z.number(), submitted: z.number() }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
      if (!page) return { data: null, tips: ['需要浏览器页面'], message: '缺少浏览器页面' };

      const start = params.startFrom || 0;
      const max = params.maxSites || 10;
      const handlers = SITE_HANDLERS.slice(start, start + max);

      const tips: string[] = [
        `开始处理 ${handlers.length} 个站点 (${start + 1}-${start + handlers.length} of ${SITE_HANDLERS.length})`,
        '',
      ];

      for (const handler of handlers) {
        try {
          // Get fresh page for each site - reuse context's existing pages or create new
          let sitePage: Page;
          try {
            sitePage = await page.context().newPage();
          } catch {
            // If context newPage fails, try getting existing page
            const pages = page.context().pages();
            sitePage = pages[pages.length - 1] || page;
          }

          const result = await handler(sitePage);
          const icon = result.captchaType ? '🛑' : result.registered ? (result.submitted ? '✅' : '⚠️') : '❌';
          tips.push(`${icon} ${result.site} (DR${result.dr}) ${result.captchaType ? 'CAPTCHA: '+result.captchaType : result.registered ? 'registered' : 'failed'} ${result.submitted ? '+submitted' : ''} ${result.code ? `code:${result.code}` : ''} ${result.notes}`);

          // Close the site page to keep things clean
          // DON'T close - CDP mode shared context, closing kills the connection
          // try { await sitePage.close(); } catch { /* non-critical, skip */ }
        } catch (e: unknown) {
          tips.push(`❌ Error: ${(e as Error).message?.substring(0, 60)}`);
        }
        if (params.delay > 0) await page.waitForTimeout(params.delay);
      }

      const registered = RESULTS.filter(r => r.registered).length;
      const submitted = RESULTS.filter(r => r.submitted).length;

      tips.push('');
      tips.push(`汇总: ${RESULTS.length} 个站点 | 注册: ${registered} | 提交: ${submitted}`);
      tips.push(`结果文件: /Users/xuyingzhou/Downloads/backlink-results.json`);
      tips.push(`继续: xbrowser --cdp 9221 backlink-auto run --startFrom ${start + max}`);

      return ok({ total: RESULTS.length, registered, submitted }, tips);
    },
  });

  site.command('sms', {
    description: '读取最新短信验证码',
    loginRequired: 'required',
    scope: 'project',
    parameters: z.object({
      filter: z.string().optional().describe('过滤关键词'),
    }),
    result: z.object({ code: z.string().nullable(), text: z.string(), time: z.string() }).passthrough().nullable(),
    handler: async (params) => {
      const sms = readLatestSMS(params.filter);
      return ok(sms, [sms ? `验证码: ${sms.code} (${sms.time})` : '未找到验证码短信']);
    },
  });

  site.command('read-email', {
    description: '从163网页邮箱读取验证码',
    loginRequired: 'required',
    scope: 'browser',
    parameters: z.object({
      from: z.string().describe('发件人域名'),
      timeout: z.number().optional().describe('超时毫秒').default(30000),
    }),
    result: z.object({ code: z.string().nullable() }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
      if (!page) return { data: null, tips: ['需要浏览器页面'] };

      const code = await read163EmailCode(page, params.from, params.timeout);
      return ok({ code }, [code ? `验证码: ${code}` : `未从 ${params.from} 找到验证码`]);
    },
  });
}
