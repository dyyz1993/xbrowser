# XBrowser 国家统计局 插件

## 插件简介

XBrowser 国家统计局插件用于国家统计局 - 分省年度经济数据。

## 安装方式

### 前置要求
- Node.js >= 18.0.0
- Chrome 浏览器（推荐最新版本）

### CDP 连接
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9221

# 使用 --cdp 连接
xbrowser --cdp 9221 stats <command>
```

本插件无需登录即可使用。

## 命令列表

| 命令 | 功能 |
| --- | --- |
| `indicators` | 列出分省年度数据所有可用指标 |
| `gdp` | 获取各省地区生产总值（GDP） |
| `retail` | 获取各省社会消费品零售总额 |
| `query` | 通用指标查询（输入指标名称查询各省数据） |
| `report` | 生成 HTML 可视化报告 |
| `export` | 导出缓存数据为 JSON/CSV |

## 使用示例

```bash
xbrowser --cdp 9221 stats indicators
```
```bash
xbrowser --cdp 9221 stats gdp
```
```bash
xbrowser --cdp 9221 stats retail
```
```bash
xbrowser --cdp 9221 stats query
```
```bash
xbrowser --cdp 9221 stats report
```
```bash
xbrowser --cdp 9221 stats export
```

## 注意事项

1. 本插件无需登录即可使用
2. 避免频繁请求，防止触发反爬
3. 仅用于学习研究，不得用于商业用途

## 许可证

MIT License
