# xbrowser SEO 外链推广执行计划

> 目标站点: **xbrowser.dev**
> 工具链: xbrowser SEO 插件套件 (13 个平台插件 + 核心 SEO 插件)
> 策略: 分层推进，优先 dofollow 高 DA 平台，兼顾品牌曝光与中文市场

---

## 一、执行优先级总览

| Phase | 平台 | DA | 链接类型 | 登录方式 | 预估耗时 |
|-------|------|-----|---------|---------|---------|
| **P1** | WordPress.com | 93 | Dofollow | Google OAuth | 30 min |
| **P1** | Product Hunt | 91 | Dofollow | 需注册 | 60 min |
| **P1** | GitHub | 100 | Dofollow | 已登录 | 20 min |
| **P1** | Blogger | 89 | Dofollow | Google 直进 | 20 min |
| **P2** | Tumblr | 86 | Dofollow | Google OAuth | 20 min |
| **P2** | Hashnode | 80+ | Dofollow | Google OAuth | 30 min |
| **P2** | Medium | 96 | Nofollow | Google OAuth | 30 min |
| **P2** | Quora | 92 | Nofollow | Google OAuth | 40 min |
| **P2** | Dev.to | 51 | UGC | GitHub OAuth | 30 min |
| **P3** | CSDN | 80+ | Nofollow | 需注册 | 40 min |
| **P3** | 掘金 | 70+ | Nofollow | 需注册 | 40 min |
| **P4** | SEO 核心 | - | - | API | 10 min |

---

## 二、Phase 1 — 高优先级 (DA 90+, dofollow)

> 目标: 建立 4 条高质量 dofollow 外链，DA 总和 370+

### 1.1 GitHub (DA 100)

**操作步骤:**
```bash
# 1. Profile 链接 (20 min)
xbrowser github-seo login
# → Settings → Profile → Website: https://xbrowser.dev → Update profile

# 2. README.md 横幅 (10 min)
# 编辑 GitHub profile README，添加 xbrowser 项目介绍
# 在 https://github.com/{username}/{username} 仓库的 README.md 中插入链接

# 3. 仓库 About 链接 (5 min)
# xbrowser 主仓库 → Settings → Website: https://xbrowser.dev

# 4. Gist 创建 (5 min)
# 创建一个 xbrowser 使用技巧的 Gist，包含链接
```

**预期效果:** 4 条 dofollow 链接，GitHub 内页权重高，搜索引擎抓取频繁

---

### 1.2 WordPress.com (DA 93)

**操作步骤:**
```bash
# 1. Profile 链接
xbrowser wordpress-seo login
# → Me → Profile → Website: https://xbrowser.dev → Save

# 2. 发布文章 (含 contextual backlink)
xbrowser wordpress-seo publish \
  --title "Automate Browser Tasks with xbrowser: A Developer's Guide" \
  --content ./content/wp-article.md \
  --tags "browser-automation,web-scraping,developer-tools"
```

**内容要求:**
- 1500+ 字原创英文文章
- 标题包含 "browser automation" 关键词
- 正文中自然插入 2-3 个指向 xbrowser.dev 的链接
- 锚文本多样化: "xbrowser", "browser automation CLI", "xbrowser.dev"

**预期效果:** Profile 链接 + 文章 contextual link，WordPress 文章页收录快

---

### 1.3 Product Hunt (DA 91)

**操作步骤:**
```bash
# 1. 提交产品
xbrowser producthunt-seo login
xbrowser producthunt-seo submit-product \
  --name "xbrowser" \
  --url https://xbrowser.dev \
  --description "AI-powered browser automation CLI for developers"
```

**发布策略:**
- 选择周二至周四 (PST 12:01 AM) 发布，流量最高
- 准备好 Maker Comment: 产品介绍 + 技术细节
- 标签: Developer Tools, Productivity, Open Source
- 提前 1 周在 Twitter/Reddit 预热

**预期效果:** 1 条 dofollow 链接 + 大量社区曝光 + 早期用户

---

### 1.4 Blogger (DA 89)

**操作步骤:**
```bash
# 1. Profile 链接
xbrowser blogger-seo login
# → Settings → User Profile → Website: https://xbrowser.dev → Save

# 2. 创建博客 + 发布文章
xbrowser blogger-seo create-blog \
  --title "xbrowser Dev Blog" \
  --url xbrowser-dev-tools

xbrowser blogger-seo publish \
  --title "Top 10 Browser Automation Use Cases for 2026" \
  --content ./content/blogger-article.html
```

