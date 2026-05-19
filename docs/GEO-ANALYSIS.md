# GEO 数据采集和分析系统使用指南

## 概述

GEO（Generative Engine Optimization）数据采集和分析系统是一个强大的工具，用于：
- 批量采集 16 个 AI 搜索引擎的数据
- 分析域名/平台排名
- 计算企业排名
- 进行趋势分析
- 生成可视化报告

## 快速开始

### 1. 基本采集

```bash
# 使用默认引擎（kimi）采集
xbrowser geo-analysis --keyword "广东服装加工企业" --mode collect

# 使用指定引擎采集
xbrowser geo-analysis --keyword "广东服装加工企业" --engines kimi,deepseek,yuanbao --mode collect

# 使用所有引擎采集
xbrowser geo-analysis --keyword "广东服装加工企业" --engines kimi,deepseek,yuanbao,chatglm,metaso,hailuo,tiangong,spark --mode collect
```

### 2. 数据分析

```bash
# 分析已采集的数据
xbrowser geo-analysis --keyword "广东服装加工企业" --mode analyze

# 计算企业排名
xbrowser geo-analysis --keyword "广东服装加工企业" --mode rank

# 分析趋势
xbrowser geo-analysis --keyword "广东服装加工企业" --mode trend --timeframe 7d
```

### 3. 生成报告

```bash
# 生成 JSON 报告
xbrowser geo-analysis --keyword "广东服装加工企业" --mode report --output json

# 生成 Markdown 报告
xbrowser geo-analysis --keyword "广东服装加工企业" --mode report --output markdown
```

## 命令参数

### 核心参数

- `keyword` (必需): 搜索关键词
- `engines` (可选): AI 搜索引擎列表，默认 ['kimi']
- `mode` (可选): 执行模式，默认 'collect'
  - `collect`: 采集数据
  - `analyze`: 分析数据
  - `rank`: 计算企业排名
  - `trend`: 分析趋势
  - `report`: 生成完整报告
- `timeframe` (可选): 时间范围，默认 '7d'（7d/30d/90d）
- `output` (可选): 输出格式，默认 'json'（json/markdown）
- `cdpEndpoint` (可选): CDP endpoint URL

### 支持的 AI 引擎

```
kimi, deepseek, yuanbao, chatglm, metaso, hailuo, tiangong, spark,
claude, gpt, copilot, gemini, qianwen, wenxin, doubao, yi
```

## 批量采集脚本

### collector.mjs

批量采集工具，支持大规模数据采集：

```bash
# 使用默认设置采集
node analytics/collector.mjs "广东服装加工企业"

# 使用指定引擎
node analytics/collector.mjs "广东服装加工企业" "kimi,deepseek,yuanbao"

# 限制引擎数量
node analytics/collector.mjs "广东服装加工企业" "all" 5
```

### analyzer.mjs

数据分析工具：

```bash
# 完整分析
node analytics/analyzer.mjs full

# 域名分析
node analytics/analyzer.mjs domains

# 趋势分析
node analytics/analyzer.mjs trends
```

### report-generator.mjs

报告生成工具：

```bash
# 生成 JSON 报告
node analytics/report-generator.mjs json

# 生成 Markdown 报告
node analytics/report-generator.mjs markdown

# 生成 HTML 报告
node analytics/report-generator.mjs html

# 生成所有格式
node analytics/report-generator.mjs all
```

## 数据存储

### 存储结构

```
./data/xbrowser-collection/
├── engines/           # 按引擎分类存储
│   ├── kimi/
│   ├── deepseek/
│   └── ...
├── by-date/          # 按日期分类存储
│   ├── 2026/
│   │   ├── 05/
│   │   │   └── 19/
│   │   └── ...
│   └── ...
├── exports/          # 导出的数据
│   ├── analysis-xxx.json
│   └── analysis-xxx.md
├── reports/          # 生成的报告
│   ├── geo-report-xxx.json
│   ├── geo-report-xxx.md
│   └── geo-report-xxx.html
└── backups/          # 备份数据
```

### 数据格式

#### 搜索结果 (SearchResult)

