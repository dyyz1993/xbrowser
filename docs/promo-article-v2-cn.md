# 同一个网站操作 10 次，我的 AI Agent 烧了 5 万 Token

上周我做了一个实验：让 AI Agent 连续 10 天，每天帮我去掘金搜一下"Rust 教程"相关的新文章。

结果呢？**10 天下来，光浏览器操作这一项就烧了差不多 26000 token。** 而且每一天的操作流程完全一样——找搜索框、输入关键词、等加载、提取结果。AI 每次都像第一次来这个网站一样，从头摸索。

我算了一笔账，按 GPT-4o 的价格，这波操作花了差不多 **¥2-3 块钱**。钱不多，但真正让我难受的是——**这些 token 花在了完全重复的劳动上。**

## AI Agent 操作浏览器为什么这么费 Token？

先看一个典型的场景。我让 AI Agent 去 CSDN 搜索一篇文章的标题：

**第 1 次操作（探索阶段）：**

```
[Agent] 截图分析当前页面结构...... ~800 token
[Agent] 尝试定位搜索框选择器 → 猜了 #search-box... ~600 token
[Agent] 选择器不存在，查看 DOM 结构重新定位... ~500 token
[Agent] 找到了！是 input[placeholder="搜CSDN"]
[Agent] 输入搜索词，等待页面加载... ~400 token
[Agent] 提取搜索结果列表文本... ~300 token
总计：~2600 token
```

**第 2 次操作（一模一样的事）：**

```
[Agent] 截图分析页面结构...... ~800 token（又来一遍）
[Agent] 定位搜索框... ~600 token（又要找）
[Agent] 可能又猜错一次... ~500 token（又重试）
[Agent] 输入、等待、提取... ~700 token
总计：~2600 token
```

10 次操作 = **26000 token**，而且每次的执行路径几乎完全相同。

我把问题总结成了四点：

### 1. 每次从零开始，没有记忆

AI Agent 没有跨会话记忆。昨天它在掘金上摸索出的 `input[placeholder="探索"]` 这个选择器，今天它忘得一干二净。同样的探索过程，日复一日地重复。

### 2. 选择器靠猜，猜错就重试

AI 分析页面结构多半靠截图或 DOM 快照，**猜选择器本质上是一个概率游戏**。猜对了万事大吉，猜错了——重试一次就是几百 token。我统计过，对于复杂页面，AI 平均要尝试 2-3 次才能找到正确的选择器。

### 3. 上下文膨胀严重

浏览器页面的 HTML 动辄几十 KB，一张截图也有几百 KB。每次操作都要把这些信息塞进 AI 的上下文窗口。**光是传输页面结构，每次就要消耗 800-1500 token。**

### 4. 没有复用机制

第一次探索的结果——选择器、操作流程、异常处理经验——全部无法保存。**每次都像是第一次，每次都在交同样的学费。**

## 核心思路：把探索结果沉淀成可复用的命令

想明白之后，解决方案其实很简单：

> **第一次让 AI 探索，把结果（选择器、流程）固化下来，后续直接调用。**

举个具体的例子。第一次在掘金搜索后，我记录下了这些信息：

```
掘金搜索：
- 搜索框选择器：input[placeholder="探索"]  
- 搜索结果列表：.content-main .entry
- 操作流程：点击搜索框 → 输入关键词 → 按 Enter → 等待结果加载 → 提取文本
```

然后封装成一个 CLI 命令：

```bash
juejin search "Rust 教程" --json
```

**之后 AI 只需要拼接这个命令字符串，不需要再分析页面。**

Token 消耗对比：

| 方式 | 单次 token | 10 次总计 | 重复率 |
|------|-----------|----------|--------|
| AI 直接操作浏览器 | ~2600 | ~26000 | 100% |
| 调用封装好的命令 | ~50 | ~500 | 0% |

**从 26000 降到 500，节省了 98%。** 那 50 token 只是 AI 构造命令字符串的开销。

## 实战：从 3000+ Token 到 50 Token

我用一个真实的场景来演示——"AI Agent 每天监控京东某商品的价格变化"。

### 之前：AI 每次手动操作浏览器（~3000 token/次）

AI 每次都要生成类似这样的代码：

```javascript
// AI Agent 每次生成的浏览器操作代码
const page = await browser.newPage();
await page.goto('https://item.jd.com/100012043978.html', {
  waitUntil: 'domcontentloaded'
});

// AI 猜选择器... 第 1 次尝试
let price = await page.$eval('.p-price span', el => el.textContent).catch(() => null);
if (!price) {
  // 第 2 次尝试
  price = await page.$eval('.price J-p-100012043978', el => el.textContent).catch(() => null);
}
if (!price) {
  // 第 3 次尝试，查看 DOM...
  const html = await page.content();
  // 分析 HTML 结构，重新定位...
  price = await page.$eval('[class*="price"] span', el => el.textContent);
}

// 处理反爬、等待动态加载、异常捕获...
```

