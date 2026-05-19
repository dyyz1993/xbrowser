# AI 搜索引擎 GEO 平台 Spec

> 最后更新：2026-05-19 | 来源：CDP 9221 登录态实际探索

## 摘要

国内 12 + 国际 4 个 AI 搜索引擎的完整能力矩阵。用于 GEO（Generative Engine Optimization）策略和 `xbrowser ai-search` 命令的引擎支持。

---

## 总览

| # | 引擎 | key | 厂商 | URL | 登录态 | 输入框 | 联网搜索 | 图片上传 | 文件上传 |
|---|------|-----|------|-----|--------|--------|----------|----------|----------|
| 1 | DeepSeek | `deepseek` | 深度求索 | chat.deepseek.com | ✅ 已登录 | textarea | 🔘 有开关 | ✅ | ✅ |
| 2 | 豆包 | `doubao` | 字节跳动 | doubao.com/chat/ | ✅ 已登录 | textarea | 🔘 有开关 | ❓ | ❓ |
| 3 | Kimi | `kimi` | 月之暗面 | kimi.com | ✅ 已登录 | contenteditable | 🔘 有开关 | ❓ | ❓ |
| 4 | 通义千问 | `qianwen` | 阿里 | qianwen.com | ✅ 已登录 | contenteditable | 🔘 有开关 | ✅ | ✅ |
| 5 | 腾讯元宝 | `yuanbao` | 腾讯 | yuanbao.tencent.com/chat/ | ✅ 已登录 | contenteditable | 🔘 有开关 | ❓ | ❓ |
| 6 | 智谱清言 | `chatglm` | 智谱 | chatglm.cn | ✅ 已登录 | textarea | 🔘 有开关(联网) | ❓ | ✅ |
| 7 | 文心一言 | `yiyan` | 百度 | yiyan.baidu.com | ✅ 已登录 | contenteditable | 🔘 有开关 | ❓ | ❓ |
| 8 | 秘塔AI搜索 | `metaso` | 秘塔 | metaso.cn | ✅ 已登录 | textarea | 🔧 默认联网 | ✅ | ✅ |
| 9 | 天工AI | `tiangong` | 昆仑万维 | tiangong.cn | ✅ 已登录 | contenteditable | 🔘 有开关 | ✅ | ❓ |
| 10 | 讯飞星火 | `xinghuo` | 科大讯飞 | xinghuo.xfyun.cn | ⚠️ 需验证 | ❓(SPA) | 🔘 有开关 | ❓ | ❓ |
| 11 | 海螺AI | `hailuo` | MiniMax | hailuoai.com | ⚠️ 需验证 | contenteditable | 🔘 有开关 | ✅ | ✅ |
| 12 | 纳米AI(360) | `360ai` | 360 | n.cn | ✅ 已登录 | contenteditable | 🔧 默认联网 | ❓ | ✅ |
| 13 | Perplexity | `perplexity` | Perplexity | perplexity.ai | 🔒 CF验证 | ❓ | 🔧 默认联网 | ❓ | ❓ |
| 14 | Google Gemini | `gemini` | Google | gemini.google.com | ❌ 未登录 | ❓ | 🔧 默认联网 | ❓ | ❓ |
| 15 | MS Copilot | `copilot` | Microsoft | copilot.microsoft.com | ❌ 未登录 | textarea | 🔧 默认联网 | ❓ | ✅ |
| 16 | Grok | `grok` | xAI | grok.com | 🔒 CF验证 | ❓ | 🔘 有开关 | ❓ | ❓ |

---

## 详细 Spec（国内平台）

### 1. DeepSeek

