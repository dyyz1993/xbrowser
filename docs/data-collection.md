# XBrowser Data Collection System

完整的数据采集、存储和分析系统，用于批量收集和分析 AI 搜索引擎结果。

## 功能特性

- 🔍 **批量采集**：支持 16 个 AI 搜索引擎的批量数据采集
- 💾 **持久化存储**：支持文件系统存储，自动备份
- 📊 **数据分析**：域名统计、企业识别、趋势分析
- 📈 **可视化报告**：支持 JSON、CSV、Markdown 格式导出
- 🔬 **深度分析**：企业分类、平台识别、频次追踪

## 快速开始

### 1. 单次采集

从单个引擎采集数据：

```bash
node scripts/collect-single.mjs \
  --engine kimi \
  --query "广东服装加工企业" \
  --output ./data/results
```

### 2. 批量采集

从多个引擎批量采集：

```bash
node scripts/collect-all.mjs \
  --query "广东服装加工企业" \
  --engines kimi,tongyi,yuanbao,chatglm \
  --output ./data/results \
  --analyze \
  --export-report
```

### 3. 企业分析

分析采集到的企业信息：

```bash
node scripts/analyze-companies.mjs \
  --input ./data/results \
  --output ./data/reports \
  --type enterprise \
  --top 50 \
  --export
```

### 4. 导出报告

导出数据和分析报告：

```bash
node scripts/export-report.mjs \
  --input ./data/results \
  --output ./data/exports \
  --format markdown \
  --type all \
  --include-full
```

## 支持的 AI 引擎

- `deepseek` - DeepSeek
- `doubao` - 豆包
- `chatgpt` - ChatGPT
- `claude` - Claude
- `kimi` - Kimi
- `qianwen` - 通义千问
- `yuanbao` - 腾讯元宝
- `chatglm` - 智谱清言
- `yiyan` - 文心一言
- `metaso` - 秘塔AI搜索
- `tiangong` - 天工AI
- `xinghuo` - 讯飞星火
- `hailuo` - 海螺AI
- `360ai` - 纳米AI

## 详细使用说明

### collect-single.mjs - 单次采集

从单个 AI 引擎采集搜索结果。

#### 参数

| 参数 | 说明 | 必填 | 默认值 |
|------|------|------|--------|
| `--engine, -e` | AI 引擎名称 | ✅ | - |
| `--query, -q` | 搜索关键词 | ✅ | - |
| `--timeout, -t` | 超时时间（毫秒） | ❌ | 60000 |
| `--full, -f` | 保存完整 AI 回复 | ❌ | false |
| `--extract-urls` | 提取和分析 URL | ❌ | true |
| `--output, -o` | 输出目录 | ❌ | ./data/xbrowser-collection |
| `--format` | 输出格式（json/csv/markdown） | ❌ | json |
| `--delay` | 请求间隔（毫秒） | ❌ | 2000 |

#### 示例

```bash
# 基本使用
node scripts/collect-single.mjs \
  --engine kimi \
  --query "人工智能最新进展"

# 保存完整回复
node scripts/collect-single.mjs \
  --engine deepseek \
  --query "区块链技术" \
  --full

# 自定义输出目录和格式
node scripts/collect-single.mjs \
  --engine chatgpt \
  --query "机器学习算法" \
  --output ./data/custom \
  --format markdown
```

### collect-all.mjs - 批量采集

从多个 AI 引擎批量采集搜索结果。

#### 参数

| 参数 | 说明 | 必填 | 默认值 |
|------|------|------|--------|
| `--query, -q` | 搜索关键词 | ✅ | - |
| `--engines, -e` | 引擎列表（逗号分隔） | ❌ | 全部引擎 |
| `--timeout, -t` | 单引擎超时时间（毫秒） | ❌ | 60000 |
| `--full, -f` | 保存完整 AI 回复 | ❌ | false |
| `--extract-urls` | 提取和分析 URL | ❌ | true |
| `--output, -o` | 输出目录 | ❌ | ./data/xbrowser-collection |
| `--format` | 输出格式（json/csv/markdown） | ❌ | json |
| `--delay` | 引擎间延迟（毫秒） | ❌ | 2000 |
| `--analyze` | 采集后自动分析 | ❌ | true |
| `--export-report` | 导出分析报告 | ❌ | true |
| `--report-format` | 报告格式（json/markdown） | ❌ | markdown |

