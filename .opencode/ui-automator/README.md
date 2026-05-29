# UI Automator 知识库

> 最后更新：2026-05-29 | 来源：文章存活率复查 + 反检测工具建设

## 摘要
xbrowser 项目 UI 自动化相关知识沉淀，包含 AI 搜索引擎 GEO 平台 spec、网络拦截、评分引擎、推广发帖、**反检测（拟人化操作 + 内容去 AI 化 + 发文节奏控制）**、豆包文生图、SEO 优化等。

## Specs（规格文档）
| 文件 | 内容 | 最后更新 |
|------|------|----------|
| [specs/ai-search-engines-spec.md](specs/ai-search-engines-spec.md) | AI 搜索引擎 GEO 平台完整能力矩阵（12国内+4国际） | 2026-05-19 |

## 推广平台发布状态（2026-05-28 复查 — CDP 9221 真实浏览器验证）

### ✅ 存活（4 篇 — 2026-05-29 复查）

| # | 平台 | URL | 语言 | 备注 |
|---|------|-----|------|------|
| 1 | 掘金 V1 | https://juejin.cn/post/7644466893395525666 | CN | "xbrowser：一个命令行搞定浏览器自动化"，248阅读 |
| 2 | 掘金 V2 | https://juejin.cn/post/7644773671907885097 | CN | "同一个网站操作 10 次，我的 AI Agent 烧了 5 万 Token" |
| 3 | CSDN V2 | https://blog.csdn.net/u012596714/article/details/161494990 | CN | "同一个网站操作 10 次，我的 AI Agent 烧了 5 万 Token" |
| 4 | CSDN V4 | https://blog.csdn.net/u012596714/article/details/161495756 | CN | "凌晨三点，我的爬虫被 reCAPTCHA 干掉了" |

### ❌ 已删除（12 篇 — 2026-05-29 复查）

| 平台 | 被删数 | 原因分析 |
|------|--------|----------|
| Dev.to | 6/6 全删 | 同一天批量发 5 篇 + AI 生成特征 + 新账号无互动 |
| 掘金 | 4/6 被删 | V3-V6 同天连发 4 篇，被判营销号；V1/V2 跨天发存活 |
| CSDN | 2/4 被删 | V1 标题含产品名被删；V3 审核不通过 |

### ⏳ 草稿待发（2 篇）

| # | 平台 | URL | 备注 |
|---|------|-----|------|
| 1 | CSDN V5 | https://mp.csdn.net/mp_blog/creation/editor/161495822 | 发文额度不足 |
| 2 | CSDN V6 | https://mp.csdn.net/mp_blog/creation/editor/161495863 | 发文额度不足 |

### ❓ 无法验证 — 被墙（5 篇）

Medium、Tumblr、Reddit×2、Quora — 需翻墙环境验证

### 汇总

- **存活率**: 4/16（25%）
- **被删原因**: 批量发文（同天 >1 篇）+ AI 生成特征 + 新账号
- **存活规律**: 每天最多 1 篇 + 跨天发布 + 内容质量高的存活

### 被删根因分析

1. **发文节奏**（主因）：同一天发 4-5 篇触发平台批量发文检测
2. **新账号**：Dev.to 账号无评论/点赞历史，被当作营销号
3. **操作指纹**：fill() 无键盘事件、无鼠标移动、固定延迟
4. **AI 内容**：文章结构太完美，句长方差低，缺乏真实因果链

### 文章文件
| 文件 | 版本 | 语言 | 标题 |
|------|------|------|------|
| `docs/promo-article-v3-cn.md` | V3 | CN | 我只想抓一个网页标题，为什么要写 50 行 Puppeteer 代码？ |
| `docs/promo-article-v3-en.md` | V3 | EN | I Just Wanted to Scrape One Page. Why Did I Write 50 Lines of Puppeteer? |
| `docs/promo-article-v2-cn.md` | V2 | CN | 同一个网站操作 10 次，我的 AI Agent 烧了 5 万 Token |
| `docs/promo-article-v2-en.md` | V2 | EN | My AI Agent Burned 26K Tokens Doing the Same Browser Task 10 Times |
| `docs/promo-wordpress-article.md` | V1 | EN | I Replaced 50-Line Puppeteer Scripts with Single CLI Commands |
| `docs/promo-chinese-article.md` | V1 | CN | xbrowser：一个命令行搞定浏览器自动化 |

## 选择器库
| 文件 | 站点 | 最后更新 |
|------|------|----------|
| [selectors/doubao.md](selectors/doubao.md) | 豆包 (doubao.com) 文生图选择器 + URL 格式 | 2026-05-28 |

