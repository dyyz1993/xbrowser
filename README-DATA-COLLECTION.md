# XBrowser Data Collection System

完整的 AI 搜索结果数据采集、存储和分析系统。

## 快速开始

### 1. 测试系统

```bash
# 运行系统测试
node scripts/test-data-collection.mjs
```

### 2. 单次采集

```bash
# 从单个引擎采集
node scripts/collect-single.mjs \
  --engine deepseek \
  --query "人工智能最新进展" \
  --output ./data/my-collection
```

### 3. 批量采集

```bash
# 从多个引擎批量采集
node scripts/collect-all.mjs \
  --query "广东服装加工企业" \
  --engines kimi,tongyi,deepseek \
  --output ./data/my-collection \
  --analyze \
  --export-report
```

### 4. 企业分析

```bash
# 分析企业信息
node scripts/analyze-companies.mjs \
  --input ./data/my-collection \
  --output ./data/reports \
  --type enterprise \
  --top 50
```

### 5. 导出报告

```bash
# 导出数据和分析报告
node scripts/export-report.mjs \
  --input ./data/my-collection \
  --output ./data/exports \
  --format markdown \
  --type all
```

## 系统架构

```
src/data-collector/
├── types.ts           # 类型定义
├── config.ts          # 配置和工具函数
├── storage.ts         # 存储层实现
├── analyzer.ts        # 数据分析器
├── collector.ts       # 主采集器
└── index.ts           # 模块导出

scripts/
├── collect-single.mjs       # 单次采集脚本
├── collect-all.mjs          # 批量采集脚本
├── analyze-companies.mjs    # 企业分析脚本
├── export-report.mjs        # 报告导出脚本
└── test-data-collection.mjs # 系统测试脚本
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

## 核心功能

### 数据采集
- ✅ 支持 14 个 AI 搜索引擎
- ✅ 自动提取 URL 和域名
- ✅ 识别平台类型
- ✅ 容错机制（单个引擎失败不影响其他）
- ✅ 可配置延迟和超时

### 数据存储
- ✅ 按引擎和日期双重索引
- ✅ 自动备份
- ✅ 支持多种格式（JSON、CSV、Markdown）
- ✅ 存储统计和管理

### 数据分析
- ✅ 域名排名统计
- ✅ 企业类型分类
- ✅ 引擎分布分析
- ✅ 趋势追踪
- ✅ 生成详细报告

## 使用示例

### 采集多个关键词

```bash
#!/bin/bash
queries=("人工智能" "区块链" "机器学习" "深度学习")

for query in "${queries[@]}"; do
  node scripts/collect-all.mjs \
    --query "$query" \
    --engines kimi,tongyi,deepseek \
    --delay 5000
  sleep 10
done
```

### 定时采集

```bash
# 编辑 crontab
crontab -e

# 每天凌晨 2 点采集
0 2 * * * cd /path/to/xbrowser && node scripts/collect-all.mjs --query "最新新闻" >> /var/log/xbrowser.log 2>&1
```

### 数据可视化

```bash
# 导出 CSV 格式
node scripts/export-report.mjs --format csv --type analysis

# 使用 Excel 或其他工具打开
open ./data/xbrowser-collection/exports/analysis-*.csv
```

## 数据结构

### SearchResult
```typescript
{
  id: string;
  engine: string;
  query: string;
  timestamp: number;
  results: SearchItem[];
  total: number;
  duration?: string;
  aiResponse?: string;
  domainExtraction?: {
    totalUrls: number;
    totalDomains: number;
    domains: DomainExtraction[];
  };
  engineInfo?: {
    name: string;
    loginStatus: string;
    internetSearch: { supported: boolean; enabled: boolean; details: string };
    uploadCapabilities: { image: boolean; file: boolean };
  };
}
```

## 存储结构

```
data/xbrowser-collection/
├── engines/           # 按引擎存储
│   ├── kimi/
│   ├── deepseek/
│   └── ...
├── by-date/           # 按日期存储
│   ├── 2026/
│   │   ├── 05/
│   │   │   └── 19/
│   │   └── ...
│   └── ...
├── exports/           # 导出文件
│   ├── results-*.json
│   ├── analysis-*.md
│   └── ...
├── backups/           # 备份文件
│   └── ...
└── reports/           # 分析报告
    └── ...
```

## 性能优化

### 1. 采集策略
- 增加引擎间延迟：`--delay 5000`
- 只采集关键引擎：`--engines kimi,tongyi`
- 调整超时时间：`--timeout 120000`

### 2. 数据管理
- 定期导出备份数据
- 清理过期数据
- 压缩历史数据

### 3. 分析优化
- 设置最小出现次数：`--min-occurrences 3`
- 按类型分析：`--type enterprise`
- 限制结果数量：`--limit 500`

## 故障排除

### 采集失败
```bash
# 增加超时时间
node scripts/collect-single.mjs \
  --engine kimi \
  --query "测试" \
  --timeout 120000

# 检查网络连接
ping kimi.moonshot.cn
```

### 数据未保存
```bash
# 检查输出目录权限
ls -la ./data/xbrowser-collection

# 使用绝对路径
node scripts/collect-single.mjs \
  --engine kimi \
  --query "测试" \
  --output /absolute/path/to/output
```

## 高级用法

### 自定义企业分类
编辑 `src/data-collector/config.ts` 中的 `getCompanyType` 函数。

### 添加新的分析功能
在 `src/data-collector/analyzer.ts` 中添加新方法。

### 扩展导出格式
在 `src/data-collector/storage.ts` 中添加新方法。

## 文档

详细使用文档请参考：`docs/data-collection.md`

## 许可证

MIT License