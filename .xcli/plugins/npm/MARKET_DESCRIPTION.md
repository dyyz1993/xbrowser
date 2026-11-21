# npm — registry 查询 + 访问令牌管理

一个插件两类能力：公开 registry API（search / package / downloads，无需登录），
与 npmjs.com 访问令牌全生命周期管理（create-token / list-tokens / delete-token）。

令牌命令走 chrome-bridge 通道在用户真实 Chrome 里执行：账密走 trusted fill 管线，
关键按钮用真实鼠标事件（isTrusted=true），邮箱 OTP 支持 `--otp` 直传或 viewer 人工接管，
创建后立即提取 npm 仅展示一次的 `npm_` 令牌值。适合 CI 发布令牌的发放与轮换自动化。
