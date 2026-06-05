import { launch } from '../src/cdp-driver/index.js';
import type { XBPage } from '../src/cdp-driver/types.js';

const STEPS: string[] = [];

async function safeClick(page: XBPage, selector: string): Promise<boolean> {
  const box = await page.evaluate<{ x: number; y: number; width: number; height: number } | null>((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }, selector);
  if (!box) return false;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return true;
}

async function safeClickByText(page: XBPage, text: string): Promise<boolean> {
  const box = await page.evaluate<{ x: number; y: number; width: number; height: number } | null>((t: string) => {
    const el = Array.from(document.querySelectorAll('button, a, div[role="button"], span, div'))
      .find(e => e.textContent?.trim() === t) as HTMLElement | undefined;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }, text);
  if (!box) return false;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return true;
}

async function run() {
  console.log('Connecting to CDP tunnel...');
  const { browser } = await launch({ cdpEndpoint: 'http://localhost:9221' });
  const ctx = browser.contexts()[0];
  if (!ctx) throw new Error('No browser context found');

  const page = await ctx.newPage();
  STEPS.push('Created new page');

  try {
    // Step 1: Navigate to signup
    console.log('Navigating to serper.dev signup...');
    await page.goto('https://serper.dev/signup', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: '/tmp/serper-01-signup-page.png' });
    STEPS.push('Navigated to signup page');
    console.log('Page URL:', page.url());

    // Step 2: Accept cookies if prompted
    const cookieAccepted = await safeClickByText(page, 'Accept all');
    if (cookieAccepted) {
      console.log('Accepted cookies');
      await page.waitForTimeout(1000);
      STEPS.push('Accepted cookies');
    } else {
      console.log('No cookie banner found');
    }

    // Step 3: Analyze form structure
    const formInfo = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      return inputs.map(i => ({
        type: i.type,
        name: i.name,
        id: i.id,
        placeholder: i.placeholder,
        ariaLabel: i.getAttribute('aria-label'),
        autocomplete: i.autocomplete,
      }));
    });
    console.log('Form fields:', JSON.stringify(formInfo, null, 2));
    STEPS.push('Form fields: ' + JSON.stringify(formInfo.map(f => ({ name: f.name, placeholder: f.placeholder, id: f.id }))));

    // Step 4: Fill form using evaluate to directly set values and dispatch React-compatible events
    const fillResult = await page.evaluate(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      
      function reactFill(selector: string, value: string): boolean {
        const el = document.querySelector(selector) as HTMLInputElement;
        if (!el) return false;
        nativeInputValueSetter?.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }

      // Try to fill each field
      const results: Record<string, boolean> = {};

      // First name
      const firstNameSelectors = [
        'input[name="firstName"]', 'input[name="first_name"]', 'input[name="firstname"]',
        'input[placeholder*="First"]', 'input[placeholder*="first"]',
        'input[autocomplete="given-name"]',
      ];
      for (const sel of firstNameSelectors) {
        if (reactFill(sel, 'Yingzhou')) { results.firstName = true; break; }
      }

      // Last name
      const lastNameSelectors = [
        'input[name="lastName"]', 'input[name="last_name"]', 'input[name="lastname"]',
        'input[placeholder*="Last"]', 'input[placeholder*="last"]',
        'input[autocomplete="family-name"]',
      ];
      for (const sel of lastNameSelectors) {
        if (reactFill(sel, 'Xu')) { results.lastName = true; break; }
      }

      // Email
      const emailSelectors = [
        'input[type="email"]', 'input[name="email"]',
        'input[placeholder*="Email"]', 'input[placeholder*="email"]',
        'input[autocomplete="email"]',
      ];
      for (const sel of emailSelectors) {
        if (reactFill(sel, 'dyyz1993@163.com')) { results.email = true; break; }
      }

      // Password
      const passwordSelectors = [
        'input[type="password"]', 'input[name="password"]',
        'input[placeholder*="Password"]', 'input[placeholder*="password"]',
        'input[autocomplete="new-password"]',
      ];
      for (const sel of passwordSelectors) {
        if (reactFill(sel, 'Xyz@Serper2026!')) { results.password = true; break; }
      }

      return results;
    });

    console.log('Fill results:', JSON.stringify(fillResult));
    STEPS.push('Filled form: ' + JSON.stringify(fillResult));
    await page.screenshot({ path: '/tmp/serper-02-form-filled.png' });

    // Step 5: Wait for Turnstile / Cloudflare
    console.log('Waiting for Turnstile...');
    let turnstileStatus = 'unknown';
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(1500);
      turnstileStatus = await page.evaluate(() => {
        const cfInput = document.querySelector('input[name="cf-turnstile-response"]') as HTMLInputElement;
        if (cfInput && cfInput.value) return 'completed';
        const turnstileFrame = document.querySelector('iframe[src*="turnstile"]');
        if (turnstileFrame) return 'iframe-present';
        return 'not-found';
      });
      console.log(`Turnstile check ${i}: ${turnstileStatus}`);
      if (turnstileStatus === 'completed') break;
    }
    STEPS.push('Turnstile: ' + turnstileStatus);
    await page.screenshot({ path: '/tmp/serper-03-turnstile.png' });

    // Step 6: Click submit
    console.log('Looking for submit button...');
    const submitBtnInfo = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.map(b => ({
        text: b.textContent?.trim(),
        type: b.type,
        disabled: b.disabled,
        classes: b.className,
      }));
    });
    console.log('Buttons:', JSON.stringify(submitBtnInfo, null, 2));

    // Try clicking submit
    let clicked = false;
    for (const text of ['Create account', 'Sign up', 'Register', 'Create Account', 'Submit']) {
      if (await safeClickByText(page, text)) {
        clicked = true;
        console.log(`Clicked: ${text}`);
        break;
      }
    }
    if (!clicked) {
      clicked = await safeClick(page, 'button[type="submit"]');
      console.log('Clicked button[type="submit"]:', clicked);
    }
    STEPS.push('Submit clicked: ' + clicked);
    
    // Wait for response
    await page.waitForTimeout(8000);
    await page.screenshot({ path: '/tmp/serper-04-after-submit.png' });
    console.log('After submit URL:', page.url());

    // Check page state
    const pageContent = await page.evaluate(() => document.body.innerText.substring(0, 3000));
    console.log('Page content (first 3000):', pageContent);

    // Step 7: Handle email verification if needed
    if (pageContent.toLowerCase().includes('verify') || pageContent.toLowerCase().includes('verification email') || pageContent.toLowerCase().includes('check your email') || pageContent.toLowerCase().includes('confirm your email')) {
      STEPS.push('Email verification required');
      console.log('Email verification needed, opening 163 mail...');

      const mailPage = await ctx.newPage();
      try {
        await mailPage.goto('https://mail.163.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await mailPage.waitForTimeout(5000);
        await mailPage.screenshot({ path: '/tmp/serper-05-mail.png' });
        STEPS.push('Opened 163 mail');

        // Get page content to understand the mail UI
        const mailText = await mailPage.evaluate(() => document.body.innerText.substring(0, 2000));
        console.log('Mail page text:', mailText);

        // Try clicking on inbox or looking for Serper email
        // Click on first unread or look for serper
        const foundSerper = await mailPage.evaluate(() => {
          const allElements = Array.from(document.querySelectorAll('td, span, a, div'));
          const serperEl = allElements.find(el => 
            el.textContent?.toLowerCase().includes('serper') && el.offsetParent !== null
          );
          if (serperEl) {
            (serperEl as HTMLElement).click();
            return true;
          }
          return false;
        });

        if (foundSerper) {
          STEPS.push('Found Serper email in inbox');
          await mailPage.waitForTimeout(5000);
          await mailPage.screenshot({ path: '/tmp/serper-06-email-opened.png' });

          // Extract verification link
          const verifyLink = await mailPage.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            const vLink = links.find(a =>
              a.href.includes('verify') || a.href.includes('confirm') || (a.href.includes('serper') && !a.href.includes('mail'))
            );
            return vLink?.href || null;
          });

          if (verifyLink) {
            STEPS.push('Verification link: ' + verifyLink);
            const vPage = await ctx.newPage();
            await vPage.goto(verifyLink, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await vPage.waitForTimeout(5000);
            await vPage.screenshot({ path: '/tmp/serper-07-verified.png' });
            STEPS.push('Opened verification link');
          }
        } else {
          STEPS.push('Serper email not found in inbox yet');
        }
      } catch (e) {
        STEPS.push('Mail error: ' + (e as Error).message);
        await mailPage.screenshot({ path: '/tmp/serper-05-mail-error.png' }).catch(() => {});
      }
    }

    // Step 8: Look for API key
    // Try to navigate to dashboard
    console.log('Looking for API key...');
    await page.goto('https://serper.dev/dashboard', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/tmp/serper-08-dashboard.png' });

    // Also try the API settings page
    const dashContent = await page.evaluate(() => document.body.innerText.substring(0, 3000));
    console.log('Dashboard content:', dashContent);

    // Look for API key in various ways
    const apiKey = await page.evaluate(() => {
      // Check input fields with readonly
      const readonlyInputs = Array.from(document.querySelectorAll('input[readonly]'));
      for (const input of readonlyInputs) {
        const val = (input as HTMLInputElement).value;
        if (val && val.length > 10) return val;
      }

      // Check code blocks
      const codeEls = document.querySelectorAll('code, pre, td');
      for (const el of codeEls) {
        const text = el.textContent?.trim();
        if (text && text.length > 20 && /^[a-f0-9]+$/i.test(text)) return text;
      }

      // Look in page text
      const bodyText = document.body.innerText;
      const keyPatterns = [
        /api[_-]?key[:\s]+([a-f0-9]{20,})/i,
        /(?:key|token)[:\s"]+([a-f0-9]{20,})/i,
      ];
      for (const pattern of keyPatterns) {
        const match = bodyText.match(pattern);
        if (match) return match[1];
      }

      return null;
    });

    STEPS.push(apiKey ? `API key found: ${apiKey.substring(0, 10)}...` : 'API key not found');

    const result = {
      success: !!apiKey,
      apiKey: apiKey || undefined,
      error: apiKey ? undefined : 'API key not found on dashboard. Check screenshots.',
      steps: STEPS,
      finalUrl: page.url(),
    };

    console.log('\n=== RESULT ===');
    console.log(JSON.stringify(result, null, 2));

  } catch (error) {
    await page.screenshot({ path: '/tmp/serper-error.png' }).catch(() => {});
    console.log('\n=== ERROR ===');
    console.log(JSON.stringify({
      success: false,
      error: (error as Error).message,
      steps: STEPS,
    }, null, 2));
  }
}

run().catch(console.error);
