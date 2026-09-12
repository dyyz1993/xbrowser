# 发布矩阵使用手册

> xbrowser 内容发布矩阵——**14 个平台**，统一 `login / draft / publish` 三件套，全部走浏览器真实登录态。
> 最后更新：2026-09-11

## 快速上手

```bash
# 1. 连接浏览器（获取登录态）
xbrowser --cdp 9221 goto https://juejin.cn

# 2. 发布文章（draft 先存草稿，publish 直接发布）
xbrowser juejin publish --title "标题" --file article.md --tags "前端,自动化"
xbrowser juejin draft --title "标题" --file article.md    # 只存草稿

# 3. 生成封面图（浏览器自渲染，零绘图库）
xbrowser "set-viewport 1200 630 && content cover --title '文章标题' --output cover.png"

# 4. 浏览内置推广选题
xbrowser content cases
xbrowser content draft --case self-healing-replay --lang zh
```

## 平台矩阵一览

| # | 平台 | 插件名 | login | draft | publish | 编辑器 | 适合内容 | 登录态 |
|---|------|--------|:-----:|:-----:|:-------:|--------|---------|:------:|
| 1 | 掘金 | `juejin` | ✅ | ✅ | ✅ | CodeMirror | 技术深文 | ✅ |
| 2 | CSDN | `csdn` | ✅ | ✅ | ✅ | textarea | 教程/SEO | ✅ |
| 3 | 知乎 | `zhihu` | ✅ | ✅ | ✅ | 富文本 | 观点/问答 | ✅ |
| 4 | dev.to | `devto` | ✅ | ✅ | ✅ | textarea | 英文技术 | ✅ |
| 5 | Medium | `medium` | ✅ | ✅ | ✅ | 富文本 | 英文长文 | ✅ |
| 6 | Hashnode | `hashnode` | ✅ | ✅ | ✅ | Markdown | 英文技术 | ✅ |
| 7 | Blogger | `blogger` | ✅ | — | ✅ | — | 英文 SEO | ✅ |
| 8 | WordPress | `wordpress` | ✅ | ✅ | ✅ | Gutenberg | 自建站 | ✅ |
| 9 | SegmentFault | `segmentfault` | ✅ | ✅ | ✅ | CodeMirror/textarea | 技术问答 | ✅ |
| 10 | 博客园 | `cnblogs` | ✅ | ✅ | ✅ | TinyMCE | 老牌技术博客 | ✅ |
| 11 | 51CTO | `51cto` | ✅ | ✅ | ✅ | textarea | IT 运维/认证 | ✅ |
| 12 | oschina | `oschina` | ✅ | ✅ | ✅ | TipTap/ProseMirror | 开源/技术资讯 | ✅ |
| 13 | 少数派 | — | ✅ | 🔲 | 🔲 | — | 泛科技/效率 | ✅ |
| 14 | InfoQ | — | ✅ | 🔲 | 🔲 | — | 企业级技术 | ✅ |
| 15 | 腾讯云社区 | — | ✅ | — | — | — | 云原生 | ⚠️ 仅微信扫码 |
| 16 | 阿里云社区 | — | ✅ | — | — | — | 云计算 | ⚠️ 跳支付宝 |

## 每平台详细用法

### 掘金

```bash
xbrowser juejin publish --title "标题" --file article.md --tags "前端,自动化"
xbrowser juejin draft --title "标题" --content "# 正文"
```

- **编辑器**：CodeMirror，标题用 `.title-input`
- **图片**：正文中的图片 paste 后自动上传掘金 CDN（`p0-xtjj-private.juejin.cn`）
- **标签**：byte-select 组件，需键盘 ArrowDown+Enter 选建议项（直接 click 不生效）
- **发布按钮**：顶栏"发布"是视频入口，文章发布走面板内"确定并发布"
- **封面**：文内首图自动设为封面

### CSDN

```bash
xbrowser csdn publish --title "标题" --file article.md --tags "前端,自动化"
```

- **编辑器**：textarea（Markdown 模式）
- **发布入口**：mp.csdn.net 后台

### 知乎

```bash
xbrowser zhihu publish --title "标题" --file article.md
```

### dev.to

```bash
xbrowser devto publish --title "标题" --file article.md --tags "typescript,automation"
xbrowser devto draft --title "标题" --content "# Draft"
```

- **编辑器**：textarea `#article_body_markdown`（注意：标题已改版为 `textarea#article-form-title`）
- **⚠️ slug 变更**：发表后 URL slug 会变（草稿 `23a3` → 发表 `37de`），必须从 `/api/articles/me` 拿最终 URL
- **cover_image**：API 支持 `cover_image` 字段，publish 参数待暴露

### Medium

```bash
xbrowser medium publish --title "标题" --file article.md
```

### Hashnode

```bash
xbrowser hashnode publish --title "标题" --file article.md
```

### Blogger

```bash
xbrowser blogger publish --title "标题" --file article.md
```

### WordPress

```bash
xbrowser wordpress publish --title "标题" --file article.md
xbrowser wordpress draft --title "标题" --file article.md
```

### SegmentFault

```bash
xbrowser segmentfault publish --title "标题" --file article.md --tags "前端,自动化"
xbrowser segmentfault draft --title "标题" --file article.md
```

