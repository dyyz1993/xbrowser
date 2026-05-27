# Automate Browser Tasks with xbrowser: A Developer's Guide to Web Automation

Browser automation has been stuck in a rut for years. The dominant tools — Selenium, Puppeteer, Playwright — are powerful, but they're built for testing, not for real-world task automation. You want to scrape a competitor's pricing page? Write a 40-line script. Need to search Google and Bing simultaneously and compare results? That's another script. Want to chain a login flow with a data extraction step? Now you're managing async state, waiting for selectors, and praying nothing times out.

I've been writing browser automation code for years, and I kept running into the same friction: too much boilerplate for tasks that should take one command. That frustration led me to [xbrowser](https://xbrowser.dev), a CLI tool designed specifically for developers and AI agents who need to get things done in a browser without writing a full test suite every time.

## The Problem with Current Tools

Let's be clear — Playwright and Selenium are excellent at what they do. If you're writing end-to-end tests for a web application, they're the right choice. But when your use case shifts from "test my app" to "interact with the web," the cracks start to show:

- **Heavy setup**: You need a Node.js project, dependency installation, browser downloads, and boilerplate before you can even navigate to a page.
- **Script-first**: Every task requires writing a script. There's no quick "just do this one thing" mode.
- **No domain helpers**: Want to search Google? You're navigating to google.com, typing in a selector, waiting for results, and parsing the DOM yourself.
- **Not agent-friendly**: AI agents need simple, composable commands. A 50-line async script is the opposite of that.

What I wanted was something like `curl` but for interactive browser tasks — a single command that handles the complexity and gives me the result.

## Enter xbrowser

