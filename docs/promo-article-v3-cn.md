# 我只想抓一个网页标题，为什么要写 50 行 Puppeteer 代码？

上周五下午四点半，产品经理走过来："帮我把 Hacker News 首页的标题抓一下，发个 Excel 给我。"

我心想：就这？五分钟搞定。

两个小时后，我还在调选择器。

## 事情是怎么失控的

### 第一步：初始化项目

```bash
mkdir hacker-news-scraper && cd hacker-news-scraper
npm init -y
npm install puppeteer
```

回车，等了三分钟。Puppeteer 要下载一个完整的 Chromium——200 多 MB。我盯着进度条，开始怀疑人生。

### 第二步：写代码

"不就是一个 `document.querySelectorAll` 吗？"我是这么想的。然后我打开编辑器，开始写：

```javascript
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  try {
    await page.goto('https://news.ycombinator.com', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    await page.waitForSelector('.titleline > a', {
      timeout: 10000
    });

    const titles = await page.evaluate(() => {
      const items = document.querySelectorAll('.titleline > a');
      return Array.from(items).map(el => ({
        title: el.textContent,
        url: el.href
      }));
    });

    console.log(JSON.stringify(titles, null, 2));
  } catch (err) {
    console.error('Scraping failed:', err.message);
  } finally {
    await browser.close();
  }
})();
```

数了一下，27 行。而且这还是最简化的版本，没加 User-Agent 伪装、没加重试、没加代理、没加并发控制。要是加全了，50 行打不住。

### 第三步：运行

```bash
node index.js
```

报错：`Navigation timeout of 30000 ms exceeded`。

换成 `domcontentloaded`，过了。但是 `waitForSelector` 又超时了——因为 `.titleline` 这个选择器是后来改的，之前叫 `.storylink`。Hacker News 的前端不知道什么时候悄悄改了类名。

### 第四步：调试

加 `headless: false`，打开浏览器看看。哦，选择器确实变了。改完再跑，终于出结果了。

### 第五步：收尾

把数据格式化成 CSV，发给产品经理。然后删掉这个项目目录——因为我知道，下次再要抓别的网站，这代码完全不能复用。

**总共花了两个小时。** 就为了 30 个标题。

## "简单"的浏览器抓取为什么这么复杂

冷静下来想想，问题出在哪？

### 框架太重

Puppeteer 和 Playwright 本质上是**浏览器测试框架**。它们的设计目标是让开发者写复杂的 E2E 测试套件——模拟用户登录、填写表单、验证页面状态。抓取网页标题？那只是它们能力的百分之一，但你得为那百分之九十九买单。

安装 Puppeteer 的过程就是在你的电脑上装一个完整的浏览器。这就像你想开个罐头，结果先得组装一个厨房。

### 每次从零开始

写了一次 Hacker News 的抓取脚本，下次抓 Reddit 能复用吗？不能。选择器不同，页面加载策略不同，反爬机制不同。每次都是全新的冒险。

没有"上次抓过这个网站"的记忆，没有通用的选择器策略，没有自动适应页面变化的能力。每一次，你都从零开始。

### async/await 的马拉松

看看 Puppeteer 的代码，满眼都是 `await`：

```javascript
await browser.launch()
await browser.newPage()
await page.goto()
await page.waitForSelector()
await page.evaluate()
await browser.close()
```

每一个操作都是异步的，每一个都要 await。我不是说异步不好——浏览器操作确实需要异步。但对于一个"打开页面、拿点数据"的任务来说，这个心智负担太重了。

### 错误处理爆炸

超时、元素不存在、网络错误、页面跳转、SSL 错误……每一个都可能出问题，每一个都要 try-catch。一个健壮的抓取脚本，错误处理的代码可能比业务逻辑还多。

```javascript
try {
  await page.goto(url, { timeout: 30000 });
} catch (e) {
  if (e.name === 'TimeoutError') {
    // 换个 waitUntil 策略重试？
  } else {
    // 真挂了？
  }
}

try {
  await page.waitForSelector(sel, { timeout: 10000 });
} catch (e) {
  // 选择器变了？页面没加载完？被反爬了？
}
```

你以为自己在抓数据，其实在写容错框架。

### 不可复用

换一个网站，选择器变了、加载策略变了、反爬方式变了。上次写的代码，除了那段 `puppeteer.launch()` 的模板代码能留着，其他全得重写。

这就好比每次做饭都得重新发明菜刀。

## 如果浏览器操作能像 curl 一样简单呢？

curl 多简单：

```bash
curl https://api.github.com/users/octocat | jq '.login'
```

一行命令，拿到数据。但 curl 有个致命问题：**它不执行 JavaScript**。

