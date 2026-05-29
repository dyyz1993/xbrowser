# 掘金发帖推广流程（SOP）

> 最后更新：2026-05-29 | 来源：2 篇文章发布经验

## 摘要
在掘金发布技术文章的完整流程。已验证 2 次。

## 前置条件
- CDP 9221 连接可用
- 掘金已登录（检测标志："创作者中心" 按钮）
- Markdown 文件已准备好

## 一键发布流程（子任务 prompt 模板）

```
读取文章文件：<FILE_PATH>
平台：掘金
标题：<TITLE>
标签：<TAG1, TAG2>（最多 3 个，需从掘金可选标签列表中选择）
Session：juejin-v<N>

按照 `.opencode/ui-automator/plugins/juejin-promotion.md` 中的 SOP 执行发布。
```

## 详细 SOP

### Step 1：打开编辑页 + 检查登录
```bash
agent-browser --cdp http://localhost:9221 --session juejin-v<N> open https://juejin.cn/editor/draft/new
sleep 3
agent-browser --cdp http://localhost:9221 --session juejin-v<N> snapshot -i -s body
```

**登录态判断**：
- ✅ 已登录：看到 "创作者中心" 按钮、Markdown 编辑器
- ❌ 未登录：看到 "登录 注册" 按钮 → 执行 viewer 让用户手动登录

### Step 2：填入标题
```bash
# 用 evaluate 注入标题
agent-browser --cdp http://localhost:9221 --session juejin-v<N> evaluate "
  const titleInput = document.querySelector('.title-input') || document.querySelector('input[placeholder*=\"标题\"]');
  if (titleInput) {
    titleInput.value = 'ARTICLE_TITLE';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
"
```

### Step 3：填入 Markdown 正文

**掘金编辑器可能默认是富文本模式**，需要切换到 Markdown：

```bash
# 检查是否有"Markdown"切换按钮
agent-browser --cdp http://localhost:9221 --session juejin-v<N> evaluate "
  const mdSwitch = document.querySelector('.switch-btn') || document.querySelector('[class*=\"markdown\"]');
  if (mdSwitch) mdSwitch.click();
"
```

然后注入正文：

```bash
agent-browser --cdp http://localhost:9221 --session juejin-v<N> evaluate "
  const editor = document.querySelector('.CodeMirror') || document.querySelector('textarea');
  if (editor) {
    editor.value = `MARKDOWN_CONTENT`;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }
"
```

**注意**：如果掘金编辑器是 CodeMirror，需要用 CodeMirror API：

```bash
agent-browser --cdp http://localhost:9221 --session juejin-v<N> evaluate "
  const cm = document.querySelector('.CodeMirror').CodeMirror;
  if (cm) cm.setValue('MARKDOWN_CONTENT');
"
```

### Step 4：添加标签

掘金的标签需要从可选列表中选择，不能自由输入：

```bash
# 点击标签选择区域
agent-browser --cdp http://localhost:9221 --session juejin-v<N> evaluate "
  const tagInput = document.querySelector('.tag-input') || document.querySelector('[class*=\"tag\"] input');
  if (tagInput) tagInput.click();
"
# 然后从下拉列表中选择
```

**掘金可选标签**（常用）：
- 前端、后端、Android、iOS、人工智能、开发工具、Node.js、JavaScript、TypeScript

### Step 5：点击发布
```bash
agent-browser --cdp http://localhost:9221 --session juejin-v<N> evaluate "
  const btn = document.querySelector('.publish-btn') || document.querySelector('button[class*=\"submit\"]');
  if (btn) btn.click();
"
sleep 5
```

### Step 6：获取发布 URL
```bash
agent-browser --cdp http://localhost:9221 --session juejin-v<N> get url
```

## 踩坑记录

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| 标签选不上 | 标签是下拉列表选择，不是自由输入 | 用 `.byte-select-option` 选择器点击 |
| 验证码弹窗 | 新 session 登录时可能触发滑块验证 | viewer 让用户手动处理 |
| 审核延迟 | 掘金有内容审核，status=1 表示审核中 | 等待 1-2 小时后检查 |
| 登录态丢失 | Session 过期或 cdp-tunnel 重启 | 重新登录 |
| **编辑器 URL 变更** | 旧 URL `/editor/draft/new` 重定向到首页 | 新 URL: `/editor/drafts/new?v=2`（注意 `drafts` 复数） |
| **弹窗拦截** | 首页有"选择兴趣方向"和 risk 弹窗 | 先关闭弹窗再导航 |
| **写文章入口** | 直接访问编辑器 URL 可能失败 | 先进"创作者中心"(`/creator/home`)再点"写文章" |
| **大内容注入** | 9KB+ 文章单次传不进去 | 分 3-4 个 chunk（每 chunk 3000 bytes base64），用 `TextDecoder` 做 UTF-8 解码 |
| **发布流程** | 不是直接点一次"发布"就完 | 填标题+正文 → 侧栏选分类+标签 → 点"发布"→ 弹窗确认 → 点"确定并发布" |

## 发布记录

| # | 标题 | URL | 状态 | 发布日期 |
|---|------|-----|------|---------|
| 1 | xbrowser：一个命令行搞定浏览器自动化 | https://juejin.cn/post/7644466893395525666 | ✅ Active（248阅读） | 2026-05-27 |
| 2 | 同一个网站操作 10 次，我的 AI Agent 烧了 5 万 Token | https://juejin.cn/post/7644773671907885097 | ✅ Active | 2026-05-28 |
| 3 | 我只想抓一个网页标题，为什么要写 50 行 Puppeteer 代码？ | https://juejin.cn/spost/7644779138884108322 | ✅ Active | 2026-05-29 |
| 4 | 凌晨三点，我的爬虫被 reCAPTCHA 干掉了 | https://juejin.cn/spost/7644779138884124706 | ✅ Active | 2026-05-29 |
| 5 | 把每天 30 分钟的浏览器重复操作变成一条 Cron 命令 | https://juejin.cn/spost/7644805910990127119 | ✅ Active | 2026-05-29 |
| 6 | Playwright 太重，Selenium 太老，浏览器自动化还能怎么选？ | https://juejin.cn/spost/7644805910990143503 | ✅ Active | 2026-05-29 |

## 变更记录
- 2026-05-29：初始创建（从 platform-promotion-guide.md 拆分 + 2 次发布经验沉淀）
| 3 | 我只想抓一个网页标题，为什么要写 50 行 Puppeteer 代码？ | https://juejin.cn/spost/7644779138884108322 | ✅ 已发布 | 2026-05-29 |
| 4 | 凌晨三点，我的爬虫被 reCAPTCHA 干掉了 | https://juejin.cn/spost/7644779138884124706 | ✅ 已发布 | 2026-05-29 |
| 5 | 把每天 30 分钟的浏览器重复操作变成一条 Cron 命令 | https://juejin.cn/spost/7644805910990127119 | ✅ 已发布 | 2026-05-29 |
| 6 | Playwright 太重，Selenium 太老，浏览器自动化还能怎么选？ | https://juejin.cn/spost/7644805910990143503 | ✅ 已发布 | 2026-05-29 |

## 变更记录
- 2026-05-29：批量发布 4 篇中文文章（V3-V6），更新编辑器 URL 为 /editor/drafts/new?v=2
- 2026-05-29：初始创建（从 platform-promotion-guide.md 拆分 + 2 次发布经验沉淀）
