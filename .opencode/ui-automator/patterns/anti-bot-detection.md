# 反检测（Anti-Bot Detection）模式

> 最后更新：2026-05-27 | 来源：用户需求 + 实现经验

## 摘要
在执行浏览器自动化任务前，主动检测页面的反机器人机制，避免被识别和阻断。

## 背景
CDP（Chrome DevTools Protocol）连接的浏览器会被网站检测到自动化特征：
- `navigator.webdriver === true`
- `window.__webdriver_script_fn` 存在
- `window.chrome` 缺失
- 指纹 API（Canvas、AudioContext）暴露

## 检测层次

### 第一层：被动拦截（已有 — CDP Firewall）
xbrowser 的 `cdp-interceptor` 模块已实现被动拦截：
- `automation-signals.ts` — 拦截 webdriver 标记访问
- `fingerprinting.ts` — 拦截指纹 API 调用
- 9 个规则模块，~200 个检测模式

### 第二层：主动检测（新增 — anti-bot-detection.ts）
在执行交互命令（click/fill/type）前主动检测：
- 验证码检测（reCAPTCHA、hCaptcha、Turnstile、Cloudflare）
- 警告文本检测（"detected as bot"、"suspicious activity"）
- 阻断页面检测（Cloudflare Challenge、AWS WAF）
- webdriver 标记暴露检测
- 未登录状态检测（可选）

## 实现架构

```
TipsManager.beforeCommand()
    ↓
detectAntiBot(page, config)
    ↓
┌─────────────────┐
│ checkCaptcha    │ → iframe src 检测 + DOM 选择器检测
│ checkWarning    │ → body 文本匹配
│ checkBlocked    │ → URL 模式匹配
│ checkWebdriver  │ → page.evaluate() 检测 JS 标记
│ checkLogin      │ → 顶部登录按钮检测
└─────────────────┘
    ↓
DetectionResult { detected, type, severity, message, actionRequired }
    ↓
severity === 'high' → 抛出错误，阻止命令执行
severity === 'medium' → 警告，继续执行
```

## 文件位置
- `src/anti-bot-detection.ts` — 核心检测模块
- `src/commands/detect.ts` — detect 命令处理函数
- `src/tips/index.ts` — TipsManager 集成自动检测

## 使用方式

### 手动检测
```typescript
import { detectAntiBot } from './anti-bot-detection.js';
const result = await detectAntiBot(page, {
  checkCaptcha: true,
  checkWarning: true,
  checkBlocked: true,
  checkWebdriver: true,
});
if (result.detected) {
  // 处理检测结果
}
```

### 自动检测
TipsManager 在执行 click/fill/type/select/check/uncheck/hover/dblclick 命令前自动检测。
5秒内不重复检测（防抖）。

## 最佳实践

1. **使用 CDP 9221 连接用户浏览器**：保留用户登录态，减少被检测概率
2. **操作前先检测**：避免在检测到问题时继续操作
3. **高严重级别 → 立即停止**：给用户 viewer URL 让其手动处理
4. **低严重级别 → 警告继续**：记录日志但不阻止
5. **添加延迟**：操作间添加随机延迟，模拟人类行为

## 变更记录
- 2026-05-27：初始创建（反检测功能实现）
