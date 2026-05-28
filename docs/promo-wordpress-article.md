# I Replaced 50-Line Puppeteer Scripts with Single CLI Commands — Here's How

Last month I spent 3 hours debugging a Puppeteer script. The task? Go to Hacker News, click the top story, scrape the content, and save it. That's it. Three actions. Three hours — because the selector changed, the page loaded slower than my timeout, and the async/await chain threw an error I couldn't reproduce locally.

![Hero - Terminal browser automation](https://raw.githubusercontent.com/dyyz1993/xbrowser/master/docs/promo-images/hero-banner.png)

That's when I decided to build [xbrowser](https://xbrowser.dev) — a CLI tool that treats browser automation as commands, not code. One line to search Google. One line to scrape any page. One line to chain a complete multi-step workflow. No scripts. No async management. No boilerplate. Think of it as the **web scraping CLI** that sits between Playwright and curl — purpose-built for developers who need to interact with the web, not test it.

```bash
# What took me 50 lines of Puppeteer
xbrowser "goto https://news.ycombinator.com , click '.titleline > a' , text"
```

That's it. One command. Readable. Replayable. Done.

## Why I Couldn't Keep Using Puppeteer and Playwright

Don't get me wrong — Playwright is incredible for testing. Selenium pioneered the space. But I'm not testing web apps. I'm *using* the web: scraping competitors, checking SEO rankings, automating my social media posting, monitoring price changes. And **every headless browser tutorial** I found was about testing, not about building real web scraping pipelines or automation workflows.

For those tasks, the testing tools feel like using a sledgehammer to hang a picture frame:

**The setup tax is real.** Every new task means `npm init`, install dependencies, download a browser, write boilerplate. I just want to scrape one page — why do I need a project?

**Scripts don't compose.** My "scrape Hacker News" script doesn't help me "scrape Reddit." The selectors are different, the structure is different, but the core operation is the same: go to URL, extract content.

**AI agents can't use them.** I build AI tools, and giving an LLM a 50-line async script to manage is a recipe for hallucinated selectors and broken promises. Agents need simple, declarative commands.

I wanted `curl` for interactive browser tasks. So I built it.

## Install Once, Automate Everything

```bash
npm i -g @dyyz1993/xbrowser
```

That's the entire setup. No WebDriver. No config files. xbrowser ships with its own managed Chromium that includes CDP fingerprint protection — sites can't easily detect automation.

From there, you have 35+ composable commands at your fingertips.

## Feature 1: Search the Web From Your Terminal

No API keys. No OAuth. No rate limits. Just search.

```bash
# Google
xbrowser search "best headless browser 2026" --engine google --num 10

# Bing
xbrowser search "best headless browser 2026" --engine bing --num 10

# Baidu (for Chinese-language results)
xbrowser search "无头浏览器自动化" --engine baidu --num 10
```

![Multi-engine search visualization](https://raw.githubusercontent.com/dyyz1993/xbrowser/master/docs/promo-images/multi-engine-search.png)

Each command returns structured JSON: titles, URLs, snippets. Pipe to `jq`, save to file, or feed directly into your AI agent's context.

**Real use case:** I track how my open-source project ranks across search engines. Every Monday I run:

```bash
xbrowser search "xbrowser browser automation" --engine google --num 30 \
  | jq '.results[] | select(.url | contains("xbrowser.dev")) | .position'
```

Takes 5 seconds. No script. No API key. Just results.

## Feature 2: Scrape Without Writing a Scraper

The `scrape` command handles JavaScript rendering, lazy-loaded content, and complex layouts — and outputs clean Markdown by default. It's the **web scraping tool** I always wished Playwright had built in:

```bash
# Any page → clean Markdown
xbrowser scrape https://example.com/blog/my-article

# Crawl an entire site (respects robots.txt)
xbrowser crawl https://example.com --depth 3 --max-pages 100

# Generate a complete URL map
xbrowser map https://example.com
```

![Web scraping concept](https://raw.githubusercontent.com/dyyz1993/xbrowser/master/docs/promo-images/web-scraping.png)

I use `scrape` daily for:
- **Content research**: Scrape competitor articles → feed to LLM for analysis
- **SEO auditing**: Map all URLs on a site, check for orphaned pages
- **Documentation**: Scrape API docs and convert to Markdown for offline reading
- **Web crawler workflows**: Chain scrape with crawl for bulk data extraction

The `crawl` command follows internal links, respects `robots.txt`, deduplicates URLs, and handles SPA hash routes. It's an ethical, complete **web crawler** in one command.

## Feature 3: Chain Commands — The Real Magic

This is the feature that makes people say "wait, you can do that?"

Instead of writing scripts, you chain operations with 6 operators (`&&`, `,`, `+`, `->`, `;`, `||`):

```bash
# Go to a page, click the top link, extract text
xbrowser "goto https://news.ycombinator.com , click '.titleline > a:first-of-type' , text"

# Complete workflow: navigate → fill form → submit → extract
xbrowser "goto https://app.example.com/login \
  + fill '#email' 'user@example.com' \
  + fill '#password' 'secret' \
  + click '#login' \
  -> wait '#dashboard' \
  , screenshot --output dashboard.png"
```

![Command chaining pipeline](https://raw.githubusercontent.com/dyyz1993/xbrowser/master/docs/promo-images/command-chaining.png)

The syntax reads like natural language. `&&` means "then and only then" (stop on error). `,` means "do all of these." `->` means "pipe to next." `||` means "fallback if failed."

**For AI agent developers**, this is transformative. Instead of generating 50-line scripts, your agent constructs a single chain string:

```
User: "Go to Hacker News, click the top story, and summarize it"

Agent builds:
xbrowser "goto https://news.ycombinator.com , click '.titleline > a:first-of-type' , text"
```

No async. No error handling boilerplate. No debugging. Just intent → command → result.

## Feature 4: Record Once, Replay Forever

Some workflows are too complex for a one-liner. That's where recording comes in:

```bash
# Start recording (opens visible browser)
xbrowser record start --url https://example.com

# Do your thing — click around, fill forms, navigate
# xbrowser captures every action

# Stop and save
xbrowser record stop --output my-workflow.yaml

# Replay headlessly anytime
xbrowser replay my-workflow.yaml --headless

# Export to Python, JavaScript, or Bash
xbrowser convert my-workflow.yaml --lang python --output workflow.py
```

![Record and replay workflow](https://raw.githubusercontent.com/dyyz1993/xbrowser/master/docs/promo-images/record-replay.png)

I use this for:
- **Daily standup reports**: Record the Jira → Confluence navigation once, replay every morning
- **Price monitoring**: Record a competitor's pricing page, replay daily, diff the output
- **Onboarding**: Record a complex internal tool setup, give new hires the replay script

The `convert` command is particularly powerful — it auto-generates working Puppeteer/Playwright/Selenium scripts from your recorded actions. Record in the browser, ship as code.

## Feature 5: 68 Plugins for Every Platform

![Plugin ecosystem](https://raw.githubusercontent.com/dyyz1993/xbrowser/master/docs/promo-images/plugin-ecosystem.png)

xbrowser ships with 68 built-in plugins that encapsulate site-specific knowledge:

| Category | Plugins |
|----------|---------|
| **Search Engines** | Google, Bing, Baidu |
| **AI Assistants** | DeepSeek, ChatGPT, Claude, Doubao, QianWen, YuanBao |
| **Social Media** | Twitter/X, Reddit, Quora, Weibo, Zhihu, XiaoHongShu, Douyin |
| **Developer** | GitHub, Dev.to, Medium, Hashnode, CSDN, Juejin |
| **Image Platforms** | Unsplash, Pexels, Pinterest, Getty, Shutterstock, and 15 more |
| **E-Commerce** | Taobao, JD, 1688 |
| **SEO** | Backlink analysis, site audit, keyword tracking |

Each plugin provides high-level commands tailored to that platform:

```bash
# GitHub: Get any user's profile
xbrowser github get-profile --username torvalds

# Unsplash: Search and download images
xbrowser unsplash search "mountain sunset" --download first

# Doubao: Generate AI images
xbrowser doubao image --prompt "cyberpunk city at sunset" --cdp 9221

# SEO: Audit any page
xbrowser seo audit https://your-website.com
```

No selectors to write. No DOM to inspect. The plugin handles the complexity.

## When to Use xbrowser vs. Playwright vs. Selenium

I'll be direct:

| | xbrowser | Playwright | Selenium |
|---|---|---|---|
| **Best for** | Web tasks & automation | App testing | Legacy testing |
| **Setup** | `npm i -g` (1 step) | npm + browser download | npm + WebDriver |
| **Learning curve** | CLI commands | JavaScript API | Language bindings |
| **Search/Scrape** | Built-in helpers | Write it yourself | Write it yourself |
| **Plugins** | 68 built-in | None | None |
| **Anti-detection** | Built-in CDP protection | Third-party plugins | External tools |
| **AI agent friendly** | ✅ CLI commands | ❌ Scripts | ❌ Scripts |
| **Test framework** | Not a test tool | ⭐ Best in class | Good |

**Use Playwright** for testing your web app. **Use xbrowser** for everything else.

## Real-World Workflows I Run Daily

Here's what my actual automation looks like:

**Morning competitive check:**
```bash
xbrowser search "xbrowser alternatives" --engine google --num 20 --json > /tmp/competitors.json
xbrowser search "browser automation CLI" --engine bing --num 20 --json >> /tmp/competitors.json
```

**Weekly SEO audit:**
```bash
xbrowser map https://xbrowser.dev > /tmp/sitemap.txt
xbrowser seo audit https://xbrowser.dev --json > /tmp/seo-report.json
```

**Content research for blog posts:**
```bash
xbrowser scrape https://competitor-blog.com/latest-post | llm summarize
```

**AI search intelligence** (query 14 AI engines at once):
```bash
xbrowser ai-search-engines "how to do browser automation in 2026"
```

Each of these would be a 30-80 line Puppeteer script. With xbrowser, they're single commands I can alias, schedule with cron, or embed in AI agent workflows.

## Get Started in 30 Seconds

```bash
npm i -g @dyyz1993/xbrowser
xbrowser search "hello world" --engine google
```

That's it. Two commands and you're automating the web.

- **Docs & examples**: [xbrowser.dev](https://xbrowser.dev)
- **Source code**: [github.com/dyyz1993/xbrowser](https://github.com/dyyz1993/xbrowser) (MIT license)
- **68 plugins**: Search, scrape, crawl, record, replay, and automate 68+ platforms

If you're tired of writing 50-line scripts for tasks that should take one command — or if you're building AI agents that need to browse the web — give it a try.

## Tags

`browser automation` `web scraping` `playwright alternative` `puppeteer alternative` `selenium alternative` `CLI tool` `headless browser` `web crawler` `SEO tool` `AI agent` `open source`

---

*xbrowser is open source under the MIT license. Install with `npm i -g @dyyz1993/xbrowser`. Full docs at [xbrowser.dev](https://xbrowser.dev).*
