# login-state — 离线登录态提取

浏览器关着也能导出登录 cookie：无锁快照 Chrome Cookies 库（含 WAL 边车），
macOS Keychain 取钥解密，输出标准 Playwright storageState（0600）。
只解密你指定的域名（公共后缀当过滤器直接拒），密钥不落盘不进命令行。
headless worker 冷启动带登录态的合规第三通道——不装扩展、不开调试端口、不控制浏览器。
