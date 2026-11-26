# npm — registry 查询 + 访问令牌管理

两类能力，一个插件：

1. **公开 registry API**（无需登录，任何会话）：`search` / `package` / `downloads`
2. **访问令牌管理**（需要登录，走 chrome-bridge 通道）：`create-token` / `list-tokens` / `delete-token`

## 令牌命令（chrome-bridge 通道）

npm 的建令牌页面有人机验证与一次性令牌展示，**必须**在用户真实 Chrome 里跑：

```bash
# 首次：把内置命令路由进用户浏览器（首用标记，之后粘性）
xbrowser --session npm-ci --bridge goto https://www.npmjs.com

# 登录 + 创建 30 天 Granular Access Token（OTP 在 viewer 人工输入）
xbrowser npm create-token --session npm-ci --bridge \
  --username myuser --password '****' --tokenName ci-publish

# 直传邮箱 OTP（Agent 已从别处拿到验证码时）
xbrowser npm create-token --session npm-ci --bridge \
  --username myuser --password '****' --otp 123456 --packagesScope @myorg

# 列出全部令牌
xbrowser npm list-tokens --session npm-ci --bridge --username myuser

# 撤销令牌（--name 或 --id）
xbrowser npm delete-token --session npm-ci --bridge --username myuser --name ci-publish
```

### create-token 流程

1. 打开 `https://www.npmjs.com/login`（已登录则跳过）
2. 账密经 **trusted fill** 管线输入（`page.fill`，无合成事件）
3. **Sign in** 用真实鼠标点击（evaluate 读 rect → `page.mouse.click`，isTrusted=true）
4. npm 向账号邮箱发 **OTP 一次性验证码**：
   - 传了 `--otp` → 直接填入
   - 没传 → 命令以 `NEEDS_HUMAN` 结束（fail-closed，不会挂着等）：在 viewer（`http://localhost:9224/preview/<session>`）或浏览器里输入验证码后，带 `--otp <code>` 重跑
5. 打开 `/settings/<username>/tokens/granular-access-tokens/new`，填令牌名/有效期/Packages scope
6. 提交后提取**仅展示一次**的令牌值（`npm_` 前缀），随结果返回

### 输入合规（AGENTS §14）

- 文本框一律 `page.fill`（trusted fill 管线）
- 关键 UI（登录/建令牌/撤销/确认按钮）先 evaluate 读 rect，再 `page.mouse.click`
- `evaluate` 内不出现 `el.click()` / `dispatchEvent`（CDP Guard 硬闸门）
- select 用 `locator.selectOption`（驱动层 click-focus + 设值管线）

## 公开 API 命令

```bash
xbrowser npm search --query "graphql client" --limit 10
xbrowser npm package --name react
xbrowser npm downloads --name react --period last-week
```

## 参数速查（create-token）

| 参数 | 必填 | 说明 |
|------|------|------|
| `--username` | 是 | npm 用户名 |
| `--password` | 是 | npm 密码 |
| `--tokenName` | 否 | 令牌名（默认 `xbrowser-ci`） |
| `--expiryDays` | 否 | `30` / `90` / `custom` |
| `--customExpiryDays` | custom 时必填 | 自定义有效天数 |
| `--packagesScope` | 否 | @scope 名（不带 `@` 自动补） |
| `--otp` | 否 | 邮箱 OTP 验证码；不传则 viewer 人工输入 |

## 已知假设（表单结构可能随 npm 改版漂移）

- 令牌列表页：`/settings/<username>/tokens`，表格含 name/type/created/expires/last used 列
- 建令牌页：`/settings/<username>/tokens/granular-access-tokens/new`
- 选择器候选见 `index.ts` 顶部常量（id/name/语义属性优先，class 哈希不稳定）；
  失配时命令会返回明确的 fail 提示与预期页面 URL，按提示更新候选即可