**预期效果:** Google 生态内 dofollow 链接，Blogger 页面被 Google 快速收录

---

## 三、Phase 2 — 中优先级 (DA 80+, dofollow/nofollow)

> 目标: 扩大外链覆盖，建立品牌权威

### 2.1 Tumblr (DA 86, Dofollow)

```bash
xbrowser tumblr-seo login
# → Settings → 选择博客 → Blog Settings → Website URL: https://xbrowser.dev

xbrowser tumblr-seo publish \
  --title "Why I Built xbrowser — The Browser Automation CLI" \
  --content ./content/tumblr-post.html \
  --tags "browser,automation,cli,developer-tools,open-source"
```

**策略:** 短文 + 代码示例，标签覆盖 developer 社区

---

### 2.2 Hashnode (DA 80+, Dofollow with custom domain)

```bash
xbrowser hashnode-seo login
xbrowser hashnode-seo publish \
  --title "Building a Browser Automation CLI: Lessons Learned" \
  --content ./content/hashnode-article.md
```

**策略:** 技术深度文章，开发者受众精准。如配置 custom domain 可获得 dofollow。

---

### 2.3 Medium (DA 96, Nofollow)

```bash
xbrowser medium-seo login
# → Settings → Profile → Links → 添加 https://xbrowser.dev

# 方式 A: 直接发布
xbrowser medium-seo publish \
  --title "The Future of Browser Automation: AI + CLI" \
  --content ./content/medium-article.md

# 方式 B: Import (保留 canonical URL)
xbrowser medium-seo import --url https://xbrowser.dev/blog/xxx
```

**策略:** 虽为 nofollow，但 DA 96 带来品牌曝光和流量。Import 方式可保留 canonical 归属。

---

### 2.4 Quora (DA 92, Nofollow)

```bash
xbrowser quora-seo login
# → Settings → Profile → Website: https://xbrowser.dev

# 回答热门问题
xbrowser quora-seo answer \
  --question "What is the best browser automation tool for developers?" \
  --content ./content/quora-answer.md

# 发布 Article
xbrowser quora-seo publish-article \
  --title "How to Automate Browser Tasks Without Writing Selenium Code" \
  --content ./content/quora-article.md
```

**策略:** 搜索 "browser automation", "web scraping tools", "playwright alternative" 等问题并回答。Profile 链接 + 回答内 contextual link。

---

### 2.5 Dev.to (DA 51, UGC)

```bash
xbrowser devto-seo login
xbrowser devto-seo publish \
  --title "I Built a CLI That Controls Browsers Like a Human" \
  --content ./content/devto-article.md \
  --tags "javascript,webdev,browsers,opensource"
```

**策略:** 开发者社区精准受众，文章可获大量互动。使用 cover image 提升点击率。

---

## 四、Phase 3 — 中文市场

> 目标: 覆盖百度搜索，触达中文开发者

### 3.1 CSDN (DA 80+, 中文技术社区)

```bash
xbrowser csdn-seo login
xbrowser csdn-seo publish \
  --title "xbrowser：一款比 Selenium 更好用的浏览器自动化 CLI 工具" \
  --content ./content/csdn-article.md
```

**内容策略 (中文):**
- 标题包含关键词: "浏览器自动化", "CLI 工具"
- 内容 2000+ 字，含代码示例和截图
- 标签: 浏览器自动化, Web爬虫, Node.js, 开发工具
- 文章内自然插入 xbrowser.dev 链接

---

### 3.2 掘金 (DA 70+, 中文开发者社区)

```bash
xbrowser juejin-seo login
xbrowser juejin-seo publish \
  --title "我用 Node.js 写了一个浏览器自动化 CLI，支持 CAPTCHA 人机协作" \
  --content ./content/juejin-article.md
```

**内容策略 (中文):**
- 标题偏故事性，吸引点击
- 重点突出 CAPTCHA 人机协作、CDP 协议等技术亮点
- 配合代码演示和 GIF 动图
- 分类: 前端 / Node.js

---

### 3.3 中文内容通用策略

- **关键词布局:** 浏览器自动化, 网页爬虫, Web scraping, CLI 工具, Playwright 替代
- **内容差异化:** CSDN 偏教程，掘金偏技术分享
- **百度收录:** 两平台百度收录快，间接提升 xbrowser.dev 在百度的权重

---

## 五、Phase 4 — IndexNow + 搜索引擎提交

> 目标: 主动通知搜索引擎收录 xbrowser.dev 及所有已发布内容

