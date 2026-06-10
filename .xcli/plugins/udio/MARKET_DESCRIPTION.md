# Udio

> Udio AI 音乐生成 — 音乐创作、Credits 查询、歌曲库管理、hCaptcha 处理

## 命令

- `billing` — 查询 Udio Credits 使用情况和订阅状态
- `library` — 查看 Udio 歌曲库/创作历史
- `create` — 在 Udio 上生成音乐
- `status` — 检查 Udio 最新歌曲生成状态
- `download` — 下载音乐到本地
- `result` — 获取 Udio 最新生成的音乐音频 URL

## 使用

```bash
xbrowser --cdp 9221 udio <command> [options]
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录Udio，然后通过 `--cdp` 连接。