#### 示例

```bash
# 采集所有引擎
node scripts/collect-all.mjs \
  --query "广东服装加工企业"

# 指定引擎列表
node scripts/collect-all.mjs \
  --query "人工智能" \
  --engines kimi,tongyi,yuanbao,chatglm

# 不自动分析和导出
node scripts/collect-all.mjs \
  --query "区块链" \
  --analyze false \
  --export-report false

# 导出 JSON 格式报告
node scripts/collect-all.mjs \
  --query "机器学习" \
  --report-format json
```

### analyze-companies.mjs - 企业分析

分析采集到的企业信息，按类型分类。

#### 参数

| 参数 | 说明 | 必填 | 默认值 |
|------|------|------|--------|
| `--input, -i` | 输入数据目录 | ❌ | ./data/xbrowser-collection |
| `--output, -o` | 输出目录 | ❌ | ./data/xbrowser-collection/reports |
| `--type, -t` | 企业类型过滤 | ❌ | - |
| `--top` | 显示前 N 个企业 | ❌ | 20 |
| `--export` | 导出结果到文件 | ❌ | true |
| `--format` | 导出格式（json/csv/markdown） | ❌ | markdown |
| `--min-occurrences` | 最小出现次数 | ❌ | 1 |

#### 企业类型

- `job-platform` - 招聘平台（Boss直聘、拉勾、猎聘等）
- `media` - 媒体（36氪、IT之家、澎湃新闻等）
- `gov` - 政府（.gov.cn 域名）
- `ai-platform` - AI 平台（OpenAI、DeepSeek 等）
- `enterprise` - 企业
- `other` - 其他

#### 示例

```bash
# 分析所有企业
node scripts/analyze-companies.mjs \
  --input ./data/results

# 只分析企业类型
node scripts/analyze-companies.mjs \
  --type enterprise \
  --top 50

# 分析招聘平台
node scripts/analyze-companies.mjs \
  --type job-platform \
  --top 20

# 导出 CSV 格式
node scripts/analyze-companies.mjs \
  --format csv \
  --min-occurrences 5
```

### export-report.mjs - 导出报告

导出采集数据和分析报告。

#### 参数

| 参数 | 说明 | 必填 | 默认值 |
|------|------|------|--------|
| `--input, -i` | 输入数据目录 | ❌ | ./data/xbrowser-collection |
| `--output, -o` | 输出目录 | ❌ | ./data/xbrowser-collection/exports |
| `--format` | 导出格式（json/csv/markdown） | ❌ | json |
| `--type` | 导出类型（results/analysis/all） | ❌ | all |
| `--engine` | 按引擎过滤 | ❌ | - |
| `--query` | 按查询过滤 | ❌ | - |
| `--limit` | 限制结果数量 | ❌ | 1000 |
| `--date-range` | 日期范围（YYYY-MM-DD,YYYY-MM-DD） | ❌ | - |
| `--include-full` | 包含完整 AI 回复 | ❌ | false |

#### 示例

```bash
# 导出所有数据
node scripts/export-report.mjs \
  --format markdown

# 只导出分析报告
node scripts/export-report.mjs \
  --type analysis

# 按引擎过滤
node scripts/export-report.mjs \
  --engine kimi \
  --format csv

# 按日期范围过滤
node scripts/export-report.mjs \
  --date-range 2026-05-01,2026-05-19

# 包含完整 AI 回复
node scripts/export-report.mjs \
  --include-full
```

## 数据结构

### SearchResult

