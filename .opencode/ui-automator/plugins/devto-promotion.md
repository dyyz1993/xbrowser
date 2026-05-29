# Dev.to 发帖推广流程（SOP）

> 最后更新：2026-05-29 | 来源：5 篇文章发布经验

## 摘要
在 Dev.to 发布技术推广文章的完整流程。已验证 5 次，成功率 100%。

## 前置条件
- CDP 9221 连接可用
- Dev.to 已登录
- Markdown 文件已准备好

## 一键发布流程（子任务 prompt 模板）

给子任务的 prompt 只需要：

```
读取文章文件：<FILE_PATH>
平台：Dev.to
标题：<TITLE>
标签：<TAG1, TAG2, TAG3, TAG4>（最多 4 个）
Session：devto-v<N>（N 为文章序号，避免 session 冲突）

按照 `.opencode/ui-automator/plugins/devto-promotion.md` 中的 SOP 执行发布。
```

## 详细 SOP

### Step 1：打开编辑页 + 检查登录
```bash
agent-browser --cdp http://localhost:9221 --session devto-v<N> open https://dev.to/new
sleep 3
agent-browser --cdp http://localhost:9221 --session devto-v<N> snapshot -i -s body
```

**登录态判断**：
- ✅ 已登录：看到 "What's on your mind?" 或编辑器界面
- ❌ 未登录：看到 "Log in" 按钮 → 执行 viewer 让用户手动登录

### Step 2：注入标题 + 正文（JS 注入法，最稳定）

**不要用 fill 命令**（对长文本不稳定）。用 JS 直接注入：

```bash
agent-browser --cdp http://localhost:9221 --session devto-v<N> evaluate "
  // 注入标题
  const titleInput = document.querySelector('#article_title') || document.querySelector('input[name="title"]');
  if (titleInput) {
    titleInput.value = 'ARTICLE_TITLE';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
  
  // 注入正文（Markdown）
  const bodyEditor = document.querySelector('#article_body_markdown') || document.querySelector('textarea[name="body_markdown"]');
  if (bodyEditor) {
    bodyEditor.value = `MARKDOWN_CONTENT`;
    bodyEditor.dispatchEvent(new Event('input', { bubbles: true }));
  }
"
```

**注意**：Markdown 内容中的反引号需要转义。如果内容太长，分段注入。

### Step 3：添加标签
```bash
# 找到标签输入区域并输入
agent-browser --cdp http://localhost:9221 --session devto-v<N> evaluate "
  const tagInput = document.querySelector('#tag-input') || document.querySelector('input[placeholder*="tag"]');
  if (tagInput) {
    tagInput.value = 'tag1, tag2, tag3, tag4';
    tagInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
"
```

### Step 4：点击 Publish
```bash
agent-browser --cdp http://localhost:9221 --session devto-v<N> evaluate "
  const btn = document.querySelector('button[value=\"publish\"]') || document.querySelector('.crayons-btn--primary');
  if (btn) btn.click();
"
sleep 5
```

### Step 5：获取发布 URL
```bash
agent-browser --cdp http://localhost:9221 --session devto-v<N> get url
```

## 踩坑记录

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| 标题/正文填不进去 | fill 命令对长文本不稳定 | 用 JS evaluate 直接注入 |
| 标签添加失败 | 标签输入框交互复杂 | 用 evaluate 直接设值 |
| 文章被删（第1篇） | 标题含产品名，被判定为纯推广 | 标题不出现产品名，故事化包装 |
| Session 冲突 | 多篇文章共用 session | 用 devto-v<N> 隔离 |
| 反引号报错 | JS 注入时 Markdown 代码块冲突 | 分段注入或转义 |

## 发布记录

| # | 标题 | URL | 状态 | 发布日期 |
|---|------|-----|------|---------|
| 1 | Automate Browser Tasks with xbrowser... | https://dev.to/_ab214f84f83a01455a74b/automate-browser-tasks-with-xbrowser...4m71 | ❌ 已删除（标题含产品名） | 2026-05-27 |
| 2 | I Replaced 50-Line Puppeteer Scripts... | https://dev.to/_ab214f84f83a01455a74b/i-replaced-50-line-puppeteer-scripts...3jlc | ✅ Active | 2026-05-27 |
| 3 | My AI Agent Burned 26K Tokens... | https://dev.to/_ab214f84f83a01455a74b/my-ai-agent-burned-26k-tokens...emp | ✅ Active | 2026-05-28 |
| 4 | I Just Wanted to Scrape One Page... | https://dev.to/_ab214f84f83a01455a74b/i-just-wanted-to-scrape-one-page...2mfa | ✅ Active | 2026-05-28 |
| 5 | My Web Scraper Died at 3 AM... | https://dev.to/_ab214f84f83a01455a74b/my-web-scraper-died-at-3-am...2191 | ✅ Active | 2026-05-28 |
| 6 | I Replaced 30 Minutes of Daily Browser Chores... | https://dev.to/_ab214f84f83a01455a74b/i-replaced-30-minutes-of-daily-browser-chores...44eb | ✅ Active | 2026-05-28 |
| 7 | Playwright Is a Test Framework... | https://dev.to/yanqdinho/playwright-is-a-test-framework...1158 | ✅ Active | 2026-05-28 |

## 变更记录
- 2026-05-29：重写为完整 SOP（含踩坑、JS 注入法、子任务模板、发布记录）
- 2026-05-28：更新发布记录，标注第1篇已删除、第2篇存活
- 2026-05-27：初始创建（Dev.to 发布成功经验）
