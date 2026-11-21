# login-state

离线提取本机 Chromium 系浏览器（Chrome / Canary / Brave / Edge / Arc）的登录态，
输出标准 **Playwright `storageState`** JSON，供 headless 会话、curl、其他工具复用。

## 定位：第三条登录态通道

| 通道 | 何时在线 | 适用 |
|------|---------|------|
| **chrome-bridge**（扩展 WS 通道） | 用户浏览器开着 | 在线自动化，登录态天然复用 |
| **CDP 会话命令**（get-cookies 等） | 会话活着 | 从活跃 session 取 |
| **login-state（本插件）** | **浏览器关着也行** | 冷启动 headless worker、离线分析 |

工作原理：**不控制浏览器、不装扩展、不开调试端口**——直接无锁快照 profile 里的
SQLite `Cookies` 库（连同 `-wal`/`-shm` 边车，运行中浏览器的最新 cookie 可能还在
WAL 未落盘），经 macOS Keychain 取 "Chrome Safe Storage" 密钥，PBKDF2-HMAC-SHA1
(1003 轮, salt `saltysalt`) 派生 AES-128-CBC key 内存解密，输出 storageState。

解密格式（v10/v11 envelope + Chrome 130+ DB v24 的 SHA256(host) 明文前缀）参考
[wasabihu/sessfork](https://github.com/wasabihu/sessfork)（MIT）。

## 用法

```bash
# 导出 github.com + linear.app 的登录 cookie 到 ~/.xbrowser/login-state/state.json
xbrowser login-state export --domains github.com,linear.app

# 指定输出文件 + 整体覆盖（默认是合并 upsert）
xbrowser login-state export --domains linear.app --output /tmp/linear.json --refresh

# 指定浏览器 / profile / 库路径
xbrowser login-state export --domains weibo.com --browser chrome --profile "Profile 1"
xbrowser login-state export --domains weibo.com --dbPath ~/Library/Application\ Support/Google/Chrome/Default/Cookies
```

首次运行会弹 macOS 钥匙串授权框（读 "Chrome Safe Storage"），需点【允许】。

## run：把登录态灌进无头会话跑起来（闭环）

`export` 只落盘；`run` 是最后一步——取 state（现成文件或 `--domains` 现场刷新）→
`browserContext.addCookies()` 注入当前无头会话 → 可选导航。**已验证姿势**（两步，
`--session` 必须放链字符串**外面**当全局 flag）：

```bash
# 第 1 步：注入（首次会弹 Keychain；--state 可省略复用已导出的 state）
xbrowser login-state run --domains github.com --session mysite

# 第 2 步：同会话后续操作（登录态已生效）
xbrowser --session mysite "goto https://github.com/settings/profile && text && screenshot"
```

> ⚠️ 已知限制：**单条链里混跑 `login-state run` + 内置命令**目前不可靠——链引擎里
> 插件命令转发 daemon 会话、内置命令用本地会话，注入与读取落在两个浏览器
> （#<chain-split-issue>）。在上面的两步姿势下闭环已实证（cookie 注入 → goto →
> `document.cookie` 可见）。

## 安全模型

- **最小权限**：只解密 `--domains` 匹配的行；`github.io` / `vercel.app` / `co.uk`
  等公共后缀直接拒绝当过滤器（防止一次导出带走全平台租户会话）
- 密钥只在内存中派生使用，**不落盘、不进命令行参数**（`ps` 不可见）
- 输出 0600 原子写（mkstemp + fchmod + rename），目录 0700
- 符号链接的 Cookies 路径直接拒读
- 快照副本即用即删，不触碰浏览器原库

## 已知限制（用前必读）

1. **同账号多实例互踢**：带此登录态的无头实例与真实浏览器**同时活跃**，部分站点
   （知乎等）会服务端清掉全部会话。错峰使用，或导出后暂别在真浏览器用该站。
2. **治不了 headless 指纹风控**：cookie 新鲜度只解决"登录态"这一半；站点若检测
   无头指纹（headless 特征 UA/CDP 痕迹），仍会拒绝。风控敏感场景仍走 chrome-bridge
   真浏览器。
3. **仅 macOS**（Linux secret-tool 在路线图；Windows DPAPI/app-bound 不支持）。
4. **需要 Node >= 22.5**（`node:sqlite` 读取 Cookies 库），缺失时给出明确报错。

## 路线图

- **二期 localStorage**：LevelDB（SSTable + WAL + Snappy + MVCC 墓碑）解析器，
  JWT 站（Linear/Vercel 等）token 在 localStorage——格式已验证可行（sessfork 纯
  Python 实现 385 行），将移植为 TS 进 `helpers` 并在 `origins` 字段输出。
- `import` 命令：把 state.json 灌进活跃 session / `.xcli/storage/`。
- Keychain 密钥自愈缓存（opt-in，sessfork 同款语义）。

## Changelog

见 [CHANGELOG.md](./CHANGELOG.md)。