```typescript
interface SearchResult {
  id: string;                    // 唯一标识
  engine: string;                // 引擎名称
  query: string;                 // 搜索查询
  timestamp: number;             // 时间戳
  results: SearchItem[];        // 搜索结果
  total: number;                 // 结果总数
  duration?: string;             // 执行时长
  aiResponse?: string;           // AI 完整回复
  sources?: {                    // 来源信息
    total: number;
    domains: string[];
    urls: Array<{ url: string; domain: string }>;
  };
  domainExtraction?: {           // 域名提取
    query: string;
    totalUrls: number;
    totalDomains: number;
    domains: DomainExtraction[];
  };
  engineInfo?: {                 // 引擎信息
    name: string;
    loginStatus: string;
    internetSearch: { supported: boolean; enabled: boolean; details: string };
    uploadCapabilities: { image: boolean; file: boolean };
  };
}
```

### DomainExtraction

```typescript
interface DomainExtraction {
  domain: string;               // 域名
  count: number;                // URL 数量
  urls: string[];               // URL 列表
  platform?: string;            // 平台名称
}
```

### CompanyInfo

```typescript
interface CompanyInfo {
  name: string;                 // 企业名称
  domain: string;               // 域名
  type: 'job-platform' | 'media' | 'gov' | 'ai-platform' | 'enterprise' | 'other';
  url?: string;                 // URL
  description?: string;         // 描述
}
```

## 存储结构

```
data/xbrowser-collection/
├── engines/                    # 按引擎存储
│   ├── kimi/
│   │   ├── abc123.json
│   │   └── def456.json
│   ├── tongyi/
│   └── ...
├── by-date/                    # 按日期存储
│   ├── 2026/
│   │   ├── 05/
│   │   │   ├── 19/
│   │   │   │   ├── abc123.json
│   │   │   │   └── def456.json
│   │   │   └── ...
│   │   └── ...
│   └── ...
├── exports/                    # 导出文件
│   ├── results-2026-05-19.json
│   ├── analysis-2026-05-19.md
│   └── ...
├── backups/                    # 备份文件
│   ├── kimi/
│   └── ...
└── reports/                    # 分析报告
    ├── analysis-2026-05-19.md
    ├── companies-analysis-2026-05-19.json
    └── ...
```

## 分析功能

### 域名分析
- 统计各域名出现频次
- 识别平台类型（知乎、CSDN、掘金等）
- 追踪域名趋势变化
- 计算域名权重

### 企业识别
- 按类型分类企业
- 统计企业出现频次
- 分析企业分布
- 生成企业排名

### 引擎对比
- 对比不同引擎的搜索结果
- 统计各引擎的成功率
- 分析引擎特点
- 评估引擎效果

### 趋势分析
- 时间序列分析
- 域名热度变化
- 查询历史追踪
- 数据量统计

## 最佳实践

### 1. 采集策略

```bash
# 分批采集，避免请求过快
node scripts/collect-all.mjs \
  --query "查询1" \
  --delay 5000

# 只采集关键引擎
node scripts/collect-all.mjs \
  --query "查询2" \
  --engines kimi,tongyi,deepseek
```

### 2. 数据管理

```bash
# 定期导出备份数据
node scripts/export-report.mjs \
  --format json \
  --output ./data/backups

# 清理过期数据
rm -rf ./data/xbrowser-collection/by-date/2026/04/
```

### 3. 分析优化

```bash
# 按类型分析，更有针对性
node scripts/analyze-companies.mjs \
  --type enterprise \
  --min-occurrences 3

# 导出 Markdown 报告，便于阅读
node scripts/export-report.mjs \
  --format markdown \
  --include-full
```

## 故障排除

### 问题 1：采集失败

**症状**：所有引擎都返回失败

**解决方案**：
```bash
# 检查网络连接
ping kimi.moonshot.cn

# 增加超时时间
node scripts/collect-single.mjs \
  --engine kimi \
  --query "测试" \
  --timeout 120000
```

### 问题 2：数据没有保存

**症状**：采集成功但找不到数据

**解决方案**：
```bash
# 检查输出目录权限
ls -la ./data/xbrowser-collection

# 使用绝对路径
node scripts/collect-single.mjs \
  --engine kimi \
  --query "测试" \
  --output /absolute/path/to/output
```