[xbrowser](https://github.com/dyyz1993/xbrowser) is an open-source (MIT) browser automation CLI that ships as a single npm package:

```bash
npm i -g @dyyz1993/xbrowser
```

That's the entire installation. No separate browser download, no WebDriver setup, no configuration files. It comes with a managed Chromium build that includes CDP fingerprint protection — meaning the sites you visit can't easily detect that you're running an automated browser.

The tool is designed around composable commands that map to real-world tasks rather than low-level browser APIs. Let me walk through the core features.

## Multi-Engine Search

Searching the web from the command line shouldn't require an API key. xbrowser handles the browser interaction for you:

```bash
# Search Google
xbrowser search "headless browser automation tools" --engine google --num 10

# Search Bing
xbrowser search "headless browser automation tools" --engine bing --num 10

# Search Baidu (for Chinese-language results)
xbrowser search "无头浏览器自动化工具" --engine baidu --num 10
```

Each command returns structured results with titles, URLs, and snippets. You can pipe them into `jq` for filtering, save them to a file, or feed them directly into an AI agent's context.

This is particularly useful for competitive analysis. Want to see how your brand ranks across search engines?

```bash
# Compare your ranking position across engines
xbrowser search "my product name" --engine google --num 30 | jq '.results[] | select(.url | contains("myproduct.com"))'
```

No API keys, no rate limits to manage, no OAuth flows. Just search and get results.

## Web Scraping Without the Script

The `scrape` command extracts clean, structured content from any URL:

```bash
# Get page content as markdown
xbrowser scrape https://example.com/blog/my-article

# Crawl an entire site
xbrowser crawl https://example.com --depth 3 --max-pages 100

# Generate a URL sitemap
xbrowser map https://example.com
```

The `scrape` output is markdown by default, which means it's immediately usable — paste it into a document, feed it to an LLM, or parse it with standard text tools.

`crawl` follows internal links and respects depth limits, giving you a complete content snapshot of a site. `map` produces a flat list of every reachable URL, which is invaluable for SEO audits.

Here's a practical example — auditing your own site's internal link structure:

```bash
# Map all URLs on your site
xbrowser map https://mysite.com > sitemap.txt

# Find orphaned pages (in sitemap but not linked from other pages)
cat sitemap.txt | while read url; do
  count=$(xbrowser scrape "$url" | grep -c "href=")
  echo "$url: $count links"
done
```

## Chain Commands: The Power Move

This is the feature that sets xbrowser apart. Instead of writing multi-step scripts, you chain operations in a single command:

```bash
# Navigate, interact, and extract
xbrowser chain "goto https://news.ycombinator.com && click '.titleline > a' && scrape"

# Complete login flow with data extraction
xbrowser chain "goto https://app.example.com/login \
  && fill '#email' 'user@example.com' \
  && fill '#password' 'my-password' \
  && click '#login-button' \
  && wait '#dashboard' \
  && scrape '#dashboard'"
```

The chain syntax reads like natural language: go to this page, click this element, fill in that field, scrape the result. It mirrors how you'd describe the task to another person.

For AI agent workflows, this is a game-changer. An agent can construct chain commands dynamically based on user intent:

```
User: "Go to Hacker News, click the top story, and summarize it for me"

Agent constructs:
xbrowser chain "goto https://news.ycombinator.com && click '.titleline > a:first-of-type' && scrape"
```

No script generation, no debugging async code, no selector management. The agent just builds a chain string and executes it.

## SEO and Backlink Analysis

xbrowser ships with 67+ plugins, and the SEO suite is particularly comprehensive:

```bash
# Analyze backlinks for a domain
xbrowser seo backlinks --domain example.com

# Check on-page SEO factors
xbrowser seo audit https://example.com/page

# Analyze search engine results for a keyword
xbrowser search "target keyword" --engine google --num 30 --analyze
```

The backlink plugin crawls referring domains, checks link status, and reports on link quality metrics. The audit plugin checks meta tags, heading structure, image alt text, and other on-page factors.

For link-building workflows, you can combine search and scraping:

```bash
# Find guest post opportunities
xbrowser search "write for us + web development" --engine google --num 20 | \
  jq -r '.results[].url' | \
  while read url; do
    xbrowser scrape "$url" | grep -i "guidelines\|submit\|contribute"
  done
```

## Record and Replay

Sometimes you need to automate a complex workflow that's hard to express as a chain. That's where recording comes in:

```bash
# Start recording (opens a visible browser window)
xbrowser record my-workflow

# Do your thing — click around, fill forms, navigate

# Stop recording when done
# The workflow is saved as a replayable script

# Replay it headlessly
xbrowser replay my-workflow --headless
```

Record your workflow once in a visible browser, then replay it on a schedule or in CI. This is perfect for:

- Daily report generation that requires login
- Monitoring competitor pricing pages
- Regression testing without writing test code

## How It Compares

Let me be straightforward about when to use what:

| Feature | xbrowser | Playwright | Selenium |
|---------|----------|------------|----------|
| **Installation** | `npm i -g` (one step) | npm install + browser download | npm install + WebDriver |
| **CLI-first** | Yes | No (library-first) | No (library-first) |
| **Search helpers** | Google/Bing/Baidu built-in | None | None |
| **SEO plugins** | 67+ built-in | None | None |
| **Chain syntax** | `goto && click && scrape` | Requires script | Requires script |
| **Record/Replay** | Built-in | Codegen (code output) | IDE plugins |
| **Anti-detection** | CDP fingerprint protection | Basic stealth plugins | External tools |
| **Test framework** | Not designed for this | Primary use case | Primary use case |

The key distinction: [xbrowser](https://xbrowser.dev) is for **doing things on the web**. Playwright and Selenium are for **testing things on the web**. Different goals, different tools.

If you're building an AI agent that needs to browse the web, scrape data, perform SEO analysis, or automate repetitive browser tasks, xbrowser gives you composable commands that map directly to those tasks. If you're writing integration tests for your React app, stick with Playwright.

## Getting Started

```bash
npm i -g @dyyz1993/xbrowser
xbrowser --help
xbrowser search "hello world" --engine google
```

Three commands and you're up and running. The full documentation, plugin directory, and API reference are available at [xbrowser.dev](https://xbrowser.dev). The source code is on [GitHub](https://github.com/dyyz1993/xbrowser) under the MIT license.

If you're building AI agents that interact with the web, or if you're tired of writing 50-line scripts for tasks that should take one command, give it a try. Contributions and plugin submissions are welcome.

---

*xbrowser is open source under the MIT license. Install with `npm i -g @dyyz1993/xbrowser`. Docs and examples at [xbrowser.dev](https://xbrowser.dev).*
