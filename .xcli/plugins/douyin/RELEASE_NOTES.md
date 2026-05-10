# 抖音插件 v2.0.0 发布说明

## 版本信息

- **版本号**: 2.0.0
- **发布日期**: 2026-05-10
- **发布类型**: Major Release（重大更新）

---

## 新功能概览

本次更新是抖音插件的首次重大升级，新增了三个核心命令，大幅提升了数据采集能力。

### 1. comments - 获取视频评论 📝

**功能描述**:
通过拦截网络请求获取视频评论数据，支持自动分页滚动加载，无需手动操作即可获取完整评论列表。

**核心特性**:
- ✅ 网络拦截技术，直接获取结构化数据
- ✅ 自动分页滚动，可自定义最大页数
- ✅ 支持评论回复数据
- ✅ 包含用户信息、点赞数、时间戳等完整数据

**使用示例**:
```bash
# 获取视频评论（默认滚动 5 页）
xbrowser --cdp 9221 douyin comments 7123456789012345678

# 获取更多评论（滚动 10 页）
xbrowser --cdp 9221 douyin comments 7123456789012345678 --max-pages 10

# 使用 session 隔离
xbrowser --cdp 9221 --session task1 douyin comments 7123456789012345678
```

**返回数据结构**:
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

---

### 2. user-comments - 获取用户评论 💬

**功能描述**:
获取指定用户发布的评论数据，可用于分析用户的互动行为和参与度。

**核心特性**:
- ✅ 支持批量获取用户所有评论
- ✅ 包含评论所属视频信息
- ✅ 提供完整的互动数据（点赞、回复）

**使用示例**:
```bash
# 获取用户评论
xbrowser --cdp 9221 douyin user-comments 1234567890123456

# 获取更多评论
xbrowser --cdp 9221 douyin user-comments 1234567890123456 --max-pages 10
```

**返回数据结构**:
```json
{
  "total": 50,
  "comments": [
    {
      "id": "7123456789012345678",
      "text": "评论内容",
      "user": {
        "uid": "1234567890123456",
        "nickname": "用户昵称"
      },
      "video": {
        "awemeId": "7123456789012345678",
        "desc": "视频描述"
      },
      "diggCount": 10,
      "replyCount": 2
    }
  ]
}
```

---

### 3. video-stats - 获取单个作品数据 📊

**功能描述**:
获取单个视频的完整统计数据，包括播放量、点赞数、评论数等核心指标。

**核心特性**:
- ✅ 完整的视频元数据（标题、作者、时长）
- ✅ 详细的统计数据（播放、点赞、评论、分享、收藏）
- ✅ 多码率播放地址
- ✅ 视频分辨率和封面图

**使用示例**:
```bash
# 获取视频统计
xbrowser --cdp 9221 douyin video-stats 7123456789012345678
```

**返回数据结构**:
```json
{
  "awemeId": "7123456789012345678",
  "desc": "视频描述",
  "createTime": 1715328000000,
  "author": {
    "uid": "1234567890123456",
    "nickname": "作者昵称"
  },
  "video": {
    "playUrl": "https://...",
    "cover": "https://...",
    "width": 1080,
    "height": 1920,
    "duration": 15000,
    "bitRates": [
      {
        "gearName": "原画",
        "qualityType": 0,
        "playAddr": "https://...",
        "size": 5242880
      }
    ]
  },
  "statistics": {
    "diggCount": 10000,
    "commentCount": 500,
    "shareCount": 200,
    "collectCount": 300,
    "playCount": 100000
  }
}
```

---

## 优化与改进

### 性能优化
- **数据解析优化**: 提升了 DOM 解析和数据提取的准确性
- **网络拦截优化**: 改进了网络请求监听逻辑，减少失败率
- **内存管理**: 优化了滚动加载时的内存占用

### 用户体验优化
- **错误提示**: 新增 CDP 连接检查和友好的错误提示
- **Session 隔离**: 支持独立的 session，避免并发任务数据串扰
- **参数验证**: 增强了输入参数的验证和错误处理

