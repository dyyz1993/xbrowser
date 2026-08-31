# 插件完成度看板

> **自动生成，请勿手改** · 由 `lint-scripts/check-plugin-status.mjs` 生成
> 生成时间：2026-08-28 · 规范见 `docs/plans/2026-06-27-plugin-completion-spec.md`

## 汇总

| 指标 | 值 |
|------|-----|
| 插件总数 | 125 |
| ✅ 已完成（有实现+有测试） | 89 |
| 🟡 有实现无测试 | 22 |
| 🔴 scaffold 待实现 | 14 |
| **当前债务** | **36** |

> 债务 = 🟡无测试 + 🔴scaffold + ⛔加载失败。目标：债务 → 0。

## 🔴 Scaffold 待实现（14）

| 插件 | 行数 | URL |
|------|------|-----|
| amazon | 14 | https://www.amazon.com |
| booking | 14 | https://www.booking.com |
| boss | 14 | https://www.zhipin.com |
| confluence | 14 | https://xxx.atlassian.net/wiki |
| grok | 14 | https://grok.com |
| indeed | 14 | https://www.indeed.com |
| jira | 14 | https://xxx.atlassian.net |
| kimi | 14 | https://kimi.moonshot.cn |
| linkedin | 14 | https://www.linkedin.com |
| linkedin-learning | 14 | https://www.linkedin.com/learning |
| notebooklm | 14 | https://notebooklm.google.com |
| tiktok | 14 | https://www.tiktok.com |
| upwork | 14 | https://www.upwork.com |
| youtube | 14 | https://www.youtube.com |

## 🟡 有实现无测试（22） — P1 优先

| 插件 | 行数 | 命令数 | scope |
|------|------|--------|-------|
| bbc | 39 | 1 | `project` |
| douban | 59 | 1 | `page` |
| github-trending | 53 | 1 | `project` |
| goofish | 333 | 3 | `page` |
| google-scholar | 47 | 1 | `project` |
| hf | 62 | 2 | `project` |
| login-bridge | 339 | 5 | `page`, `project` |
| maven | 39 | 1 | `project` |
| nuget | 40 | 1 | `project` |
| packagist | 38 | 1 | `project` |
| producthunt | 286 | 4 | `browser`, `page` |
| pubmed | 47 | 1 | `project` |
| rubygems | 39 | 1 | `project` |
| semanticscholar | 39 | 1 | `project` |
| smzdm | 56 | 1 | `page` |
| stackoverflow | 43 | 1 | `project` |
| ths | 60 | 1 | `page` |
| tieba | 51 | 1 | `page` |
| weread | 40 | 1 | `project` |
| wikidata | 65 | 2 | `project` |
| xueqiu | 64 | 2 | `project` |
| yahoo-finance | 46 | 1 | `project` |

## ✅ 已完成（89）

| 插件 | 命令数 | scope |
|------|--------|-------|
| 1688 | 5 | `browser` |
| 58pic | 1 | `browser` |
| 699pic | 1 | `browser` |
| 9gag | 1 | `browser` |
| ai-search | 1 | `browser` |
| apple-podcasts | 2 | `project` |
| artstation | 1 | `browser` |
| arxiv | 3 | `project` |
| assert | 1 | `page` |
| backlink-auto | 3 | `browser`, `project` |
| baidu | 8 | `browser`, `cli` |
| behance | 1 | `browser` |
| bilibili | 5 | `browser` |
| bing | 3 | `browser`, `cli` |
| blogger | 4 | `browser`, `page` |
| bloomberg | 1 | `browser` |
| chatgpt | 5 | `browser`, `page` |
| claude | 5 | `browser`, `page` |
| cmf-seats | 3 | `any`, `page` |
| crates | 2 | `project` |
| csdn | 5 | `browser`, `page` |
| ctrip | 1 | `browser` |
| ctrip-review | 1 | `browser` |
| deepseek | 8 | `browser`, `page` |
| deviantart | 1 | `browser` |
| devto | 4 | `browser`, `page` |
| dianping | 1 | `page` |
| dictionary | 3 | `project` |
| diff | 1 | `page` |
| doubao | 20 | `browser`, `page` |
| douyin | 8 | `browser` |
| dribbble | 1 | `browser` |
| duitang | 1 | `browser` |
| eastmoney | 2 | `browser` |
| facebook | 5 | `browser` |
| flickr | 1 | `browser` |
| freepik | 1 | `browser` |
| gemini | 3 | `page` |
| geo-analysis | 9 | `browser`, `global` |
| gettyimages | 1 | `browser` |
| github | 6 | `browser` |
| google | 3 | `browser`, `cli` |
| hackernews | 8 | `project` |
| hashnode | 4 | `browser`, `page` |
| homebrew | 2 | `project` |
| huaban | 1 | `browser` |
| image | 1 | `browser` |
| imdb | 2 | `browser` |
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
| pixiv | 2 | `browser` |
| pypi | 3 | `project` |
| qianwen | 5 | `browser`, `page` |
| quanjing | 1 | `browser` |
| quora | 4 | `browser`, `page` |
| qwen | 4 | `browser` |
| reddit | 5 | `browser` |
| reuters | 1 | `browser` |
| seo | 16 | `browser`, `project` |
| shutterstock | 1 | `browser` |
| spotify | 1 | `browser` |
| stats | 6 | `browser`, `cli` |
| steam | 1 | `browser` |
| substack | 1 | `browser` |
| suno | 4 | `browser` |
| taobao | 11 | `browser` |
| tdx | 1 | `project` |
| testsuite | 1 | `page` |
| tumblr | 1 | `browser` |
| twitter | 10 | `browser` |
| udio | 6 | `browser` |
| unsplash | 1 | `browser` |
| v2ex | 2 | `browser` |
| wanx | 3 | `browser` |
| weibo | 3 | `browser` |
| wikipedia | 5 | `project` |
| wordpress | 5 | `browser`, `page` |
| xiaohongshu | 8 | `browser` |
| yuanbao | 5 | `browser`, `page` |
| zhihu | 8 | `browser` |
