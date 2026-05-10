# XBrowser 抖音插件

> 专业级抖音数据采集工具，基于 CDP 协议，支持视频评论、用户评论、作品统计等核心功能

[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](https://github.com/your-org/xbrowser)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)

## 📖 简短介绍

XBrowser 抖音插件是专为抖音数据采集设计的专业工具，通过 Chrome DevTools Protocol (CDP) 连接浏览器，直接拦截网络请求获取结构化数据，无需复杂的 DOM 解析。支持视频评论、用户评论、作品统计等功能，适用于数据分析、市场研究、内容监控等场景。

## ✨ 核心特性

### 🎯 六大核心命令

| 命令 | 功能 | 适用场景 |
|------|------|---------|
| `comments` | 获取视频评论 | 分析视频互动情况、用户反馈 |
| `user-comments` | 获取用户评论 | 分析用户行为、活跃度 |
| `video-stats` | 获取作品统计 | 分析视频表现、内容质量 |
| `videos` | 获取作品列表 | 批量采集用户作品 |
| `profile` | 获取用户资料 | 分析账号信息 |
| `detail` | 获取视频详情 | 视频元数据提取 |

### 🔧 技术亮点

- **网络拦截技术**: 直接拦截 API 请求，获取结构化数据，无需 DOM 解析
- **自动分页加载**: 支持自动滚动加载，可自定义最大页数
- **Session 隔离**: 支持独立 session，避免并发任务数据串扰
- **完整数据**: 包含用户信息、统计数据、时间戳等完整字段
- **错误处理**: 友好的错误提示和连接检查
- **类型安全**: TypeScript 编写，完整的类型定义

### 🚀 性能优势

- **速度快**: 网络拦截比 DOM 解析快 3-5 倍
- **数据准**: 直接获取 API 数据，避免解析错误
- **内存省**: 优化的滚动加载机制，减少内存占用
- **并发支持**: Session 隔离支持多任务并发执行

## 🎯 使用场景

### 1. 内容分析
- 分析视频评论，了解用户反馈
- 分析作品数据，评估内容质量
- 监控热门话题和趋势

### 2. 用户研究
- 分析用户评论行为
- 研究用户互动模式
- 识别活跃用户和关键意见领袖

### 3. 市场调研
- 采集竞品数据
- 分析热门内容特征
- 研究用户偏好

### 4. 数据监控
- 监控账号数据变化
- 跟踪内容表现
- 定期数据备份

## 📦 安装方式

### 前置要求

- **Node.js**: >= 18.0.0
- **Chrome 浏览器**: >= 120（推荐最新版本）

### 安装步骤

#### 1. 启动 Chrome 并开启 CDP

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# Linux
google-chrome --remote-debugging-port=9221

# Windows
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9221
```

#### 2. 安装插件

```bash
# 全局安装
npm install -g xbrowser-plugin-douyin

# 或作为项目依赖
npm install xbrowser-plugin-douyin
```

#### 3. 登录抖音

在已启动的 Chrome 浏览器中手动登录抖音账号（部分数据需要登录态）

## 🚀 快速开始

### 获取视频评论

```bash
# 基础用法
xbrowser --cdp 9221 douyin comments 7123456789012345678

# 获取更多评论
xbrowser --cdp 9221 douyin comments 7123456789012345678 --max-pages 10
```

### 获取用户评论

```bash
# 基础用法
xbrowser --cdp 9221 douyin user-comments 1234567890123456

# 获取更多评论
xbrowser --cdp 9221 douyin user-comments 1234567890123456 --max-pages 10
```

### 获取作品统计

```bash
# 获取单个作品数据
xbrowser --cdp 9221 douyin video-stats 7123456789012345678
```

### 使用 Session 隔离

```bash
# 创建独立的 session
xbrowser --cdp 9221 --session task1 douyin comments 7123456789012345678
xbrowser --cdp 9221 --session task2 douyin comments 7123456789012345679

# 清理 session
xbrowser --session task1 --cleanup
```

## 📊 返回数据示例

### 视频评论数据

```json
{
  "total": 1500,
  "comments": [
    {
      "id": "7123456789012345678",
      "text": "太赞了！",
      "user": {
        "uid": "1234567890123456",
        "nickname": "用户昵称",
        "avatar": "https://..."
      },
      "createTime": 1715328000000,
      "createTimeStr": "2024-05-10 12:00:00",
      "diggCount": 100,
      "replyCount": 5
    }
  ]
}
```

### 视频统计数据

```json
{
  "awemeId": "7123456789012345678",
  "desc": "视频描述",
  "statistics": {
    "diggCount": 10000,
    "commentCount": 500,
    "shareCount": 200,
    "collectCount": 300,
    "playCount": 100000
  }
}
```

## 🔍 常见问题

### Q: CDP 连接失败怎么办？

A: 检查 Chrome 是否已启动并开启 CDP：

```bash
# 检查 Chrome 进程
ps aux | grep "Chrome"

# 检查端口占用
lsof -i :9221

# 重新启动 Chrome
killall "Google Chrome"
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221
```

### Q: 为什么获取不到数据？

A: 确保已登录抖音账号，部分数据需要登录态才能获取。

### Q: 如何提高采集速度？

A: 减少 `maxPages` 参数，使用更快的网络环境，使用 Session 隔离并发执行。

### Q: 数据不完整怎么办？

A: 增加 `maxPages` 参数，确保网络连接稳定。

## 📚 文档

- **完整文档**: [README.md](./README.md)
- **变更日志**: [CHANGELOG.md](./CHANGELOG.md)
- **发布说明**: [RELEASE_NOTES.md](./RELEASE_NOTES.md)
- **API 文档**: [完整 API 文档](./README.md#数据结构)

## 🤝 贡献

欢迎贡献代码、报告问题或提出建议！

- 提交 Issue: [GitHub Issues](https://github.com/your-org/xbrowser/issues)
- 提交 PR: [GitHub Pull Requests](https://github.com/your-org/xbrowser/pulls)

## 📄 许可证

MIT License - 详见 [LICENSE](./LICENSE) 文件

## 🔗 链接

- **项目主页**: https://github.com/your-org/xbrowser
- **文档**: https://github.com/your-org/xbrowser/blob/main/.xcli/plugins/douyin/README.md
- **问题反馈**: https://github.com/your-org/xbrowser/issues
- **NPM**: https://www.npmjs.com/package/xbrowser-plugin-douyin

## ⚠️ 免责声明

本插件仅供学习研究使用，不得用于商业用途。使用本插件采集的数据请遵守相关法律法规和平台服务条款。

---

**Made with ❤️ by XBrowser Team**