- **编辑器**：/write 页，CodeMirror 或 textarea
- **⚠️ 权限**：新账号可能需要先完成写作权限开通（首次进 /write 会引导）

### 博客园

```bash
xbrowser cnblogs publish --title "标题" --file article.md
xbrowser cnblogs draft --title "标题" --file article.md
```

- **编辑器**：i.cnblogs.com/posts/edit，TinyMCE
- **⚠️ 正文写入**：必须用 `tinymce.setContent()` API，native setter + input 事件**不进编辑器内部状态**（实测踩坑）

### 51CTO

```bash
xbrowser 51cto publish --title "标题" --file article.md
xbrowser 51cto draft --title "标题" --file article.md
```

- **编辑器**：blog.51cto.com/blogger/publish，textarea `.write-area`
- **登录**：手机号验证码或微信扫码（登录页在跨域 iframe 中，自动填写受限）

### oschina

```bash
xbrowser oschina publish --title "标题" --file article.md
xbrowser oschina draft --title "标题" --file article.md
```

- **编辑器**：my.oschina.net/u/<uid>/blog/ai-write（OSC·智写平台），TipTap/ProseMirror
- **⚠️ 正文写入**：TipTap 需先聚焦再 `keyboard.insertText()`，native setter 不生效

## 内容营销插件（content）

```bash
# 查看内置推广选题（4 个：自愈回放 / CLI for AI agents / Stealth / MCP server）
xbrowser content cases

# 渲染文章（中英双语，自动替换版本号/日期/安装命令）
xbrowser content draft --case self-healing-replay --lang zh

# 生成 OG 封面（浏览器自渲染，无需绘图库）
xbrowser "set-viewport 1200 630 && content cover --title '标题' --output cover.png"
```

内置 case 库：

| slug | 主题 | 语言 |
|------|------|------|
| self-healing-replay | 自愈回放引擎 | en+zh |
| cli-for-ai-agents | CLI 为什么适合 Agent | en+zh |
| stealth-automation | CDP 反检测实战 | en+zh |
| mcp-server | MCP server 一天上线 | en+zh |

## 踩坑速查表（实战积累）

| # | 坑 | 原因 | 解法 |
|---|---|------|------|
| 1 | TinyMCE 填了但存不上 | native setter + input 事件不进 TinyMCE 内部状态 | `tinymce.setContent()` |
| 2 | 掘金 byte-select 标签选不上 | 下拉 li 直接 click 不生效 | 键盘 ArrowDown + Enter |
| 3 | 掘金顶栏"发布"开了视频弹窗 | 顶栏按钮是视频入口 | 文章发布走面板内"确定并发布" |
| 4 | devto 标题 404 | 编辑器改版 input→textarea | 用 `#article-form-title` |
| 5 | devto 发表后 URL 404 | slug 变了 | 从 `/api/articles/me` 拿最终 URL |
| 6 | TipTap 正文填不进 | native setter 不触发 ProseMirror | 聚焦后 `keyboard.insertText()` |
| 7 | 后台 tab trustedClick 无效 | Chrome 节流丢弃后台 tab 事件 | win-open 小窗（真渲染） |
| 8 | 合成 Enter 发不出消息 | isTrusted=false 被拦截 | trustedClick 真实鼠标事件 |
| 9 | 封面图网络不通 | localhost 手机访问不到 | 推送链接自动改写局域网 IP |
| 10 | MCP 工具 7→9 后旧调用失败 | 工具列表变了需重新发现 | 重启 MCP client |

## 登录态管理

### 登录流程

```bash
# 方式一：CDP 连接已有 Chrome（推荐——复用真实登录态）
xbrowser --cdp 9221 <platform> publish --title "T" --file a.md

# 方式二：插件 login 命令打开登录页
xbrowser juejin login    # 打开登录页，等人工完成
```

### 登录态检查

```bash
# 用 API 实调验证（最可靠）
curl -s "https://dev.to/api/articles/me?per_page=1" --cookie "cookie.txt"

# 用受限页面验证（登录用户才能看的页面不被重定向）
xbrowser "goto https://i.cnblogs.com/posts && text"
```

### 判定铁律

| 信号 | 可信度 | 说明 |
|------|--------|------|
| API 实调返回用户数据 | ⭐⭐⭐ | 最可靠 |
| 受限页面未被重定向 | ⭐⭐⭐ | 次可靠 |
| 退出按钮存在 | ⭐⭐ | 辅助 |
| 头像可见 | ⭐ | 辅助（可能是默认头像） |
| cookie 存在 | ⭐ | 可能过期 |

## 尚未支持的平台

| 平台 | 原因 | 复醒条件 |
|------|------|---------|
| sspai 少数派 | 插件待建（已登录） | 用户指令 |
| InfoQ | 插件待建（已登录） | 用户指令 |
| 腾讯云社区 | 插件待建（仅微信扫码登录） | 用户手动登录 |
| 阿里云社区 | 插件待建（跳支付宝登录） | 用户指令 |
| 简书 | 插件待建（已登录） | 用户指令 |
| V2EX | 未探针 | 用户指令 |
| Reddit | 需代理 | 有代理环境 |
| Twitter/X | 需代理 | 有代理环境 |
| Bluesky | 未探针 | 用户指令 |