| 属性 | 值 |
|------|-----|
| **URL** | `https://chat.deepseek.com` |
| **Title** | DeepSeek - 探索未至之境 |
| **输入框类型** | `textarea` |
| **输入选择器** | `textarea._27c9245` / `textarea` |
| **Placeholder** | "给 DeepSeek 发送消息" |
| **联网搜索** | 有（深度思考模式自动触发联网） |
| **图片上传** | ✅ 支持（图片内容询问按钮） |
| **文件上传** | ✅ 支持（.pdf,.png,.jpg,.doc,.docx 等 300+ 格式） |
| **登录态检测** | ✅ |
| **已登录指标** | 页面有历史对话列表 |
| **未登录指标** | URL 跳转 `/sign_in`，有"登录"按钮 |
| **发送方式** | Enter |
| **备注** | 已在 ai-search 中支持 |

### 2. 豆包

| 属性 | 值 |
|------|-----|
| **URL** | `https://www.doubao.com/chat/` |
| **Title** | 豆包 - 字节跳动旗下 AI 智能助手 |
| **输入框类型** | `textarea` |
| **输入选择器** | `textarea.semi-input-textarea` / `textarea` |
| **Placeholder** | "发消息..." |
| **联网搜索** | 有（豆包搜索模式） |
| **图片上传** | ❓ 需登录态进一步确认 |
| **文件上传** | ❓ 需登录态进一步确认 |
| **登录态检测** | ⚠️ 未明确检测到（页面直接可用） |
| **已登录指标** | 历史对话列表可见 |
| **未登录指标** | 可能弹出登录弹窗 |
| **发送方式** | Enter |
| **备注** | 已在 ai-search 中支持。SPA 渲染，需等待 |

### 3. Kimi

| 属性 | 值 |
|------|-----|
| **URL** | `https://kimi.moonshot.cn` → 跳转 `https://www.kimi.com/` |
| **Title** | Kimi AI 官网 - K2.6 上线 |
| **输入框类型** | `contenteditable` / `role=textarea` |
| **输入选择器** | `[contenteditable="true"]` |
| **Placeholder** | "尽管问..." |
| **联网搜索** | 有（默认联网） |
| **图片上传** | ❓ 需进入对话页确认 |
| **文件上传** | ❓ 需进入对话页确认 |
| **登录态检测** | ✅ 明确 |
| **已登录指标** | `DIV.user-info-container` + `IMG.user-avatar[src^=https://avatar.moonshot.cn]` |
| **未登录指标** | `DIV.not-login-container` + `SPAN[text="登录"]` |
| **发送方式** | Enter |
| **备注** | 首页和对话页不同。首页是营销页，需点进对话。注意域名重定向 moonshot.cn → kimi.com |

### 4. 通义千问