### 4.1 初始配置 (一次性)

```bash
# 1. 生成 IndexNow Key
xbrowser seo setup-indexnow --domain xbrowser.dev
# 输出 key 和 keyUrl，按提示部署 key 文件到网站根目录

# 2. 检查 SEO 基础配置
xbrowser seo check --domain xbrowser.dev
# 检查 HTTPS, robots.txt, sitemap.xml, IndexNow key
```

### 4.2 Sitemap Ping

```bash
# 通知 Google 和 Bing 抓取 sitemap
xbrowser seo ping --sitemap "https://xbrowser.dev/sitemap.xml"
xbrowser seo ping --sitemap "https://xbrowser.dev/sitemap.xml" --engines "google"
xbrowser seo ping --sitemap "https://xbrowser.dev/sitemap.xml" --engines "bing"
```

### 4.3 URL 提交

```bash
# 提交首页
xbrowser seo submit --url "https://xbrowser.dev" --key "<YOUR_INDEXNOW_KEY>"

# 提交关键页面
xbrowser seo submit --url "https://xbrowser.dev/docs" --key "<YOUR_INDEXNOW_KEY>"
xbrowser seo submit --url "https://xbrowser.dev/docs/quickstart" --key "<YOUR_INDEXNOW_KEY>"
```

### 4.4 批量提交 (每次发布新内容后)

```bash
# 批量提交多个 URL
xbrowser seo bulk-submit \
  --urls "https://xbrowser.dev,https://xbrowser.dev/docs,https://xbrowser.dev/docs/quickstart,https://xbrowser.dev/docs/commands" \
  --key "<YOUR_INDEXNOW_KEY>"
```

### 4.5 外链页面加速收录

```bash
# 提交在各大平台发布的文章 URL (加速搜索引擎发现外链)
xbrowser seo bulk-submit \
  --urls "https://wordpress.com/post/xxx,https://medium.com/@xxx/xxx,https://dev.to/xxx/xxx" \
  --key "<YOUR_INDEXNOW_KEY>"
```

---

## 六、推广文案模板

### 6.1 英文文案

#### 一句话描述
> xbrowser is an AI-powered browser automation CLI that lets developers control browsers through natural language commands with human-in-the-loop CAPTCHA solving.

#### 核心卖点
1. **Natural Language Commands** — Control browsers with plain text, no Selenium code needed
2. **CAPTCHA Human-in-the-Loop** — Interactive CAPTCHA solving with live browser preview
3. **Multi-Engine Support** — Works with Chromium, Firefox, WebKit via Playwright
4. **Plugin Ecosystem** — Extend with SEO, scraping, social media plugins
5. **CDP + Playwright** — Direct Chrome DevTools Protocol + Playwright API access

#### CTA
```
Try xbrowser today: https://xbrowser.dev
GitHub: https://github.com/nicepkg/xbrowser
```

#### Twitter/X Post Template
```
Tired of writing Selenium code for browser automation? 🤖

I built xbrowser — a CLI that lets you control browsers with natural language.

✅ CAPTCHA solving with human-in-the-loop
✅ Plugin ecosystem for SEO, scraping, social
✅ Works with Chromium, Firefox, WebKit

Try it: https://xbrowser.dev
```

#### Product Hunt Description
```
xbrowser is a developer-first browser automation CLI powered by AI.

Control any browser with natural language commands. Solve CAPTCHAs interactively. Extend with plugins for SEO, web scraping, and social media automation.

Built on Playwright + Chrome DevTools Protocol. Works with Chromium, Firefox, and WebKit.

Key Features:
- Natural language browser commands
- Interactive CAPTCHA solving with live preview
- Plugin marketplace for extensibility
- CDP + Playwright API access
- Headless & headed modes
- Session management & cookie persistence

Perfect for: SEO professionals, web scrapers, QA engineers, and developers who want to automate browser tasks without writing code.
```

---

### 6.2 中文文案

#### 一句话描述
> xbrowser 是一款 AI 驱动的浏览器自动化 CLI 工具，支持自然语言控制浏览器，内置 CAPTCHA 人机协作和插件生态。

#### 核心卖点
1. **自然语言操控** — 用文字描述即可控制浏览器，无需写代码
2. **CAPTCHA 人机协作** — 遇验证码自动暂停，交互式预览手动解决
3. **多浏览器引擎** — 支持 Chromium、Firefox、WebKit
4. **插件生态** — SEO 外链、网页爬取、社交媒体等插件可扩展
5. **CDP + Playwright** — 直接访问 Chrome DevTools 协议和 Playwright API