### 问题 3：分析结果不准确

**症状**：企业分类错误

**解决方案**：
```bash
# 增加最小出现次数阈值
node scripts/analyze-companies.mjs \
  --min-occurrences 5

# 手动检查原始数据
cat ./data/xbrowser-collection/engines/kimi/*.json | jq '.domainExtraction'
```

## 性能优化

### 1. 并发控制

默认情况下，系统会按顺序采集各引擎数据，避免请求过快被封禁。

```bash
# 增加引擎间延迟
node scripts/collect-all.mjs \
  --query "查询" \
  --delay 10000
```

### 2. 数据压缩

定期导出并压缩旧数据：

```bash
# 导出旧数据
node scripts/export-report.mjs \
  --date-range 2026-04-01,2026-04-30

# 压缩导出文件
tar -czf 2026-04-backup.tar.gz ./data/xbrowser-collection/exports/results-*.json
```

### 3. 存储优化

```bash
# 清理重复数据
node scripts/analyze-companies.mjs \
  --min-occurrences 2

# 删除旧数据
rm -rf ./data/xbrowser-collection/by-date/2026/03/
```

## 高级用法

### 1. 定时采集

使用 cron 定时采集：

```bash
# 编辑 crontab
crontab -e

# 添加定时任务（每天凌晨 2 点采集）
0 2 * * * cd /path/to/xbrowser && node scripts/collect-all.mjs --query "最新新闻" >> /var/log/xbrowser-collect.log 2>&1
```

### 2. 多查询采集

创建脚本批量采集多个查询：

```bash
#!/bin/bash
queries=("人工智能" "区块链" "机器学习" "深度学习")

for query in "${queries[@]}"; do
  echo "Collecting: $query"
  node scripts/collect-all.mjs \
    --query "$query" \
    --delay 5000
  sleep 10
done
```

### 3. 数据可视化

导出数据后使用 Excel、Tableau 或其他工具可视化：

```bash
# 导出 CSV 格式
node scripts/export-report.mjs \
  --format csv \
  --type analysis

# 使用 Excel 打开
open ./data/xbrowser-collection/exports/analysis-*.csv
```

## 扩展开发

### 添加新的分析功能

在 `src/data-collector/analyzer.ts` 中添加新方法：

```typescript
export class ResultAnalyzer {
  // 新增：情感分析
  analyzeSentiment(): Map<string, number> {
    const sentimentScores = new Map<string, number>();
    
    this.results.forEach(result => {
      // 实现情感分析逻辑
    });
    
    return sentimentScores;
  }
}
```

### 添加新的导出格式

在 `src/data-collector/storage.ts` 中添加新方法：

```typescript
export class DataStorage {
  async exportToExcel(outputPath: string): Promise<void> {
    // 实现导出 Excel 格式
  }
}
```

## 常见问题 (FAQ)

**Q: 支持哪些 AI 搜索引擎？**
A: 目前支持 16 个主流 AI 搜索引擎，包括 DeepSeek、豆包、ChatGPT、Claude、Kimi、通义千问等。

**Q: 如何增加采集成功率？**
A: 1) 增加超时时间（--timeout 120000）2) 增加引擎间延迟（--delay 5000）3) 确保网络连接稳定。

**Q: 数据存储在哪里？**
A: 默认存储在 `./data/xbrowser-collection/` 目录，包含按引擎、按日期两种组织方式。

**Q: 如何导出数据？**
A: 使用 `export-report.mjs` 脚本，支持 JSON、CSV、Markdown 三种格式。

**Q: 可以自定义企业分类吗？**
A: 可以修改 `src/data-collector/config.ts` 中的 `getCompanyType` 函数。

**Q: 如何处理采集失败的情况？**
A: 系统会自动记录错误信息，其他引擎会继续采集。可以查看日志文件排查问题。

## 技术支持

如有问题或建议，请通过以下方式联系：

- GitHub Issues: [项目地址]
- 邮件: [联系邮箱]

## 许可证

MIT License