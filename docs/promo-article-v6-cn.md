# Playwright 太重，Selenium 太老，浏览器自动化还能怎么选？

上周有个朋友问我："我想在命令行里搜个 Google，然后拿到搜索结果，该怎么搞？"

我说："你用 Playwright 写个脚本就行。"

他过了一天回来跟我说："我看了一下午 Playwright 文档，还没写出来。代码写到 30 行了，到现在连个搜索结果都没拿到。"

我看了一眼他的代码：

```javascript
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://www.google.com');
  await page.fill('input[name="q"]', 'node.js best practices');
  await page.press('input[name="q"]', 'Enter');
  await page.waitForSelector('#search');

  const results = await page.$$eval('.g', (els) =>
    els.map((el) => ({
      title: el.querySelector('h3')?.textContent,
      url: el.querySelector('a')?.href,
    }))
  );

  console.log(results);
  await browser.close();
})();
```

23 行。搜个 Google 而已。

而且这段代码还不稳定——Google 的搜索结果页面结构三天两头变，选择器随时可能失效。一旦失效，你得打开浏览器调试，找到新的选择器，改代码，重新跑。

"有没有更简单的方法？"

有。但在此之前，我们得先搞清楚一个根本问题。

## 测试框架 ≠ 自动化工具

这是很多人混淆的概念。Playwright、Selenium、Cypress——它们都是**测试框架**，不是**自动化工具**。

测试框架的核心设计目标是：

- **断言驱动**：验证页面行为是否符合预期
- **报告生成**：生成 HTML/JSON 格式的测试报告
- **并行执行**：多浏览器、多设备同时跑测试
- **CI 集成**：在 GitHub Actions、Jenkins 等流水线中运行
- **调试工具**：Trace Viewer、截图对比、录屏回放

这些功能在做测试的时候很重要。但如果你只是想"搜个 Google 拿结果"呢？

你不需要断言。你不需要测试报告。你不需要并行执行。你只需要：打开页面 → 提取数据 → 拿走。

自动化工具的核心设计目标完全不同：

- **命令行驱动**：一条命令完成一个操作
- **一次性执行**：不需要持久化的测试套件
- **管道组合**：输出可以被其他命令处理
- **快速反馈**：秒级完成，不需要等 CI 跑完
- **脚本友好**：可以直接嵌入 bash 脚本或 cron 任务

换句话说，**测试框架关心的是"对不对"，自动化工具关心的是"快不快"**。

## 三种方案对比

让我们用同一个任务来对比：Google 搜索 "node.js tutorial"，提取前 10 条结果。

### 方案 1：Playwright

```javascript
// search.js
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('https://www.google.com/search?q=node.js+tutorial');
  await page.waitForSelector('#search');

  const results = await page.$$eval('.g', (elements) =>
    elements.slice(0, 10).map((el) => ({
      title: el.querySelector('h3')?.textContent || '',
      url: el.querySelector('a')?.href || '',
      snippet: el.querySelector('.VwiC3b')?.textContent || '',
    }))
  );

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})();
```

运行：

```bash
npm install playwright    # 安装依赖，下载浏览器，约 300MB
node search.js            # 运行
```

**代价**：安装 300MB 浏览器 + 23 行代码 + 选择器维护。

### 方案 2：Selenium

```python
# search.py
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import json

driver = webdriver.Chrome()
driver.get("https://www.google.com/search?q=node.js+tutorial")

WebDriverWait(driver, 10).until(
    EC.presence_of_element_located((By.ID, "search"))
)

results = []
elements = driver.find_elements(By.CSS_SELECTOR, ".g")[:10]

for el in elements:
    title = el.find_element(By.CSS_SELECTOR, "h3").text if el.find_elements(By.CSS_SELECTOR, "h3") else ""
    url = el.find_element(By.CSS_SELECTOR, "a").get_attribute("href") if el.find_elements(By.CSS_SELECTOR, "a") else ""
    snippet = el.find_element(By.CSS_SELECTOR, ".VwiC3b").text if el.find_elements(By.CSS_SELECTOR, ".VwiC3b") else ""
    results.append({"title": title, "url": url, "snippet": snippet})

print(json.dumps(results, indent=2))
driver.quit()
```

运行：

```bash
pip install selenium          # 安装依赖
# 还需要单独下载 ChromeDriver
node search.py                # 运行
```

**代价**：安装依赖 + 下载 ChromeDriver + 27 行代码 + 选择器维护。

### 方案 3：CLI 工具

```bash
xbrowser google search "node.js tutorial" --json --limit 10
```

运行：

```bash
npx xbrowser google search "node.js tutorial" --json --limit 10
```

**代价**：1 行命令。

输出：

```json
[
  {
    "title": "Node.js Tutorial - W3Schools",
    "url": "https://www.w3schools.com/nodejs/",
    "snippet": "Learn Node.js with our comprehensive tutorial..."
  },
  {
    "title": "The Node.js Handbook - FreeCodeCamp",
    "url": "https://www.freecodecamp.org/news/the-nodejs-handbook/",
    "snippet": "This handbook is a getting-started guide to Node.js..."
  }
]
```

