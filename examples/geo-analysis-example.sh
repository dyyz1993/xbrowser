#!/bin/bash
# GEO 数据采集和分析系统 - 使用示例

echo "══════════════════════════════════════════════════════════════"
echo "         GEO 数据采集和分析系统 - 使用示例"
echo "══════════════════════════════════════════════════════════════"
echo ""

# 示例 1：基本采集
echo "📌 示例 1：基本采集（使用默认引擎 kimi）"
echo "命令：xbrowser geo-analysis --keyword \"广东服装加工企业\" --mode collect"
echo ""

# 示例 2：多引擎采集
echo "📌 示例 2：多引擎采集（3 个引擎）"
echo "命令：xbrowser geo-analysis --keyword \"广东服装加工企业\" --engines kimi,deepseek,yuanbao --mode collect"
echo ""

# 示例 3：全引擎采集
echo "📌 示例 3：全引擎采集（16 个引擎）"
echo "命令：xbrowser geo-analysis --keyword \"广东服装加工企业\" \\"
echo "       --engines kimi,deepseek,yuanbao,chatglm,metaso,hailuo,tiangong,spark,claude,gpt,copilot,gemini,qianwen,wenxin,doubao,yi \\"
echo "       --mode collect"
echo ""

# 示例 4：数据分析
echo "📌 示例 4：数据分析"
echo "命令：xbrowser geo-analysis --keyword \"广东服装加工企业\" --mode analyze"
echo ""

# 示例 5：企业排名
echo "📌 示例 5：企业排名"
echo "命令：xbrowser geo-analysis --keyword \"广东服装加工企业\" --mode rank"
echo ""

# 示例 6：趋势分析
echo "📌 示例 6：趋势分析（7 天时间窗口）"
echo "命令：xbrowser geo-analysis --keyword \"广东服装加工企业\" --mode trend --timeframe 7d"
echo ""

# 示例 7：生成 JSON 报告
echo "📌 示例 7：生成 JSON 报告"
echo "命令：xbrowser geo-analysis --keyword \"广东服装加工企业\" --mode report --output json"
echo ""

# 示例 8：生成 Markdown 报告
echo "📌 示例 8：生成 Markdown 报告"
echo "命令：xbrowser geo-analysis --keyword \"广东服装加工企业\" --mode report --output markdown"
echo ""

# 示例 9：使用脚本批量采集
echo "📌 示例 9：使用脚本批量采集"
echo "命令：node analytics/collector.mjs \"广东服装加工企业\" \"kimi,deepseek,yuanbao\""
echo ""

# 示例 10：使用脚本生成报告
echo "📌 示例 10：使用脚本生成所有格式报告"
echo "命令：node analytics/report-generator.mjs all"
echo ""

echo "══════════════════════════════════════════════════════════════"
echo "                   数据存储位置"
echo "══════════════════════════════════════════════════════════════"
echo ""
echo "采集的数据存储在："
echo "  ./data/xbrowser-collection/"
echo ""
echo "目录结构："
echo "  ├── engines/           # 按引擎分类存储"
echo "  ├── by-date/          # 按日期分类存储"
echo "  ├── exports/          # 导出的数据"
echo "  ├── reports/          # 生成的报告"
echo "  └── backups/          # 备份数据"
echo ""

echo "══════════════════════════════════════════════════════════════"
echo "                   支持的引擎列表"
echo "══════════════════════════════════════════════════════════════"
echo ""
echo "kimi, deepseek, yuanbao, chatglm, metaso, hailuo, tiangong, spark,"
echo "claude, gpt, copilot, gemini, qianwen, wenxin, doubao, yi"
echo ""

echo "══════════════════════════════════════════════════════════════"
echo "                   参数说明"
echo "══════════════════════════════════════════════════════════════"
echo ""
echo "--keyword     搜索关键词（必需）"
echo "--engines     AI 搜索引擎列表，逗号分隔（默认：kimi）"
echo "--mode        执行模式（默认：collect）"
echo "              - collect: 采集数据"
echo "              - analyze: 分析数据"
echo "              - rank: 计算企业排名"
echo "              - trend: 分析趋势"
echo "              - report: 生成完整报告"
echo "--timeframe   时间范围（默认：7d）"
echo "              - 7d: 最近 7 天"
echo "              - 30d: 最近 30 天"
echo "              - 90d: 最近 90 天"
echo "--output      输出格式（默认：json）"
echo "              - json: JSON 格式"
echo "              - markdown: Markdown 格式"
echo "--cdpEndpoint CDP endpoint URL（可选）"
echo ""

echo "══════════════════════════════════════════════════════════════"
echo "                   文档"
echo "══════════════════════════════════════════════════════════════"
echo ""
echo "详细使用文档："
echo "  docs/GEO-ANALYSIS.md"
echo ""
echo "实现总结："
echo "  docs/GEO-SUMMARY.md"
echo ""
echo "脚本使用指南："
echo "  analytics/README.md"
echo ""

echo "══════════════════════════════════════════════════════════════"
