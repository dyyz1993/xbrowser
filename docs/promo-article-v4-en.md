# My Web Scraper Died at 3 AM Because of reCAPTCHA

3:17 AM. My phone buzzed.

It was an alert from the monitoring system — the scheduled web scraper had crashed.

I grabbed my laptop, VPN'd into the server, and pulled the logs:

```
Error: ElementClickInterceptedException: element click intercepted
  by iframe element: <iframe src="https://www.google.com/recaptcha/...">
```

The page was stuck on a reCAPTCHA challenge.

Honestly, this wasn't the first time. Last month it was hCaptcha. The month before that, Cloudflare Turnstile. Same script every time: the target site upgrades their bot detection, my scraper gets caught off guard, data collection stops, and the downstream pipeline breaks.

I stared at that CAPTCHA widget on the screen and thought: **how am I supposed to deal with this?**

---

## Approach 1: Go Stealth — Hide Your Automation Traces

The first thing that comes to mind: "don't let them know you're a bot."

The Puppeteer community has a popular solution: `puppeteer-extra-plugin-stealth`. It patches various fingerprints that Headless Chrome exposes — `navigator.webdriver`, Chrome DevTools Protocol artifacts, missing plugin lists, and so on.

Here's what the code looks like:

```javascript
import puppeteer from 'puppeteer';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.goto('https://example.com/protected-page');

// Pretend to be human
await page.evaluate(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
});
```

Sounds great, right? The problem is — **it doesn't guarantee 100% effectiveness**.

Cloudflare's bot detection team is continuously upgrading their systems. The maintainers of stealth plugins are essentially playing a cat-and-mouse game. You patch something today, they come up with a new detection method tomorrow.

More critically, stealth only *reduces the probability* of triggering a CAPTCHA — it doesn't eliminate it. For a scheduled task that needs to run 24/7, "it probably won't trigger" isn't good enough.

**Verdict: Useful, but not a silver bullet. Good for reducing trigger frequency, but not suitable as your only line of defense.**

---

## Approach 2: Pay to Bypass — CAPTCHA Solving Services

If machines can't solve it, get a "smarter machine" to do it.

Services like 2Captcha, Anti-Captcha, and CapSolver work on a simple principle: you send them a screenshot of the CAPTCHA, they either use AI to solve it or dispatch it to a real human to click through, and they send you back the result.

```javascript
import { solve } from '2captcha-ts';

async function bypassCaptcha(page, siteKey) {
  const result = await solve({
    sitekey: siteKey,
    pageurl: page.url(),
    method: 'recaptcha'
  });

  await page.evaluate((token) => {
    document.querySelector('#g-recaptcha-response').value = token;
  }, result.data);

  await page.click('#submit-button');
}
```

Each solve costs about $0.001 to $0.003. Doesn't sound like much. But let's do the math:

- One scraping job hits 1,000 pages
- 30% of them trigger CAPTCHAs
- That's 300 × $0.003 = $0.90/day = ~$27/month

A few dozen dollars a month is still within budget. But the real problems aren't about money:

1. **Unstable success rates**: reCAPTCHA v3 scores users based on behavioral signals. The token returned by the solving service might not score high enough to pass verification.
2. **Privacy concerns**: You're sending the target site's URL and site key to a third party.
3. **High latency**: From submission to result, it can take 10 seconds on the fast end, or a minute or two on the slow end — seriously dragging down scraping speed.
4. **Ethical gray area**: CAPTCHAs exist to distinguish humans from machines. Paying real humans to solve them for your bot... well, you see the issue.

**Verdict: Functional, but cost, stability, and compliance are all questionable. Suitable for small-scale, non-critical use cases.**

---

## Approach 3: Guerrilla Warfare — Rotate Through Proxy Pools

Another approach: since too many requests from one IP triggers CAPTCHAs, just keep switching IPs.

```javascript
import puppeteer from 'puppeteer';

const proxyList = [
  'http://user:pass@proxy1:8080',
  'http://user:pass@proxy2:8080',
  'http://user:pass@proxy3:8080',
];

async function crawlWithProxy(url) {
  const proxy = proxyList[Math.floor(Math.random() * proxyList.length)];
  const browser = await puppeteer.launch({
    args: [`--proxy-server=${proxy}`]
  });
  const page = await browser.newPage();
  await page.goto(url);
  // ... scraping logic
}
```

Anyone who's used proxy pools knows the drill:

- **Free proxies**: Don't bother. If you can even connect, consider yourself lucky. Speed and reliability are essentially zero.
- **Paid proxies**: Residential proxies have the best quality but are expensive — dozens of dollars per GB. Data center proxies are cheaper but easier to detect.
- **Inconsistent quality**: Some IP ranges are already blacklisted by major websites. Buying them is basically throwing money away.

A friend of mine does e-commerce data collection. He spends over $2,000/month on proxies alone. He once told me, with complete sincerity: "My proxy bill is ten times my server bill."

**Verdict: Can reduce trigger frequency, but expensive, and effectiveness depends entirely on proxy quality. Suitable for teams with budgets.**

---

## Approach 4: Call for Help — Pause on CAPTCHA, Let a Human Handle It

The three approaches above share a common flaw: **they all try to "beat" the CAPTCHA**.

