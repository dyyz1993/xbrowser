# CAPTCHA 交互系统设计

## 概述

xbrowser 自动化执行时遇到验证码，暂停并通知用户。用户通过多种方式解决验证码后，自动化继续执行。

## 用户交互流程

### 默认流程（终端）
```
$ xbrowser github publish --title "My Article"

→ Opening https://github.com/login...
→ Filling credentials...
→ Clicking submit...

⚠️  ═══════════════════════════════════════════════════
⚠️  CAPTCHA DETECTED on github.com/login
⚠️  
⚠️  Solve it via:
⚠️    📺 Preview:  http://localhost:9223?session=sess_abc123
⚠️    🌐 Direct:   https://github.com/login
⚠️    ⏭️  Skip     (continue without solving)
⚠️    ❌ Abort    (stop execution)
⚠️  
⚠️  ⏳ Waiting for resolution... (60s timeout)
⚠️  ═══════════════════════════════════════════════════

[User opens preview URL, clicks CAPTCHA]

✅ CAPTCHA solved! Continuing...
→ Navigating to publish page...
→ Article published successfully!
```

### Webhook 通知模式
```
$ xbrowser github publish --notify https://hooks.slack.com/xxx

⚠️  CAPTCHA DETECTED
📧  Notification sent to webhook
📖  Preview: http://localhost:9223?session=sess_abc123
⏳  Waiting for resolution... (no timeout)
```

### 自动打开模式
```
$ xbrowser github publish --auto-open

⚠️  CAPTCHA DETECTED
📖  Opening preview in browser... http://localhost:9223?session=sess_abc123
⏳  Waiting for resolution...
```

## 配置

### 环境变量
```bash
XBROWSER_NOTIFY_URL=https://hooks.slack.com/xxx    # Webhook 通知地址
XBROWSER_AUTO_OPEN=true                              # 自动打开 preview
XBROWSER_CAPTCHA_TIMEOUT=120                          # 超时秒数（0=无限等待）
XBROWSER_PREVIEW_PORT=9223                            # Preview 端口
```

### 配置文件 (~/.xbrowser/config.json)
```json
{
  "captcha": {
    "notifyUrl": "https://hooks.slack.com/services/xxx",
    "autoOpen": false,
    "timeout": 120,
    "strategy": "preview-first"
  },
  "preview": {
    "port": 9223,
    "quality": 90,
    "fps": 4
  }
}
```

## 技术架构

### 组件关系

```
┌──────────────────────────────────────────────────────────────┐
│                        xbrowser CLI                           │
│                                                              │
│  Plugin Handler                                              │
│       ↓                                                      │
│  ctx.waitForHuman({ reason, timeout })                       │
│       ↓                                                      │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │              HumanInteractionManager                    │ │
│  │                                                         │ │
│  │  1. Detect CAPTCHA (iframe/selector heuristics)         │ │
│  │  2. Capture screenshot frame                            │ │
│  │  3. Notify via:                                         │ │
│  │     - Terminal message (always)                         │ │
│  │     - Webhook POST (if configured)                      │ │
│  │     - Auto-open preview (if configured)                 │ │
│  │  4. Start ScreencastCapturer → WSServer → broadcast     │ │
│  │  5. Wait for resolution:                                │ │
│  │     a. Poll page state (CAPTCHA disappeared?)           │ │
│  │     b. Receive WS click/type from preview client        │ │
│  │     c. Timeout → strategy (skip/abort)                  │ │
│  │  6. Resume execution                                    │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌──────────────┐      ┌──────────────┐                      │
│  │Screencast    │─────→│ WSServer     │                      │
│  │Capturer      │      │ (port 9223)  │                      │
│  │(page.screen- │      │              │                      │
│  │ shot loop)   │      │ Inbound:     │                      │
│  └──────────────┘      │ click/x/y    │                      │
│                        │ type/text    │                      │
│                        │ keypress/key │                      │
│                        │ scroll/dx/dy │                      │
│                        │ solved       │                      │
│                        │              │                      │
│                        │ Outbound:    │                      │
│                        │ screenshot   │                      │
│                        │ captcha      │                      │
│                        │ paused       │                      │
│                        │ resolved     │                      │
│                        └──────┬───────┘                      │
│                               │                              │
│                        ┌──────▼───────┐                      │
│                        │ preview.html │                      │
│                        │ (浏览器打开)  │                      │
│                        │              │                      │
│                        │ - 显示 LIVE  │                      │
│                        │   截图画面    │                      │
│                        │ - 捕获鼠标   │                      │
│                        │   点击坐标    │                      │
│                        │ - 转发键盘   │                      │
│                        │   事件       │                      │
│                        │ - 显示验证码 │                      │
│                        │   提示信息   │                      │
│                        └──────────────┘                      │
└──────────────────────────────────────────────────────────────┘
```

### WebSocket 消息协议

