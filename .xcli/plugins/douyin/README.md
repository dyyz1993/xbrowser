# XBrowser 抖音数据采集插件

## 插件简介

XBrowser 抖音插件是用于抖音平台数据采集的专业工具，支持通过 CDP（Chrome DevTools Protocol）连接浏览器，拦截网络请求获取结构化数据。支持视频评论、用户评论、作品统计等核心功能。

## 安装方式

### 1. 安装 Chrome 浏览器

确保系统已安装 Chrome 浏览器。

### 2. 启动 Chrome 并开启 CDP

在终端中执行以下命令启动 Chrome：

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# Linux
google-chrome --remote-debugging-port=9221

# Windows
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9221
```

### 3. 安装插件

```bash
# 如果是 XBrowser 内置插件，无需额外安装
# 如果是独立插件，使用以下命令
npm install -g xbrowser-plugin-douyin
```

## 前置要求

### Chrome 浏览器
- 需要安装 Chrome 浏览器（推荐最新版本）
- 通过 CDP 参数启动（`--remote-debugging-port=9221`）

### CDP 连接
- 默认端口：`9221`
- 使用 `--cdp 9221` 参数连接
- 确保端口未被占用

### 登录态
- **必须**在 Chrome 浏览器中登录抖音账号
- 部分数据（如评论）需要登录态才能获取
- 建议在启动 Chrome 后手动登录抖音

## 命令列表

### 1. comments - 获取视频评论

拦截网络请求获取视频评论数据，支持分页加载。

**参数：**
- `awemeId` (必填): 视频的 aweme_id
- `maxPages` (可选): 最大滚动次数，默认 5

**返回数据：**
- 评论列表（含回复）
- 用户信息
- 点赞数、回复数
- 时间戳

### 2. user-comments - 获取用户评论

获取指定用户发布的评论数据。

**参数：**
- `uid` (必填): 用户的 uid
- `maxPages` (可选): 最大滚动次数，默认 5

**返回数据：**
- 用户评论列表
- 评论所属视频信息
- 点赞数、回复数
- 时间戳

### 3. video-stats - 获取单个作品数据

获取单个视频的完整统计数据。

**参数：**
- `awemeId` (必填): 视频的 aweme_id

**返回数据：**
- 视频基本信息（标题、作者）
- 播放量、点赞数、评论数、分享数、收藏数
- 视频分辨率、时长
- 视频链接和封面图
- 多码率播放地址

### 4. videos - 获取用户作品列表

采集用户主页的作品列表（已存在命令）。

**参数：**
- `url` (必填): 用户主页 URL
- `maxPages` (可选): 最大滚动次数，默认 5

### 5. profile - 获取用户资料

获取用户的基本信息（已存在命令）。

**参数：**
- `url` (必填): 用户主页 URL

### 6. detail - 获取视频详情

获取视频的 DOM 解析详情（已存在命令）。

**参数：**
- `awemeId` (必填): 视频 ID

## 使用示例

### 1. 获取视频评论

```bash
# 基础用法
xbrowser --cdp 9221 douyin comments 7123456789012345678

# 指定最大页数
xbrowser --cdp 9221 douyin comments 7123456789012345678 --max-pages 10
```

### 2. 获取用户评论

```bash
# 基础用法
xbrowser --cdp 9221 douyin user-comments 1234567890123456

# 指定最大页数
xbrowser --cdp 9221 douyin user-comments 1234567890123456 --max-pages 10
```

### 3. 获取单个作品数据

```bash
# 基础用法
xbrowser --cdp 9221 douyin video-stats 7123456789012345678
```

### 4. 获取用户作品列表

```bash
# 基础用法
xbrowser --cdp 9221 douyin videos https://www.douyin.com/user/MS4wLjABAAAA1234567890

# 指定最大页数
xbrowser --cdp 9221 douyin videos https://www.douyin.com/user/MS4wLjABAAAA1234567890 --max-pages 10
```

### 5. 使用 session 隔离

```bash
# 创建独立的 session 避免数据污染
xbrowser --cdp 9221 --session task1 douyin comments 7123456789012345678
xbrowser --cdp 9221 --session task2 douyin comments 7123456789012345679

