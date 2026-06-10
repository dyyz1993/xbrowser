# XBrowser CMF Seats 插件

## 插件简介

XBrowser CMF Seats插件用于座椅CMF评论查询（颜色/材质/触感）。

## 安装方式

### 前置要求
- Node.js >= 18.0.0
- Chrome 浏览器（推荐最新版本）

### CDP 连接
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# 使用 --cdp 连接
xbrowser --cdp 9221 cmf-seats <command>
```

本插件无需登录即可使用。

## 命令列表

| 命令 | 功能 |
| --- | --- |
| `query` | 查询指定车型的座椅CMF评论 |
| `list` | 列出所有支持的车型 |
| `stats` | 统计CMF关键词频率 |

## 使用示例

```bash
xbrowser --cdp 9221 cmf-seats query
```
```bash
xbrowser --cdp 9221 cmf-seats list
```
```bash
xbrowser --cdp 9221 cmf-seats stats
```

## 注意事项

1. 本插件无需登录即可使用
2. 避免频繁请求，防止触发反爬
3. 仅用于学习研究，不得用于商业用途

## 许可证

MIT License
