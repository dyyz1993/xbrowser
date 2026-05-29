# xbrowser: Browser Automation CLI for AI Agents

A quick-reference cheatsheet for [xbrowser](https://xbrowser.dev) — the CLI that turns any AI agent into a browser power user.

> `npm i -g @xbrowser/cli`

## Why This Exists

If you've ever tried to wire Playwright into an agent loop, you know the pain: boilerplate setup, flaky selectors, and zero help with real-world tasks like SEO analysis or multi-engine search. xbrowser was built to fill that gap — a single binary that handles navigation, scraping, search, SEO auditing, and more, all from the command line.

Full docs at [xbrowser.dev](https://xbrowser.dev). Open source (MIT) on [GitHub](https://github.com/dyyz1993/xbrowser).

---

## 1. Search Across Google, Bing, and Baidu

One command, three engines. No API keys needed.

```bash
# Google search
xbrowser search "best headless browser tools" --engine google

# Compare results across engines
xbrowser search "AI agent frameworks 2025" --engine bing --num 20
xbrowser search "AI agent frameworks 2025" --engine baidu --num 20
```

Pipe results into jq, save to file, or feed them directly into your agent's context window.

## 2. Scrape, Crawl, and Map — No Setup

```bash
# Extract clean text from any page
xbrowser scrape https://example.com

# Crawl an entire site (respects depth limits)
xbrowser crawl https://example.com --depth 2 --max-pages 50

# Generate a URL sitemap
xbrowser map https://example.com
```

The `scrape` command returns structured markdown by default. `crawl` handles pagination and follows internal links. `map` gives you a flat list of every reachable URL — useful for SEO audits.

## 3. Chain Commands Together

This is where xbrowser gets interesting for agent workflows. Instead of writing scripts, you chain operations inline:

```bash
# Navigate, click, and extract — all in one line
xbrowser chain "goto https://news.ycombinator.com && click .titleline > a && scrape"

# Log in and grab dashboard data
xbrowser chain "goto https://app.example.com/login \
  && fill '#email' 'user@example.com' \
  && fill '#password' 'secret' \
  && click '#submit' \
  && scrape '#dashboard'"
```

Chain syntax mirrors how a human would interact with the page — go here, click this, fill that, grab the result.

## 4. Record and Replay Sessions

```bash
# Record your browser actions
xbrowser record my-session

# Replay them later (headless or headed)
xbrowser replay my-session
```

Record your workflow once in headed mode, then replay it headlessly in CI or cron jobs. Great for regression testing and data pipelines that need to run on schedule.

## 5. 67+ Plugins for SEO, AI, and More

```bash
# List available plugins
xbrowser plugin list

# SEO backlink analysis
xbrowser seo backlinks --domain example.com

# AI-powered page analysis
xbrowser ai summarize https://example.com/article
```

The plugin ecosystem covers search engine scraping, structured data extraction, AI summarization, and backlink auditing. Check the full list at [xbrowser.dev/plugins](https://xbrowser.dev).

---

## Quick Install

```bash
npm i -g @xbrowser/cli
xbrowser --help
```

That's it. No browser download step — xbrowser ships with its own managed Chromium build with CDP fingerprint protection built in.

---

*Found this useful? Star the [repo](https://github.com/dyyz1993/xbrowser) and check out the full documentation at [xbrowser.dev](https://xbrowser.dev).*
