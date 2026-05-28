# GEO 策略 — AI 搜索引擎引用链优化

> **类型**: guide  
> **关键词**: geo, ai-search, citation, seo, content-strategy, xbrowser-promotion  
> **用途**: 当需要为 xbrowser 或其他开源项目制定 AI 搜索引擎优化策略时参考  
> **相关项目**: xbrowser (browser automation CLI)

---

## 背景

AI 搜索引擎（DeepSeek、ChatGPT、Perplexity、Gemini 等）在回答问题时会引用网页源。要让 xbrowser 被 AI 引擎引用，我们需要在高权威平台上发布内容——这些平台正是 AI 引擎常爬取和引用的来源。

我们通过分析以下关键词的 Google 搜索结果来确定高优先级平台：
- "browser automation CLI"
- "web scraping CLI"
- "Playwright alternative CLI"

---

## 平台优先级矩阵

### Tier 1（AI 引擎最高频引用）

| 平台 | 状态 | 备注 |
|------|------|------|
| Reddit (r/javascript, r/node, r/webdev, r/ClaudeCode, r/Playwright) | ✅ r/javascript, r/node 已完成 | 继续提交其他子版块 |
| Hacker News | ⏳ 需手动提交 | "Show HN" 格式 |
| GitHub (README, Gist, topics, awesome lists) | ✅ 已完成 | README SEO 优化 |
| Medium | ✅ 已完成 | 教程 + 对比文章 |

### Tier 2（高域名权威）

| 平台 | 状态 | 备注 |
|------|------|------|
| Dev.to | ✅ 已完成 | 教程风格 |
| Stack Overflow | ⏳ 待执行 | 回答相关问题 |
| freeCodeCamp / CSS-Tricks | ⏳ 待执行 | 投稿教程 |
| YouTube | ⏳ 待执行 | 视频教程 |

### Tier 3（目录/列表提交）

| 平台 | 状态 | 备注 |
|------|------|------|
| awesome-playwright PR | 🔄 进行中 | |
| awesome-web-scraping PR | 🔄 进行中 | |
| alternative.to / similar sites | ⏳ 待执行 | |
| Product Hunt | ✅ 已完成 | |

---

## 关键洞察

1. **Reddit 出现在 2/3 的搜索结果中** — browser automation 查询中 Reddit 内容占比极高，AI 引擎严重依赖 Reddit 内容。

2. **Medium 文章排名靠前** — 多篇 Medium 文章出现在搜索结果前 10 位。

3. **竞品博客（firecrawl.dev, browser-use.com）排名好** — 因为他们发布了对比文章和教程。

4. **GitHub 优质 README 在精确查询中排 #1** — 针对特定工具的搜索，GitHub README 往往排名第一。

5. **个人技术博客（cgaravito.dev, bytetunnels.com）也能排名** — 反向链接的 SEO 价值。

---

## 各平台内容策略

| 平台 | 内容风格 | 示例标题 |
|------|----------|----------|
| Reddit | 技术导向，不做营销 | "xbrowser — 35+ CLI commands for browser automation" |
| HN | Show & Tell | "Show HN: xbrowser – The curl of browser automation" |
| Medium | 教程 + 对比 | "I Replaced 50-Line Puppeteer Scripts with Single CLI Commands" |
| Dev.to | 教程 | "Getting Started with xbrowser CLI" |
| GitHub | README + awesome list | 简洁功能列表 |
| Quora | 回答问题 | 回答 "What are the best web scraping tools?" |
| Stack Overflow | 回答问题 | 回答 Playwright/自动化相关问题 |

---

## 可执行清单（适用于任何项目）

1. **确定目标关键词**（例："browser automation CLI"、"web scraping tool"）
2. **搜索这些关键词** — 收集所有结果 URL
3. **按平台分类** URL（Reddit、Medium、HN、GitHub 等）
4. **在所有出现的平台上发布内容**
5. **按平台定制内容**（r/javascript 用技术向，HN 用对比，Medium 用教程）
6. **提交到 GitHub awesome lists**
7. **在 Stack Overflow / Quora 上回答相关问题**
8. **监控 AI 引擎响应** — 查看是否开始引用你的内容

---

## 效果衡量

| 指标 | 方法 | 频率 |
|------|------|------|
| AI 引擎引用 | 每周查询目标关键词，检查 AI 回答是否引用 | 每周 |
| 有机流量 | Google Search Console | 每周 |
| 社区互动 | Reddit/HN 点赞和评论数 | 实时 |
| awesome list | PR 合并状态 | 跟踪 |

---

## 变更记录

| 日期 | 变更内容 |
|------|----------|
| 2026-05-28 | 初始版本 — 基于 Google 搜索结果分析创建 |