But think about it differently — CAPTCHAs exist for a reason. They're designed to tell humans and machines apart. So why not let a **human** handle it?

This is the core idea behind "human-in-the-loop" automation:

1. The automation script runs normally
2. When a CAPTCHA is detected, **pause immediately**
3. Notify a human (send a message, push a notification, open a preview link)
4. The human manually completes the CAPTCHA in the browser
5. The automation script resumes

### CAPTCHA Detection Logic

The first step is knowing when a CAPTCHA appears on the page. The detection logic is actually straightforward:

```javascript
const CAPTCHA_SELECTORS = [
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  'iframe[src*="challenges.cloudflare.com"]',
  'iframe[src*="turnstile"]',
  '.g-recaptcha',
  '.h-captcha',
  '#captcha',
  'div[data-sitekey]',
];

async function detectCaptcha(page) {
  for (const selector of CAPTCHA_SELECTORS) {
    try {
      const element = await page.$(selector);
      if (element) {
        const box = await element.boundingBox();
        return {
          detected: true,
          type: guessCaptchaType(selector),
          selector,
          position: box,
        };
      }
    } catch {
      // selector didn't match, skip
    }
  }
  return { detected: false };
}

function guessCaptchaType(selector) {
  if (selector.includes('recaptcha')) return 'reCAPTCHA';
  if (selector.includes('hcaptcha')) return 'hCaptcha';
  if (selector.includes('cloudflare') || selector.includes('turnstile')) return 'Cloudflare Turnstile';
  return 'unknown';
}
```

This covers the major CAPTCHA providers: Google reCAPTCHA, hCaptcha, and Cloudflare Turnstile. It uses iframe `src` attributes and class names for feature matching — simple but effective.

### What Happens After Detection?

Once a CAPTCHA is detected, the key is to let a real person **see the current page** and **manually interact** with it:

```javascript
async function handleCaptcha(page) {
  const captcha = await detectCaptcha(page);
  if (!captcha.detected) return false;

  console.log(`[CAPTCHA] ${captcha.type} detected. Pausing for human intervention...`);

  // Generate a live preview URL
  const previewUrl = `http://localhost:9222/devtools/inspector.html?ws=localhost:9222`;

  // Send notification (Slack, Telegram, Discord, etc.)
  await sendNotification({
    title: 'CAPTCHA detected — manual intervention needed',
    message: `Type: ${captcha.type}\nPreview: ${previewUrl}`,
    urgent: true,
  });

  // Poll until CAPTCHA disappears (human has solved it)
  while (true) {
    await sleep(2000);
    const check = await detectCaptcha(page);
    if (!check.detected) {
      console.log('[CAPTCHA] CAPTCHA resolved. Resuming...');
      break;
    }
  }

  return true;
}
```

### The Complete Workflow

Embed the detection logic into your normal scraping flow:

```javascript
async function smartCrawl(urls) {
  const browser = await puppeteer.launch({ headless: false }); // Note: non-headless mode
  const page = await browser.newPage();

  for (const url of urls) {
    await page.goto(url, { waitUntil: 'networkidle2' });

    // Check for CAPTCHA after every page load
    const blocked = await handleCaptcha(page);
    if (blocked) {
      // CAPTCHA handled, reload the page
      await page.reload({ waitUntil: 'networkidle2' });
    }

    // Normal scraping logic
    const data = await page.evaluate(() => {
      return {
        title: document.querySelector('h1')?.textContent,
        price: document.querySelector('.price')?.textContent,
      };
    });

    await saveData(data);
    await sleep(randomInt(1000, 3000)); // Random delay to mimic human behavior
  }
}
```

### Why This Approach Works

1. **100% success rate**: A real human solves the CAPTCHA. There's no such thing as "recognition failure."
2. **Zero extra cost**: No proxy pools, no CAPTCHA solving services.
3. **Compliant**: A real person is operating the browser. Nothing is being "bypassed."
4. **Resilient**: No matter how the target site upgrades their anti-bot system, the final step is always handled by a human.

Of course, the caveat is: **this approach requires that your use case doesn't need to be fully unattended**. For most small-to-medium scraping tasks, the occasional need for human intervention is perfectly acceptable.

---

## Back to That 3 AM Alert

Honestly, I don't really worry about CAPTCHAs anymore.

My approach is simple: **stealth plugin as the first line of defense to reduce trigger frequency, and when a CAPTCHA does appear, the script pauses and sends me a notification. I wake up, tap through it, and the scraper continues**.

It's cheaper than paying for CAPTCHA solving services, less hassle than maintaining proxy pools, and way more reliable than trying to outsmart the CAPTCHA.

CAPTCHAs exist for a reason. They protect websites from being overwhelmed by malicious bots. That's a valid design goal. Instead of trying to "beat" them, make your automation smart enough to know when to **ask for help**.

After all, **the best code isn't code that can solve every problem — it's code that knows when to get a human involved**.

---

If you want to try this "human-in-the-loop" approach, check out [xbrowser](https://github.com/xuyingzhou/xbrowser) — it has built-in CAPTCHA detection and live preview. When a CAPTCHA is detected, it automatically pauses and generates a preview link so you can take over with one click.
