# Stealth 自动化指南

> xbrowser 内置反检测隐身层——所有 `click` / `fill` / `type` 命令自动携带人类行为仿真，无需额外配置。

## 快速开始

```bash
# 正常使用即可（隐身默认开启）
xbrowser goto https://example.com
xbrowser click "#like-btn"
xbrowser fill "#input" "hello"

# 提交表单前回看（模拟人类检查行为）
xbrowser click "#submit-btn" --review

# 模拟浏览行为（先看页面再操作，推荐）
xbrowser browse --duration 5
xbrowser click "#like-btn"
```

## 内置隐身行为

### 点击（click / fill / type 自动携带）

| 行为 | 实现 | 破解的检测 |
|------|------|-----------|
| 贝塞尔轨迹 | 随机弧向 + 噪声 ±5.5px + 过冲折返 | 直线轨迹检测 |
| 落点偏移 | 小元素 ±0.3-2.5px / 大元素 ±1.5-7px | 精确中心检测 |
| 按压漂移 | release 坐标偏 0.8-2.5px | 零漂移检测 |
| 瞄准停顿 | 到位后停 150-400ms + 微动 | 无停顿检测 |

### 输入（fill / type 自动携带）

| 行为 | 实现 | 破解的检测 |
|------|------|-----------|
| 点击聚焦 | 先 click 再打字（不用 `el.focus()`） | 聚焦链检测 |
| 三档节奏 | 22% 快速(25-60ms) / 60% 基础(50-350ms) / 18% 停顿(400-1200ms) | 节奏 CV 检测 |
| 完整键码 | key + code + windowsVirtualKeyCode + modifiers | 空键码检测 |
| 打错修正 | 6% 概率打错 1 字符 + Backspace 重打 | 完美打字检测 |

### 滚动（自动携带）

| 行为 | 实现 | 破解的检测 |
|------|------|-----------|
| 惯性滚轮 | deltaY = 180·e^(-0.4i) 指数衰减 | 无惯性检测 |
| 滚轮滚动 | 不用 scrollIntoView，用 CDP mouseWheel | 零 wheel 检测 |

### 页面级 Hook（goto 自动注入）

| 行为 | 实现 | 破解的检测 |
|------|------|-----------|
| AEL 事件代理 | sourceCapabilities 伪造 + isTrusted 洗白 + 坐标伪随机浮点化 | 多种指纹检测 |
| onclick 原型劫持 | 双流一致性（AEL 流与 onclick 流坐标相同） | 双流交叉检测 |
| Screen 伪装 | 1728×1117（原型级，非实例级） | screen 物理矛盾检测 |
| hasFocus 覆盖 | return true + toString 伪装 | 焦点死区检测 |
| toString 名单制 | 劫持函数返回 [native code] 格式 | 函数源码检测 |

## 新命令

### `browse` — 模拟人类浏览

```bash
xbrowser browse                        # 默认 5 秒
xbrowser browse --duration 10          # 10 秒
xbrowser browse --scrolls 3            # 含 3 次向下滚动

# 推荐：先浏览再操作
xbrowser "browse --duration 5 && click #like-btn"
```

行为包含：随机鼠标漫游（3-5 段贝塞尔轨迹）+ 等待期微动 + 惯性滚动 + 阅读停顿。

### `click --review` — 提交前回看

> ⚠️ `--review` 标志存在 CLI 布尔解析问题，当前推荐使用下方两步模式。

**推荐方式（已验证通过 36 层检测）：**

```bash
# 步骤 1：向上滚动回看
xbrowser eval "window.scrollBy(0,-200);document.dispatchEvent(new WheelEvent('wheel',{deltaY:-120,bubbles:true}))"
sleep 2

# 步骤 2：提交
xbrowser click "#submit-btn"
```

## 配置

### 关闭隐身模式（性能优先）

```bash
# 环境变量方式
XBROWSER_STEALTH=off xbrowser click "#btn"

# 或在命令链中
XBROWSER_STEALTH=off xbrowser "goto https://example.com && click #btn"
```

关闭后：不注入 init script、点击为直线轨迹、输入为固定间隔。**仅推荐在无反检测的内部页面使用。**

### 最佳实践

```bash
# 1. 先浏览（模拟用户到达页面先看看）
xbrowser browse --duration 5

# 2. 再交互（点击/输入自动带隐身）
xbrowser click "#like-btn"
xbrowser fill "#comment" "好看"

# 3. 提交前回看（两步模式）
xbrowser eval "window.scrollBy(0,-200);document.dispatchEvent(new WheelEvent('wheel',{deltaY:-120,bubbles:true}))"
sleep 2
xbrowser click "#submit-btn"
```

## 技术架构

```
用户命令 (click/fill/type)
    ↓
StealthDriver (行为仿真层)
  ├─ 贝塞尔轨迹 + 余弦缓动 + 噪声 + 过冲
  ├─ 三档打字节奏 + 键码补全 + 打错修正
  └─ 惯性滚轮 + 阅读停顿 + 微动漂移
    ↓
CDPGuard (安全代理层)
  ├─ ❌ 拦截: Shift 键 / Space 激活 / Escape / browser.close
  ├─ ✅ 补全: clickCount / 键码 / buttons / 亚像素坐标
  └─ ⚠️ 警告: 合成 click / 程序 focus / scrollIntoView
    ↓
Chrome Browser (CDP WebSocket)
    ↓
目标页面 (含守方检测 JS)
    ↓
✅ 操作成功（未被检测）
```

## 验证结果

36 层检测（五季攻防实测全部检测器）下 **0 命中**：

| 检测类别 | 层数 | 结果 |
|----------|------|------|
| 事件真实性 | 8 | ✅ 全过 |
| 行为统计 | 10 | ✅ 全过 |
| 环境指纹 | 8 | ✅ 全过 |
| 轨迹分析 | 5 | ✅ 全过 |
| 综合评分 | 5 | ✅ 全过 |

## 已知限制

| 限制 | 说明 | 对策 |
|------|------|------|
| 跨会话检测 | IP 信誉 / 设备指纹历史 / 账号基线 | 需代理 IP 池 + 账号轮换 |
| 服务端 ML | 机器学习行为模型（非规则引擎） | 需多样化操作模式 |
| CAPTCHA | 遇到验证码需人工接管 | `--waitCaptcha` 标志 |
| 性能开销 | 隐身模式 ~45s/次 vs 普通模式 ~0.6s | `XBROWSER_STEALTH=off` 可关闭 |
