# GEO 数据采集和分析系统

## 简介

GEO（Generative Engine Optimization）数据采集和分析系统是一个强大的工具，用于批量采集 AI 搜索引擎数据、分析域名/平台排名、计算企业排名和趋势分析。

## 文件结构

```
analytics/
├── collector.mjs          # 批量采集脚本
├── analyzer.mjs           # 数据分析脚本
├── report-generator.mjs   # 报告生成脚本
└── README.md             # 本文件
```

## 快速开始

### 1. 批量采集

```bash
# 使用默认引擎采集
node collector.mjs "广东服装加工企业"

# 使用指定引擎
node collector.mjs "广东服装加工企业" "kimi,deepseek,yuanbao"

# 使用所有引擎（前 16 个）
node collector.mjs "广东服装加工企业" "all" 16
```

### 2. 数据分析

```bash
# 完整分析
node analyzer.mjs full

# 域名分析
node analyzer.mjs domains

# 趋势分析
node analyzer.mjs trends
```

### 3. 生成报告

```bash
# 生成 JSON 报告
node report-generator.mjs json

# 生成 Markdown 报告
node report-generator.mjs markdown

# 生成 HTML 报告
node report-generator.mjs html

# 生成所有格式
node report-generator.mjs all
```

## 使用 xbrowser 命令

### 采集数据

```bash
# 基本采集
xbrowser geo-analysis --keyword "广东服装加工企业" --mode collect

# 多引擎采集
xbrowser geo-analysis --keyword "广东服装加工企业" --engines kimi,deepseek,yuanbao --mode collect

# 全部引擎采集
xbrowser geo-analysis --keyword "广东服装加工企业" --engines kimi,deepseek,yuanbao,chatglm,metaso,hailuo,tiangong,spark,claude,gpt,copilot,gemini,qianwen,wenxin,doubao,yi --mode collect
```

### 数据分析

```bash
# 分析数据
xbrowser geo-analysis --keyword "广东服装加工企业" --mode analyze

# 企业排名
xbrowser geo-analysis --keyword "广东服装加工企业" --mode rank

# 趋势分析
xbrowser geo-analysis --keyword "广东服装加工企业" --mode trend --timeframe 7d
```

### 生成报告

```bash
# JSON 报告
xbrowser geo-analysis --keyword "广东服装加工企业" --mode report --output json

# Markdown 报告
xbrowser geo-analysis --keyword "广东服装加工企业" --mode report --output markdown
```

## 支持的 AI 引擎

```
kimi, deepseek, yuanbao, chatglm, metaso, hailuo, tiangong, spark,
claude, gpt, copilot, gemini, qianwen, wenxin, doubao, yi
```

## 数据存储

采集的数据存储在 `./data/xbrowser-collection/` 目录下：

```
./data/xbrowser-collection/
├── engines/           # 按引擎分类
├── by-date/          # 按日期分类
├── exports/          # 导出的数据
├── reports/          # 生成的报告
└── backups/          # 备份数据
```

## 功能特性

- ✅ 批量采集 16 个 AI 搜索引擎
- ✅ 外链去重和聚合
- ✅ 按域名/平台分类统计
- ✅ 企业排名计算
- ✅ 趋势分析
- ✅ 多种格式报告输出（JSON/Markdown/HTML）
- ✅ SQLite 数据库支持
- ✅ 自动备份
- ✅ 数据导出

## 文档

详细使用文档请参考 [docs/GEO-ANALYSIS.md](../docs/GEO-ANALYSIS.md)

## 开发

### 构建项目

```bash
npm run build
```

### 类型检查

```bash
npm run typecheck
```

### Lint 检查

```bash
npm run lint
```

## 贡献

欢迎提交 Issue 和 Pull Request！

## 许可证

MIT
