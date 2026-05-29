# I Just Wanted to Scrape One Page. Why Did I Write 50 Lines of Puppeteer?

Last Friday at 4:30 PM, my product manager walked over: "Hey, can you grab the titles from the Hacker News homepage and send me an Excel file?"

I thought: That's it? Five minutes tops.

Two hours later, I was still debugging CSS selectors.

## How Things Spiraled Out of Control

### Step 1: Initialize the Project

```bash
mkdir hacker-news-scraper && cd hacker-news-scraper
npm init -y
npm install puppeteer
```

Hit enter, waited three minutes. Puppeteer needs to download a full Chromium browser — over 200 MB. I stared at the progress bar and started questioning my life choices.

### Step 2: Write the Code

"It's just a `document.querySelectorAll`, right?" That's what I thought. Then I opened my editor:

```javascript
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  try {
    await page.goto('https://news.ycombinator.com', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    await page.waitForSelector('.titleline > a', {
      timeout: 10000
    });

    const titles = await page.evaluate(() => {
      const items = document.querySelectorAll('.titleline > a');
      return Array.from(items).map(el => ({
        title: el.textContent,
        url: el.href
      }));
    });

    console.log(JSON.stringify(titles, null, 2));
  } catch (err) {
    console.error('Scraping failed:', err.message);
  } finally {
    await browser.close();
  }
})();
```

I counted: 27 lines. And this is the minimal version — no User-Agent spoofing, no retry logic, no proxy support, no concurrency control. Add all of that and you're well past 50 lines.

### Step 3: Run It

```bash
node index.js
```

Error: `Navigation timeout of 30000 ms exceeded`.

Switched to `domcontentloaded`, got past that. But then `waitForSelector` timed out — because `.titleline` was a relatively new class name. Hacker News had silently changed it from `.storylink` at some point, and nobody sent me the memo.

### Step 4: Debug

Set `headless: false`, watched the browser open. Oh right, the selector did change. Fixed it, ran it again, finally got results.

### Step 5: Wrap Up

Formatted the data as CSV, sent it to the PM. Then deleted the project directory — because I knew the next time someone wanted to scrape a different website, none of this code would be reusable.

**Total time: two hours.** For 30 titles.

## Why Is "Simple" Browser Scraping So Complicated?

Let's think about this calmly. Where does the complexity come from?

### The Framework Is Overkill

Puppeteer and Playwright are, at their core, **browser testing frameworks**. They're designed for developers writing complex E2E test suites — simulating user logins, filling out forms, verifying page states. Scraping webpage titles? That's maybe 1% of what they can do, but you pay the price for the other 99%.

Installing Puppeteer literally installs an entire browser on your machine. It's like wanting to open a can of soup and having to assemble an entire kitchen first.

### Starting from Scratch Every Time

I wrote a scraper for Hacker News. Can I reuse it for Reddit? Nope. Different selectors, different loading strategies, different anti-bot measures. Every website is a brand new adventure.

There's no "I scraped this site before" memory, no universal selector strategy, no ability to automatically adapt when pages change. Every single time, you start from zero.

### The async/await Marathon

Look at any Puppeteer script — it's a sea of `await`:

```javascript
await browser.launch()
await browser.newPage()
await page.goto()
await page.waitForSelector()
await page.evaluate()
await browser.close()
```

Every single operation is asynchronous. Every one needs `await`. I'm not saying async is bad — browser operations genuinely need to be async. But for an "open page, grab data" task, the cognitive overhead is excessive.

### Error Handling Explosion

Timeouts, missing elements, network errors, page redirects, SSL errors… every step can fail, every step needs a try-catch. A robust scraping script often has more error handling code than actual business logic.

```javascript
try {
  await page.goto(url, { timeout: 30000 });
} catch (e) {
  if (e.name === 'TimeoutError') {
    // Retry with a different waitUntil strategy?
  } else {
    // Actually broken?
  }
}

try {
  await page.waitForSelector(sel, { timeout: 10000 });
} catch (e) {
  // Selector changed? Page not loaded? Blocked by anti-bot?
}
```

You think you're scraping data, but you're actually writing an error-handling framework.

### Not Reusable

Switch to a different website and everything changes — selectors, loading strategies, anti-bot mechanisms. The only reusable part from your last script is the `puppeteer.launch()` boilerplate. Everything else gets rewritten.

It's like having to reinvent the knife every time you want to cook a meal.

## What If Browser Operations Were as Simple as curl?

curl is beautifully simple:

```bash
curl https://api.github.com/users/octocat | jq '.login'
```

One line, you get your data. But curl has a fatal flaw: **it doesn't execute JavaScript**.

