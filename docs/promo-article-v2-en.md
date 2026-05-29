# My AI Agent Burned 26K Tokens Doing the Same Browser Task 10 Times

Last week I ran an experiment: I asked my AI agent to search Juejin for "Rust tutorial" articles — once a day, for 10 days straight.

The result? **It consumed roughly 26,000 tokens on browser operations alone.** And every single day, the execution flow was identical: find the search box, type the keyword, wait for results, extract text. The AI treated each session like its first visit, fumbling from scratch every time.

I did the math. At GPT-4o pricing, that's about **$0.40–0.60** wasted. Not a fortune — but the real pain is that **every token was spent on pure, unadulterated repetition.**

## Why Do AI Agents Burn So Many Tokens on Browser Tasks?

Let's look at a typical scenario. I ask my AI agent to search CSDN for an article title:

**First attempt (exploration phase):**

```
[Agent] Screenshots the page to analyze layout...... ~800 tokens
[Agent] Tries to locate search box → guesses #search-box... ~600 tokens
[Agent] Selector doesn't exist, inspects DOM to find the real one... ~500 tokens
[Agent] Found it: input[placeholder="搜CSDN"]
[Agent] Types search term, waits for page load... ~400 tokens
[Agent] Extracts search result list text... ~300 tokens
Total: ~2,600 tokens
```

**Second attempt (exact same task):**

```
[Agent] Screenshots the page to analyze layout...... ~800 tokens (again)
[Agent] Locates search box... ~600 tokens (guessing again)
[Agent] Guesses wrong once... ~500 tokens (retrying again)
[Agent] Types, waits, extracts... ~700 tokens
Total: ~2,600 tokens
```

10 iterations = **26,000 tokens**, with nearly identical execution paths every time.

I broke down the problem into four root causes:

### 1. No Memory Between Sessions

AI agents have zero cross-session memory. Yesterday it figured out that `input[placeholder="探索"]` is Juejin's search box. Today? Gone. Forgotten. That same exploration process repeats, day after day.

### 2. Selector Guessing Is a Probabilistic Game

When AI analyzes page structure — usually via screenshots or DOM snapshots — **finding the right CSS selector is essentially guesswork.** Lucky guess? Great. Wrong guess? That's a few hundred tokens down the drain per retry. From my measurements, on complex pages the AI averages **2–3 attempts** before landing on the correct selector.

### 3. Context Bloat from Page Data

A typical webpage's HTML runs tens of kilobytes. A single screenshot is hundreds of kilobytes. Every browser operation shoves this data into the AI's context window. **Just transmitting page structure costs 800–1,500 tokens per operation.**

### 4. Zero Reusability

The results of the first exploration — selectors, workflows, error-handling experience — vanish entirely. **Every session is Groundhog Day. Every time, the AI pays the same tuition.**

## The Core Insight: Turn Exploration Results into Reusable Commands

Once I understood the problem, the solution felt almost embarrassingly obvious:

> **Let the AI explore once. Record what it learns (selectors, flows). Invoke the recorded command every time after.**

Concrete example. After the first Juejin search, I recorded this:

```
Juejin Search:
- Search box selector: input[placeholder="探索"]
- Result list: .content-main .entry
- Flow: click search box → type keyword → press Enter → wait for load → extract text
```

Then I wrapped it into a CLI command:

```bash
juejin search "Rust 教程" --json
```

**From that point on, the AI just constructs this command string. No more page analysis.**

Token cost comparison:

| Approach | Per-operation tokens | 10x total | Repetition rate |
|----------|---------------------|-----------|-----------------|
| AI operates browser directly | ~2,600 | ~26,000 | 100% |
| Calls pre-built command | ~50 | ~500 | 0% |

**From 26,000 down to 500. A 98% reduction.** That 50 tokens is just the cost of the AI assembling the command string.

## In Practice: From 3,000+ Tokens Down to 50

Let me walk through a real scenario — "AI agent monitors the price of a JD.com product daily."

### Before: AI manually operates the browser (~3,000 tokens/time)

The AI generates code like this every single time:

```javascript
// Code the AI generates fresh every session
const page = await browser.newPage();
await page.goto('https://item.jd.com/100012043978.html', {
  waitUntil: 'domcontentloaded'
});

// AI guesses selectors... attempt 1
let price = await page.$eval('.p-price span', el => el.textContent).catch(() => null);
if (!price) {
  // attempt 2
  price = await page.$eval('.price J-p-100012043978', el => el.textContent).catch(() => null);
}
if (!price) {
  // attempt 3, inspect DOM...
  const html = await page.content();
  // parse HTML structure, re-locate...
  price = await page.$eval('[class*="price"] span', el => el.textContent);
}

// handle anti-scraping, wait for dynamic loading, catch errors...
```

This code looks reasonable, right? The problem is **the AI regenerates this entire flow from scratch every time.** And in practice, AI-generated code is even more bloated — it adds excessive try-catch blocks, verbose comments, debug logging, because it's "thinking out loud" as it writes.

### After: Wrapped as a command (~50 tokens/time)

I packaged common browser operations into plugins. Now the AI agent just calls a CLI command:

```bash
# The AI only needs to generate this one line
xbrowser jd price --url "https://item.jd.com/100012043978.html" --json
```

