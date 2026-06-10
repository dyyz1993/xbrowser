# 知乎

> 知乎 - 知识问答与内容采集 (DA 93)

## 命令

- `search` — 搜索知乎问题、回答、文章
- `trending` — 获取知乎热榜
- `question` — 获取知乎问题及其回答
- `answer` — 回答知乎问题（支持外链）
- `chat` — 知乎知答 AI 搜索
- `article` — 在知乎发布文章（含外链）

## 使用

```bash
xbrowser --cdp 9221 zhihu <command> [options]
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录知乎，然后通过 `--cdp` 连接。