#### Outbound (Server → Client)
```typescript
// 截图帧
{ type: 'screenshot', sessionId: string, data: string, url: string, viewport: {width, height} }

// 验证码检测
{ type: 'captcha-detected', sessionId: string, url: string, reason: string, timeout: number }

// 执行暂停
{ type: 'paused', sessionId: string, reason: string }

// 执行恢复
{ type: 'resolved', sessionId: string }

// 命令事件
{ type: 'command', sessionId: string, command: string, status: 'before'|'after', result?: any }
```

#### Inbound (Client → Server)
```typescript
// 鼠标点击
{ type: 'click', sessionId: string, x: number, y: number, button: 'left'|'right' }

// 键盘输入
{ type: 'type', sessionId: string, text: string }

// 按键
{ type: 'keypress', sessionId: string, key: string }

// 滚动
{ type: 'scroll', sessionId: string, deltaX: number, deltaY: number }

// 人工标记解决
{ type: 'solved', sessionId: string }
```

### CAPTCHA 检测规则

```typescript
const CAPTCHA_SELECTORS = [
  // reCAPTCHA v2/v3
  'iframe[src*="recaptcha"]',
  '.g-recaptcha',
  '#recaptcha',
  
  // hCaptcha
  'iframe[src*="hcaptcha"]',
  '.h-captcha',
  
  // Cloudflare Turnstile
  'iframe[src*="challenges.cloudflare.com"]',
  '.cf-turnstile',
  
  // Generic
  'iframe[src*="captcha"]',
  '[data-captcha]',
  '.captcha-container',
  
  // Image-based
  '.captcha-image',
  '#captcha_image',
];

async function detectCaptcha(page: Page): Promise<{ detected: boolean; type?: string; selector?: string }> {
  for (const selector of CAPTCHA_SELECTORS) {
    const el = await page.$(selector);
    if (el) {
      return { detected: true, type: identifyType(selector), selector };
    }
  }
  
  // 页面文本检测
  const text = await page.textContent('body');
  const captchaKeywords = ['verify you are human', 'prove you are not a robot', 'complete the challenge'];
  if (captchaKeywords.some(kw => text?.toLowerCase().includes(kw))) {
    return { detected: true, type: 'text-challenge' };
  }
  
  return { detected: false };
}
```

### Webhook 通知格式

```json
{
  "event": "captcha-detected",
  "timestamp": "2026-05-06T12:00:00Z",
  "sessionId": "sess_abc123",
  "url": "https://github.com/login",
  "reason": "reCAPTCHA v2 detected",
  "previewUrl": "http://localhost:9223?session=sess_abc123",
  "targetUrl": "https://github.com/login",
  "timeout": 120
}
```

## 新增/修改的文件

### xbrowser 项目

| 文件 | 操作 | 内容 |
|------|------|------|
| `src/human-interaction.ts` | 新增 | HumanInteractionManager：检测+通知+等待 |
| `src/screencast.ts` | 修改 | 支持更高帧率、CDP screencast 模式 |
| `src/websocket-server.ts` | 修改 | 添加 inbound 消息处理（click/type/keypress/scroll） |
| `preview.html` | 修改 | 添加交互能力（点击捕获、键盘转发、CAPTCHA UI） |
| `src/context.ts` | 修改 | 添加 `ctx.waitForHuman()` 方法 |
| `src/builtins/preview.ts` | 修改 | 串联 ScreencastCapturer + WSServer |
| `src/captcha-detector.ts` | 新增 | CAPTCHA 检测规则引擎 |
| `src/webhook.ts` | 新增 | Webhook 通知发送 |

### 不需要修改
- mpage/xcli-core — 框架层不需要改动
- marketplace — 市场不需要改动

## API

### ctx.waitForHuman()

```typescript
interface WaitForHumanOptions {
  reason?: string;           // 原因描述，默认 'Human interaction required'
  timeout?: number;          // 超时秒数，默认从配置读取
  autoDetect?: boolean;      // 自动检测 CAPTCHA 消失，默认 true
  previewUrl?: string;       // 自定义 preview URL
}

// 在 CommandContext 上新增
interface CommandContext {
  // ...existing methods
  
  /**
   * 暂停自动化，等待人工操作
   * 
   * - 自动启动 screencast + WS server
   * - 终端打印 preview URL
   * - 如果配置了 webhook，发送通知
   * - 等待用户在 preview 上操作，或 CAPTCHA 自动消失
   * - 超时后按策略处理（skip/abort）
   */
  waitForHuman(options?: WaitForHumanOptions): Promise<{ solved: boolean; method: string }>;
}
```

## 开发计划

| # | 子任务 | 依赖 |
|---|--------|------|
| 1 | WSServer 双向通信 | 无 |
| 2 | CAPTCHA 检测器 | 无 |
| 3 | preview.html 交互升级 | #1 |
| 4 | ctx.waitForHuman() + HumanInteractionManager | #1, #2 |
| 5 | preview 命令串联 + CDP screencast | #3, #4 |
| 6 | Webhook 通知 | #4 |