| 属性 | 值 |
|------|-----|
| **URL** | `https://tongyi.aliyun.com/qianwen` → `https://www.qianwen.com/` |
| **Title** | 千问-阿里 AI 助手 |
| **输入框类型** | `contenteditable` / `role=textarea` |
| **输入选择器** | `[contenteditable="true"]` |
| **Placeholder** | "向千问提问" |
| **联网搜索** | 有（联网搜索开关） |
| **图片上传** | ✅ 支持（image/*） |
| **文件上传** | ✅ 支持（.pdf,.doc,.docx,.md,.xlsx 等 100+ 格式） |
| **登录态检测** | ✅ 已登录（SPA 内容验证） |
| **已登录指标** | 有"新建对话"和历史对话列表 |
| **未登录指标** | 无明确检测 |
| **发送方式** | Enter / 发送按钮 `BUTTON.inline-flex` |
| **备注** | 阿里系，需淘宝/支付宝账号登录。URL 重定向 tongyi → qianwen |

### 5. 腾讯元宝

| 属性 | 值 |
|------|-----|
| **URL** | `https://yuanbao.tencent.com/chat/` |
| **Title** | 元宝-腾讯旗下全能AI助手 |
| **输入框类型** | `contenteditable` |
| **输入选择器** | `[contenteditable="true"]` |
| **Placeholder** | "有问题，尽管问，shift+enter换行" |
| **联网搜索** | ✅ 有"搜索"切换按钮 |
| **联网选择器** | `DIV.yb-common-nav__tool` (text="搜索") |
| **图片上传** | ❓ 有附件样式元素，需进一步确认 |
| **文件上传** | ❓ 需确认 |
| **登录态检测** | ✅ 明确 |
| **已登录指标** | `DIV.yb-common-nav__ft__avatar` + `P.nick-info-name` |
| **未登录指标** | 无明确 |
| **发送方式** | Enter |
| **备注** | 腾讯系，微信/QQ 登录。有独立的"搜索"模式 |

### 6. 智谱清言

| 属性 | 值 |
|------|-----|
| **URL** | `https://chatglm.cn` → `https://chatglm.cn/main/alltoolsdetail?lang=zh` |
| **Title** | 智谱清言 |
| **输入框类型** | `textarea` |
| **输入选择器** | `textarea.scroll-display-none` |
| **Placeholder** | ❓ 未捕获到 |
| **联网搜索** | ✅ 有"联网"切换按钮 |
| **联网选择器** | `DIV.mode-button` (text="联网") |
| **图片上传** | ❓ 有上传容器元素 |
| **文件上传** | ✅ 支持（.wbmp,.gif,.jpeg,.png,.jpg,.webp + .jpg,.jpeg,.png,.bmp,.tif,.tiff,.webp,.svg） |
| **登录态检测** | ✅ 有 `DIV.userInfoBar` |
| **已登录指标** | `DIV.userInfoBar` |
| **未登录指标** | 未检测到 |
| **发送方式** | Enter |
| **备注** | 有多种模式：思考/联网/Agent/研究/PPT/数据分析 |

### 7. 文心一言

| 属性 | 值 |
|------|-----|
| **URL** | `https://yiyan.baidu.com` |
| **Title** | 文心一言 |
| **输入框类型** | `contenteditable` / `role=textarea` |
| **输入选择器** | `[contenteditable="true"]` |
| **Placeholder** | "深度分析需求并解答，你需要什么帮助？" |
| **联网搜索** | 有（默认联网） |
| **图片上传** | ❓ 有上传图标元素 `DIV.uploadDropdownIconWrapper` |
| **文件上传** | ❓ 需确认 |
| **登录态检测** | ✅ 明确（双重指标） |
| **已登录指标** | `DIV.avatar__jsWTuLHM` |
| **未登录指标** | `BUTTON.ebButton__Td1lJFbI[text="登录"]` + `DIV.topFixedArea__CEAf6zVo[text="登录"]` |
| **发送方式** | Enter |
| **备注** | 百度系。当前模型：文心 5.1。有"思考"模式 |

### 8. 秘塔AI搜索

| 属性 | 值 |
|------|-----|
| **URL** | `https://metaso.cn` |
| **Title** | 秘塔AI搜索 |
| **输入框类型** | `textarea` |
| **输入选择器** | `textarea.search-consult-textarea` |
| **Placeholder** | "请输入，Enter键发送，Shift+Enter键换行，"/"打开自定义技能" |
| **联网搜索** | 🔧 默认联网（搜索优先型） |
| **图片上传** | ✅ 支持（粘贴图片 Ctrl+V） |
| **文件上传** | ✅ 支持（上传文件按钮，image/bmp,png,jpeg,gif,webp） |
| **登录态检测** | ✅ 明确 |
| **已登录指标** | `IMG.MuiAvatar-img[src^=https://uranus-static]` |
| **未登录指标** | 无头像 |
| **发送方式** | Enter / 发送按钮 `BUTTON.MuiButtonBase-root` |
| **备注** | **搜索优先型**，无需特殊 prompt，直接输入查询即可。有：全网/互动网页/简洁/深入/深度研究 模式 |

### 9. 天工AI

| 属性 | 值 |
|------|-----|
| **URL** | `https://www.tiangong.cn` |
| **Title** | 首页 |
| **输入框类型** | `contenteditable` |
| **输入选择器** | `[contenteditable="true"]` |
| **Placeholder** | ❓ 未捕获 |
| **联网搜索** | 有 |
| **图片上传** | ✅ 有"图片"技能按钮 `BUTTON.quick-skill-button` |
| **文件上传** | ❓ 需确认 |
| **登录态检测** | ✅ 明确 |
| **已登录指标** | `IMG.general-hero__avatar[src^=https://static-s3.skyworkcdn.com]` |
| **未登录指标** | `DIV.login-btn[text="登录"]` / `DIV.login-btn[text="注册"]` |
| **发送方式** | Enter |
| **备注** | 有超级智能体 2，SkyClaw 全能助手。首页是项目列表，需进入对话页 |

### 10. 讯飞星火

| 属性 | 值 |
|------|-----|
| **URL** | `https://xinghuo.xfyun.cn` |
| **Title** | 讯飞星火-懂我的AI助手 |
| **输入框类型** | ❓ 未检测到（SPA 较重，可能需要更长的等待） |
| **输入选择器** | ❓ 需进一步探索 |
| **Placeholder** | "开始对话"（从 KeyText 推断） |
| **联网搜索** | 有（星火AI搜索功能） |
| **图片上传** | ❓ 需确认 |
| **文件上传** | ❓ 需确认 |
| **登录态检测** | ⚠️ 有 `DIV.ant-dropdown-trigger`（可能是用户菜单） |
| **已登录指标** | `DIV.ant-dropdown-trigger` |
| **未登录指标** | `DIV.header_login_btn__JSZrf[text="登录"]` |
| **发送方式** | Enter |
| **备注** | SPA 较重，首页是营销页。需点击"开始对话"进入聊天。可能需要更长等待时间 |

### 11. 海螺AI

| 属性 | 值 |
|------|-----|
| **URL** | `https://hailuoai.com` |
| **Title** | 海螺视频：每个想法都是一部大片 |
| **输入框类型** | `contenteditable` / `role=textarea` |
| **输入选择器** | `[contenteditable]#video-create-textarea` |
| **Placeholder** | ❓ 未捕获（视频创作页） |
| **联网搜索** | ❓ 可能不支持（聚焦视频创作） |
| **图片上传** | ✅ 支持（.jpg,.jpeg,.png,.gif,.bmp,.webp） |
| **文件上传** | ✅ 支持（.jpg,.jpeg,.png,.webp） |
| **登录态检测** | ⚠️ 未明确 |
| **已登录指标** | ❓ |
| **未登录指标** | `DIV[text="登录"]` |
| **发送方式** | Enter |
| **备注** | 首页是视频创作工具。需找到聊天入口。可能不是传统 AI 搜索引擎 |

### 12. 纳米AI（原360AI搜索）

| 属性 | 值 |
|------|-----|
| **URL** | `https://www.n.cn` |
| **Title** | 纳米AI - 首页 |
| **输入框类型** | `contenteditable` / `role=textarea` |
| **输入选择器** | `[contenteditable="true"]` |
| **Placeholder** | "输入任何问题" |
| **联网搜索** | 🔧 默认联网（搜索优先型） |
| **图片上传** | ❓ 需确认 |
| **文件上传** | ✅ 支持（.png,.jpg,.jpeg,.webp + .txt,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.md,.csv,.zip 等） |
| **登录态检测** | ✅ 明确 |
| **已登录指标** | `IMG.avatar-title-icon[src^=https://qcdn]` |
| **未登录指标** | ❓ |
| **发送方式** | Enter / 发送按钮 `BUTTON.send-btn` |
| **备注** | **搜索优先型**。有深度思考、AI写作、智能体等功能。原 360AI搜索更名为纳米AI |

---

## 国际平台（待补充详细 Spec）

| # | 引擎 | key | URL | 状态 | 备注 |
|---|------|-----|-----|------|------|
| 13 | Perplexity | `perplexity` | perplexity.ai | 🔒 CF验证 | 搜索优先型，默认联网 |
| 14 | Google Gemini | `gemini` | gemini.google.com | ❌ 未登录 | 默认联网 |
| 15 | MS Copilot | `copilot` | copilot.microsoft.com | ❌ 未登录 | 默认联网，textarea 输入 |
| 16 | Grok | `grok` | grok.com | 🔒 CF验证 | xAI 出品 |

---

## 联网搜索分类

| 类型 | 引擎 | 说明 |
|------|------|------|
| **🔧 默认联网** | 秘塔、纳米AI、Perplexity、Copilot、Gemini | 搜索优先型，直接输入查询 |
| **🔘 有开关** | DeepSeek、豆包、Kimi、通义千问、元宝、智谱、文心、天工、讯飞、Grok | 需要开启联网搜索 |
| **❓ 待确认** | 海螺AI | 聚焦视频创作，可能不支持 |

## 图片/附件能力汇总

| 引擎 | 图片上传 | 文件上传 | 说明 |
|------|----------|----------|------|
| DeepSeek | ✅ | ✅ | 300+ 文件格式 |
| 豆包 | ❓ | ❓ | 需确认 |
| Kimi | ❓ | ❓ | 需确认 |
| 通义千问 | ✅ | ✅ | 100+ 格式 |
| 元宝 | ❓ | ❓ | 有附件 UI |
| 智谱清言 | ❓ | ✅ | 图片相关格式 |
| 文心一言 | ❓ | ❓ | 有上传图标 |
| 秘塔 | ✅ | ✅ | 支持粘贴图片 |
| 天工 | ✅ | ❓ | 图片技能按钮 |
| 讯飞星火 | ❓ | ❓ | 需确认 |
| 海螺AI | ✅ | ✅ | 聚焦图片/视频 |
| 纳米AI | ❓ | ✅ | 支持多种文档格式 |

---

## 登录态检测选择器汇总

| 引擎 | 已登录选择器 | 未登录选择器 |
|------|-------------|-------------|
| DeepSeek | 历史对话列表存在 | URL 包含 `/sign_in` |
| 豆包 | 历史对话列表存在 | 可能弹登录弹窗 |
| Kimi | `.user-avatar[src*="avatar.moonshot"]` | `.not-login-container` |
| 通义千问 | 历史对话列表存在 | 未检测到 |
| 元宝 | `.yb-common-nav__ft__avatar` | 未检测到 |
| 智谱 | `.userInfoBar` | 未检测到 |
| 文心 | `.avatar__jsWTuLHM` | `.ebButton__Td1lJFbI` (登录按钮) |
| 秘塔 | `.MuiAvatar-img[src*="uranus"]` | 无头像 |
| 天工 | `.general-hero__avatar` | `.login-btn` |
| 讯飞 | `.ant-dropdown-trigger` | `.header_login_btn__JSZrf` |
| 海螺 | ❓ 待确认 | `DIV[text="登录"]` |
| 纳米AI | `.avatar-title-icon[src*="qcdn"]` | ❓ |

---

## 实现优先级

### P0（必须先做 - 国内 Top 5）
1. **DeepSeek** - 已支持 ✅
2. **豆包** - 已支持 ✅
3. **Kimi** - 未支持 ❌
4. **通义千问** - 未支持 ❌
5. **元宝** - 未支持 ❌

### P1（国内二线）
6. **智谱清言** - 未支持 ❌
7. **文心一言** - 未支持 ❌
8. **秘塔AI搜索** - 未支持 ❌

### P2（三线 / 特殊）
9. **天工AI** - 未支持 ❌
10. **讯飞星火** - 未支持 ❌ (SPA 重)
11. **海螺AI** - 未支持 ❌ (非典型搜索)
12. **纳米AI(360)** - 未支持 ❌

---

## 变更记录
- 2026-05-19：初始创建（CDP 9221 实际探索 12 个国内平台）
