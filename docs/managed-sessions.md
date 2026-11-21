# 并发运行与人工接管

- `xbrowser run steps.txt --headless --session demo`：在自启动的无头会话中运行文件。每行一条命令，逐条执行；要在同一行遇错即停，用 `&&`。
- `xbrowser run jobs.json --parallel 2`：不同会话并行，单个会话内保持顺序；命令等待所有任务完成并按输入顺序汇总。并发数默认 2，可设 1–8；有任何任务失败时退出码为 1。
- `xbrowser session handoff demo`：输出本机会话的 Viewer 链接，不弹原生 Chrome 窗口。链里写 `handoff` 才会暂停，人工操作完成后点 Viewer 的「继续任务」，从下一步继续；120 秒无人确认则停止该任务。其他会话不用等待。
- `xbrowser session save demo`：显式保存自启动会话里的 Cookies 与已打开页面的 LocalStorage。关闭会话后用 `xbrowser session restore demo` 恢复，再运行同名任务。
- `xbrowser session errors`：查看既有错题本的分类、次数和约束状态。预期重复的运行错误仍由现有判重和阈值处理。

`jobs.json` 示例：

```json
{
  "jobs": [
    { "session": "demo", "chain": "goto https://example.com && handoff && title" },
    { "session": "check", "chain": "goto https://example.org && title" }
  ]
}
```

## 设计决定：保留同一个页面，不切换 Chromium 进程

`CLI run → daemon → 名称独立的无头会话 → Viewer 接管 → 同一任务继续`。不重启 Chromium，因此保留页面、输入和临时状态。Viewer 控制的是网页，不是系统级浏览器窗口；本机 Viewer 不应暴露给公网。

托管运行不附加外部浏览器。同名托管任务拒绝并发，既有链式调用和 `.txt` 执行默认保持原行为；`.txt` 显式加 `--headless` 才启用托管运行。快照只在显式 `save` 时写到 `~/.xbrowser/saved-sessions/`，不读主 Chrome 或系统钥匙串。快照是本地敏感文件，不入库、不分享，不包含 IndexedDB，也不能恢复已过期或被服务端撤销的登录态。
