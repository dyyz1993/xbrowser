# 伪装的伪装审查：当你的反检测开始暴露你

> 给无头浏览器做了 17 层伪装之后，最危险的不再是"没伪装"，而是"伪装过度"。本文记录一组特殊的攻防武器（d28-d37）—— 它们不检测机器人特征，而是检测**伪装本身的破绽**。十个真实案例，每个都来自我们自己的代码。

## 核心论点

伪装的目标不是"处处更真"，而是**精确匹配真实浏览器的行为分布**。两者的区别在于：

- 真实浏览器：合成事件 `isTrusted=false`，后台标签 `hasFocus=false`，坐标是整数
- 过度伪装：一切"更像人"的值 —— `isTrusted` 恒 true，`hasFocus` 恒 true，坐标恒浮点

第二种在单维度看每个都"更像人"，但检测方只需要构造一个"真实浏览器会给出平凡值"的场景，你就穿帮了 —— **因为你在那个场景给出的值和真人不一致**。

## 十个案例的完整清单

### 案例一：isTrusted 悖论（d28）

```
检测方：dispatchEvent(new Event('click'))，然后查 isTrusted
真实浏览器：false（合成事件的定义）
我们：true（hook 强制返回 true）
```

根因：stealth 的 AEL hook 无差别 `return true`，把页面自己的合成事件也"变真"了。修复：透传 `k.isTrusted` —— CDP 真实事件本来就是 true（无需改），合成恢复 false。

### 案例二：坐标篡改（d29）

```
检测方：dispatchEvent(clientX=100)，查收到的 clientX
真实浏览器：100（原样）
我们：100.427...（浮点化 hook 无差别生效）
```

修复：浮点化条件收紧为 `Number.isInteger && isTrusted === true`。

### 案例三：hasFocus 恒真（d41）

```
检测方：切到后台标签，查 document.hasFocus()
真实浏览器：false（失焦）
我们：true（伪装恒 true）
```

修复：`hasFocus = visibilityState === "visible"`。

### 案例四：toString 白名单永不命中（d30）

```
检测方：hook 后的函数.toString()
真实浏览器：function toDataURL() { [native code] }
我们：返回 hook 源码
```

根因精妙：白名单比较的是"保存的原函数"，但 `fn.toString()` 时 `this` 是"hook 后的新函数" —— **永不相等**。修复：白名单改为比较 prototype 上的当前函数。

### 案例五：代理对象暴露类型（d30）

```
检测方：ctx.measureText('x') instanceof TextMetrics
真实浏览器：true
我们：false（返回自造的代理对象）
```

修复：改回真 TextMetrics 实例 + `defineProperty` 覆写 width getter。

### 案例六：init script 语法错误静默裸奔（第十五季）

```
正则 [^\r\n] 在字符串数组 join 后断裂成真实 CR/LF
  → 整段 init script 语法错误
  → addScriptToEvaluateOnNewDocument 静默失败
  → 全部防护裸奔两季（无人发现）
```

这是最深刻的一课：**伪装的回归不能用"功能通不通"验证，要用指纹探针验证**。事故后我们固化了语法自检测试。

### 案例七：voices 阈值分支错误（d33）

iframe 原生有约 10 个 voice，hook 的 `real.length > 0` 分支误判"已有真实列表"而跳过伪装。修复：阈值 > 50。

### 案例八：iframe 独立实例（d33-d37 修复）

iframe 的 `speechSynthesis` 是独立实例，主文档 hook 不可达。修复：MutationObserver 监听 iframe 插入 + 轮询兜底。

### 案例九：performance.now 完整精度（d34）

11 位小数 vs 真实 Chrome 的 100μs 粒度。修复：`Math.round(t*10)/10`。

### 案例十：检测器自己也会错（d37）

假设 isTrusted 在 `Event.prototype` 且 `enumerable=false` —— 全部猜反（实测：实例自有、enumerable=true）。**检测器的预期必须来自实测，不是 spec 假设。**

## 方法论提炼

四条从案例中蒸馏的原则：

### 1. 匹配分布，不是最大化"真实感"

每个伪装值问一句：**真实浏览器在这个场景下会给什么值？** 不是"什么值最像人"。

### 2. 伪装必须区分真实事件和探测事件

CDP 管线的真实事件（该伪装）vs 检测方 dispatch 的合成事件（该原样）—— 条件判断不能少。

### 3. 表面与行为同样保真

hook 后的函数：`toString()` 要 native、`instanceof` 要正确、参数个数要对。取证级检测看这些。

### 4. 每个事故变成永久防线

修复只管一次，测试管 forever —— 语法自检、12 锚点检查、组合回归（d31）都是从事故固化的。

## 组合正确性

单维度通过 ≠ 组合通过。我们用 d31 验证 16 层伪装的互相干扰（canvas 三 hook 叠加、PRNG 共享种子稳定性、WebGL 与 2D 共存）—— 新增伪装层后跑 d31 基线即可。

## 写给做反检测的工程师

1. 你的 hook 是**代码注入**，注入就会留痕 —— `Error.stack`、`toString`、属性描述符是三大取证面
2. Chromium 的行为经常与 spec 不一致 —— 用实测校准检测预期（d37 的教训）
3. 伪装层之间的**时序竞争**真实存在（iframe 快照 vs 异步 patcher）—— 诚实记录已知限制比假装完美安全

## 结语

十七层伪装不是 seventeen 个开关，是一个需要持续审查的生态系统。伪装审查武器（d28-d37）现在和防护层一起跑在每次回归里 —— **防守自己的防守**，这是反检测工程的终极形态。

---

*xbrowser：github.com/dyyz1993/xbrowser。39 件武器在 `output/rec-duel/pages/` 可复现。系列导航见第 1 篇。*
