# CSDN 发帖推广流程（SOP）

> 最后更新：2026-05-29 | 来源：6 篇文章发布经验

## 摘要
在 CSDN 发布技术文章的完整流程。已验证 6 次。注意：CSDN 有每日发文上限。

## 前置条件
- CDP 9221 连接可用
- CSDN 已登录
- Markdown 文件已准备好

## 一键发布流程（子任务 prompt 模板）

```
读取文章文件：<FILE_PATH>
平台：CSDN
标题：<TITLE>
标签：<TAG1, TAG2>
Session：csdn-v<N>

按照 `.opencode/ui-automator/plugins/csdn-promotion.md` 中的 SOP 执行发布。
```

## 详细 SOP

### Step 1：打开编辑页 + 检查登录
```bash
agent-browser --cdp http://localhost:9221 --session csdn-v<N> open https://mp.csdn.net/mp_blog/creation/editor
sleep 5
agent-browser --cdp http://localhost:9221 --session csdn-v<N> snapshot -i -s body
```

**登录态判断**：
- ✅ 已登录：看到编辑器界面、"写文章" 入口
- ❌ 未登录：看到 "登录" 按钮 → 执行 viewer 让用户手动登录

### Step 2：切换到 Markdown 模式

CSDN 默认是富文本编辑器，需要切换：

```bash
agent-browser --cdp http://localhost:9221 --session csdn-v<N> evaluate "
  const mdBtn = document.querySelector('[class*=\"markdown\"]') || document.querySelector('a[title*=\"Markdown\"]');
  if (mdBtn) mdBtn.click();
"
```

### Step 3：注入标题 + 正文

```bash
# 标题
agent-browser --cdp http://localhost:9221 --session csdn-v<N> evaluate "
  const titleInput = document.querySelector('#article-title') || document.querySelector('.article-title');
  if (titleInput) {
    titleInput.value = 'ARTICLE_TITLE';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
"

# 正文 — 用 CKEditor API（CSDN 使用 CKEditor）
agent-browser --cdp http://localhost:9221 --session csdn-v<N> evaluate "
  const editor = window.CKEDITOR || document.querySelector('.editor');
  if (editor && editor.instances) {
    const inst = Object.values(editor.instances)[0];
    inst.setData('HTML_CONTENT');
  }
"
```

**注意**：CSDN 使用 CKEditor，Markdown 需要先转 HTML。或者用 CKEditor 的 `insertHtml` 方法。

### Step 4：添加标签 + 分类

```bash
# 标签
agent-browser --cdp http://localhost:9221 --session csdn-v<N> evaluate "
  const tagInput = document.querySelector('.tag-input') || document.querySelector('[class*=\"tag\"] input');
  if (tagInput) {
    tagInput.value = '人工智能';
    tagInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
"

# 类型：原创
agent-browser --cdp http://localhost:9221 --session csdn-v<N> evaluate "
  const originalRadio = document.querySelector('[value=\"original\"]') || document.querySelector('[class*=\"original\"]');
  if (originalRadio) originalRadio.click();
"
```

### Step 5：点击发布

```bash
agent-browser --cdp http://localhost:9221 --session csdn-v<N> evaluate "
  const btn = document.querySelector('.btn-publish') || document.querySelector('#btnPublish');
  if (btn) btn.click();
"
sleep 5
```

### Step 6：检查结果

```bash
# 获取 URL
agent-browser --cdp http://localhost:9221 --session csdn-v<N> get url

# 检查是否弹出发文上限提示
agent-browser --cdp http://localhost:9221 --session csdn-v<N> snapshot -i -s body
```

## 踩坑记录

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| **第1篇被删** | 自动化发文被 Cloudflare Bot 检测 + 内容判定为推广 | 标题不出现产品名，文章质量要高 |
| **发文上限** | CSDN 每日发文有额度限制 | 先保存为草稿，明天再发布 |
| **CKEditor** | CSDN 用 CKEditor，不是 textarea | 用 CKEditor API 注入内容 |
| **审核机制** | 所有文章都需审核 | 等待 1-2 小时 |
| **Cloudflare 检测** | CSDN 编辑器页面有 Cloudflare Bot Management | 减少 session 频率，避免快速操作 |
| **CKEditor 注入大内容** | eval 直接传 HTML 字符串会被 shell 转义破坏 | 用 base64 编码：`B64=$(base64 -i file.html)` → `atob(b64)` |
| **标签添加方式** | 搜索框输入会匹配推荐标签而非精确文本 | 点击分类 tab（如"开发工具"tab）再点击具体标签更可靠 |
| **发文上限提示** | 第 3 篇起提示"已达发文上限" | 先保存草稿，次日额度刷新后再发布 |

## 发布记录

| # | 标题 | URL | 状态 | 发布日期 |
|---|------|-----|------|---------|
| 1 | xbrowser：一个命令行搞定浏览器自动化 | https://blog.csdn.net/u012596714/article/details/161480081 | ❌ 被删（审核不通过） | 2026-05-27 |
| 2 | 同一个网站操作 10 次，我的 AI Agent 烧了 5 万 Token | https://blog.csdn.net/u012596714/article/details/161494990 | ✅ Active | 2026-05-28 |
| 3 | 我只想抓一个网页标题，为什么要写 50 行 Puppeteer 代码？(V3) | https://blog.csdn.net/u012596714/article/details/161495441 | ✅ 已发布（审核中） | 2026-05-29 |
| 4 | 凌晨三点，我的爬虫被 reCAPTCHA 干掉了 (V4) | https://blog.csdn.net/u012596714/article/details/161495756 | ✅ 已发布（审核中） | 2026-05-29 |
| 5 | 把每天 30 分钟的浏览器重复操作变成一条 Cron 命令 (V5) | https://mp.csdn.net/mp_blog/creation/editor/161495822 | ⏳ 草稿（发文额度不足） | 2026-05-29 |
| 6 | Playwright 太重，Selenium 太老，浏览器自动化还能怎么选？(V6) | https://mp.csdn.net/mp_blog/creation/editor/161495863 | ⏳ 草稿（发文额度不足） | 2026-05-29 |

## 变更记录
- 2026-05-29：发布 V3、V4；V5、V6 保存为草稿（第 3 篇后达到发文上限）。新增 CKEditor base64 注入技巧。
- 2026-05-29：初始创建（从 platform-promotion-guide.md 拆分 + 2 次发布经验沉淀）
