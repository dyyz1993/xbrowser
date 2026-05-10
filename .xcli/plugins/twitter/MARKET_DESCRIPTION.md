# XBrowser Twitter Plugin

**专业的 Twitter/X 数据采集工具** - 轻松获取推文、用户资料、时间线和回复数据，特别针对高影响力账号优化。

---

## 📝 简短介绍

XBrowser Twitter Plugin 是一个功能强大的 Twitter/X 数据采集插件，支持推文搜索、用户资料获取、时间线采集、推文详情和回复获取等功能。插件内置多级选择器策略、动态等待机制和人类行为模拟，确保数据采集的稳定性和准确性。

---

## 🎯 核心特性

### 1. 多级选择器策略
- 自动适配 DOM 结构变化
- 多重备选选择器提高抓取稳定性
- 智能回退机制

### 2. 高影响力账号优化
- 自动识别 @elonmusk、@realDonaldTrump 等高影响力账号
- 应用增强配置（更长等待、更多滚动）
- 智能重试机制

### 3. 动态等待机制
- 智能等待内容加载完成
- 可配置超时时间
- 减少数据缺失

### 4. 人类行为模拟
- 模拟真实用户滚动行为
- 随机滚动距离和延迟
- 降低被检测风险

### 5. Session 隔离
- 支持多任务并行
- 独立浏览器实例
- 避免状态污染

### 6. 完整的错误处理
- 友好的错误提示
- 自动重试机制
- CDP 连接检查

### 7. 丰富的数据字段
- 推文内容、时间、链接
- 互动数据（点赞、转推、回复、浏览）
- 用户信息（名称、用户名、简介、粉丝）

### 8. Zod 数据验证
- 确保返回数据结构正确
- 类型安全
- 减少运行时错误

---

## 💡 使用场景

### 1. 市场调研
- 监控品牌关键词
- 分析用户讨论热度
- 追踪竞争对手动态

### 2. 内容创作
- 搜集热门话题
- 获取行业领袖观点
- 寻找创作灵感

### 3. 数据分析
- 推文互动数据分析
- 用户行为模式研究
- 趋势预测

### 4. 社交媒体管理
- 监控账号表现
- 回复用户反馈
- 分析粉丝互动

### 5. 新闻媒体
- 实时追踪新闻事件
- 获取第一手信息
- 监控公共人物动态

### 6. 学术研究
- 社交网络分析
- 舆情研究
- 用户行为研究

---

## 📦 安装方式

插件已内置在 XBrowser 中，无需额外安装。

### 前置要求
- Chrome 浏览器
- CDP 连接（`--cdp 9221`）
- 登录态（可选，用于访问受保护内容）

### 启动 Chrome 远程调试

```bash
# macOS/Linux
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# 或使用 xbrowser 内置命令
xbrowser chrome --cdp 9221
```

---

## 🚀 快速开始

### 1. 搜索推文

```bash
xbrowser --cdp 9221 twitter search --query "OpenAI" --limit 20
```

**返回示例：**
```json
{
  "data": [
    {
      "id": "1234567890",
      "author": "Elon Musk",
      "handle": "@elonmusk",
      "text": "OpenAI is doing amazing work!",
      "time": "2026-05-10T12:00:00Z",
      "link": "https://x.com/elonmusk/status/1234567890",
      "replies": "1234",
      "retweets": "5678",
      "likes": "90123",
      "views": "1.2M"
    }
  ],
  "tips": [
    "Session: default",
    "找到 20 条推文"
  ]
}
```

### 2. 获取用户资料

```bash
xbrowser --cdp 9221 twitter profile --username "elonmusk"
```

**返回示例：**
```json
{
  "data": {
    "name": "Elon Musk",
    "handle": "@elonmusk",
    "bio": "Mars, cars, robots & the occasional meme",
    "following": "850",
    "followers": "200.5M",
    "verified": true
  },
  "tips": [
    "Session: default"
  ]
}
```

### 3. 获取用户时间线

```bash
xbrowser --cdp 9221 twitter timeline --username "elonmusk" --limit 10
```

**返回示例：**
```json
{
  "data": {
    "username": "elonmusk",
    "count": 10,
    "tweets": [
      {
        "text": "Just launched a new rocket!",
        "time": "2026-05-10T11:30:00Z",
        "likes": "45678",
        "replies": "2345",
        "link": "https://x.com/elonmusk/status/1234567890",
        "id": "1234567890"
      }
    ]
  },
  "tips": [
    "Session: default",
    "elonmusk 最近 10 条推文"
  ]
}
```

### 4. 获取高影响力账号时间线（推荐）

```bash
# 马斯克时间线
xbrowser --cdp 9221 twitter timeline-advanced --username "elonmusk" --limit 30

# 川普时间线（使用登录）
xbrowser --cdp 9221 twitter timeline-advanced --username "realdonaldtrump" --useLogin
```

