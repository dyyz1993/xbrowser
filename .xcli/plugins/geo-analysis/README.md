# GEO 外链排名分析插件

一键搜索所有 AI 搜索引擎（DeepSeek/豆包/Kimi/通义千问/元宝/智谱/文心/秘塔/天工/纳米AI），提取引用外链，按域名/平台聚合排名，生成发帖策略报告。

## 安装

```bash
xbrowser plugin install geo-analysis
```

## 命令

### all - 一键聚合搜索
```bash
xbrowser geo-analysis all --keyword "广东服装加工企业排名" --cdp http://localhost:9221
```

### collect - 单引擎采集
```bash
xbrowser geo-analysis collect --keyword "AI 编程工具" --engine deepseek --cdp http://localhost:9221
```

### batch - 批量采集
```bash
xbrowser geo-analysis batch --keyword "Rust 语言" --engines "kimi,deepseek,doubao" --cdp http://localhost:9221
```

### rank - 域名排名
```bash
xbrowser geo-analysis rank --top 20 --format markdown
```

### report - 导出报告
```bash
xbrowser geo-analysis report --keyword "AI" --format markdown
```

## 支持 AI 引擎

| 引擎 | 标识 | 联网搜索 |
|------|------|---------|
| DeepSeek | deepseek | ✅ |
| 豆包 | doubao | ✅ |
| Kimi | kimi | ✅ |
| 通义千问 | tongyi | ✅ |
| 腾讯元宝 | yuanbao | ✅ |
| 智谱清言 | zhipu | ✅ |
| 文心一言 | wenxin | ✅ |
| 秘塔AI | metaso | ✅ |
| 天工AI | tiangong | ✅ |
| 纳米AI | 360ai | ✅ |

## 输出示例

```
=== AI 搜索引擎聚合结果 ===
查询：广东服装加工企业排名
引擎数：9（成功 9，失败 0）

--- 域名排名 Top 10 ---
1. jobui.com (职友集) — 4 引擎引用
2. 163.com (网易号) — 3 引擎引用
3. smzdm.com (什么值得买) — 3 引擎引用
...
```

## 技术原理

1. **SSE 网络拦截**：监听 AI 引擎的 API 响应，从 SSE 流中提取引用链接
2. **DOM 全页面提取**：提取页面所有外链 `<a>` 标签
3. **去噪过滤**：移除 .ico/.svg/.png/CDN/广告追踪等噪音
4. **跨引擎聚合**：按域名去重，统计被多少引擎引用

## License

MIT
