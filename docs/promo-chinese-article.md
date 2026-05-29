# xbrowser：一个命令行搞定浏览器自动化（Playwright/Puppeteer 的 CLI 替代方案）

![Hero](https://raw.githubusercontent.com/dyyz1993/xbrowser/master/docs/promo-images/hero-banner.png)

## 从一次失败的爬虫说起

上周我需要抓取 Hacker News 首页的标题和链接。作为一个「熟练」的开发者，我打开编辑器，熟练地敲出了以下代码：

```javascript
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://news.ycombinator.com');

  const titles = await page.evaluate(() => {
    const items = document.querySelectorAll('.titleline > a');
    return Array.from(items).map(el => ({
      title: el.textContent,
      url: el.href
    }));
  });

  console.log(titles);
  await browser.close();
})();
```

50 行代码，只为了抓一个页面的标题。而且这只是 happy path —— 还没加上错误处理、反爬策略、超时重试。更别提部署到服务器上还得装 Chromium、处理字体缺失、解决 headless 模式下的各种诡异问题。

我当时就想：**这种事情，能不能一行命令搞定？**

这就是 xbrowser 的由来。

## 为什么不直接用 Playwright / Puppeteer？

先说结论：**Playwright 和 Puppeteer 是优秀的测试框架，但不是高效的自动化工具。**

| 维度 | Playwright / Puppeteer | xbrowser |
|------|------------------------|----------|
| 定位 | 测试框架（test framework） | 自动化命令行工具（CLI automation） |
| 使用方式 | 写 Node.js 脚本 | 直接在终端输入命令 |
| 学习成本 | 需要了解 API、async/await | 会打字就能用 |
| 代码量 | 30-50 行起步 | 一行命令 |
| 输出格式 | 需要自行处理 | JSON / YAML / Markdown |
| 反爬处理 | 手动配置 stealth 插件 | 内建 CDP 指纹保护 |

如果你是一个 QA 工程师，Playwright 是你的最佳选择。但如果你是一个需要**快速抓取网页数据**的开发者，一个需要**批量采集信息**的运营人员，或者一个需要给 AI Agent 提供**浏览器操作能力**的开发者 —— 你需要的不是测试框架，而是一个**命令行爬虫工具**。

xbrowser 就是为此而生。

## 核心功能一览

### 1. 多引擎搜索：Google / Bing / 百度一键搞定

![Search](https://raw.githubusercontent.com/dyyz1993/xbrowser/master/docs/promo-images/multi-engine-search.png)

不需要申请 API Key，不需要付钱，直接在命令行里搜索：

```bash
# Google 搜索
xbrowser "goto https://www.google.com/search?q=playwright+vs+selenium , text --selector '#search'"

# 百度搜索
xbrowser "goto https://www.baidu.com/s?wd=浏览器自动化工具 , html --selector '#content_left'"

# 也可以使用内置百度插件
xbrowser session open https://www.baidu.com
xbrowser baidu search --query "web scraping 工具推荐"
xbrowser baidu hotsearch --category tech
```

搜索结果直接输出到终端，可以配合 `jq`、`grep` 等工具做二次处理。这才是**命令行爬虫**该有的样子。

### 2. 网页抓取：scrape 直接转 Markdown

![Scrape](https://raw.githubusercontent.com/dyyz1993/xbrowser/master/docs/promo-images/web-scraping.png)

抓取网页内容是浏览器自动化最常见的需求之一。用 Puppeteer 你得写一长串 `page.evaluate()`，用 xbrowser 一行搞定：

```bash
# 抓取页面全部文本
xbrowser "goto https://example.com/blog/seo-tips , text"

# 抓取指定区域
xbrowser "goto https://news.ycombinator.com , text --selector '.titleline'"

# 获取 HTML 片段
xbrowser "goto https://example.com , html --selector '#main-content'"

# 全页截图
xbrowser "goto https://example.com , screenshot --full-page"
```

输出直接是干净的文本或 Markdown，省去了你用正则清洗 HTML 的麻烦。这种**网页抓取**体验，是 Playwright 和 Puppeteer 默认给不了的。

### 3. 命令链：一行搞定复杂流程

![Chain](https://raw.githubusercontent.com/dyyz1993/xbrowser/master/docs/promo-images/command-chaining.png)

这是 xbrowser 最强大的特性 —— **命令链（Chain）语法**。用 `&&`、`,`、`+`、`->` 串联多个命令，像搭积木一样组合浏览器操作：

```bash
# 逗号分隔：顺序执行
xbrowser "goto https://example.com , title , text"

# && 分隔：前一步成功才继续
xbrowser "goto https://example.com && wait '#content' && text --selector '#article'"

# -> 分隔：管道式
xbrowser "goto https://example.com/login -> fill '#username' 'admin' -> fill '#password' '123456' -> click '#submit' -> wait '.dashboard' -> screenshot"

# || 分隔：前一步成功则跳过（容错）
xbrowser "goto https://primary.com || goto https://backup.com"
```

你还可以用 Heredoc 写多行脚本：

```bash
xbrowser <<EOF
goto https://example.com/articles
text --selector ".article-list"
scroll down
wait ".article-list .item:nth-child(20)"
text --selector ".article-list"
EOF
```

不需要写 `.js` 文件，不需要 `async/await`，不需要 try/catch。**命令行**本身就是你的脚本语言。

### 4. 录制回放：鼠标操作秒变自动化脚本

![Record](https://raw.githubusercontent.com/dyyz1993/xbrowser/master/docs/promo-images/record-replay.png)

还有一种更爽的方式 —— **直接录你的操作**：

```bash
# 开始录制
xbrowser record start --url https://example.com

# 在浏览器里正常操作（点击、输入、滚动...）
# xbrowser 会自动记录你的每一个操作

# 停止录制，保存为 YAML
xbrowser record stop --output my-workflow.yaml

# 随时回放
xbrowser replay my-workflow.yaml

# 慢速回放（调试用）
xbrowser replay my-workflow.yaml --slow-mo 100
```

录制文件还能**转换成代码**：

```bash
# 生成 Node.js 脚本
xbrowser convert my-workflow.yaml replay.js

# 生成 Python 脚本
xbrowser convert my-workflow.yaml replay.py

# 生成 Bash 脚本
xbrowser convert my-workflow.yaml replay.sh
```

这意味着你可以先用浏览器手动操作一遍，再让 xbrowser 自动帮你把操作转成可复用的脚本。从手动到自动化，只需要两条命令。

### 5. 68 个插件：覆盖主流平台

![Plugins](https://raw.githubusercontent.com/dyyz1993/xbrowser/master/docs/promo-images/plugin-ecosystem.png)

xbrowser 内置了 **68 个站点插件**，覆盖了从搜索引擎到社交媒体、从电商平台到 AI 工具的主流网站：

| 类别 | 插件举例 |
|------|---------|
| 搜索引擎 | baidu、google、bing |
| 社交媒体 | twitter、weibo、zhihu、xiaohongshu、reddit |
| 电商平台 | taobao、jd、1688 |
| AI 平台 | chatgpt、claude、deepseek、qianwen、doubao |
| 音乐/视频 | douyin、suno、udio、mureka |
| 图片素材 | unsplash、pexels、pixabay、freepik、pinterest |
| 开发者平台 | github、csdn、juejin、stackoverflow |
| 内容平台 | medium、hashnode、wordpress、devto |
| SEO 工具 | seo、backlink-auto、geo-analysis |

使用插件也非常简单：

```bash
# 百度热搜
xbrowser session open https://www.baidu.com
xbrowser baidu hotsearch --category tech

# 抖音视频信息
xbrowser session open https://www.douyin.com
xbrowser douyin video-info --url https://www.douyin.com/video/xxx

# GitHub 个人资料
xbrowser session open https://github.com
xbrowser github get-profile
```

如果现有插件不满足需求，你可以用 `xbrowser create my-plugin --template static` 从模板创建自己的插件，基于 TypeScript 编写，享受完整的类型提示。

## 横向对比：xbrowser vs Playwright vs Selenium

| 特性 | xbrowser | Playwright | Selenium |
|------|----------|------------|----------|
| **使用方式** | 命令行 CLI | Node.js/Python/Java API | 多语言 API |
| **安装复杂度** | `npm i -g` 一条命令 | 需要安装浏览器驱动 | 需要配置 WebDriver |
| **代码量** | 1 行命令 | 30-50 行 | 40-60 行 |
| **headless browser** | 默认支持 | 默认支持 | 需要配置 |
| **反爬处理** | 内建 CDP 指纹保护 | 需要额外插件 | 需要额外配置 |
| **命令链语法** | 支持（`&&`、`,`、`->`等） | 不支持 | 不支持 |
| **录制回放** | YAML 录制 + 多语言导出 | Codegen（仅生成代码） | IDE 插件 |
| **插件生态** | 68 个站点插件 | 社区测试插件 | WebDriver 插件 |
| **AI Agent 集成** | 天然适配（命令行接口） | 需要封装 | 需要封装 |
| **管道支持** | stdin 管道 + Heredoc | 不支持 | 不支持 |
| **Daemon 模式** | 后台常驻，快速响应 | 不支持 | 不支持 |
| **许可证** | MIT | Apache-2.0 | Apache-2.0 |

**总结**：如果你要写 E2E 测试，选 Playwright；如果你要做**浏览器自动化**和**网页抓取**，选 xbrowser。

## 真实使用场景

### 场景一：SEO 审计

检查网站所有页面是否有 meta description：

```bash
# 爬取站点地图
xbrowser "goto https://myclient.com/sitemap.xml , text" | \
  grep -oP 'https://[^<]+' | while read url; do
    has_meta=$(xbrowser "goto $url , html --selector 'meta[name=description]'" | wc -l)
    if [ "$has_meta" -eq 0 ]; then
      echo "缺少 meta description: $url"
    fi
  done
```

### 场景二：竞品监控

每天定时采集竞品价格：

```bash
xbrowser <<EOF
goto https://competitor.com/products
text --selector ".product-price"
scroll down --distance 1000
wait ".product-item:nth-child(20)"
text --selector ".product-price"
EOF
```

配合 crontab 就是一个零代码的价格监控系统。

### 场景三：内容采集 + AI 摘要

批量采集文章后用 AI 生成摘要：

```bash
# 采集文章列表
xbrowser "goto https://blog.example.com , html --selector '.post-list'" > posts.html

# 逐篇抓取正文
for url in $(extract_urls posts.html); do
  xbrowser "goto $url , text --selector 'article'" >> content.md
  echo "---" >> content.md
done

# 用 AI 生成摘要（配合其他工具）
```

### 场景四：AI Agent 浏览器操控

xbrowser 的命令行接口天然适配 AI Agent：

```bash
# Agent 发出搜索指令
xbrowser search "最新的浏览器自动化工具" --engine google

# Agent 抓取页面内容
xbrowser "goto https://target-site.com , text --selector '#main'"

# Agent 执行复杂操作链
xbrowser "goto https://app.com/login -> fill '#email' 'agent@ai.com' -> click '#submit' -> wait '.dashboard' -> screenshot"
```

## 安装与快速开始

```bash
# 安装（全局）
npm i -g @xbrowser/cli

# 第一次使用 —— 打开浏览器并获取标题
xbrowser "goto https://news.ycombinator.com , title"

# 抓取页面文本
xbrowser "goto https://example.com , text"

# 截图
xbrowser "goto https://example.com , screenshot"
```

**系统要求**：
- Node.js >= 18
- Chromium 浏览器（默认路径 `/Applications/Chromium.app/Contents/MacOS/Chromium`，可通过环境变量 `XBROWSER_CHROMIUM_PATH` 自定义）

## 更多高级功能

- **Daemon 模式**：`xbrowser daemon start` 后台常驻，响应更快
- **CDP 连接**：`xbrowser --cdp 9222` 连接已运行的 Chrome 实例
- **多会话并行**：`xbrowser session open --name work` 同时管理多个浏览器会话
- **JS 执行**：`xbrowser eval "document.title"` 在页面中执行 JavaScript
- **Cookie/Storage 管理**：`getCookies`、`setCookie`、`getLocalStorage` 等全套存储操作
- **视口控制**：`setViewport 375 812 --isMobile true` 模拟移动设备
- **配置管理**：`xbrowser config set browser.executablePath /usr/bin/chromium` 持久化配置

## 为什么选择 xbrowser？

1. **零代码上手**：不需要写脚本，命令行输入即可完成浏览器自动化
2. **Playwright 引擎**：底层使用 Playwright 驱动 headless browser，稳定可靠
3. **内建反爬**：CDP 指纹保护，不惧常见的自动化检测
4. **68 个插件**：开箱即用，覆盖主流网站
5. **录制回放**：手动操作一遍，自动回放千遍
6. **AI Agent 友好**：命令行接口天然适配 LLM 调用
7. **完全开源**：MIT 许可证，代码在 [GitHub](https://github.com/dyyz1993/xbrowser)

---

**项目链接**：
- GitHub：[github.com/dyyz1993/xbrowser](https://github.com/dyyz1993/xbrowser)
- npm：[@xbrowser/cli](https://www.npmjs.com/package/@xbrowser/cli)

如果觉得有用，欢迎给个 Star ⭐

---

> 浏览器自动化` `爬虫` `web scraping` `Playwright` `Puppeteer` `命令行工具` `开源` `CLI` `headless browser`
