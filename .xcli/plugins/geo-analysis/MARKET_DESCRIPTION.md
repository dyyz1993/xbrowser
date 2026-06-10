# GEO Analysis

> GEO 外链排名分析 - 多引擎数据采集、域名排名、企业排名、趋势分析

## 命令

- `collect` — 从单个 AI 搜索引擎采集数据（SSE 拦截 + DOM 提取）
- `batch` — 批量从多个 AI 搜索引擎采集数据
- `rank` — 基于历史采集数据生成域名排名和平台排名
- `all` — 一键搜索所有 AI 引擎，自动聚合排名
- `company` — 基于历史采集数据生成企业排名
- `trend` — 基于历史采集数据分析域名出现趋势
- `report` — 基于历史数据生成完整的 GEO 分析报告
- `history` — 查看历史采集记录
- `status` — 查看 GEO 分析系统状态

## 使用

```bash
xbrowser --cdp 9221 geo-analysis <command> [options]
```

### 登录要求

本插件需要登录才能使用。请先在 Chrome 中登录GEO Analysis，然后通过 `--cdp` 连接。
