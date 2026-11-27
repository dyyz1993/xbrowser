# chrome-bridge — Chrome 扩展控制通道

让 xbrowser **直接控制你的 Chrome/Chromium**——浏览器装上 login-bridge 扩展后，xbrowser 经本地 WS 通道下发命令（导航/取值/点击/填充/截图），**无需开 --remote-debugging-port**，登录态就是你浏览器里的真实登录态。

## 架构

```
xbrowser CLI ──HTTP──> bridge server（独立进程，WS :9346 / HTTP :9347）
                              │ WS
                              ▼
              Chrome 扩展（background service worker）
                              │ chrome.scripting / tabs
                              ▼
                      你的浏览器页面（真实登录态）
```

## 一次性安装（Chrome / Chromium）

> Chromium 137+ 已静默禁用 `--load-extension`（防篡改机制会清除命令行注入的扩展），
> 需手动加载一次，之后常驻：

1. 浏览器打开 `chrome://extensions/`
2. 右上角打开「开发者模式」
3. 点「加载已解压的扩展程序」→ 选择本仓库的 `.xcli/plugins/login-bridge/extension/` 目录
4. 扩展徽标显示 `ON`（绿）即已连入 bridge

## 使用

```bash
# 1. 启动通道服务（xbrowser 侧，独立进程常驻）
xbrowser chrome-bridge serve

# 2. 查看状态（扩展是否已连入）
xbrowser chrome-bridge status

# 3. 在你的浏览器里执行命令
xbrowser chrome-bridge exec --cmd ping                          # 连通性（返回浏览器真实 UA）
xbrowser chrome-bridge open https://juejin.cn                   # 打开页面
xbrowser chrome-bridge exec --cmd evaluate --args '{"expression":"document.title"}'
xbrowser chrome-bridge exec --cmd click --args '{"selector":"#btn"}'
xbrowser chrome-bridge exec --cmd fill --args '{"selector":"#q","value":"搜索词"}'
xbrowser chrome-bridge exec --cmd tabs                          # 列出所有 tab
xbrowser chrome-bridge exec --cmd screenshot                    # 可视区截图（base64）
```

## 支持的命令

| cmd | 参数 | 说明 |
|-----|------|------|
| ping | - | 连通性 + 浏览器 UA |
| tabs | - | 所有 tab 列表 |
| navigate / open | url, tabId? | 导航（默认激活 tab） |
| evaluate | expression, tabId? | 页面内执行 JS |
| click | selector | 合成点击（query + el.click）——file input 会被守卫拦，见下「文件上传」 |
| fill | selector, value | 原型 setter + input/change 事件（React 兼容） |
| screenshot | - | 可视区 PNG base64 |
| url | tabId? | 当前 tab URL/title |
| setFiles | tabId?, selector, files[] | **文件上传**：`DOM.setFileInputFiles` 一等命令，见下「文件上传」 |

## 文件上传（setFiles = `DOM.setFileInputFiles`）

**永远不要 click `<input type=file>`**：合成 click 会被守卫的 file-input 规则拦
（403 指引 `setFileInputFiles`），真实点击只会弹系统文件对话框——两条路都传不了文件。

```bash
# 一条命令完成上传（server 侧编排：拿 objectId → DOM.setFileInputFiles → 回读 fileCount）
xbrowser chrome-bridge exec --cmd setFiles \
  --args '{"tabId":123,"selector":"input[type=file]","files":["/abs/a.jpg","/abs/b.jpg"]}'
# → { ok: true, data: { selector, files, tabId, fileCount: 1 } }
```

- `files[]` 必须是**本机绝对路径**且真实存在（浏览器自己读文件；相对路径按 server cwd 展开后校验，不存在返回 400）
- 内部三步：`Runtime.evaluate(returnByValue:false)` 拿 objectId → `DOM.setFileInputFiles{files, objectId}`（浏览器原生写 files 并触发 change，无合成事件）→ 回读 `input.files.length` 作为 `fileCount` 自证
- objectId 偶发失效（`Object id doesn't reference a Node`）→ 自动重取一次再试；仍失败返回 502 原文
- `tabId` 建议显式传；不传时三步各自落到当前任务组 tab
- 上传入口常要真实点击触发按钮打开弹窗——那一步受「页面可见」约束（`input-health`）；`setFiles` 本身不受
- 守卫对该命令设计上放行（不派发任何合成事件，正是 file-input 规则给出的替代路径）
- 上传前探站点规则（可选）：对 uploader 组件用假 File 调 `uploader.$props.beforeUpload(f)`——例如京东云上传口只收 JPG，PNG 被**静默移除、不发请求**，先探规则省得白传

## Guard 403：body 必须读再抛

守卫拒绝命令时返回 **HTTP 403 + JSON body**，`error` 字段是写给 LLM 的纠错说明
（`[CDP-Guard] 原因 | 替代: 正确用法 [ruleId]`）。封装这个通道的代码**必须先把 body
读出来再抛错**——只抛 HTTP 状态码会让调用方（LLM）一次都看不到替代用法，等于守卫
白拦。反例（2026-11-27 实录）：某封装 `res.ok` 不成立直接 `throw new Error('HTTP 403')`，
8 轮试错全靠猜。

```js
const r = await fetch(url, opts);
const body = await r.json();                       // 先读 body
if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);  // 把 [CDP-Guard] 文案带上去
```

## 登录态同步（原有 login-bridge 能力保留）

扩展 popup 里的「导出/导入」仍走 9355 HTTP——把你的登录态同步给 xbrowser 的自动化浏览器（`xbrowser login-bridge apply`）。

## 已知边界

- MV3 SW 空闲约 30s 被杀：`chrome.alarms` 每 30s 唤醒重连 + bridge 每 25s 双心跳（协议 ping/pong 探死连接、应用层 ka 帧给 SW 续命，S212）+ CONNECTING 卡死 15s 强制重连——SW 死透时用 `xbrowser chrome-bridge revive` 一键唤醒
- click 是合成事件（isTrusted=false）——需要 trusted 事件的场景后续走 `chrome.debugger` 通道
- Chromium 137+ 必须手动装扩展（见上）；装好后 Secure Preferences 正确签名，不会被清除


## SW 死透自愈（S212）

扩展 SW 彻底死亡（连接清空 + 保活闹钟失效）时：

```bash
xbrowser chrome-bridge revive          # 打开扩展 popup 页唤醒 SW，轮询等待重连（默认 20s）
xbrowser chrome-bridge status          # 看 lastDisconnectAt / ext 身份 / 客户端 lastSeen
```

三重防线：
1. **应用层 ka 帧**（bridge→扩展，25s）：MV3 SW 收到 WS 消息才重置空闲计时——活着就不会死
2. **协议 ping/pong 探死**（25s × 2 轮未 pong → terminate）：死连接秒级清除，挂起请求立即失败
3. **revive 命令**：真死透了开 popup 页物理唤醒（扩展 ID 自动记忆于 `~/.xbrowser/chrome-bridge-ext.json`）

日志：`~/.xbrowser/logs/chrome-bridge.log`（connect/disconnect/hello/exec 耗时/超时/ka-drop/no-client 心跳全落盘）
