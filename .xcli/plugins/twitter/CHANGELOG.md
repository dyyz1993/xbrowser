# Changelog

## [2.0.0] - 2026-05-10

### Added
- 新增 `timeline-advanced` 命令：高级时间线功能，针对高影响力账号优化
- 新增 `tweets` 命令：获取单条推文详情
- 新增 `replies` 命令：获取推文回复
- 新增多级选择器策略，提高抓取稳定性
- 新增动态等待机制，优化性能
- 新增人类行为模拟，降低被检测风险
- 新增高影响力账号自动识别（elonmusk, realDonaldTrump）
- 新增 CDP 连接检查和友好错误提示
- 新增 Session 隔离支持

### Changed
- 优化 `search` 命令，增强数据解析能力和错误处理
- 优化 `profile` 命令，提高用户资料提取准确性
- 优化 `timeline` 命令，改进滚动加载和去重逻辑

### Fixed
- 修复 DOM 选择器脆弱导致的问题
- 修复高影响力用户名大小写匹配问题
- 修复网络请求监听失败导致的命令中断

### Documentation
- 新增完整的 README.md 文档
- 新增 54 个测试用例，覆盖所有功能
- 新增高影响力账号优化说明

## [1.0.0] - Initial Release

- 初始版本，包含 search、profile、timeline 三个命令
