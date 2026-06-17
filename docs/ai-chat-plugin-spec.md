# SPEC: AI 聊天插件统一模型

> 目标：所有 AI 聊天站点共享一套通用 engine，每个站点只需写一份**配置**（~20 行），
> 不再手写重复的命令逻辑。改一处 engine，所有站点生效。

## 1. 设计原则

- **配置驱动**：一个站点 = 一份 `AIChatSiteConfig`
- **能力开关**：config 里声明支持哪些能力（think/search/image/music/...），engine 自动注册对应命令
- **渐进迁移**：先抽共享函数（不破坏现有插件），再逐个迁移到 config 模式
- **selector 参数化**：所有 selector 在 config 里声明，不散落在代码里

## 2. 站点配置模型（AIChatSiteConfig）

```typescript
interface AIChatSiteConfig {
  // ── 基本信息 ──
  name: string;                    // 'deepseek'
  url: string;                     // 'https://chat.deepseek.com'
  description: string;
  requiresLogin: boolean;

  // ── 登录检测 ──
  login: {
    loggedInSelectors?: string[];  // ['#prompt-textarea']
    loggedOutTextPatterns?: string[][]; // [['登录','注册']] — body 同时含这些词 = 未登录
    loggedInTextPatterns?: string[];    // ['深度思考'] — body 含任一 = 已登录
  };

  // ── 输入框 ──
  input: {
    selector: string;              // 'textarea[name="search"]'
    type: 'textarea' | 'contenteditable';  // editor 类型决定输入方式
  };

  // ── 发送 ──
  send: {
    method: 'enter' | 'click';    // 'enter' = keyboard.press Enter; 'click' = click 发送按钮
    buttonSelector?: string;       // method='click' 时必填
    typeDelay: number;             // keyboard.type 的 delay（ms），默认 10
  };

  // ── 附件上传 ──
  attach: {
    method: 'setInputFiles' | 'pasteFiles' | 'triggerButton';
    fileInputSelector?: string;    // method='setInputFiles' 时
    editorSelector?: string;       // method='pasteFiles' 时
    triggerButtonCoord?: 'leftOfInput'; // method='triggerButton' 时（先点触发按钮挂载 file input）
    waitLoadingSelector?: string;  // 上传后等此元素消失（如 '.ds-loading'）
  };

  // ── 历史列表 ──
  history: {
    linkSelector: string;          // 'a[href*="/a/chat/s/"]'
    openMethod: 'click' | 'goto';  // click = 点链接让 SPA 路由; goto = 直接导航
  };

  // ── 回复提取 ──
  reply: {
    selectors: string[];           // 按优先级：['[class*="ds-markdown"]', '[class*="message"]']
    excludeUserMessage: boolean;   // 排除用户消息气泡
    generatingIndicators: string[];// ['停止生成', '思考中', '正在搜索'] — body 含这些词 = 还在生成，跳过本轮
    pollInterval: number;          // 轮询间隔 ms，默认 1500
    pollTimeout: number;           // 轮询超时 ms，默认 60000
    smartFallback: boolean;        // 超时后是否用 smartExtractReply 兜底
  };

  // ── 能力开关（决定注册哪些命令/参数）──
  features: {
    think?: { toggleSelector: string; toggleText: string };
    search?: { toggleSelector: string; toggleText: string; sourceExtractor?: (page: Page) => Promise<SourceInfo[]> };
    image?: { prompt: string; resultSelector: string };     // 文生图
    music?: { panelSelector: string; lyricSelector: string; resultUrlPattern: string };
    video?: { prompt: string; taskIdSelector: string };
  };
}
```

## 3. 通用 Engine 注册的命令

engine 根据 config 自动注册以下命令（config.features 没声明的就不注册）：

| 命令 | 参数 | 说明 | 条件 |
|------|------|------|------|
| `chat` | message, path, paths, type, think, search, showSources | 发消息+附件+等回复 | 总是注册 |
| `attach` | type, path, paths | 上传附件 | 总是注册 |
| `list` | — | 列历史对话 | 总是注册 |
| `new` | — | 新建对话 | 总是注册 |
| `open` | title | 打开指定对话 | 总是注册 |
| `check-login` | — | 检查登录态 | 总是注册 |
| `image` | prompt, ref | 文生图 | features.image |
| `music` | lyric, timeout | 音乐生成 | features.music |
| `video` | prompt | 视频生成 | features.video |

### `chat --session "标题"` 继续历史对话

你说的"从历史列表定位到某条消息继续聊"：
```bash
xbrowser deepseek chat "继续之前的话题" --session "关于 React 的讨论"
```
engine 逻辑：`open(标题) → 等页面加载 → chat(消息)`。如果 `--session` 传的是标题，先 open 再 chat。

## 4. 5 个站点的配置预览