Returns:

```json
{
  "price": "2999.00",
  "originalPrice": "3299.00",
  "discount": "-9.1%",
  "inStock": true,
  "timestamp": "2025-05-28T10:30:00Z"
}
```

**50 tokens. Done.** The AI doesn't need to know JD's price selector. It doesn't need anti-scraping logic. It doesn't need to wait for dynamic content. The plugin handles all the dirty work internally.

### Another example: searching content platforms

```bash
# Before: AI operates browser to search Juejin articles, ~2,600 tokens
# After:
xbrowser juejin search "Rust async programming" --limit 5 --json
```

Returns:

```json
{
  "results": [
    {
      "title": "Rust 异步编程完全指南",
      "author": "xxx",
      "url": "https://juejin.cn/post/7xxx",
      "likes": 328,
      "date": "2025-05-25"
    }
  ]
}
```

**Clean. Structured. Predictable.** The AI gets JSON it can directly reason over — no more scraping text out of HTML.

## The Deeper Principle: Amortize Exploration Cost into Reusable Assets

After using this approach for a month, I've arrived at a simple formula:

```
Total Token Cost = First Exploration Cost + Repeat Count × Per-operation Cost

Without encapsulation:  Total = 2,600 + N × 2,600
With encapsulation:     Total = 2,600 + N × 50

When N = 10:  saves 98%
When N = 50:  saves 99.6%
```

**That initial 2,600 tokens is a necessary investment** — the AI has to figure out the page structure at least once. The key insight: you only pay this tax **once.**

Here's an analogy: **AI agents doing browser tasks is like hiring someone new to order lunch from the same restaurant every day, but they re-read the menu, ask the waiter for recommendations, and agonize over the choice every single time.** Encapsulating commands is like letting them memorize their regular order. Next time, they just say the dish name.

## Plugin Architecture: One Plugin Per Website

The natural extension of this approach is **encapsulating by website.** Each plugin packages operations for a specific site, and the AI agent calls them on demand:

```bash
# Search engines
xbrowser baidu search "AI Agent browser automation" --json
xbrowser google search "playwright token cost" --json
xbrowser bing search "CDP protocol guide" --json

# Content platforms
xbrowser juejin search "Rust 教程" --limit 10 --json
xbrowser csdn search "TypeScript generics" --json
xbrowser zhihu search "how to learn system design" --json

# E-commerce
xbrowser jd price --url "https://item.jd.com/xxx" --json
```

Each plugin is an npm package containing:
- **Selector definitions** — which CSS selectors this website uses
- **Operation flows** — what to do first, what next, how to handle errors
- **Data extraction** — how to transform raw HTML into structured JSON

**The AI doesn't need to know any of this.** It just needs to know "there's a command for that."

## Scaling the Approach: Beyond Token Savings

Once you start thinking this way, the benefits compound beyond just token efficiency.

### Reliability

An AI guessing selectors will fail sometimes. A plugin with hardcoded selectors doesn't guess — it **knows.** When a website changes its layout, you update one plugin file instead of hoping the AI figures it out on the next attempt.

### Speed

Constructing a CLI command takes the AI one inference step. Operating a browser manually takes 5–10 inference steps (screenshot → analyze → guess → retry → act). **That's not just token savings — it's latency savings.** Your agent responds faster.

### Composability

Once operations are CLI commands, you can compose them:

```bash
# Search multiple platforms and compare results
xbrowser baidu search "Rust async" --json > baidu.json
xbrowser google search "Rust async" --json > google.json
diff <(jq '.results[].title' baidu.json) <(jq '.results[].title' google.json)
```

Try doing that with raw browser automation. You'd need the AI to orchestrate multiple browser sessions, manage context windows, and merge results. **With commands, it's just shell scripting.**

### Auditability

When something goes wrong, you can inspect the command and its output directly. No need to replay the AI's entire chain-of-thought to figure out where the selector guess went wrong.

## Some Broader Reflections

Here's what I think is the deeper issue.

**The biggest cost of AI agents isn't the API bill — it's the waste of repetitive labor.** A single browser operation costing 3,000 tokens isn't expensive. Repeating it 100 times is 300,000 tokens. And worse, these repetitions have **zero learning value** — the AI explores the same page every time but doesn't get any smarter.

**Converting one-time exploration cost into reusable assets is the right engineering direction for AI agents.** It's the same logic behind every abstraction we already use: we don't manually configure environments every deployment, so we have Docker. We don't manually compile every build, so we have CI/CD. AI agent browser operations need the same "encapsulation" mindset.

Imagine if every commonly-used website had a pre-built command library — GitHub operations, Jira queries, Slack message reads, Confluence page fetches. How much would AI agent token efficiency improve? How much more reliable would agents become? (Pre-built commands don't guess wrong selectors.)

**That's the leap from "AI agents that sort of work" to "AI agents that actually work reliably."**

---

*If you're building browser automation for AI agents, I'd suggest trying this encapsulation approach. I've been using [xbrowser](https://github.com/dyyz1993/xbrowser) — it's an open-source CLI tool purpose-built for this pattern. Plugin-based, per-website commands, and it's on GitHub if you want to take a look.*
