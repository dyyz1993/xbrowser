# Why I Built xbrowser: A CLI That Combines Browser Automation with SEO

Three years ago, I was freelancing as an SEO consultant. My days looked like this: open Chrome, search for a keyword on Google, manually scroll through results, open each competitor's page, copy-paste their meta tags into a spreadsheet, check their backlinks on some expensive SaaS tool, and repeat. For every client. Every month.

I knew there had to be a better way. There *were* tools — Selenium had been around forever, Puppeteer was gaining traction, and Playwright was the new hotness. But every time I tried to automate my workflow with them, I hit the same wall: they're test frameworks, not task runners. I didn't want to write a test suite. I wanted to type one command and get results.

So I started building.

## The First Version Was Ugly

The first version of what would become xbrowser was a bash script. It launched Chromium, navigated to Google, typed a search query using xdotool, took a screenshot, and ran OCR on it. It worked — barely. It broke every time Google changed their layout, and it only ran on Linux with a specific desktop environment.

But it proved something important: the workflow I wanted — search, extract, analyze — could be expressed as a pipeline of simple commands. The problem wasn't the concept. The problem was the implementation.

I rewrote it in Node.js, wrapping Puppeteer behind a CLI interface. The second version was better, but it still felt like I was fighting the library. Puppeteer's API is designed for test assertions (`expect(page).toHaveText()`), not for task composition (`search this, click that, grab the result`). I spent more time working around the framework than solving my actual problem.

## The Breakthrough: Chain Syntax

The turning point came when I started thinking about how I describe tasks to other people. When I tell a colleague to "go to Hacker News, click the top story, and send me the title," I don't break it down into "create a page instance, navigate to URL, wait for the selector, query the DOM, extract the text." I just say what to do.

That insight led to xbrowser's chain syntax:

```bash
xbrowser chain "goto https://news.ycombinator.com && click '.titleline > a' && scrape"
```

One line. No script file, no async/await, no error handling boilerplate. The CLI handles all of that internally. You just describe the sequence of actions, and it executes them.

This clicked for me because it's exactly how I think about web tasks. And more importantly, it's how AI agents think about web tasks. When an LLM needs to browse the web, it doesn't want to write a 50-line Playwright script. It wants to issue a command and get a result.

## From Personal Tool to Open Source

For a long time, xbrowser was just my personal tool. I used it for client work — automating keyword research, checking competitor backlinks, monitoring SERP positions. It saved me hours every week.

The thing that pushed me to open-source it was a conversation with a friend who builds AI agents. He was complaining about how painful it is to give an agent web access. Every agent framework had a different browser integration, they all required writing custom code for basic tasks like search and scrape, and the resulting code was fragile.

I showed him xbrowser. He ran:

```bash
xbrowser search "best AI agent frameworks" --engine google --num 10
```

And got structured results in three seconds. His response: "This is what I've been looking for."

That was the moment I realized this wasn't just an SEO tool. It was a general-purpose web interaction layer for AI agents.

## What It Does Today

xbrowser has grown far beyond my original bash script. Here's what it covers now:

**Search across engines.** Google, Bing, Baidu — one command each, no API keys required. Results come back as structured JSON with titles, URLs, and snippets.

```bash
xbrowser search "open source SEO tools" --engine google --num 20
```

**Scrape and crawl.** Extract clean content from any page, or crawl an entire site. Output is markdown by default.

```bash
xbrowser scrape https://example.com/blog/seo-tips
xbrowser crawl https://example.com --depth 2 --max-pages 50
```

**Chain operations.** Navigate, click, fill forms, and extract — all in one line.

```bash
xbrowser chain "goto https://app.example.com/login && fill '#email' 'me@site.com' && fill '#password' 'pass' && click '#submit' && scrape '#dashboard'"
```

**Record and replay.** Open a browser, do your thing, and the tool records every action. Replay it later headlessly.

**67+ plugins.** SEO backlink analysis, AI summarization, structured data extraction, and more. The plugin system lets anyone extend xbrowser for their specific use case.

## The SEO Angle

I still do SEO work, and xbrowser is still my primary tool for it. The difference is that what used to take me a full afternoon now takes five minutes.

A typical workflow:

```bash
# Check my client's SERP position for their target keyword
xbrowser search "plumber near me" --engine google --num 30 | \
  jq '.results[] | select(.url | contains("myclient.com")) | .position'

# Audit their top competitor's on-page SEO
xbrowser scrape https://competitor.com | grep -i "<h1\|<meta\|<title"

# Map their site to find pages with missing meta descriptions
xbrowser map https://myclient.com | while read url; do
  has_meta=$(xbrowser scrape "$url" | grep -c "meta name=\"description\"")
  if [ "$has_meta" -eq 0 ]; then echo "Missing meta: $url"; fi
done
```

This is what I wanted from the beginning — real SEO work, done from the command line, composable and scriptable.

## Anti-Detection Built In

One thing I learned the hard way: automated browsers get blocked. A lot. Google is particularly aggressive about detecting headless Chrome.

xbrowser ships with CDP fingerprint protection out of the box. It patches the Chromium DevTools Protocol to mask automation signals — navigator.webdriver, CDP runtime leaks, and other common detection vectors. This isn't a stealth plugin bolted on after the fact. It's integrated into the browser management layer.

Does it make you invisible? No. Sophisticated bot detection can still catch you. But it handles the low-hanging fruit that blocks 90% of naive automation attempts.

## Why Open Source

I open-sourced xbrowser under the MIT license because I believe web automation should be accessible. The existing options are either expensive SaaS tools with monthly subscriptions or frameworks that require significant programming knowledge to use effectively.

xbrowser sits in the middle: it's free, it's open source, and it's designed to be usable from day one without writing code. If you can type a command, you can automate browser tasks.

The plugin system is open too. If you build something useful — a new search engine integration, a specialized scraper, an AI-powered analysis tool — you can share it with the community.

## Try It

If any of this resonates — if you've ever been frustrated by the gap between "I just want to search Google from the command line" and the 40-line script it takes to actually do it — give xbrowser a try:

```bash
npm i -g @xbrowser/cli
xbrowser search "hello world" --engine google
```

That's the entire getting-started process. One install command, one search command. The full documentation is at [xbrowser.dev](https://xbrowser.dev), and the source code is on [GitHub](https://github.com/dyyz1993/xbrowser).

I built this tool because I needed it. Now I'm sharing it because I think other people need it too.

---

*xbrowser is MIT-licensed and available on npm. Install: `npm i -g @xbrowser/cli`. Documentation: [xbrowser.dev](https://xbrowser.dev). Source: [github.com/dyyz1993/xbrowser](https://github.com/dyyz1993/xbrowser).*
