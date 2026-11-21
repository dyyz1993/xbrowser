# Changelog

## [1.0.0] - 2026-11-21

### Added
- `export` 命令：无锁快照 Chromium Cookies 库（含 -wal/-shm 边车）→ Keychain 解密
  → Playwright storageState（0600 原子写，默认合并 upsert，--refresh 整体覆盖）
- Chrome 130+（DB meta.version >= 24）SHA256(host_key) 明文前缀条件剥离
- 公共后缀域名过滤器黑名单（github.io/vercel.app/co.uk 等）
- 符号链接路径拒读；密钥仅内存派生不落盘不进命令行