**返回示例：**
```json
{
  "data": {
    "username": "elonmusk",
    "count": 30,
    "tweets": [
      {
        "text": "Exciting news coming soon!",
        "time": "2026-05-10T12:00:00Z",
        "likes": "78901",
        "replies": "3456",
        "retweets": "12345",
        "link": "https://x.com/elonmusk/status/1234567890",
        "id": "1234567890",
        "author": "Elon Musk",
        "handle": "@elonmusk"
      }
    ]
  },
  "tips": [
    "Session: default",
    "检测到高影响力账号，使用增强配置",
    "elonmusk 最近 30 条推文"
  ]
}
```

### 5. 获取单条推文详情

```bash
xbrowser --cdp 9221 twitter tweets --tweetId "1234567890"
```

**返回示例：**
```json
{
  "data": {
    "id": "1234567890",
    "author": "Elon Musk",
    "handle": "@elonmusk",
    "text": "This is a tweet!",
    "time": "2026-05-10T12:00:00Z",
    "link": "https://x.com/elonmusk/status/1234567890",
    "replies": "1234",
    "retweets": "5678",
    "likes": "90123",
    "views": "1.2M"
  },
  "tips": [
    "Session: default"
  ]
}
```

---

## 🌟 高影响力账号优化

插件自动识别以下高影响力账号并应用优化策略：

### 支持的账号
- **@elonmusk** - 埃隆·马斯克
- **@realdonaldtrump** - 唐纳德·川普
- **@realdonaldtrump_backup** - 川普备用账号

### 优化内容
1. **更长等待时间**
   - 高影响力账号：20 秒超时
   - 普通账号：15 秒超时

2. **更多滚动迭代**
   - 高影响力账号：8 次滚动
   - 普通账号：5 次滚动

3. **更长滚动延迟**
   - 高影响力账号：1.5 秒
   - 普通账号：1 秒

4. **智能重试**
   - 高影响力账号：3 次重试
   - 普通账号：1 次重试

5. **用户名大小写不敏感**
   - `elonmusk`, `ElonMusk`, `ELONMUSK` 都可以
   - 自动转换为小写进行匹配

### 使用示例

```bash
# 所有以下命令都会自动应用高影响力账号优化
xbrowser --cdp 9221 twitter timeline-advanced --username "elonmusk" --limit 30
xbrowser --cdp 9221 twitter timeline-advanced --username "ElonMusk" --limit 30
xbrowser --cdp 9221 twitter timeline-advanced --username "ELONMUSK" --limit 30

# 川普账号（推荐使用登录态）
xbrowser --cdp 9221 twitter timeline-advanced --username "realdonaldtrump" --useLogin
xbrowser --cdp 9221 twitter timeline-advanced --username "RealDonaldTrump" --useLogin
```

---

## 🔧 技术亮点

### 1. 多级选择器策略

```typescript
// 智能选择器函数
function smartSelect(element: Element, selectors: string[]): Element | null {
  for (const selector of selectors) {
    const found = element.querySelector(selector);
    if (found) return found;
  }
  return null;
}

// 使用示例
const userEl = smartSelect(article, [
  '[data-testid="User-Name"] a',
  '[class*="username"]',
  'a[href*="/"][tabindex="-1"]'
]);
```

### 2. 动态等待机制

```typescript
async function waitForContent(page: Page, selector: string, timeout = 10000): Promise<void> {
  try {
    await page.waitForSelector(selector, { timeout, state: 'attached' });
  } catch (error) {
    console.warn(`Selector ${selector} not found, continuing anyway`);
  }
}
```

### 3. 人类行为模拟

```typescript
async function simulateHumanScroll(page: Page): Promise<void> {
  const scrollAmount = Math.random() * 500 + 500;  // 500-1000 像素
  await page.evaluate((amount) => window.scrollBy(0, amount), scrollAmount);
  await page.waitForTimeout(Math.random() * 1000 + 500);  // 500-1500 毫秒
}
```

### 4. 高影响力账号识别

```typescript
const HIGH_PROFILE_USERS = new Set([
  'elonmusk',
  'realdonaldtrump',
  'realdonaldtrump_backup'
]);

const isHighProfile = HIGH_PROFILE_USERS.has(username.toLowerCase());
const config = isHighProfile ? HIGH_PROFILE_CONFIG : DEFAULT_CONFIG;
```

### 5. Zod 数据验证

```typescript
import { z } from 'zod';

const TweetSchema = z.object({
  id: z.string(),
  author: z.string(),
  handle: z.string(),
  text: z.string(),
  time: z.string(),
  link: z.string(),
  likes: z.string(),
  retweets: z.string(),
  replies: z.string(),
  views: z.string().optional(),
});

const result = TweetSchema.parse(data);
```

---

## 📊 数据结构

### 推文数据
```typescript
interface Tweet {
  id: string;           // 推文 ID
  author: string;       // 作者名称
  handle: string;       // @用户名
  text: string;         // 推文内容
  time: string;         // 发布时间（ISO 8601）
  link: string;         // 推文链接
  replies: string;      // 回复数
  retweets: string;     // 转推数
  likes: string;        // 点赞数
  views?: string;       // 浏览数（可选）
}
```