It's 2026. A huge number of websites are client-side rendered. When you curl them, you get an empty HTML shell and a bunch of `<script>` tags. The actual data only appears after a browser executes the JavaScript.

So what we need is a **curl that can execute JavaScript**.

Not a testing framework. Not a browser automation library. Just a command-line tool. You give it a command, it gives you data. Done.

## What Can One Line Do?

Let's go back to the Hacker News titles scenario:

```bash
xbrowser scrape https://news.ycombinator.com
```

That's it. The page content in Markdown format goes straight to your terminal.

Only want the titles? Add a selector:

```bash
xbrowser goto https://news.ycombinator.com , text --selector ".titleline"
```

Want JSON output?

```bash
xbrowser goto https://news.ycombinator.com , text --selector ".titleline" --json
```

No `npm init`. No `async/await`. No try-catch. One command, results come out.

### Search Engine Results

PM says: "Check where our company ranks on Google for 'AI agent'."

The traditional approach? Fire up Puppeteer, simulate a search, parse the SERP page, handle Google's dynamic loading… another 50 lines right there.

Now:

```bash
xbrowser search "AI agent" --engine google --limit 10 --full
```

Returns titles, URLs, and summaries. Supports Google, Bing, Baidu, DuckDuckGo — multiple engines out of the box.

### Screenshots

"Take a screenshot of this page."

```bash
xbrowser goto https://news.ycombinator.com , screenshot --full-page
```

Full-page screenshot. No need to worry about browser window size, lazy-loaded images, or viewport settings.

### Fill and Submit Forms

"Test the signup flow."

```bash
xbrowser goto https://example.com/signup , fill "#email" "test@example.com" , fill "#password" "123456" , click "#submit" , screenshot
```

Comma-separated command chain, one line. As natural as writing a shell pipeline.

### Monitor Page Changes

"Notify me when this price drops below 500."

```bash
while true; do
  xbrowser text --selector ".price" | grep -q "^4[0-9][0-9]$" && notify-send "Price dropped!"
  sleep 3600
done
```

Integrates naturally with cron, shell scripts, CI/CD pipelines. Because it's a command-line tool, not an API library.

## It's Not Just About "Simple"

You might be thinking: Isn't this just Puppeteer wrapped in a CLI?

Not quite. There's a **fundamentally different philosophy** behind this.

### Waterfall vs. Faucet

Puppeteer and Playwright are like a waterfall — powerful, but you have to stand underneath to collect water, and you'll get drenched in the process. You have to manage async operations, handle lifecycles, write boilerplate.

A CLI tool should be like a faucet — turn it on, water comes out. Turn it off, it stops. Simple, direct, on-demand.

### Framework vs. Tool

A framework demands you think its way. You must understand its conceptual model: Browser → Page → Frame → Element, each step is async, each step can fail.

A tool should think your way. What do you want? "Open this page" — `goto`. "Get this text" — `text`. "Take a screenshot" — `screenshot`. Simple as that.

### Programming Interface vs. Command Interface

The flexibility of a programming interface (API) is irreplaceable — complex automation scenarios genuinely need fine-grained control. But for 80% of "open a page, grab some data" use cases, a command interface (CLI) is 10x more efficient.

Think of it like Git: you *can* use libgit2 to write a program that manipulates your repository, but most of the time you just run `git commit -m "xxx"` and call it a day.

## When to Use What?

To be clear: I'm not saying Puppeteer or Playwright are bad. They're incredibly powerful in their domain. The problem is using them for the wrong jobs.

| Scenario | Recommended Tool |
|----------|-----------------|
| Scrape one page's data | CLI |
| Extract search engine results | CLI |
| Quick screenshot | CLI |
| Integrate with shell scripts | CLI |
| Complex E2E test suites | Playwright |
| Fine-grained browser control | Puppeteer |
| Performance testing | Lighthouse / k6 |
| Large-scale crawling systems | Scrapy / Custom |

Tools should fit the scenario, not the other way around. Using a sledgehammer to drive a nail isn't the hammer's fault — it's yours.

## Back to That Friday Afternoon

If I'd had this tool back then, my Friday would have gone like this:

```bash
xbrowser scrape https://news.ycombinator.com > hn.md
```

Three seconds. Then I'd toss the Markdown file to the PM and get back to my actual work.

Not because the technology is revolutionary, but because **the tool matches the scale of the problem**.

Scraping one page's titles should never require a full project setup.

---

*I built [xbrowser](https://github.com/dyyz1993/xbrowser) to solve exactly this — a tool that turns browser operations into command-line commands. If you're also tired of writing full projects for one-off scraping tasks, give it a try.*