### deepseek
```typescript
{
  name: 'deepseek', url: 'https://chat.deepseek.com',
  input: { selector: 'textarea[name="search"]', type: 'textarea' },
  send: { method: 'enter', typeDelay: 5 },
  attach: { method: 'setInputFiles', fileInputSelector: 'input[type="file"]', waitLoadingSelector: '.ds-loading' },
  history: { linkSelector: 'a[href*="/a/chat/s/"]', openMethod: 'click' },
  reply: {
    selectors: ['[class*="ds-assistant-message-main-content"]', '[class*="ds-markdown"]'],
    excludeUserMessage: true,
    generatingIndicators: ['停止生成'],
    smartFallback: true,
  },
  features: {
    think: { toggleSelector: '...', toggleText: '深度思考' },
    search: { toggleSelector: '...', toggleText: '联网搜索' },
  },
}
```

### doubao
```typescript
{
  name: 'doubao', url: 'https://www.doubao.com/chat',
  input: { selector: '[contenteditable="true"]', type: 'contenteditable' },
  send: { method: 'click', buttonSelector: '#flow-end-msg-send', typeDelay: 10 },
  attach: { method: 'triggerButton', fileInputSelector: 'input[type="file"]' },
  history: { linkSelector: 'a[href*="/chat/"], a[href*="/c/"]', openMethod: 'click' },
  reply: {
    selectors: ['[class*="md-box-root"]', '[data-target-id="message-box-target-id"]'],
    excludeUserMessage: true,
    generatingIndicators: ['停止生成', '思考中', '生成中', '正在搜索'],
    smartFallback: true,
  },
  features: {
    think: { ... },
    search: { ... },
    image: { prompt: '画图: {prompt}', resultSelector: 'img[src*="rc_gen_image"]' },
    music: { panelSelector: '...', lyricSelector: '...', resultUrlPattern: 'bigmusic/get_video' },
    video: { prompt: '...', taskIdSelector: '[class*="task-id"]' },
  },
}
```

### chatgpt / qianwen / yuanbao
（类似结构，selector 各异）

## 5. 迁移计划（渐进式，不破坏现有插件）

### Phase 1: 抽共享函数（不改插件入口，降低风险）
- [ ] `listConversations(page, linkSelector)` → 替换 5 个插件各自的 list
- [ ] `openByTitle(page, title, linkSelector)` → 替换 5 个插件各自的 open
- [ ] `ensureChatPage(page, ctx, config)` → 统一 ensurePage（走 checkLoginStatus）
- [ ] `sendChatMessage(page, message, config)` → 统一 输入+发送
- [ ] `extractReply(page, config)` → 统一 回复轮询（含 smartFallback）
- [ ] `uploadAttachment(page, files, config)` → 统一 附件（pasteFiles/setInputFiles/triggerButton）

**每个共享函数都带 config 参数，旧插件暂时不传 config 用默认值，逐步迁移。**

### Phase 2: 定义 AIChatSiteConfig + engine
- [ ] 定义 `AIChatSiteConfig` 接口（`shared/ai-chat-config.ts`）
- [ ] 实现 `registerAIChatSite(xcli, config)` engine（`shared/ai-chat-engine.ts`）
- [ ] 写 5 个站点的 config

### Phase 3: 逐个迁移插件
- [ ] deepseek（已有 SEL 常量，最容易迁移）
- [ ] doubao（最复杂，有 image/music/video，最后迁移）
- [ ] chatgpt / qianwen / yuanbao
- [ ] 每个迁移后跑 `xbrowser <site> chat "测试"` 验证

### Phase 4: 补缺失命令
- [ ] gemini 补 attach/check-login（写 config 即可）
- [ ] qwen 补 chat/attach/check-login
- [ ] yuanbao 填充 draw 命令

## 6. 对比：迁移前后

| 维度 | 迁移前 | 迁移后 |
|------|--------|--------|
| 新增站点 | 抄一个插件改 selector（~400 行）| 写 config（~20 行）|
| 改发送方式 | 改 5 个插件 | 改 engine 1 处 |
| 回复提取改版失效 | 5 个插件逐个修 selector | 改 config 1 处 |
| 新增 smartFallback | 逐个接入 | config 里 `smartFallback: true` |
| 缺失命令补齐 | 手写命令 | config.features 声明即自动注册 |

## 7. 文件结构

```
.xcli/plugins/shared/
├── ai-chat-config.ts     # AIChatSiteConfig 接口定义
├── ai-chat-engine.ts     # registerAIChatSite(xcli, config) 通用 engine
├── ai-chat-base.ts       # 现有共享函数（保留，engine 内部调用）
├── smart-extract.ts      # smartExtractReply（已有）
├── paste-files.ts        # pasteFiles（已有）
└── react-click.ts        # reactClick（已有，备查）

.xcli/plugins/<site>/
└── index.ts              # 迁移后：只需 export default + registerAIChatSite(xcli, config)
```

## 8. 验收标准

- [ ] 5 个站点 chat 纯文本全部通过（response 正确）
- [ ] 5 个站点 list 返回格式一致
- [ ] 5 个站点 open 能按标题打开历史对话
- [ ] `chat --session "标题"` 能先 open 再 chat
- [ ] 新增一个站点（如 kimi）只需写 config，不改 engine
- [ ] typecheck + lint + 全部测试通过