```json
{
  "id": "abc123",
  "query": "广东服装加工企业",
  "engine": "kimi",
  "timestamp": 1742342400000,
  "total": 10,
  "results": [
    {
      "title": "企业标题",
      "url": "https://example.com",
      "snippet": "摘要内容",
      "position": 1
    }
  ],
  "domainExtraction": {
    "query": "广东服装加工企业",
    "totalUrls": 25,
    "totalDomains": 10,
    "domains": [
      {
        "domain": "example.com",
        "count": 5,
        "urls": ["https://example.com/1"],
        "platform": "招聘平台"
      }
    ]
  }
}
```

#### 分析结果 (AnalysisResult)

```json
{
  "domainRankings": [
    {
      "domain": "example.com",
      "count": 15,
      "urls": [...],
      "platform": "招聘平台",
      "firstSeen": "2026-05-19T00:00:00.000Z",
      "lastSeen": "2026-05-19T12:00:00.000Z",
      "trends": [5, 10, 15]
    }
  ],
  "topCompanies": [...],
  "engineDistribution": {...},
  "queryHistory": [...],
  "totalQueries": 1,
  "totalResults": 100,
  "uniqueDomains": 20,
  "generatedAt": 1742342400000
}
```

## 高级用法

### 1. 自定义引擎配置

```typescript
import { DataCollector, DEFAULT_COLLECTOR_CONFIG } from './src/data-collector/index.js';

const collector = new DataCollector({
  ...DEFAULT_COLLECTOR_CONFIG,
  engines: ['kimi', 'deepseek'],
  timeout: 30000,
  delayBetweenEngines: 5000,
});
```

### 2. 自定义分析

```typescript
import { ResultAnalyzer, DataStorage } from './src/data-collector/index.js';

const storage = new DataStorage();
const history = await storage.loadAllHistory(100);
const analyzer = new ResultAnalyzer(history);

const analysis = analyzer.analyzeAll();
const rankings = analyzer.analyzeDomainRankings();
const companies = analyzer.identifyCompanies();
```

### 3. 趋势分析

```typescript
// 获取特定域名的趋势数据
const trends = analyzer.getDomainTrends('example.com');

// 比较两个引擎
const comparison = analyzer.compareEngines('kimi', 'deepseek');

// 按日期范围过滤
const filtered = analyzer.filterByDateRange(
  new Date('2026-05-01'),
  new Date('2026-05-19')
);
```

## 常见问题

### Q: 如何查看已采集的数据？

A: 使用 `loadAllHistory` 方法：

```javascript
const storage = new DataStorage();
const history = await storage.loadAllHistory(100);
console.log(`Found ${history.length} results`);
```

### Q: 如何导出数据？

A: 使用存储服务的导出方法：

```javascript
await storage.exportToJSON('./export/data.json');
await storage.exportToCSV('./export/data.csv');
await storage.exportToMarkdown('./export/data.md');
```

### Q: 如何清理历史数据？

A: 使用存储服务的清理方法：

```javascript
await storage.clearEngineHistory('kimi');  // 清理特定引擎
await storage.clearAllHistory();           // 清理所有数据
```

### Q: 如何提高采集成功率？

A:
1. 增加超时时间：`timeout: 90000`
2. 增加重试次数：`maxRetries: 3`
3. 增加引擎间延迟：`delayBetweenEngines: 5000`
4. 使用稳定的网络连接

## 数据库支持

系统支持 SQLite 数据库存储，schema 文件位于 `schema/geo-analysis-schema.sql`。

### 初始化数据库

```bash
sqlite3 data/xbrowser-collection/database.db < schema/geo-analysis-schema.sql
```

### 主要表结构

- `search_results`: 搜索结果
- `domain_stats`: 域名统计
- `companies`: 企业信息
- `trends`: 趋势数据
- `engine_info`: 引擎信息

## 性能优化

1. **批量采集**: 使用 `collectAll` 而非多次调用 `collectSingle`
2. **并行处理**: 合理设置 `delayBetweenEngines` 避免被限制
3. **数据缓存**: 利用存储服务的缓存机制
4. **增量更新**: 只采集新的数据点

## 最佳实践

1. **定期备份**: 启用 `autoBackup` 选项
2. **数据验证**: 采集后检查数据质量
3. **趋势监控**: 定期运行趋势分析
4. **报告归档**: 定期导出和归档报告

## API 参考

详细的 API 文档请参考源代码中的 TypeScript 类型定义。

## 贡献

欢迎提交 Issue 和 Pull Request！