这段代码看起来还行？问题是 **AI 每次都要重新走一遍这个流程**。而且实际场景中，AI 生成的代码往往更冗长——它会加上大量的 try-catch、注释、日志输出，因为它是"边想边写"的。

### 之后：封装成命令（~50 token/次）

我把常用的浏览器操作都封装成了 [xbrowser](https://github.com/dyyz1993/xbrowser) 的插件。AI Agent 只需要调用 CLI 命令：

```bash
# AI 只需要生成这一行
xbrowser jd price --url "https://item.jd.com/100012043978.html" --json
```

返回结果：

```json
{
  "price": "2999.00",
  "originalPrice": "3299.00",
  "discount": "-9.1%",
  "inStock": true,
  "timestamp": "2025-05-28T10:30:00Z"
}
```

**50 token 就搞定了。** AI 不需要知道京东的价格选择器是什么，不需要处理反爬策略，不需要等待动态加载。插件内部已经把这些脏活累活都处理好了。

### 再看一个搜索的例子

```bash
# 之前：AI 操作浏览器搜索掘金文章，~2600 token
# 之后：
xbrowser juejin search "Rust 异步编程" --limit 5 --json
```

返回：

```json
{
  "results": [
    {
      "title": "Rust 异步编程完全指南",
      "author": "xxx",
      "url": "https://juejin.cn/post/7xxx",
      "likes": 328,
      "date": "2025-05-25"
    }
  ]
}
```

**干净、结构化、可预测。** AI 拿到这个 JSON 后可以直接做后续分析，不需要再从 HTML 里提取文本。

## 这个思路的本质：把探索成本变成可复用资产

我把这套思路用了一个多月，总结出一个公式：

```
总 Token 消耗 = 首次探索成本 + 重复操作次数 × 单次操作成本

没有封装：总消耗 = 2600 + N × 2600
有封装后：总消耗 = 2600 + N × 50

当 N = 10 时，节省 98%
当 N = 50 时，节省 99.6%
```

**首次探索的 2600 token 是必须花的**——AI 总得搞清楚页面结构。但关键是，这笔钱只需要花一次。

这让我想到一个类比：**AI Agent 做浏览器操作，就像让一个新人每天去同一家餐厅点外卖，但每次都要重新看菜单、问服务员推荐、纠结选什么。** 而封装命令相当于让他记住自己的常点菜单，下次直接报菜名就行。

## 插件化：一个网站一个插件

顺着这个思路，很自然的做法就是**按网站封装插件**。每个插件封装了对特定网站的操作，AI Agent 按需调用：

```bash
# 搜索类
xbrowser baidu search "AI Agent 浏览器自动化" --json
xbrowser google search "playwright token cost" --json
xbrowser bing search "CDP protocol guide" --json

# 内容平台
xbrowser juejin search "Rust 教程" --limit 10 --json
xbrowser csdn search "TypeScript 泛型" --json
xbrowser zhihu search "如何学习系统设计" --json

# 电商
xbrowser jd price --url "https://item.jd.com/xxx" --json
```

每个插件就是一个 npm 包，包含了：
- **选择器定义**：这个网站用哪些 CSS 选择器
- **操作流程**：先做什么、后做什么、异常怎么处理
- **数据提取**：怎么把 HTML 转成结构化 JSON

**AI 不需要知道这些细节**，它只需要知道"有这么一个命令可以用"。

## 一些延伸思考

写到这里，我想聊聊更深层的东西。

**AI Agent 最大的成本不是模型调用费，而是重复劳动的浪费。** 一次浏览器操作花 3000 token 不贵，但重复 100 次就是 30 万 token。更关键的是，这些重复操作没有任何学习价值——AI 每次探索同样的页面，但不会因此变聪明。

**把一次性的探索成本变成可复用的资产，才是 AI Agent 工程化的正确方向。** 这跟传统软件开发一个道理——我们不希望每次部署都手动配置环境，所以有了 Docker；我们不希望每次构建都手动编译，所以有了 CI/CD。AI Agent 的浏览器操作也需要同样的"封装"思维。

想象一下，如果每个常用网站都有一个封装好的命令库——GitHub 操作、JIRA 查询、飞书文档读取——AI Agent 的 token 效率能提升多少？Agent 的可靠性又能提升多少？（封装好的命令不会猜错选择器。）

**这才是 AI Agent 从"能用"到"好用"的关键一步。**

---

*如果你也在做 AI Agent 的浏览器自动化，建议试试把高频操作封装成命令。[xbrowser](https://github.com/dyyz1993/xbrowser) 就是一个专门做这件事的 CLI 工具，支持插件扩展，可以按网站封装操作命令。开源的，感兴趣的可以看看。*