2026 年了，大量网页是客户端渲染的。你用 curl 拿到的可能只是一个空 HTML 壳子和一堆 `<script>` 标签。真正的数据，要浏览器执行 JS 之后才会出现。

所以我们需要的是一个**能执行 JavaScript 的 curl**。

不是测试框架，不是浏览器驱动库，就是一个命令行工具。输入命令，输出数据。完了。

## 一行命令能做什么？

还是抓 Hacker News 标题这个场景：

```bash
xbrowser scrape https://news.ycombinator.com
```

就这样。Markdown 格式的页面内容直接输出到终端。

要只要标题？加个选择器：

```bash
xbrowser goto https://news.ycombinator.com , text --selector ".titleline"
```

要 JSON 格式？

```bash
xbrowser goto https://news.ycombinator.com , text --selector ".titleline" --json
```

没有 `npm init`，没有 `async/await`，没有 try-catch。一行命令，结果直接出来。

### 搜索引擎结果

产品经理说："帮我看看我们公司在 Google 搜 'AI agent' 排第几。"

传统做法？打开 Puppeteer，模拟搜索，解析 SERP 页面，处理 Google 的各种动态加载…… 又是 50 行。

现在：

```bash
xbrowser search "AI agent" --engine google --limit 10 --full
```

不仅返回标题和链接，连摘要都给你提取好了。还支持 Bing、百度、DuckDuckGo 多引擎。

### 截图

"帮我把这个页面截个图。"

```bash
xbrowser goto https://news.ycombinator.com , screenshot --full-page
```

全页截图。不用管浏览器窗口大小、不用处理懒加载、不用自己设置 viewport。

### 填表提交

"帮我测试一下注册流程。"

```bash
xbrowser goto https://example.com/signup , fill "#email" "test@example.com" , fill "#password" "123456" , click "#submit" , screenshot
```

用逗号分隔的命令链，一行搞定。跟写 shell pipeline 一样自然。

### 监控页面变化

"这个价格什么时候降到 500 以下通知我。"

```bash
while true; do
  xbrowser text --selector ".price" | grep -q "^4[0-9][0-9]$" && notify-send "降价了！"
  sleep 3600
done
```

跟 cron、shell 脚本、CI/CD 天然集成。因为它是命令行工具，不是 API 库。

## 不只是"简单"

你可能会想：这不就是把 Puppeteer 包了一层吗？

不完全是。这背后是**对浏览器自动化的重新思考**。

### 瀑布流 vs 水龙头

Puppeteer/Playwright 就像一个瀑布——功能强大，但你要站在瀑布下面接水，免不了被淋一身。你得处理异步、管理生命周期、写样板代码。

而 CLI 工具应该像一个水龙头——拧开就有水，关上就停。简单、直接、按需使用。

### 框架 vs 工具

框架要求你按它的方式思考。你得理解它的概念模型：Browser → Page → Frame → Element，每一步都是异步的，每一步都可能出错。

工具应该按你的方式思考。你要什么？"打开这个页面"—— `goto`。"拿这个文本"—— `text`。"截个图"—— `screenshot`。就这么简单。

### 编程接口 vs 命令接口

编程接口（API）的灵活性无可替代——复杂的自动化场景确实需要精细控制。但对于 80% 的"打开页面、拿点数据"的场景，命令接口（CLI）的效率高出十倍。

这就像 Git：你可以用 libgit2 写程序来操作仓库，但大多数时候你直接跑 `git commit -m "xxx"` 就够了。

## 什么时候该用什么？

不是说 Puppeteer/Playwright 不好。它们在自己的领域非常强大。问题是用错了场景。

| 场景 | 推荐工具 |
|------|----------|
| 抓一个页面的数据 | CLI |
| 搜索引擎提取结果 | CLI |
| 快速截图 | CLI |
| 跟 shell 脚本集成 | CLI |
| 复杂 E2E 测试套件 | Playwright |
| 需要精细控制浏览器行为 | Puppeteer |
| 性能压测 | Lighthouse / k6 |
| 大规模爬虫系统 | Scrapy / 自研 |

工具应该适配场景，而不是让场景适配工具。用大锤砸钉子，不是锤子不好，是你用错了。

## 回到那个周五下午

如果当时有这个工具，我的周五下午会是这样：

```bash
xbrowser scrape https://news.ycombinator.com > hn.md
```

三秒钟。然后我把 Markdown 文件丢给产品经理，继续写我的代码。

不是因为技术有多先进，而是因为**做的事情恰好匹配了问题的规模**。

抓一个页面的标题，本来就不应该是一个项目。

---

*我做了 [xbrowser](https://github.com/dyyz1993/xbrowser) 来解决这个问题——一个把浏览器操作变成命令行的工具。如果你也厌倦了为一次性抓取任务写完整项目，可以试试。*
