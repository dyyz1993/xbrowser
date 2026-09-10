# Content Marketing Skill（xbrowser 自推广全流程）

> 目标：用 xbrowser 自己的能力完成"选题 → 写文章 → 生成封面 → 多平台发布"的完整推广闭环。
> 这是产品自举（dogfooding）的一部分——每一次自推广都是对 content + 平台插件链路的一次真实回归测试。

## 何时用本 skill

- 用户要求"推广 xbrowser / 写一篇 xbrowser 的文章 / 发一篇技术文章"
- 版本发布后需要产出战报文章
- 用户要写推广内容并分发到开发者社区

## 完整流程

### 第 1 步：选 case

```bash
xbrowser content cases
```

内置 case 库（`.xcli/plugins/content/cases/`）：

| slug | 主题 | en 平台 | zh 平台 |
|------|------|---------|---------|
| `self-healing-replay` | 自愈回放引擎（选择器级联/指纹/知识复用） | devto, medium, hashnode | juejin, csdn, zhihu |
| `cli-for-ai-agents` | 为什么 Agent 需要浏览器 CLI | devto, medium, hashnode | juejin, csdn, zhihu |
| `stealth-automation` | CDP 反检测实战（UA-CH/压制矩阵） | devto, medium, hashnode | juejin, csdn, zhihu |

### 第 2 步：渲染文章

```bash
# 中文版（默认输出 output/content/<slug>-<lang>.md）
xbrowser content draft --case self-healing-replay --lang zh

# 英文版 + 指定输出路径
xbrowser content draft --case self-healing-replay --lang en --output /tmp/article.md
```

draft 自动替换 `{{VERSION}}`/`{{DATE}}`/`{{INSTALL_CMD}}` 等变量，并返回各平台建议命令。

### 第 3 步：生成封面（可选但推荐）

```bash
xbrowser "set-viewport 1200 630 && content cover --title '文章标题' --subtitle '副标题' --output output/content/cover.png"
```

封面由 xbrowser 的浏览器渲染 HTML 模板后截图——零绘图库依赖。掘金等平台发布后可手动/自动补传封面。

### 第 4 步：逐平台发布

按 draft 返回的 `suggestedCommands` 执行（语言决定平台）：

```bash
# 中文 → 掘金（需要登录态，通常 --cdp 9221 连用户浏览器）
xbrowser juejin publish --file "output/content/self-healing-replay-zh.md" --tags "前端,自动化"

# 英文 → Dev.to
xbrowser devto publish --file "output/content/self-healing-replay-en.md" --tags "typescript,automation"
```

发布前先确认登录态：直接跑命令，插件返回 `LOGIN_REQUIRED` 时用 `xbrowser viewer` 让用户登录。

### 第 5 步：记录结果

把发布 URL 追加记录到 `output/content/published.md`（日期 / slug / 平台 / URL / 数据），供复盘。

## 写新 case

新增自推广文章时，在 `.xcli/plugins/content/cases/<slug>/` 下放三个文件：

```
<slug>/
├── case.json   # slug/title/description/langs/platforms/tags（双语）
├── en.md       # 英文正文，支持 {{VAR}} 占位符
└── zh.md       # 中文正文
```

变量占位符：`{{VERSION}}` `{{DATE}}` `{{INSTALL_CMD}}` `{{GITHUB_URL}}` `{{NPM_URL}}`。
正文要求：有真实技术深度（设计决策 + 踩坑 + 数据），末尾带安装 CTA 和"本文由 xbrowser 自己发布"的自举彩蛋。同步补 `tests/plugins/content.test.ts` 的 case 数量断言。

## 纪律

- **版本号纪律**：发布版本战报前先 `npm view @xbrowser/cli version` 校验，避免撞号。
- **风险红线**：不在高封号风险平台用真实账号跑自动化实验；发布行为保持人类可审频率。
- **登录态**：中文平台（掘金/CSDN/知乎）需要用户浏览器登录态（`--cdp 9221` 或 chrome-bridge）；离线时草稿先落 `output/content/`，桥恢复后补推。
- **诚实原则**：文章里的数据（下载量对比、场景数）必须真实，不夸大。