#### CTA
```
立即体验 xbrowser: https://xbrowser.dev
GitHub: https://github.com/nicepkg/xbrowser
```

#### CSDN/掘金文章开头模板
```
大家好，今天给大家介绍一款我自己开发的浏览器自动化 CLI 工具 —— xbrowser。

如果你厌倦了写 Selenium 代码，或者觉得 Playwright 的 API 太繁琐，
xbrowser 可能是你一直在找的工具。

它支持用自然语言控制浏览器，比如：
- "打开 GitHub 并搜索 browser automation"
- "截个屏保存到桌面"
- "帮我把这个表单填一下"

遇到验证码？它会自动暂停并打开交互式预览，你手动解决后继续。

下面是详细的使用教程……
```

---

## 七、预估时间线

```
Week 1: Phase 1 — 高优先级平台
├── Day 1: GitHub (Profile + README + Repo About)
├── Day 2: Blogger (Profile + 创建博客 + 发布文章)
├── Day 3: WordPress.com (Profile + 发布文章)
└── Day 4-5: Product Hunt (准备素材 + 提交发布)

Week 2: Phase 2 — 中优先级平台
├── Day 1: Tumblr (Profile + 发布短文)
├── Day 2: Hashnode (发布技术文章)
├── Day 3: Medium (Profile + 发布/Import 文章)
├── Day 4: Quora (Profile + 回答 3-5 个热门问题)
└── Day 5: Dev.to (发布技术文章)

Week 3: Phase 3 — 中文市场
├── Day 1: CSDN (登录 + 发布文章)
├── Day 2: 掘金 (登录 + 发布文章)
└── Day 3: 补充回答知乎相关话题

Week 4: Phase 4 — 搜索引擎提交
├── Day 1: IndexNow 配置 + Sitemap Ping
├── Day 2: 批量提交所有已发布 URL
└── Day 3-5: 监控收录情况 + 查漏补缺

Ongoing (Week 5+):
├── 每周 1-2 篇新文章 (不同平台轮换)
├── Quora 持续回答相关问题
├── 新页面发布后立即 IndexNow 提交
└── 月度检查外链存活率和收录状态
```

---

## 八、成功指标

| 指标 | Week 4 目标 | Month 3 目标 |
|------|-----------|-------------|
| dofollow 外链数 | 6-8 条 | 15+ 条 |
| 总外链数 (含 nofollow) | 10-12 条 | 25+ 条 |
| Google 收录页面数 | 5-10 页 | 30+ 页 |
| 品牌搜索量 ("xbrowser") | 基线建立 | +50% |
| xbrowser.dev 月访问量 | 500 UV | 2000+ UV |
| Product Hunt Upvotes | 50+ | - |
| 各平台文章总阅读量 | 2000+ | 10000+ |

---

## 九、风险与注意事项

1. **内容原创性:** 每个平台发布不同角度/不同内容的文章，避免 duplicate content penalty
2. **链接节奏:** 不要一天内在所有平台发帖，分散到数周内完成
3. **CAPTCHA 处理:** 部分平台登录/发帖时可能触发验证码，xbrowser 的 `waitForHuman()` 会自动暂停
4. **账号安全:** 新注册账号首次操作不宜过于频繁，建议先浏览/互动几天再发布
5. **内容质量:** 宁可少发高质量文章，不要大量发低质内容，避免被平台判定为 spam

---

## 十、快速执行 Checklist

```bash
# Phase 1 批量登录 (前提: 已登录 Google 账号)
xbrowser github-seo login        # GitHub 直接进
xbrowser blogger-seo login       # Google 直进
xbrowser wordpress-seo login     # Google OAuth
# Product Hunt 需单独注册

# Phase 2 批量登录
xbrowser tumblr-seo login        # Google OAuth
xbrowser hashnode-seo login      # Google OAuth
xbrowser medium-seo login        # Google OAuth
xbrowser quora-seo login         # Google OAuth
xbrowser devto-seo login         # GitHub OAuth

# Phase 3 批量登录
xbrowser csdn-seo login          # 需注册
xbrowser juejin-seo login        # 需注册

# Phase 4 搜索引擎提交
xbrowser seo setup-indexnow --domain xbrowser.dev
xbrowser seo check --domain xbrowser.dev
xbrowser seo ping --sitemap "https://xbrowser.dev/sitemap.xml"
```
