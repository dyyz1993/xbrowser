# I Replaced 30 Minutes of Daily Browser Chores with One Cron Job

Every morning, I'd sit down at my desk, grab a coffee, and open my browser.

Then the ritual began.

Log into Google Search Console. Check yesterday's indexing stats. Switch to Ahrefs. Look up a handful of keyword rankings. Open Bing Webmaster Tools. Manually submit the three articles I published last night. Jump over to a backlink checker. See if those reciprocal links are still alive.

Done? Not quite. I still had to open Medium and publish yesterday's draft. Then Dev.to. Then schedule a Reddit post in the relevant subreddit.

By the time I finished all of this, my coffee was cold and a third of my morning was gone.

## What Do All These Tasks Have in Common?

If you look closely, every single one of these operations follows the same pattern:

1. Open a browser
2. Navigate to a URL
3. Log in (and re-log in when the session expires)
4. Find the right input field or button
5. Fill in content or click something
6. Wait for the result
7. Close the tab

None of these steps are hard. But every single one requires **your personal involvement**. Your hand bounces between mouse and keyboard. Your eyes dart across a dozen tabs.

Here's the thing — you're a paid engineer, not a human Selenium.

What if these operations could be turned into command-line tasks?

```bash
# Submit sitemap
seo ping --sitemap https://mysite.com/sitemap.xml

# Check Google rankings
google search "my keyword" --json | jq '.[0].position'

# Publish an article
devto publish --file article.md --tags "javascript,webdev"

# Check backlinks
curl-check --url https://partner.com --find "mysite.com"
```

One command. Press Enter. Done.

## From Manual to Automated: A Three-Step Process

### Step 1: Abstract Operations into Commands

Any browser operation can be decomposed into: open page → locate element → perform action → get result.

Take "submit sitemap to Google." Manually, you'd:

1. Open `https://www.google.com/ping?sitemap=`
2. Append your sitemap URL
3. Press Enter
4. See the success message

As a CLI command, this is one line:

```bash
xbrowser navigate "https://www.google.com/ping?sitemap=https://mysite.com/sitemap.xml"
```

Or take "check if a new article is indexed." Manually:

1. Open Google
2. Search `site:mysite.com/my-new-article`
3. Check if there are results

CLI version:

```bash
xbrowser google search "site:mysite.com/my-new-article" --json
```

You get structured JSON back. You can filter with `jq`, search with `grep`, pipe it into other commands.

### Step 2: Combine Commands into a Script

Individual commands solve individual tasks. But your daily work is a sequence of tasks — the kind you repeat every morning.

So write a script:

```bash
#!/bin/bash
# daily-seo-check.sh

SITE="https://mysite.com"
KEYWORDS=("javascript tutorial" "node.js guide" "react best practices")
LOG_FILE="/var/log/seo-$(date +%Y%m%d).log"

echo "=== SEO Daily Report $(date) ===" >> "$LOG_FILE"

# Submit sitemap
echo "[1/4] Submitting sitemap..." >> "$LOG_FILE"
xbrowser seo ping --sitemap "$SITE/sitemap.xml" >> "$LOG_FILE" 2>&1

# Check rankings
echo "[2/4] Checking rankings..." >> "$LOG_FILE"
for kw in "${KEYWORDS[@]}"; do
  position=$(xbrowser google search "$kw" --json | jq -r '.[0].position // "Not found"')
  echo "  $kw: Position $position" >> "$LOG_FILE"
done

# Check index count
echo "[3/4] Checking index count..." >> "$LOG_FILE"
count=$(xbrowser google search "site:$SITE" --json | jq 'length')
echo "  Indexed pages: $count" >> "$LOG_FILE"

# Check backlinks
echo "[4/4] Checking backlinks..." >> "$LOG_FILE"
while IFS=',' read -r url anchor; do
  found=$(xbrowser crawl "$url" --find "$anchor" | jq -r '.found')
  echo "  $url: $found" >> "$LOG_FILE"
done < backlinks.csv

echo "Done. Report saved to $LOG_FILE"
```

This script does everything you used to do manually every morning — submit sitemap, check rankings, count indexed pages, verify backlinks.

Run it once:

```bash
chmod +x daily-seo-check.sh
./daily-seo-check.sh
```

Twenty seconds later, you have your daily data. No browser. No clicking around. No waiting for pages to load.

### Step 3: Hand It Off to Cron

The script works. Running it manually takes 20 seconds. But you'll still forget sometimes.

So let the machine do it:

```bash
# Edit crontab
crontab -e
```

Add these lines:

```bash
# Daily SEO check at 9 AM
0 9 * * * /home/user/scripts/daily-seo-check.sh

# Hourly ranking check, append to log
0 * * * * xbrowser google search "javascript tutorial" --json >> /var/log/rankings-hourly.log

# Submit sitemap at 3 AM daily (off-peak)
0 3 * * * xbrowser seo ping --sitemap https://mysite.com/sitemap.xml

# Weekly backlink audit, every Monday at 8 AM
0 8 * * 1 /home/user/scripts/check-backlinks.sh
```

Save and exit. From now on, these tasks run automatically.

The first thing you do each morning isn't opening a browser — it's checking the log:

```bash
cat /var/log/seo-$(date +%Y%m%d).log
```

Output looks something like this:

