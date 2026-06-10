# Mureka

> Mureka AI 音乐生成 — 聊天式音乐创作、积分查询、歌曲管理

## 命令

- `billing` — 查询 Mureka 积分余额、免费试用次数、可用模型
- `library` — 查看已创作的歌曲列表
- `create` — 在 Mureka 上创建音乐
- `status` — 检查当前音乐生成状态
- `download` — 下载音乐到本地
- `result` — 获取最新生成的音乐音频 URL

## 使用

```bash
xbrowser --cdp 9221 mureka <command> [options]
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录Mureka，然后通过 `--cdp` 连接。
