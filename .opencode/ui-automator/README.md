# UI Automator 知识库

> 最后更新：2026-05-28

## 摘要
xbrowser 项目 UI 自动化相关知识沉淀，包含 AI 搜索引擎 GEO 平台 spec、网络拦截、评分引擎、推广发帖、反检测、豆包文生图等。

## Specs（规格文档）
| 文件 | 内容 | 最后更新 |
|------|------|----------|
| [specs/ai-search-engines-spec.md](specs/ai-search-engines-spec.md) | AI 搜索引擎 GEO 平台完整能力矩阵（12国内+4国际） | 2026-05-19 |

## 选择器库
| 文件 | 站点 | 最后更新 |
|------|------|----------|
| [selectors/doubao.md](selectors/doubao.md) | 豆包 (doubao.com) 文生图选择器 + URL 格式 | 2026-05-28 |

## 复用模式
| 文件 | 模式 | 最后更新 |
|------|------|----------|
| [patterns/network-interceptor.md](patterns/network-interceptor.md) | Daemon 级网络拦截 + 评分 + 关联 | 2026-05-14 |
| [patterns/anti-bot-detection.md](patterns/anti-bot-detection.md) | 反机器人主动检测（验证码/警告/阻断/webdriver） | 2026-05-27 |

## 踩坑记录
| 文件 | 问题 | 最后更新 |
|------|------|----------|
| [troubleshooting/doubao-image-bugs.md](troubleshooting/doubao-image-bugs.md) | 豆包文生图 4 个 bug（输入/选择器/历史图/高清下载） | 2026-05-28 |
| [troubleshooting/csdn-cloudflare.md](troubleshooting/csdn-cloudflare.md) | CSDN 编辑器被 Cloudflare bot 检测拦截 | 2026-05-27 |
| [troubleshooting/juejin-captcha.md](troubleshooting/juejin-captcha.md) | 掘金登录滑块验证码 | 2026-05-27 |
| [troubleshooting/cdp-session-loss.md](troubleshooting/cdp-session-loss.md) | cdp-tunnel 重启后登录态丢失 | 2026-05-27 |

## 插件开发笔记
| 文件 | 站点 | 最后更新 |
|------|------|----------|
| [plugins/doubao.md](plugins/doubao.md) | 豆包插件 20 个命令 + 文生图流程 + 高清下载 | 2026-05-28 |
| [plugins/devto-promotion.md](plugins/devto-promotion.md) | Dev.to 发帖推广流程（✅ 成功） | 2026-05-27 |
| [plugins/platform-promotion-guide.md](plugins/platform-promotion-guide.md) | 多平台推广发帖流程汇总（Dev.to/Medium/Hashnode/CSDN/掘金/Quora） | 2026-05-27 |

## 变更记录
- 2026-05-28：新增豆包插件沉淀（选择器 + 开发笔记 + 4 个 bug 踩坑记录）
- 2026-05-27：新增推广发帖沉淀（Dev.to/Medium/Hashnode/CSDN/掘金/Quora）+ 反检测模式
- 2026-05-19：新增 AI 搜索引擎 GEO 平台 spec（CDP 9221 实际探索 12 个国内平台）
- 2026-05-14：初始创建（网络拦截器知识沉淀）