不用装浏览器。不用写代码。不用维护选择器。

## 对比表格

| 维度 | Playwright | Selenium | CLI 工具 |
|------|-----------|----------|---------|
| **定位** | 测试框架 | 测试框架 | 自动化工具 |
| **安装大小** | ~300MB | ~150MB + Driver | ~50MB |
| **单次操作代码量** | 20-50 行 | 20-50 行 | 1 行 |
| **学习成本** | 高（需理解 Page Object、Locator、Context 等概念） | 高（需理解 WebDriver 协议、等待策略） | 低（命令行参数即可） |
| **选择器维护** | 需要手动维护 | 需要手动维护 | 内置处理 |
| **输出格式** | 需要自己格式化 | 需要自己格式化 | 原生 JSON |
| **管道支持** | 需要额外处理 | 需要额外处理 | 原生支持 |
| **适合场景** | 回归测试、E2E 测试 | 兼容性测试、跨浏览器测试 | 日常自动化、数据采集 |
| **适合人群** | QA 工程师 | QA 工程师 | 开发者、运维、内容创作者 |
| **CI 集成** | 原生支持 | 原生支持 | 通过 shell 脚本支持 |
| **断言能力** | 强大 | 强大 | 无（可配合 jq/awk） |

## 它们不是替代关系，而是互补

说这些不是为了踩 Playwright 或 Selenium。它们在各自领域都是顶级工具。

如果你在做**回归测试**——每次发版前要验证 50 个页面的核心功能是否正常——那 Playwright 就是正确选择。你需要断言、你需要测试报告、你需要 Trace Viewer 来调试失败用例。

如果你在做**兼容性测试**——确保产品在 Chrome、Firefox、Safari 上都能跑——那 Selenium 的跨浏览器能力无人能及。

但如果你在做这些事情：

- 每天定时查 Google 排名
- 批量抓取网页数据
- 定时提交 sitemap
- 监控竞品价格变化
- 批量发布内容到多个平台
- 命令行里快速搜索并拿到结构化结果

那你需要的不是一个测试框架。你需要的是一个**自动化工具**。

用测试框架做自动化，就像用大炮打蚊子——能打中，但成本太高。

## 什么时候该用什么

简单一个判断标准：

**你要验证什么"对不对"** → 测试框架
**你要快速"做完一件事"** → 自动化工具

具体来说：

**用 Playwright / Selenium 的场景**：
- E2E 测试：确保注册流程、支付流程不挂
- 回归测试：每次发版前跑一遍
- 视觉回归：截图对比，检测 UI 变化
- 性能测试：测量页面加载时间、交互延迟
- CI/CD 集成：在流水线中自动运行

**用 CLI 自动化工具的场景**：
- 数据采集：从网页提取结构化数据
- SEO 操作：查排名、提交链接、检查索引
- 内容管理：批量发布、定时发布
- 监控告警：定时检查页面状态、价格变化
- 日常杂务：搜索、截图、填表、下载

**用 shell 脚本 + CLI 工具的组合**，你甚至可以做出测试框架做不到的事：

```bash
# 每小时监控竞品价格，降价时自动发 Slack 告警
watch -n 3600 'xbrowser crawl "$COMPETITOR_URL" --extract ".price" \
  | xargs -I{} bash -c "[[ {} < 99 ]] && echo Price dropped to {} | slacksend"'
```

```bash
# 每天早上 9 点查排名，生成 Markdown 报告
0 9 * * * for kw in "js tutorial" "node guide" "react tips"; do \
  echo "### $kw"; xbrowser google search "$kw" --json --limit 3 \
  | jq -r ".[] | \"- [\(.title)](\(.url))\""; done > /tmp/rank-report.md
```

这些是 Playwright 和 Selenium 做不到的——不是技术上做不到，而是设计目标不同。它们不是为了"快速执行一次性任务"而生的。

## 我的建议

如果你是一个**开发者**，日常工作涉及浏览器操作但不需要做测试：

1. 先用 CLI 工具解决 80% 的日常操作
2. 遇到确实需要测试的场景，再引入 Playwright
3. 不要用 Playwright 做 CLI 该做的事——那是在给自己增加维护负担

如果你是一个**QA 工程师**，主要工作是测试：

1. Playwright 或 Selenium 是你的主力工具
2. 但偶尔需要快速做一些非测试的浏览器操作时，CLI 工具能省很多时间
3. 两者互补，不冲突

如果你是一个**运维 / 内容创作者 / SEO 工程师**，日常工作是重复的浏览器操作：

1. CLI 自动化工具是你最好的朋友
2. 配合 cron 和 shell 脚本，可以把每天的工作自动化
3. 不需要学测试框架，命令行就够了

---

说到 CLI 浏览器自动化工具，[xbrowser](https://github.com/yanqdinho/xbrowser) 是一个不错的选择。它把 Playwright 的浏览器操控能力封装成了命令行接口——Google 搜索、网页抓取、SEO ping 等操作一行命令搞定，输出原生 JSON，支持管道组合。适合日常自动化场景，也适合配合 cron 做定时任务。
