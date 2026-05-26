# xbrowser SEO Plugins

Automate backlink building across 10+ high-DA platforms with xbrowser's SEO plugin suite.

## Quick Start

```bash
# Install an SEO plugin
xbrowser plugin install blogger-seo
xbrowser plugin install wordpress-seo

# Login to platform
xbrowser blogger-seo login

# Publish an article with backlinks
xbrowser blogger-seo publish --title "My Article" --content article.md
```

## Supported Platforms

| Platform | DA | Link Type | Best For |
|----------|-----|-----------|----------|
| WordPress.com | 93 | Dofollow | Long-form articles, CMS |
| Blogger | 89 | Dofollow | Blog hosting, Google ecosystem |
| Product Hunt | 91 | Dofollow | Product launches, startup SEO |
| Tumblr | 86 | Dofollow | Micro-blogging, niche communities |
| Hashnode | 80+ | Dofollow (custom domain) | Developer blogs, tech content |
| Medium | 96 | Nofollow | Thought leadership, wide reach |
| Quora | 92 | Nofollow | Q&A marketing, authority building |
| Dev.to | 51 | UGC | Developer audience, tech articles |
| CSDN | 80+ | Nofollow | Chinese tech market, Baidu SEO |
| 掘金 | 70+ | Nofollow | Chinese developer community |

## Platform Usage Examples

### WordPress.com (DA 93, Dofollow)

```bash
xbrowser wordpress-seo login
xbrowser wordpress-seo publish --title "Guide to Node.js" --content article.md --tags "nodejs,tutorial"
xbrowser wordpress-seo draft --title "Draft Post" --content draft.md
```

### Blogger (DA 89, Dofollow)

```bash
xbrowser blogger-seo login
xbrowser blogger-seo create-blog --title "My SEO Blog" --url my-seo-blog
xbrowser blogger-seo publish --title "Article Title" --content article.html
```

### Medium (DA 96, Nofollow)

```bash
xbrowser medium-seo login
xbrowser medium-seo publish --title "Thought Leadership Post" --content post.md
xbrowser medium-seo import --url https://my-site.com/article
```

### Quora (DA 92, Nofollow)

```bash
xbrowser quora-seo login
xbrowser quora-seo answer --question "How to build backlinks?" --content answer.md
xbrowser quora-seo publish-article --title "SEO Guide" --content guide.md
```

### Product Hunt (DA 91, Dofollow)

```bash
xbrowser producthunt-seo login
xbrowser producthunt-seo submit-product --name "My Tool" --url https://mytool.com --description "Product description"
```

### Dev.to (DA 51, UGC)

```bash
xbrowser devto-seo login
xbrowser devto-seo publish --title "Technical Deep Dive" --content article.md --tags "javascript,webdev"
```

### Hashnode (DA 80+, Dofollow with custom domain)

```bash
xbrowser hashnode-seo login
xbrowser hashnode-seo publish --title "Blog Post" --content post.md
```

### Tumblr (DA 86, Dofollow)

```bash
xbrowser tumblr-seo login
xbrowser tumblr-seo publish --title "Post Title" --content post.html --tags "seo,marketing"
xbrowser tumblr-seo reblog --post-id 12345 --comment "Great insights!"
```

### CSDN (DA 80+, Chinese market)

```bash
xbrowser csdn-seo login
xbrowser csdn-seo publish --title "技术文章标题" --content article.md
```

### 掘金 (DA 70+, Chinese developers)

```bash
xbrowser juejin-seo login
xbrowser juejin-seo publish --title "前端开发指南" --content guide.md
```

## CAPTCHA Handling

When a platform shows CAPTCHA during login or publishing, xbrowser pauses and notifies you:

```bash
# CAPTCHA detected - xbrowser opens interactive preview
xbrowser blogger-seo login
# > CAPTCHA detected! Opening interactive preview...
# > Solve the CAPTCHA in the preview window
# > Press Enter when done...
```

### CAPTCHA Workflow

1. xbrowser detects CAPTCHA via `waitForHuman()` command
2. Interactive browser preview opens automatically
3. You solve the CAPTCHA manually
4. Press Enter or send webhook to continue
5. Automation resumes

### Webhook-based CAPTCHA (for remote/headless)

```bash
# Set webhook URL for CAPTCHA notifications
export XCAPTCHA_WEBHOOK=https://your-server.com/captcha-callback

# xbrowser sends POST to webhook when CAPTCHA is detected
# Your server notifies you (Slack, Telegram, etc.)
# You solve CAPTCHA via remote browser or API
# POST to xbrowser's resume endpoint when done
```

## Best Practices for SEO Backlinks

### Content Quality

- Write original, valuable content for each platform
- Avoid duplicate content across platforms
- Aim for 1000+ words for long-form articles
- Include relevant images and formatting

### Link Strategy

- Prioritize dofollow platforms (WordPress, Blogger, Tumblr, Product Hunt)
- Use natural anchor text, avoid keyword stuffing
- Place links contextually within content
- Build links gradually over time, not all at once

### Platform-Specific Tips

- **WordPress.com**: Use categories and tags for better indexing
- **Medium**: Import from your site for canonical URL credit
- **Quora**: Answer popular questions for maximum visibility
- **Product Hunt**: Launch timing matters (Tuesday-Thursday, 12:01 AM PST)
- **Dev.to**: Use cover images and series for engagement
- **CSDN/掘金**: Chinese content ranks well on Baidu

### Schedule

- Don't publish to all platforms on the same day
- Space out publications over weeks
- Update and republish older content periodically
- Track which platforms drive the most referral traffic

## Installation

```bash
# Install all SEO plugins
for plugin in blogger-seo tumblr-seo wordpress-seo devto-seo hashnode-seo medium-seo producthunt-seo quora-seo juejin-seo csdn-seo; do
  xbrowser plugin install $plugin
done

# List installed plugins
xbrowser plugin list

# Update a plugin
xbrowser plugin update blogger-seo
```

## Marketplace

Browse and install plugins from the [xbrowser marketplace](https://marketplace.xbrowser.dev).

```bash
# Search for SEO plugins
xbrowser plugin search seo

# Get plugin details
xbrowser plugin info wordpress-seo
```
