# Suno

> Suno AI 音乐生成 — 音乐创作、自定义歌词/风格、同步/异步生成

## 命令

- `create` — 在 Suno 上生成音乐
- `result` — 获取最新生成的音乐音频 URL
- `status` — 检查当前页面音乐生成状态
- `library` — 查看 Suno 创作历史/歌曲列表

## 使用

```bash
xbrowser --cdp 9221 suno <command> [options]
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录Suno，然后通过 `--cdp` 连接。
