# 多平台推广发帖流程汇总

> 最后更新：2026-05-27 | 来源：SEO 推广 Phase 1-3 执行经验

## 摘要
各平台发帖推广的完整流程、登录检测方法、编辑器类型、发布步骤。

## 通用流程

### 1. 登录态检测（每个平台必须先检查）
```bash
agent-browser --cdp 9221 --session <name> snapshot -i -s body
```
检查是否存在登录按钮（"Log in"、"登录"、"Sign in"），如果存在则未登录。

### 2. 未登录时的处理
```bash
# 获取 viewer URL，让用户手动登录
agent-browser --cdp 9221 --session <name> viewer --json
# 返回 viewer URL 给用户，等待用户确认
```

### 3. 发布后验证
```bash
# 检查 URL 是否跳转到文章页面
agent-browser --cdp 9221 --session <name> get url
```

---

## 平台详情

### Dev.to ✅ 已成功发布
| 项目 | 值 |
|------|-----|
| 编辑器类型 | Markdown |
| 写文章 URL | https://dev.to/new |
| 登录标志 | "What's on your mind?" 文本框、Notifications 链接 |
| 未登录标志 | "Log in" 链接在顶部 |
| 标签数量 | 最多 4 个 |
| Session 名 | devto |
| 语言 | 英文 |

### Medium ❌ 发布失败（卡在 Publish）
| 项目 | 值 |
|------|-----|
| 编辑器类型 | 所见即所得（富文本） |
| 写文章 URL | https://medium.com/new-story |
| 登录标志 | Write 链接、Notifications 链接、Profile 链接 |
| 未登录标志 | "Sign in" 按钮 |
| Session 名 | medium |
| 语言 | 英文 |
| 踩坑 | Publish 按钮点击后页面未跳转，可能需要先 "Ready to publish" → 选择标签 → 确认 |

### Hashnode ❌ 账号被暂停
| 项目 | 值 |
|------|-----|
| 编辑器类型 | Markdown |
| 写文章 URL | https://hashnode.com/new |
| 登录标志 | Write 链接、Notifications 链接 |
| Session 名 | default |
| 语言 | 英文 |
| 踩坑 | 账号显示 "Account suspended"，需要手动恢复 |

### CSDN ⏳ 需要登录
| 项目 | 值 |
|------|-----|
| 编辑器类型 | 富文本编辑器 |
| 写文章 URL | https://mp.csdn.net/mp_blog/creation/editor |
| 登录标志 | 无 "登录" 按钮、有 "写文章" 入口 |
| 未登录标志 | 顶部显示 "登录" 按钮 |
| Session 名 | csdn |
| 语言 | 中文 |

### 掘金 ⏳ 需要登录
| 项目 | 值 |
|------|-----|
| 编辑器类型 | Markdown |
| 写文章 URL | https://juejin.cn/editor/draft/new |
| 登录标志 | "创作者中心" 按钮 |
| 未登录标志 | "登录 注册" 按钮 |
| Session 名 | juejin |
| 语言 | 中文 |

### Quora ⏳ 子任务超时
| 项目 | 值 |
|------|-----|
| 操作方式 | 回答相关问题（不是发帖） |
| 搜索 URL | https://www.quora.com/search?q=browser+automation+tools |
| 登录标志 | "Add question" 按钮 |
| Session 名 | quora |
| 语言 | 英文 |
| 策略 | 搜索相关问题 → 自然地回答并提及产品 |

---

## 可沉淀为 CLI 命令

```bash
# 理想的 CLI 接口
xbrowser promo devto --file article.md --tags "browser,cli,ai"
xbrowser promo medium --file article.md --publication "Towards Data Science"
xbrowser promo csdn --file article-cn.md --tags "浏览器自动化,开发工具"
xbrowser promo juejin --file article-cn.md --tags "前端,开发工具"
xbrowser promo quora --search "browser automation" --answer-with article.md
```

## 变更记录
- 2026-05-27：初始创建（多平台推广执行经验汇总）