### 用户资料
```typescript
interface Profile {
  name: string;         // 显示名称
  handle: string;       // @用户名
  bio: string;          // 简介
  following: string;    // 关注数
  followers: string;    // 粉丝数
  verified: boolean;    // 是否认证
}
```

### 时间线数据
```typescript
interface Timeline {
  username: string;     // 用户名
  count: number;        // 推文数量
  tweets: Tweet[];      // 推文数组
}
```

### 搜索结果
```typescript
interface SearchResult {
  data: Tweet[];        // 推文数组
  tips: string[];       // 提示信息
}
```

---

## ❓ 常见问题（FAQ）

### Q: CDP 连接失败怎么办？

**A:** 确保使用 `--cdp 9221` 参数，并先启动 Chrome 的远程调试：

```bash
# macOS/Linux
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# 或使用 xbrowser 内置命令
xbrowser chrome --cdp 9221
```

### Q: 如何提高抓取成功率？

**A:** 使用 `timeline-advanced` 命令，并添加 `--useLogin` 参数：

```bash
xbrowser --cdp 9221 twitter timeline-advanced --username "elonmusk" --useLogin
```

### Q: 数据不完整？

**A:** 尝试以下方法：
- 增加 `--limit` 参数值
- 使用 `--useLogin` 参数
- 检查网络连接
- 使用 `timeline-advanced` 命令

### Q: 被限流或封号？

**A:**
- 降低请求频率
- 使用 `--session` 参数隔离不同任务
- 添加人类行为模拟间隔
- 避免在短时间内大量请求

### Q: 如何获取受保护的内容？

**A:** 使用 `--useLogin` 参数，并确保浏览器已登录 Twitter/X：

```bash
# 1. 启动 Chrome 并登录 Twitter
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# 2. 使用 --useLogin 参数
xbrowser --cdp 9221 twitter timeline-advanced --username "username" --useLogin
```

### Q: 支持哪些命令？

**A:** 目前支持 6 个命令：
1. `search` - 搜索推文
2. `profile` - 获取用户资料
3. `timeline` - 获取用户时间线
4. `timeline-advanced` - 高级时间线（推荐）
5. `tweets` - 获取单条推文详情
6. `replies` - 获取推文回复

### Q: 如何使用 Session 隔离？

**A:** 使用 `--session` 参数：

```bash
# 任务 1：搜索 OpenAI
xbrowser --cdp 9221 --session task1 twitter search --query "OpenAI"

# 任务 2：搜索 AI（独立浏览器实例）
xbrowser --cdp 9221 --session task2 twitter search --query "AI"
```

### Q: 用户名大小写敏感吗？

**A:** 不敏感。插件会自动将用户名转换为小写进行匹配：

```bash
# 以下命令效果相同
xbrowser --cdp 9221 twitter timeline --username "elonmusk"
xbrowser --cdp 9221 twitter timeline --username "ElonMusk"
xbrowser --cdp 9221 twitter timeline --username "ELONMUSK"
```

### Q: 如何获取更多推文？

**A:** 增加 `--limit` 参数值：

```bash
# 获取 50 条推文
xbrowser --cdp 9221 twitter timeline-advanced --username "elonmusk" --limit 50

# 获取 100 条推文
xbrowser --cdp 9221 twitter timeline-advanced --username "elonmusk" --limit 100
```

### Q: 插件会触发 Twitter 的反爬虫吗？

**A:** 插件采用了多项反反爬虫措施：
- 人类行为模拟（随机滚动和延迟）
- 合理的请求频率
- 多级选择器策略减少请求次数
- Session 隔离避免状态污染

但请注意，任何自动化工具都可能触发反爬虫机制，建议：
- 降低请求频率
- 使用真实的浏览器登录态
- 避免大规模采集

---

## 🔗 相关链接

- **文档**: [XBrowser 官方文档](https://docs.xbrowser.ai)
- **GitHub**: [XBrowser GitHub 仓库](https://github.com/xbrowser/xbrowser)
- **发布说明**: [RELEASE_NOTES.md](./RELEASE_NOTES.md)
- **更新日志**: [CHANGELOG.md](./CHANGELOG.md)
- **许可证**: [MIT License](./LICENSE)

---

## 📞 支持与反馈

如果您在使用过程中遇到任何问题或有改进建议，欢迎通过以下方式反馈：

- **GitHub Issues**: [提交问题](https://github.com/xbrowser/xbrowser/issues)
- **邮件**: support@xbrowser.ai
- **社区**: [XBrowser 社区](https://community.xbrowser.ai)

---

## 📄 许可证

MIT License - 详见 [LICENSE](./LICENSE) 文件

---

**版本**: v2.0.0
**发布日期**: 2026-05-10
**维护者**: XBrowser Team