## 反检测工具（2026-05-29 新增）

| 工具 | 路径 | 用途 |
|------|------|------|
| 拟人化操作库 | `.xcli/utils/humanize.ts` | humanFill/humanClick/randomPause/humanBrowse/humanMouseMove |
| 发文节奏控制 | `.xcli/utils/publish-tracker.ts` | 每平台每天限 1 篇、8h 间隔检查、发布历史追踪 |
| 内容去 AI 化指南 | `patterns/ai-content-humanize.md` | 7 大检测特征 + 8 条改写策略 + prompt 模板 + 发布前检查清单 |

## 复用模式
| 文件 | 模式 | 最后更新 |
|------|------|----------|
| [patterns/ai-content-humanize.md](patterns/ai-content-humanize.md) | 内容去 AI 化（改写策略 + prompt 模板 + 检查清单） | 2026-05-29 |
| [patterns/network-interceptor.md](patterns/network-interceptor.md) | Daemon 级网络拦截 + 评分 + 关联 | 2026-05-14 |
| [patterns/anti-bot-detection.md](patterns/anti-bot-detection.md) | 反机器人主动检测（验证码/警告/阻断/webdriver） | 2026-05-27 |
| [patterns/geo-strategy.md](patterns/geo-strategy.md) | GEO 策略（基于搜索引擎引用链优化） | 2026-05-28 |

## 踩坑记录
| 文件 | 问题 | 最后更新 |
|------|------|----------|
| [troubleshooting/doubao-image-bugs.md](troubleshooting/doubao-image-bugs.md) | 豆包文生图 4 个 bug（输入/选择器/历史图/高清下载） | 2026-05-28 |
| [troubleshooting/csdn-cloudflare.md](troubleshooting/csdn-cloudflare.md) | CSDN 编辑器被 Cloudflare bot 检测拦截 | 2026-05-27 |
| [troubleshooting/juejin-captcha.md](troubleshooting/juejin-captcha.md) | 掘金登录滑块验证码 | 2026-05-27 |
| [troubleshooting/cdp-session-loss.md](troubleshooting/cdp-session-loss.md) | cdp-tunnel 重启后登录态丢失 | 2026-05-27 |
| [troubleshooting/cloudflare-bot-block.md](troubleshooting/cloudflare-bot-block.md) | Cloudflare bot 检测拦截通用解决方案 | 2026-05-28 |

## 插件开发笔记
| 文件 | 站点 | 最后更新 |
|------|------|----------|
| [plugins/doubao.md](plugins/doubao.md) | 豆包插件 20 个命令 + 文生图流程 + 高清下载 | 2026-05-28 |
| [plugins/devto-promotion.md](plugins/devto-promotion.md) | Dev.to 发帖 SOP（7 篇经验沉淀） | 2026-05-29 |
| [plugins/juejin-promotion.md](plugins/juejin-promotion.md) | 掘金发帖 SOP（2 篇经验沉淀） | 2026-05-29 |
| [plugins/csdn-promotion.md](plugins/csdn-promotion.md) | CSDN 发帖 SOP（2 篇经验沉淀，含被删踩坑） | 2026-05-29 |
| [plugins/platform-promotion-guide.md](plugins/platform-promotion-guide.md) | 多平台推广总览（登录检测 + 编辑器类型） | 2026-05-27 |

## 变更记录
- 2026-05-29：**反检测工具三件套上线**：拟人化操作库(humanize.ts) + 发文节奏控制(publish-tracker.ts) + 内容去AI化指南；三个发帖插件(devto/juejin/csdn)已集成拟人化操作；文章存活率复查（4/16=25%）
- 2026-05-28：新增豆包插件沉淀（选择器 + 开发笔记 + 4 个 bug 踩坑记录）
- 2026-05-28：新增 GEO 策略 + 踐douao-image-bugs（4 个 bug） + doubao.md（开发笔记）
- 2026-05-28：新增平台发布状态复查 + Cloudflare 拦截分析
- 2026-05-28：推广文章已发布到英文平台（6 个）
- 2026-05-28：新增 SEO 优化（xbrowser.dev meta 标签、package.json 关键词、英文文章 SEO 关键词、中文文章 SEO 关键词）
- 2026-05-27：新增推广发帖沉淀（Dev.to/Medium/Hashnode/CSDN/掘金/Quora）
- 2026-05-27：新增反检测模式 + 6 个平台发帖验证
- 2026-05-27：新增网络拦截器知识沉淀 + 推广发帖流程
- 2026-05-14：初始创建（网络拦截器知识沉淀）
