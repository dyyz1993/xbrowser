# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-05-10

### Added
- 新增 `comments` 命令：获取视频评论（支持网络拦截和分页滚动）
- 新增 `user-comments` 命令：获取用户评论
- 新增 `video-stats` 命令：获取单个作品的完整统计数据
- 新增 CDP 连接检查和友好错误提示
- 新增 Session 隔离支持，避免并发任务数据串扰

### Changed
- 优化 `videos` 命令，增强数据解析能力
- 优化 `profile` 命令，提高数据提取准确性
- 优化 `detail` 命令，改进 DOM 解析逻辑

### Fixed
- 修复网络请求监听失败导致的命令中断问题
- 修复滚动加载时数据重复的问题

### Documentation
- 新增完整的 README.md 文档
- 新增 42 个测试用例，覆盖所有功能
- 新增 API 文档和数据结构说明

## [1.0.0] - Initial Release
- 初始版本，包含 videos、profile、detail 三个命令