```
=== SEO Daily Report 2025-01-15 09:00:01 ===
[1/4] Submitting sitemap... OK
[2/4] Checking rankings...
  javascript tutorial: Position 7
  node.js guide: Position 12
  react best practices: Position 3
[3/4] Checking index count...
  Indexed pages: 847
[4/4] Checking backlinks...
  https://partner1.com: found
  https://partner2.com: found
  https://partner3.com: NOT FOUND ⚠️
Done.
```

Thirty seconds to review. Infinitely faster than doing it by hand.

## Not Just SEO: Any Repetitive Browser Task Can Be Automated

Maybe you're not an SEO engineer. But you definitely have browser tasks you repeat daily.

**Developers**: Check GitHub Actions build status every morning? See if CI passed? Verify npm package publication?

```bash
# Hourly CI monitor
0 * * * * xbrowser github actions --repo myorg/myrepo --status failed >> /var/log/ci-monitor.log
```

**Content creators**: Need to cross-post to Medium, Dev.to, and Hashnode every day?

```bash
# One command, multiple platforms
xbrowser devto publish --file article.md --tags "js,webdev"
xbrowser medium publish --file article.md --tags "javascript,web-development"
```

**E-commerce operators**: Check competitor pricing, store ratings, inventory alerts daily?

```bash
# Daily competitor price check at 8 AM
0 8 * * * xbrowser crawl "https://competitor.com/product/123" --extract '.price' >> /var/log/price-monitor.log
```

**Social media managers**: Schedule posts, check engagement metrics, monitor brand mentions?

```bash
# Hourly brand mention check
0 * * * * xbrowser twitter search "mybrand" --json | jq '.[].text' >> /var/log/brand-mentions.log
```

The specific task doesn't matter. What matters is that **the pattern is always the same**.

## The Power of Pipes: CLI's Real Advantage

You might be thinking: "I could do all this with a Python script."

You're right. But CLI has something Python scripts can't match: **pipe composition**.

```bash
# Check rankings → filter top 10 → send to Slack
xbrowser google search "javascript tutorial" --json \
  | jq '[.[] | select(.position <= 10)]' \
  | curl -X POST "$SLACK_WEBHOOK" -d @-
```

```bash
# Scrape competitor price → compare threshold → email alert
xbrowser crawl "$COMPETITOR_URL" --extract '.price' \
  | awk -v threshold=99 '{if ($1 < threshold) print "ALERT: Competitor price dropped to " $1}' \
  | mail -s "Price Alert" me@example.com
```

```bash
# Daily SEO report → generate Markdown → convert to PDF → email
cat /var/log/seo-$(date +%Y%m%d).log \
  | pandoc -f markdown -o /tmp/seo-report.pdf \
  | mail -s "Daily SEO Report" team@example.com -A /tmp/seo-report.pdf
```

Each command does one thing well. Pipes chain them together. This is the Unix philosophy at work — and it's why CLI automation is more elegant than writing monolithic scripts.

You don't need to write a new script for every new requirement. You just recombine existing commands with pipes.

## Common Concerns

**"Won't automated actions get my account banned?"**

Not if you control the frequency. Cron's minimum granularity is one minute. Set it to run once per hour, and nobody will mistake you for a bot. It's exactly like doing it manually — except you don't have to sit at your computer.

**"What if the operation fails?"**

Scripts can handle errors just fine. Cron can send emails on failure:

```bash
# Send email notification on failure
0 9 * * * /home/user/scripts/daily-seo.sh || echo "SEO check failed" | mail -s "Alert" me@example.com
```

Or get more granular with `set -e` and `trap` inside the script:

```bash
#!/bin/bash
set -euo pipefail

cleanup() {
  echo "Script failed at line $1" | mail -s "SEO Script Error" me@example.com
}
trap 'cleanup $LINENO' ERR
```

**"I don't have a server. Can I run cron locally?"**

macOS has `launchd` (more powerful than cron). Linux has `systemd timers`. Windows has Task Scheduler. And cron itself works everywhere.

If you have a spare VPS (the $5/month kind), even better — upload your scripts, configure cron, and forget about it.

## Let's Do the Math

Conservatively, here's how much time an SEO engineer spends on daily repetitive browser tasks:

| Task | Manual Time | CLI Time |
|------|------------|---------|
| Submit sitemap | 3 min | 2 sec |
| Check 5 keyword rankings | 10 min | 10 sec |
| Check index count | 2 min | 2 sec |
| Check 10 backlinks | 15 min | 5 sec |
| Publish to 3 platforms | 10 min | 15 sec |
| Check competitor pricing | 5 min | 3 sec |
| **Total** | **45 min** | **37 sec** |

45 minutes saved per day. That's 22.5 hours per month — nearly three full workdays.

You could spend that time writing code, doing analysis, or honestly, just taking a break. All of those are better than clicking around in a browser.

## What You Can Do Today

If you want to start right now, I'd suggest beginning with the **smallest possible automation**:

1. Identify the browser task you repeat most often today
2. Find a CLI command that does the same thing
3. Verify the result is correct
4. Add it to cron

Don't try to automate everything at once. Automate one thing. Save some time. Then automate the next thing.

Iterative. No rush.

---

I've been using [xbrowser](https://github.com/yanqdinho/xbrowser) for this — a browser automation CLI that wraps Puppeteer's capabilities into a command-line interface. It supports Google search, web scraping, SEO ping, and other common operations, and works well with cron for scheduled automation. If you have similar daily repetitive tasks, give it a try.
