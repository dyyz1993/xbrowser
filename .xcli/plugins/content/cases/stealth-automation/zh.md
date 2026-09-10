# CDP 反检测实战：UA-CH、原型逃逸与 19 层打断源压制

> 发布于 {{DATE}} · xbrowser v{{VERSION}}

自动化浏览器被识别，无非三条路：你的**事件**是合成的、你的**环境**有接缝、你的**流程**被人类会随手点掉的东西打断。多数 stealth 教程只讲第二条。这篇把三条讲全——来自数月攻防竞技场对生产级检测的实测，对应 [xbrowser]({{GITHUB_URL}}) 的 stealth 层实现。

## 1. 合成事件：`isTrusted` 是第一道闸

生产站点不只监听点击——它们检查 `event.isTrusted`。任何从 JS 派发的事件（`el.click()`、`dispatchEvent`）都过不了这道闸。我们实测见过页面因此跳转 `about:blank`、静默吞掉操作、或直接弹警告"CDP Firewall: event simulation detected"。

由此得到的铁律：**只走真实输入管线交互。** 用 `getBoundingClientRect` 算坐标，再用 `Input.dispatchMouseEvent` 派发——和人类鼠标一样的可信事件。同一哲学可以推广：

- **文件上传**：永远不要点 `input[type=file]`（会弹系统对话框并触发检测）。构造 `File` 塞进 `DataTransfer` 再派发 `change` 事件——或者更上一层，stub 掉 File System Access API 的 `showOpenFilePicker` 返回合成句柄，让 Dropzone/Uppy 这类拖拽上传组件在零系统弹窗下工作。
- **抢焦点的原生控件**：`input[type=color]` 会弹取色面板且键盘输入无效；解法是值注入 + 成对的冒泡 `input`/`change` 事件。同一套处理统一覆盖 `date`、`time`、`month`、`week`、`datetime-local`。

这个模式在我们代码库里有个名字：**绕开原生 UI，直进编辑管线**。

## 2. 环境接缝：UA-CH 与原型逃逸

两个实测发现塑造了环境层。

**UA-CH 漂移是静默杀手。** 伪造 `navigator.userAgent` 却不匹配 `userAgentData`（品牌顺序、GREASE 条目、版本号）本身就是一种指纹——而且 Chrome 在你眼皮底下自动升级后，冻死的 UA 和真实二进制脱同步。解法：启动时**从运行中的二进制派生** UA-CH 档案（`Browser.getVersion`），版本号想漂移都没机会。

**原型逃逸会让你露馅。** 如果检测器沿 `Object.getPrototypeOf(navigator)` 走，把属性描述符和干净 iframe 的 navigator 比对，属性**删除**和朴素的 `defineProperty` 补丁都会暴露。可审计的修法是封口：重建描述符面，让原型级比对和干净浏览器一致，然后用检测者会用的同一批探针自检（28 条断言，一条命令可跑）。

我们守住的一条红线：**永不碰 `navigator.webdriver`**。它是被交叉验证最多的单一信号；篡改它和欺诈工具的相关性远大于测试工具。诚实的自动化要么自报家门，要么别出门。

## 3. 打断源压制：不性感但占 90% 的部分

headful agent 死于一千次纸割：`beforeunload` 对话框、HTTP Basic 认证弹窗、右键菜单、`PaymentRequest` 支付面板、串口权限申请、SSL 拦截页、macOS 回放中途睡着。每一个都会用 CSS 藏不住的模态框卡死管线。

所以 xbrowser 内置了一张**压制矩阵**——19 层，每层都是红测先行、绿测锁定：

- JS 对话框（`alert`/`confirm`/`prompt`）自动 dismiss 且保留语义返回值；
- 权限单笔全量放行（跨内核坑：`grantPermissions` 是**替换**语义，不是合并）；
- HTTP 认证在 Fetch 层带凭证应答，非认证请求旁路直通不碰；
- serial/USB/HID/Bluetooth/IdleDetector/wake-lock 全套确定性 stub，agent 拿到 `NotFoundError` 而不是挂死在原生选择器上；
- SSL 拦截页走 `Security.setIgnoreCertificateErrors`（这个字段当了几个月死选项，终于接线）；
- 回放期间持有 `caffeinate -i` 子进程，macOS 中途永不休眠。

每一层都是因为真实场景撞上了才加的。没有一层是猜的。

## 不舒服的部分，和我们的边界

反检测处在一条光谱上。在自己的应用上跑测试自动化、以克制的频率抓公开页面、维持自己的长时工作流，是正当的。规模化逃避反欺诈控制不是。我们实际操作的规则：不在高封号风险平台用真实账号跑自动化实验；尊重频控；登录态只复用创建它的那个账号。stealth 层是工具，伦理由操作者选择。

## 上手

```bash
{{INSTALL_CMD}}
xbrowser stealth:check   # 28 断言环境自检
```

MIT 开源：[{{GITHUB_URL}}]({{GITHUB_URL}}) · npm: [{{NPM_URL}}]({{NPM_URL}})

*本文由 xbrowser 自己的内容管线完成起草、封面渲染与分发。*
