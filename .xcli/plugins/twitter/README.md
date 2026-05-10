# XBrowser Twitter Plugin

X (Twitter) 数据采集插件 - 支持推文搜索、用户资料、时间线、回复等功能，针对高影响力账号优化

## 安装方式

插件已内置在 XBrowser 中，无需额外安装。

## 前置要求

- Chrome 浏览器
- CDP 连接（`--cdp 9221`）
- 登录态（可选，用于访问受保护内容）

## 命令列表

### 1. search - 搜索推文

搜索包含关键词的推文。

**参数：**
- `--query` - 搜索关键词（必需）
- `--limit` - 返回推文数量（默认：20）

**示例：**
```bash
xbrowser --cdp 9221 twitter search --query "OpenAI" --limit 20
```

### 2. profile - 获取用户资料

获取指定用户的完整资料信息。

**参数：**
- `--username` - 用户名（必需，不含 @）

**示例：**
```bash
xbrowser --cdp 9221 twitter profile --username "elonmusk"
```

### 3. timeline - 获取用户时间线

获取指定用户最近的推文时间线。

**参数：**
- `--username` - 用户名（必需）
- `--limit` - 返回推文数量（默认：10）

**示例：**
```bash
xbrowser --cdp 9221 twitter timeline --username "elonmusk" --limit 10
```

### 4. timeline-advanced - 高级时间线（推荐）

针对高影响力账号优化的高级时间线功能，提供更强的数据解析能力和稳定性。

**参数：**
- `--username` - 用户名（必需）
- `--limit` - 返回推文数量（默认：30）
- `--useLogin` - 使用登录态（可选，提高成功率）

**示例：**
```bash
# 马斯克时间线
xbrowser --cdp 9221 twitter timeline-advanced --username "elonmusk" --limit 30

# 川普时间线（使用登录）
xbrowser --cdp 9221 twitter timeline-advanced --username "realdonaldtrump" --useLogin
```

### 5. tweets - 获取单条推文详情

获取指定推文的完整信息。

**参数：**
- `--tweetId` - 推文 ID（必需）

**示例：**
```bash
xbrowser --cdp 9221 twitter tweets --tweetId "1234567890"
```

### 6. replies - 获取推文回复

获取指定推文的所有回复。

**参数：**
- `--tweetId` - 推文 ID（必需）
- `--maxPages` - 最大翻页数（默认：10）

**示例：**
```bash
xbrowser --cdp 9221 twitter replies --tweetId "1234567890" --maxPages 10
```

## 高影响力账号优化

插件自动识别以下高影响力账号并应用优化策略：

- **@elonmusk** - 埃隆·马斯克
- **@realdonaldtrump** - 唐纳德·川普
- **@realdonaldtrump_backup** - 川普备用账号

优化内容包括：
- **多级选择器策略** - 提高抓取稳定性，应对 DOM 变化
- **动态等待机制** - 优化性能，智能等待内容加载
- **人类行为模拟** - 降低被检测风险，模拟真实用户操作
- **增强数据解析能力** - 提高数据提取准确性

## 数据结构

所有命令返回 JSON 格式数据，结构如下：

### 推文数据
```json
{
  "id": "推文ID",
  "author": "作者名称",
  "handle": "@用户名",
  "text": "推文内容",
  "time": "发布时间",
  "link": "推文链接",
  "replies": "回复数",
  "retweets": "转推数",
  "likes": "点赞数",
  "views": "浏览数"
}
```

### 用户资料
```json
{
  "name": "显示名称",
  "handle": "@用户名",
  "bio": "简介",
  "following": "关注数",
  "followers": "粉丝数",
  "verified": "是否认证"
}
```

## 常见问题

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

### Q: 被限流或封号？

**A:**
- 降低请求频率
- 使用 `--session` 参数隔离不同任务
- 添加人类行为模拟间隔

## Session 管理

使用 `--session` 参数可以隔离不同的抓取任务，避免状态污染：

```bash
# 任务 1：搜索 OpenAI
xbrowser --cdp 9221 --session task1 twitter search --query "OpenAI"

# 任务 2：搜索 AI（独立浏览器实例）
xbrowser --cdp 9221 --session task2 twitter search --query "AI"
```

每个 session 使用独立的浏览器实例，互不干扰。

## 完整使用示例

```bash
# 1. 搜索推文
xbrowser --cdp 9221 twitter search --query "OpenAI" --limit 20

# 2. 获取用户资料
xbrowser --cdp 9221 twitter profile --username "elonmusk"

# 3. 获取用户时间线
xbrowser --cdp 9221 twitter timeline --username "elonmusk" --limit 10

# 4. 获取高影响力账号时间线（推荐）
xbrowser --cdp 9221 twitter timeline-advanced --username "elonmusk" --limit 30
xbrowser --cdp 9221 twitter timeline-advanced --username "realdonaldtrump" --useLogin

# 5. 获取单条推文详情
xbrowser --cdp 9221 twitter tweets --tweetId "1234567890"

# 6. 获取推文回复
xbrowser --cdp 9221 twitter replies --tweetId "1234567890" --maxPages 10

# 7. 使用 session 隔离
xbrowser --cdp 9221 --session task1 twitter search --query "OpenAI"
xbrowser --cdp 9221 --session task2 twitter search --query "AI"
```

## 技术特性

- **Zod 数据验证** - 确保返回数据结构正确
- **多级选择器** - 应对 DOM 变化，提高稳定性
- **智能等待** - 动态等待内容加载，优化性能
- **错误处理** - 友好的错误提示和恢复机制
- **Session 隔离** - 支持多任务并行，避免状态污染

## 许可证

MIT License