### 文档改进
- **完整 README**: 新增详细的使用文档和常见问题解答
- **数据结构说明**: 提供了所有返回数据的完整结构定义
- **测试覆盖**: 新增 42 个测试用例，覆盖所有核心功能

---

## 已知问题

### 当前版本已知限制

1. **登录态依赖**
   - 部分数据（如评论）需要登录态才能获取
   - **影响范围**: `comments`、`user-comments` 命令
   - **解决方案**: 确保在 Chrome 浏览器中已登录抖音账号

2. **反爬限制**
   - 频繁请求可能导致 IP 被临时限制
   - **影响范围**: 所有命令
   - **解决方案**: 控制请求频率，避免短时间内大量请求

3. **滚动加载限制**
   - 大量数据采集时可能需要较长时间
   - **影响范围**: `comments`、`user-comments`、`videos` 命令
   - **解决方案**: 适当调整 `maxPages` 参数

### 计划修复的问题

- [ ] 支持代理配置，绕过 IP 限制
- [ ] 增加断点续传功能
- [ ] 优化滚动速度，减少采集时间
- [ ] 支持数据导出（CSV、JSON、Excel）

---

## 升级指南

### 从 1.0.0 升级到 2.0.0

#### 升级前准备

1. **备份数据**（如有重要数据，请先备份）
2. **检查 Chrome 版本**（推荐使用最新版 Chrome）
3. **确认 CDP 端口**（默认端口 9221）

#### 升级步骤

1. **更新插件**
   ```bash
   # 如果使用全局安装
   npm update -g xbrowser-plugin-douyin

   # 如果是项目依赖
   npm update xbrowser-plugin-douyin
   ```

2. **验证安装**
   ```bash
   xbrowser douyin --help
   ```

3. **测试新功能**
   ```bash
   # 测试 comments 命令
   xbrowser --cdp 9221 douyin comments <aweme_id>

   # 测试 user-comments 命令
   xbrowser --cdp 9221 douyin user-comments <uid>

   # 测试 video-stats 命令
   xbrowser --cdp 9221 douyin video-stats <aweme_id>
   ```

#### 破坏性变更

**无破坏性变更**，所有 1.0.0 版本的命令保持完全兼容。

#### 弃用警告

**无弃用功能**。

#### 迁移建议

- **新增功能**: 推荐使用新的 `comments`、`user-comments`、`video-stats` 命令替代旧的手动数据采集方式
- **Session 隔离**: 建议在并发任务中使用 `--session` 参数，避免数据冲突

---

## 测试报告

### 测试覆盖

- **总测试用例**: 42 个
- **通过率**: 100%
- **功能测试**: ✅ 通过
- **集成测试**: ✅ 通过
- **错误处理测试**: ✅ 通过

### 测试环境

- **操作系统**: macOS / Linux / Windows
- **Chrome 版本**: 120+
- **Node.js 版本**: 18+

---

## 贡献者

感谢以下贡献者对本版本的支持：

- **核心开发**: 开发团队
- **测试反馈**: 测试团队
- **文档编写**: 文档团队

---

## 下一步计划

### v2.1.0 计划

- [ ] 支持代理配置
- [ ] 增加断点续传功能
- [ ] 支持数据导出（CSV、Excel）
- [ ] 增加批量采集模式

### v2.2.0 计划

- [ ] 支持多账号管理
- [ ] 增加数据可视化面板
- [ ] 支持定时任务
- [ ] 增加数据去重功能

---

## 反馈与支持

如果您在使用过程中遇到任何问题，或有任何建议，欢迎通过以下方式联系我们：

- **GitHub Issues**: [提交问题](https://github.com/your-org/xbrowser/issues)
- **文档**: [完整文档](https://github.com/your-org/xbrowser/blob/main/.xcli/plugins/douyin/README.md)
- **邮箱**: support@example.com

---

## 许可证

本插件采用 MIT 许可证，详见 [LICENSE](./LICENSE) 文件。
