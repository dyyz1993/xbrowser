# XBrowser Steam 插件

## 插件简介

XBrowser Steam插件用于Steam 游戏评论抓取 — 通过 Review API 批量获取所有语言评论。

## 安装方式

### 前置要求
- Node.js >= 18.0.0
- Chrome 浏览器（推荐最新版本）

### CDP 连接
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# 使用 --cdp 连接
xbrowser --cdp 9221 steam <command>
```

本插件无需登录即可使用。

## 命令列表

| 命令 | 功能 |
| --- | --- |
| `reviews` | 抓取 Steam 游戏的全部评论（cursor 分页，100/页） |

## 使用示例

```bash
xbrowser --cdp 9221 steam reviews
```

## 注意事项

1. 本插件无需登录即可使用
2. 避免频繁请求，防止触发反爬
3. 仅用于学习研究，不得用于商业用途

## 许可证

MIT License
