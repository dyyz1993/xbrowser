# 插件完成度看板

> **自动生成，请勿手改** · 由 `lint-scripts/check-plugin-status.mjs` 生成
> 生成时间：2026-10-17 · 规范见 `docs/plans/2026-06-27-plugin-completion-spec.md`

## 汇总

| 指标 | 值 |
|------|-----|
| 插件总数 | 123 |
| ✅ 已完成（有实现+有测试） | 121 |
| 🟡 有实现无测试 | 0 |
| 🔴 scaffold 待实现 | 2 |
| **当前债务** | **2** |

> 债务 = 🟡无测试 + 🔴scaffold + ⛔加载失败。目标：债务 → 0。

## 🔴 Scaffold 待实现（2）

| 插件 | 行数 | URL |
|------|------|-----|
| confluence | 14 | https://xxx.atlassian.net/wiki |
| jira | 14 | https://xxx.atlassian.net |

## 🟡 有实现无测试（0） — P1 优先

| 插件 | 行数 | 命令数 | scope |
|------|------|--------|-------|

## ✅ 已完成（121）

| 插件 | 命令数 | scope |
|------|--------|-------|
| 1688 | 5 | `browser` |
| 51cto | 4 | `browser`, `page` |
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
| bbc | 1 | `project` |
| behance | 1 | `browser` |
| bilibili | 5 | `browser` |
| bing | 3 | `browser`, `cli` |
| blogger | 4 | `browser`, `page` |
| bloomberg | 1 | `browser` |
| booking | 1 | `browser` |
| boss | 2 | `page` |
| chatgpt | 5 | `browser`, `page` |
| chrome-bridge | 9 | `project` |
| claude | 5 | `browser`, `page` |
| cmf-seats | 3 | `any`, `page` |
| cnblogs | 3 | `browser`, `page` |
| content | 3 | `page`, `project` |
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
| douban | 1 | `page` |
| doubao | 20 | `browser`, `page` |
| douyin | 8 | `browser` |
| dribbble | 1 | `browser` |
| duitang | 1 | `browser` |
| eastmoney | 2 | `browser` |
| facebook | 5 | `browser` |
| flickr | 1 | `browser` |
| freepik | 1 | `browser` |
| gemini | 12 | `page`, `project` |
| geo-analysis | 9 | `browser`, `global` |
| gettyimages | 1 | `browser` |
| github | 6 | `browser` |
| github-trending | 1 | `project` |
| goofish | 3 | `page` |
| google | 3 | `browser`, `cli` |
| google-scholar | 1 | `project` |
| hackernews | 8 | `project` |
| hashnode | 4 | `browser`, `page` |
| hf | 2 | `project` |
| homebrew | 2 | `project` |
| huaban | 1 | `browser` |
| image | 1 | `browser` |
| imdb | 2 | `browser` |
| imgur | 1 | `browser` |
| instagram | 1 | `browser` |
| jd | 1 | `browser` |
| juejin | 6 | `browser`, `page` |
| kimi | 1 | `browser` |
| login-bridge | 5 | `page`, `project` |
| maven | 1 | `project` |
| medium | 5 | `browser`, `page` |
| mureka | 6 | `browser` |
| npm | 3 | `project` |
| nuget | 1 | `project` |
| oschina | 3 | `browser`, `page` |
| p500px | 1 | `browser` |
| packagist | 1 | `project` |
| pexels | 1 | `browser` |
| pinterest | 1 | `browser` |
| pixabay | 1 | `browser` |
| pixiv | 2 | `browser` |
| producthunt | 4 | `browser`, `page` |
| pubmed | 1 | `project` |
| pypi | 3 | `project` |
| qianwen | 5 | `browser`, `page` |
| quanjing | 1 | `browser` |
| quora | 4 | `browser`, `page` |
| qwen | 4 | `browser` |
| reddit | 5 | `browser` |
| reuters | 1 | `browser` |
| rubygems | 1 | `project` |
| segmentfault | 3 | `browser`, `page` |
| semanticscholar | 1 | `project` |
| seo | 16 | `browser`, `project` |
| shutterstock | 1 | `browser` |
| smzdm | 1 | `page` |
| spotify | 1 | `browser` |
| stackoverflow | 1 | `project` |
| stats | 6 | `browser`, `cli` |
| steam | 1 | `browser` |
| substack | 1 | `browser` |
| suno | 4 | `browser` |
| taobao | 11 | `browser` |
| tdx | 1 | `project` |
| testsuite | 1 | `page` |
| ths | 1 | `page` |
| tieba | 1 | `page` |
| tumblr | 1 | `browser` |
| twitter | 10 | `browser` |
| udio | 6 | `browser` |
| unsplash | 1 | `browser` |
| v2ex | 2 | `browser` |
| wanx | 3 | `browser` |
| weibo | 3 | `browser` |
| weread | 1 | `project` |
| wikidata | 2 | `project` |
| wikipedia | 5 | `project` |
| wordpress | 5 | `browser`, `page` |
| xiaohongshu | 8 | `browser` |
| xueqiu | 2 | `project` |
| yahoo-finance | 1 | `project` |
| youtube | 1 | `browser` |
| yuanbao | 6 | `browser`, `page` |
| zhihu | 8 | `browser` |