# 清理 session
xbrowser --session task1 --cleanup
```

### 6. 获取用户资料

```bash
xbrowser --cdp 9221 douyin profile https://www.douyin.com/user/MS4wLjABAAAA1234567890
```

### 7. 获取视频详情

```bash
xbrowser --cdp 9221 douyin detail 7123456789012345678
```

## 数据结构

### 评论数据 (comments/user-comments)

```typescript
{
  total: number;           // 评论总数
  comments: Array<{
    id: string;            // 评论 ID
    text: string;          // 评论内容
    user: {
      uid: string;         // 用户 ID
      nickname: string;    // 用户昵称
      avatar: string;      // 头像 URL
    };
    createTime: number;    // 创建时间戳
    createTimeStr: string; // 格式化时间
    diggCount: number;     // 点赞数
    replyCount: number;    // 回复数
    replyTo?: {            // 回复的评论（如果有）
      id: string;
      text: string;
      user: {
        uid: string;
        nickname: string;
      };
    };
  }>;
}
```

### 视频统计数据 (video-stats)

```typescript
{
  awemeId: string;         // 视频 ID
  desc: string;            // 视频描述
  createTime: number;      // 创建时间戳
  createTimeStr: string;   // 格式化时间
  author: {
    uid: string;           // 作者 ID
    nickname: string;      // 作者昵称
  };
  video: {
    playUrl: string;       // 播放地址
    cover: string;         // 封面图
    width: number;         // 宽度
    height: number;        // 高度
    duration: number;      // 时长（毫秒）
    bitRates: Array<{      // 码率信息
      gearName: string;    // 码率名称
      qualityType: number; // 质量类型
      playAddr: string;    // 播放地址
      size: number;        // 文件大小
    }>;
  };
  statistics: {
    diggCount: number;     // 点赞数
    commentCount: number;  // 评论数
    shareCount: number;    // 分享数
    collectCount: number;  // 收藏数
    playCount: number;     // 播放量
  };
  tagNames: string[];      // 标签名称
}
```

### 作品列表数据 (videos)

```typescript
{
  total: number;           // 作品总数
  videos: Array<VideoStats>; // 同视频统计结构
}
```

### 用户资料数据 (profile)

```typescript
{
  nickname: string;        // 昵称
  signature: string;       // 简介
  stats: Record<string, string>; // 统计数据（获赞、粉丝、关注等）
}
```

## 常见问题

### 1. CDP 连接失败

**问题：**
```
Error: Failed to connect to CDP endpoint
```

**原因：**
- Chrome 未启动或未开启 CDP
- 端口 9221 被占用
- 防火墙阻止连接

**解决方案：**
```bash
# 1. 检查 Chrome 是否已启动
ps aux | grep "Chrome"

# 2. 检查端口是否被占用
lsof -i :9221

# 3. 如果端口被占用，更换端口
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
xbrowser --cdp 9222 douyin comments <aweme_id>

# 4. 重新启动 Chrome
killall "Google Chrome"
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221
```

### 2. 未获取到数据

**问题：**
```
未获取到视频数据，可能需要登录或视频不存在
```

**解决方案：**
- 在 Chrome 浏览器中手动登录抖音账号
- 检查视频 ID 是否正确
- 检查网络连接
- 刷新页面后重试

### 3. 数据不完整

**问题：**
采集到的数据少于预期

**原因：**
- 滚动次数不足
- 网络延迟
- 抖音反爬限制

**解决方案：**
```bash
# 增加 maxPages 参数
xbrowser --cdp 9221 douyin comments <aweme_id> --max-pages 20
```

### 4. 速度慢

**问题：**
采集速度较慢

**原因：**
- 网络延迟
- 滚动等待时间过长

**解决方案：**
- 检查网络连接
- 减少 maxPages 参数
- 使用更快的网络环境

## Session 管理

### 什么是 Session？

Session 是 XBrowser 提供的隔离机制，每个 session 有独立的浏览器上下文和数据存储。

### 为什么需要 Session？

- **数据隔离**：不同任务的数据不会互相干扰
- **并发执行**：可以同时运行多个采集任务
- **状态管理**：每个 session 维护独立的登录态和 Cookie

### 使用方法

```bash
# 创建 session
xbrowser --cdp 9221 --session task1 douyin comments 7123456789012345678

# 清理 session
xbrowser --session task1 --cleanup

# 列出所有 session
xbrowser --session list
```

### 最佳实践

1. **独立任务使用独立 session**
   ```bash
   xbrowser --cdp 9221 --session crawl-video1 douyin comments <id1>
   xbrowser --cdp 9221 --session crawl-video2 douyin comments <id2>
   ```

2. **批量任务使用相同 session**
   ```bash
   xbrowser --cdp 9221 --session batch-crawl douyin videos <url> --max-pages 10
   ```

3. **定期清理不用的 session**
   ```bash
   xbrowser --session old-task --cleanup
   ```

## 注意事项

1. **登录态**：部分数据需要登录态，请确保在 Chrome 中已登录
2. **频率限制**：避免频繁请求，可能导致 IP 被限制
3. **数据合规**：仅用于学习研究，不得用于商业用途
4. **端口占用**：确保 CDP 端口未被占用
5. **网络稳定**：保持网络连接稳定，避免数据丢失

## 版本历史

### v2.0.0 (当前版本)
- 新增 `comments` 命令：获取视频评论
- 新增 `user-comments` 命令：获取用户评论
- 新增 `video-stats` 命令：获取单个作品数据
- 优化网络拦截逻辑
- 添加 Session 隔离支持

### v1.0.0
- 初始版本
- 支持 `videos`、`profile`、`detail` 命令

## 许可证

MIT License

## 联系方式

- 项目地址：https://github.com/your-org/xbrowser
- 问题反馈：https://github.com/your-org/xbrowser/issues
