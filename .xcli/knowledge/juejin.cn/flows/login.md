---
flow: login
site: juejin.cn
intent: login
version: 2
lastVerified: 2026-06-18
sources: [verify-demo]
---

## 登录

用户通过输入账号密码完成登录。

### 关键元素

| 角色 | 值 | 类型 |
|---|---|---|
| username | testuser | text |
| passwordInput | #password | selector |
| submitBtn | .login-btn | selector |

### 操作步骤

1. 输入 testuser 到 #username
2. 输入 *** 到 #password
3. 点击「登录」

## 变更历史

| 日期 | 版本 | 类型 | 命令 | 来源 session | 变更摘要 |
|---|---|---|---|---|---|
| 2026-06-18 | v1 | created | summarize | verify-demo | 首次沉淀：识别为 login |
| 2026-06-18 | v2 | auto-reindex | reindex | verify-v2 | passwordInput: #password→#pwd-field; submitBtn: .login-btn→#sign-in-btn |