# 攻破最后一个新 tab 链路：一场 73 秒挂死的六层洋葱解剖

> 32 季攻防竞技场，33 件防守武器破了 32 件。最后一件 d07（target=_blank 新 tab 操作）剥了五层洋葱仍未破。本文记录第六层的最终攻坚 —— 从 trace 插桩到根因定位的完整过程，以及三个"看似无关实则致命"的修复。

## 背景

d07 的任务：点击页面 A 的链接打开新 tab B，切到 B 点确认按钮，证明写回 A。听起来简单，实际是自动化最深的深水区 —— 会话生命周期、CDP session 绑定、Input agent 激活、浏览器安全策略，全在这条链上。

前五层的修复记录（每层都是真实 bug）：

```
第 1 层：新 tab 的 DOM.enable 未调用 → DOM.getDocument 无限挂起
第 2 层：CDP 调用无超时 → 僵尸 session 拖死命令
第 3 层：load 事件已错过 → waitForLoadState 白等 30s
第 4 层：detectCaptcha 的 page.$ 串行 → 每次都可能挂
第 5 层：popup 检测被假事件误触发 → 2×30s 超时
```

五层修完，点击仍要 73 秒。

## 第六层：trace 插官定位法

没有 profiler 能用（瓶颈跨进程），最原始的方法最有效 —— 在 dist 构建产物里直接插桩：

```javascript
// 改 dist（改完即生效，不用等构建）
if (process.env.XBROWSER_TRACE) console.error('[trace] popup-done: ' + (Date.now() - globalThis.__t0) + 'ms');
```

第一次插桩的读数就锁定了区间：

```
[trace] click: start               0ms
[trace] locator.click: before-waitForActionable    0ms
[trace] locator.click: after-waitForActionable     1ms    ← 秒过
[trace] locator.click: before-mouse                3ms    ← 秒过
[trace] popup-done                         70697ms    ← 挂在这！
```

**locator 内部全部 1-3ms，但 popup-done 在 70697ms** —— 挂点在 `mouse.click` 的轨迹派发里。

继续拆：单独测一个 `mouse move` 到新 tab —— 6.7 秒。真相：**新 tab 的 Input agent 对每个 dispatchMouseEvent 都慢 6-7 秒**（session 未完全激活），stealth 轨迹 10+ 个点累计 = 70 秒。

对照实验证明方向：直接 CDP WebSocket 连新 tab，`DOM.getDocument` 和 `Runtime.evaluate` 都只要 1ms —— 慢的只有 Input domain。

## 三个修复

### 修复 1：轨迹总预算

```typescript
const _tb = Date.now();
let _truncated = false;
for (const p of traj) {
  if (Date.now() - _tb > 5000) { _truncated = true; break; }
  await this.send('Input.dispatchMouseEvent', { ... });
}
```

轨迹正常 ≤3 秒；session 慢时 5 秒截断跳到终点。73s → 8s。

### 修复 2：截断补发终点事件（最隐蔽的一层）

预算守卫上线后，点击命令 8 秒完成，但**按钮不触发了**。

原因精妙：截断后浏览器的"鼠标位置"停在轨迹半路。后续的 `mousePressed/mouseReleased` 坐标是对的，但页面的 hover 状态不对 —— 按钮的事件链断裂。修复：

```typescript
if (_truncated) {
  // 截断后必须补发终点事件 —— hover 态停在半路，按钮不触发
  await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tx, y: ty, ... });
}
```

### 修复 3：BroadcastChannel 替代 opener

按钮触发后仍无证明写入 —— headless 模式下 `window.opener === null`（Chromium 安全策略，不是 bug）。检测页面的证明通道改成 `BroadcastChannel`（现代跨 tab 通信，无 opener 依赖）。

## 最终验证

```bash
xbrowser click "#tab-confirm" --tab 1 --cdp http://localhost:9557 --session win
# 6.5 秒完成

# 原页面 outcome：
{"page":"d07","log":[
  {"action":"open-tab"},
  {"action":"tab-confirm","at":"new-tab"}   ← 完整证明链
]}
```

**33/33 全破。**

## 方法论沉淀

1. **trace 插桩 > profiler**：跨进程瓶颈（daemon ↔ CDP ↔ 浏览器）下，`Date.now()` 差值写 /tmp 文件是最可靠的
2. **对照实验定位 domain**：同一 tab 上 Runtime 1ms / Input 6.7s —— 慢的是特定 domain 不是整个 session
3. **修复的修复**：预算守卫解决挂死，却引入了 hover 断链 —— 每个修复都要验证「下游行为」而不只是「命令返回」
4. **浏览器安全策略不是 bug**：opener=null 是设计，绕不过就换通道（BroadcastChannel）

## 33 件武器全破的完整地图

| 类别 | 武器 | 关键修复 |
|------|------|---------|
| 页面结构 | iframe/随机类名/重生/shadow/canvas/虚拟列表 | 深度查询、去重 origin 分离、坐标回放 |
| 行为 | 拖拽/hover/contenteditable/键盘 | pointer 捕获、Bernstein 修正、keyPressDuration |
| 会话 | 指纹一致性/操作密度/新 tab | UA 固化、CV 节奏、轨迹预算+补点 |
| 环境指纹 | canvas/WebGL/audio/字体/chrome 对象/WebRTC/时区/媒体 | 微扰家族、FontFace 别名、p3 |
| 伪装审查 | isTrusted 悖论/坐标篡改/toString 取证/跨 hook 组合 | 透传原始值、白名单比较当前函数 |

---

*xbrowser：github.com/dyyz1993/xbrowser。竞技场 33 件武器在 `output/rec-duel/pages/` 全部可复现。系列导航见第 1 篇。*
