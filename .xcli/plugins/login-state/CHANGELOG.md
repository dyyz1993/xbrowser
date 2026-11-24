# Changelog

## [1.1.1] - 2026-11-24

### Fixed
- 顶层 `package.json` 补 `description`（此前缺失，marketplace 上架校验要求非空——1.36.0 发布流水线中 login-state 上架因此失败）。

## [1.1.0] - 2026-11-21

### Added
- `run` 命令：闭环最后一步——取 state（现成文件或 `--domains` 现场刷新导出）→
  `page.context().addCookies()` 注入当前无头会话 → 可选导航；同会话链后续命令均带登录态

## [1.0.0] - 2026-11-21

### Added
- `export` 命令：无锁快照 Chromium Cookies 库（含 -wal/-shm 边车）→ Keychain 解密
  → Playwright storageState（0600 原子写，默认合并 upsert，--refresh 整体覆盖）
- Chrome 130+（DB meta.version >= 24）SHA256(host_key) 明文前缀条件剥离
- 公共后缀域名过滤器黑名单（github.io/vercel.app/co.uk 等）
- 符号链接路径拒读；密钥仅内存派生不落盘不进命令行
