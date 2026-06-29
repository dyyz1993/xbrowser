# 插件完成度看板

> **自动生成，请勿手改** · 由 `lint-scripts/check-plugin-status.mjs` 生成
> 生成时间：2026-06-29 · 规范见 `docs/plans/2026-06-27-plugin-completion-spec.md`

## 汇总

| 指标 | 值 |
|------|-----|
| 插件总数 | 123 |
| ✅ 已完成（有实现+有测试） | 71 |
| 🟡 有实现无测试 | 28 |
| 🔴 scaffold 待实现 | 24 |
| **当前债务** | **52** |

> 债务 = 🟡无测试 + 🔴scaffold + ⛔加载失败。目标：债务 → 0。

## 🔴 Scaffold 待实现（24）

| 插件 | 行数 | URL |
|------|------|-----|
| amazon | 14 | https://www.amazon.com |
| bloomberg | 14 | https://www.bloomberg.com |
| booking | 14 | https://www.booking.com |
| boss | 14 | https://www.zhipin.com |
| confluence | 14 | https://xxx.atlassian.net/wiki |
| ctrip | 14 | https://www.ctrip.com |
| eastmoney | 14 | https://www.eastmoney.com |
| grok | 14 | https://grok.com |
| imdb | 14 | https://www.imdb.com |
| indeed | 14 | https://www.indeed.com |
| jira | 14 | https://xxx.atlassian.net |
| kimi | 14 | https://kimi.moonshot.cn |
| linkedin | 14 | https://www.linkedin.com |
| linkedin-learning | 14 | https://www.linkedin.com/learning |
| notebooklm | 14 | https://notebooklm.google.com |
| pixiv | 14 | https://www.pixiv.net |
| reuters | 14 | https://www.reuters.com |
| spotify | 14 | https://open.spotify.com |
| substack | 14 | https://substack.com |
| tdx | 14 | https://www.tdx.com.cn |
| tiktok | 14 | https://www.tiktok.com |
| upwork | 14 | https://www.upwork.com |
| v2ex | 14 | https://www.v2ex.com |
| youtube | 14 | https://www.youtube.com |

## 🟡 有实现无测试（28） — P1 优先

| 插件 | 行数 | 命令数 | scope |
|------|------|--------|-------|
| apple-podcasts | 67 | 2 | `project` |
| arxiv | 92 | 3 | `project` |
| bbc | 39 | 1 | `project` |
| crates | 74 | 2 | `project` |
| dictionary | 80 | 3 | `project` |
| douban | 59 | 1 | `page` |
| github-trending | 53 | 1 | `project` |
| google-scholar | 47 | 1 | `project` |
| hackernews | 229 | 8 | `project` |
| hf | 62 | 2 | `project` |
| homebrew | 70 | 2 | `project` |
| maven | 39 | 1 | `project` |
| nuget | 40 | 1 | `project` |
| packagist | 38 | 1 | `project` |
| producthunt | 286 | 4 | `browser`, `page` |
| pubmed | 47 | 1 | `project` |
| pypi | 96 | 3 | `project` |
| rubygems | 39 | 1 | `project` |
| semanticscholar | 39 | 1 | `project` |
| smzdm | 56 | 1 | `page` |
| stackoverflow | 43 | 1 | `project` |
| ths | 60 | 1 | `page` |
| tieba | 51 | 1 | `page` |
| weread | 40 | 1 | `project` |
| wikidata | 65 | 2 | `project` |
| wikipedia | 124 | 5 | `project` |
| xueqiu | 64 | 2 | `project` |
| yahoo-finance | 46 | 1 | `project` |

## ✅ 已完成（71）

| 插件 | 命令数 | scope |
|------|--------|-------|
| 1688 | 5 | `browser` |
| 58pic | 1 | `browser` |
| 699pic | 1 | `browser` |
| 9gag | 1 | `browser` |
| ai-search | 1 | `browser` |
| artstation | 1 | `browser` |
| assert | 1 | `page` |
| backlink-auto | 3 | `browser`, `project` |
| baidu | 8 | `browser`, `cli` |
| behance | 1 | `browser` |
| bilibili | 5 | `browser` |
| bing | 3 | `browser`, `cli` |
| blogger | 4 | `browser`, `page` |
| chatgpt | 5 | `browser`, `page` |
| claude | 5 | `browser`, `page` |
| cmf-seats | 3 | `any`, `page` |
| csdn | 5 | `browser`, `page` |
| ctrip-review | 1 | `browser` |
| deepseek | 8 | `browser`, `page` |
| deviantart | 1 | `browser` |
| devto | 4 | `browser`, `page` |
| dianping | 1 | `page` |
| diff | 1 | `page` |
| doubao | 20 | `browser`, `page` |
| douyin | 8 | `browser` |
| dribbble | 1 | `browser` |
| duitang | 1 | `browser` |
| facebook | 5 | `browser` |
| flickr | 1 | `browser` |
| freepik | 1 | `browser` |
| gemini | 3 | `page` |
| geo-analysis | 9 | `browser`, `global` |
| gettyimages | 1 | `browser` |
| github | 6 | `browser` |
| google | 3 | `browser`, `cli` |
| hashnode | 4 | `browser`, `page` |
| huaban | 1 | `browser` |
| image | 1 | `browser` |
| imgur | 1 | `browser` |
| instagram | 1 | `browser` |
| jd | 1 | `browser` |
| juejin | 6 | `browser`, `page` |
| medium | 5 | `browser`, `page` |
| mureka | 6 | `browser` |
| npm | 3 | `project` |
| p500px | 1 | `browser` |
| pexels | 1 | `browser` |
| pinterest | 1 | `browser` |
| pixabay | 1 | `browser` |
| qianwen | 5 | `browser`, `page` |
| quanjing | 1 | `browser` |
| quora | 4 | `browser`, `page` |
| qwen | 4 | `browser` |
| reddit | 5 | `browser` |
| seo | 16 | `browser`, `project` |
| shutterstock | 1 | `browser` |
| stats | 6 | `browser`, `cli` |
| steam | 1 | `browser` |
| suno | 4 | `browser` |
| taobao | 11 | `browser` |
| testsuite | 1 | `page` |
| tumblr | 1 | `browser` |
| twitter | 10 | `browser` |
| udio | 6 | `browser` |
| unsplash | 1 | `browser` |
| wanx | 3 | `browser` |
| weibo | 3 | `browser` |
| wordpress | 5 | `browser`, `page` |
| xiaohongshu | 8 | `browser` |
| yuanbao | 5 | `browser`, `page` |
| zhihu | 8 | `browser` |
