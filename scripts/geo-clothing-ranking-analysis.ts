import { promises as fs } from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const QUERY = '广东服装加工企业';
const OUTPUT_DIR = './data/geo/clothing-ranking';
const DATE = new Date().toISOString().split('T')[0];
const CDP = 'http://localhost:9221';

// 16个AI搜索引擎
const ENGINES = [
  'deepseek', 'doubao', 'chatgpt', 'claude',
  'kimi', 'qianwen', 'yuanbao', 'chatglm',
  'yiyan', 'metaso', 'tiangong', 'xinghuo',
  'hailuo', '360ai'
];

// 平台分类映射
const PLATFORM_CATEGORIES = {
  '招聘平台': [
    'app.mokahr.com', 'zhipin.com', 'zhaopin.com', '51job.com',
    'lagou.com', 'liepin.com', 'jobui.com', 'jobcn.com',
    'yingjiesheng.com', 'ganji.com', '58.com'
  ],
  '媒体平台': [
    'news.qq.com', 'sohu.com', '163.com', 'sina.com.cn',
    'thepaper.cn', 'guancha.cn', 'ifeng.com', 'qq.com',
    'baijiahao.baidu.com', 'toutiao.com'
  ],
  '技术社区': [
    'zhihu.com', 'juejin.cn', 'csdn.net', 'segmentfault.com',
    'cnblogs.com', 'jianshu.com', '51cto.com', 'oschina.net',
    'infoq.cn', 'mp.weixin.qq.com'
  ],
  '社交平台': [
    'weibo.com', 'douyin.com', 'xiaohongshu.com', 'bilibili.com'
  ],
  '企业官网': [] // 动态识别
};

interface EngineResult {
  query: string;
  engine: string;
  results: any[];
  total: number;
  timestamp: number;
  domainExtraction?: {
    query: string;
    totalUrls: number;
    totalDomains: number;
    domains: Array<{
      domain: string;
      count: number;
      urls: string[];
      platform?: string;
    }>;
  };
  engineInfo?: {
    name: string;
    loginStatus: string;
    internetSearch: any;
    uploadCapabilities: any;
  };
  duration?: string;
}

// 确保输出目录存在
async function ensureDir(dir: string) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (e) {
    // ignore
  }
}

// 执行单个引擎搜索
async function searchEngine(engine: string): Promise<EngineResult | null> {
  const outputPath = path.join(OUTPUT_DIR, `${engine}-${DATE}.json`);
  console.log(`\n🔍 [${engine}] 正在搜索 "${QUERY}"...`);

  return new Promise((resolve) => {
    const args = [
      'xbrowser', 'ai-search', QUERY,
      '--engine', engine,
      '--extractUrls',
      '--format', 'json',
      '--output', outputPath,
      '--cdp', CDP,
      '--timeout', '90000' // 90秒超时
    ];

    const proc = spawn('npx', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120000 // 整个进程120秒超时
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', async (code) => {
      if (code !== 0) {
        console.error(`❌ [${engine}] 搜索失败 (code ${code}): ${stderr.slice(0, 200)}`);
        resolve(null);
        return;
      }

      try {
        // 尝试从文件读取结果
        const fileContent = await fs.readFile(outputPath, 'utf-8');
        const result = JSON.parse(fileContent);
        console.log(`✅ [${engine}] 搜索成功，提取到 ${result.domainExtraction?.totalUrls || 0} 个 URL`);
        resolve(result);
      } catch (e) {
        // 如果文件不存在，尝试从 stdout 解析
        try {
          const result = JSON.parse(stdout);
          console.log(`✅ [${engine}] 搜索成功，提取到 ${result.domainExtraction?.totalUrls || 0} 个 URL`);
          resolve(result);
        } catch (e2) {
          console.error(`❌ [${engine}] 解析结果失败: ${e2}`);
          resolve(null);
        }
      }
    });

    proc.on('error', (err) => {
      console.error(`❌ [${engine}] 进程错误: ${err.message}`);
      resolve(null);
    });
  });
}

// 批量搜索所有引擎
async function batchSearch(): Promise<EngineResult[]> {
  console.log('🚀 开始批量搜索 16 个 AI 引擎...\n');
  const results: EngineResult[] = [];

  for (const engine of ENGINES) {
    const result = await searchEngine(engine);
    if (result) {
      results.push(result);
    }
    // 每个搜索之间间隔2秒，避免请求过快
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  return results;
}

// 聚合分析所有结果
function aggregateResults(results: EngineResult[]) {
  const domainStats = new Map<string, {
    totalEngines: number;
    totalUrls: number;
    engines: string[];
    urls: string[];
    platform?: string;
  }>();

  const engineStats = new Map<string, {
    engine: string;
    name: string;
    totalUrls: number;
    totalDomains: number;
    domains: string[];
  }>();

  for (const result of results) {
    if (!result.domainExtraction) continue;

    // 统计每个引擎的外链情况
    engineStats.set(result.engine, {
      engine: result.engine,
      name: result.engineInfo?.name || result.engine,
      totalUrls: result.domainExtraction.totalUrls,
      totalDomains: result.domainExtraction.totalDomains,
      domains: result.domainExtraction.domains.map(d => d.domain)
    });

    // 聚合域名统计
    for (const domainEntry of result.domainExtraction.domains) {
      const domain = domainEntry.domain;

      if (!domainStats.has(domain)) {
        domainStats.set(domain, {
          totalEngines: 0,
          totalUrls: 0,
          engines: [],
          urls: [],
          platform: domainEntry.platform
        });
      }

      const stat = domainStats.get(domain)!;
      stat.totalEngines++;
      stat.totalUrls += domainEntry.count;
      if (!stat.engines.includes(result.engine)) {
        stat.engines.push(result.engine);
      }
      // 合并URL并去重
      for (const url of domainEntry.urls) {
        if (!stat.urls.includes(url)) {
          stat.urls.push(url);
        }
      }
    }
  }

  // 识别平台类型
  function identifyPlatformType(domain: string): string {
    for (const [type, patterns] of Object.entries(PLATFORM_CATEGORIES)) {
      for (const pattern of patterns) {
        if (domain === pattern || domain.endsWith('.' + pattern)) {
          return type;
        }
      }
    }
    // 尝试识别为企业官网（包含 company, factory, textile, clothing 等关键词）
    const companyKeywords = ['company', 'factory', 'co.', 'ltd', 'corp', 'textile', 'clothing', 'garment', 'fashion', 'clothes'];
    if (companyKeywords.some(kw => domain.includes(kw))) {
      return '企业官网';
    }
    return '其他';
  }

  // 识别企业官网域名
  const domainList = Array.from(domainStats.entries());
  for (const [domain, stat] of domainList) {
    if (stat.totalEngines >= 2) { // 被2个以上引擎引用的可能是重要企业官网
      const type = identifyPlatformType(domain);
      if (type === '其他' && domain.length < 30 && domain.includes('.')) {
        stat.platform = '企业官网';
      }
    }
  }

  return { domainStats, engineStats };
}

// 生成排名报告
async function generateReport(
  results: EngineResult[],
  aggregated: { domainStats: Map<any, any>, engineStats: Map<any, any> }
) {
  const { domainStats, engineStats } = aggregated;

  // 按总引用次数排序的域名
  const sortedDomains = Array.from(domainStats.entries())
    .sort((a, b) => b[1].totalEngines - a[1].totalEngines);

  // 按外链数量排序的引擎
  const sortedEngines = Array.from(engineStats.values())
    .sort((a, b) => b.totalUrls - a.totalUrls);

  // 平台类型分布
  const platformDistribution = new Map<string, number>();
  for (const [domain, stat] of domainStats) {
    const type = stat.platform || identifyPlatformType(domain);
    platformDistribution.set(type, (platformDistribution.get(type) || 0) + 1);
  }

  function identifyPlatformType(domain: string): string {
    for (const [type, patterns] of Object.entries(PLATFORM_CATEGORIES)) {
      for (const pattern of patterns) {
        if (domain === pattern || domain.endsWith('.' + pattern)) {
          return type;
        }
      }
    }
    return '其他';
  }

  // 生成 Markdown 报告
  const mdReport = generateMarkdownReport(
    QUERY,
    results,
    sortedEngines,
    sortedDomains,
    platformDistribution
  );

  // 生成 Excel 数据
  const excelData = generateExcelData(sortedDomains, sortedEngines, platformDistribution);

  // 生成 JSON 报告
  const jsonReport = {
    query: QUERY,
    timestamp: new Date().toISOString(),
    totalEngines: results.length,
    successfulEngines: results.length,
    summary: {
      totalDomains: domainStats.size,
      totalUrls: Array.from(domainStats.values()).reduce((sum, d) => sum + d.totalUrls, 0),
      avgUrlsPerEngine: results.length > 0
        ? Array.from(engineStats.values()).reduce((sum, e) => sum + e.totalUrls, 0) / results.length
        : 0
    },
    engineRanking: sortedEngines.map(e => ({
      rank: sortedEngines.indexOf(e) + 1,
      engine: e.engine,
      name: e.name,
      totalUrls: e.totalUrls,
      totalDomains: e.totalDomains
    })),
    domainRanking: sortedDomains.map(([domain, stat], index) => ({
      rank: index + 1,
      domain,
      platform: stat.platform,
      totalEngines: stat.totalEngines,
      totalUrls: stat.totalUrls,
      engines: stat.engines,
      sampleUrls: stat.urls.slice(0, 3)
    })),
    platformDistribution: Array.from(platformDistribution.entries()).map(([type, count]) => ({
      type,
      count,
      percentage: ((count / domainStats.size) * 100).toFixed(1)
    }))
  };

  return { mdReport, excelData, jsonReport };
}

function generateMarkdownReport(
  query: string,
  results: EngineResult[],
  sortedEngines: any[],
  sortedDomains: any[],
  platformDistribution: Map<string, number>
): string {
  const lines: string[] = [];

  lines.push('# GEO（Generative Engine Optimization）外链排名分析报告');
  lines.push('');
  lines.push(`> 搜索关键词: ${query}`);
  lines.push(`> 采集时间: ${new Date().toLocaleString('zh-CN')}`);
  lines.push(`> 分析引擎: ${results.length} 个`);
  lines.push('');

  lines.push('---');
  lines.push('');

  lines.push('## 一、平台排名（按引擎外链总数）');
  lines.push('');
  lines.push('| 排名 | 引擎 | 外链数 | 域名数 | 说明 |');
  lines.push('|------|------|--------|--------|------|');
  for (const engine of sortedEngines.slice(0, 16)) {
    const info = results.find(r => r.engine === engine.engine)?.engineInfo;
    const internetSearch = info?.internetSearch?.enabled ? '✅' : '❌';
    lines.push(`| ${sortedEngines.indexOf(engine) + 1} | **${engine.name}** | ${engine.totalUrls} | ${engine.totalDomains} | 联网: ${internetSearch} |`);
  }
  lines.push('');

  lines.push('---');
  lines.push('');

  lines.push('## 二、域名热度（16个引擎总引用次数）');
  lines.push('');
  lines.push('| 排名 | 域名 | 平台 | 引用引擎数 | 外链数 | 说明 |');
  lines.push('|------|------|------|------------|--------|------|');
  for (const [domain, stat] of sortedDomains.slice(0, 30)) {
    const platform = stat.platform || '其他';
    const engines = stat.engines.join(', ');
    lines.push(`| ${sortedDomains.indexOf([domain, stat]) + 1} | ${domain} | ${platform} | ${stat.totalEngines} | ${stat.totalUrls} | ${engines} |`);
  }
  lines.push('');

  lines.push('---');
  lines.push('');

  lines.push('## 三、媒体类型分布');
  lines.push('');
  lines.push('| 类型 | 数量 | 占比 | 说明 |');
  lines.push('|------|------|------|------|');
  const typeDescriptions: Record<string, string> = {
    '招聘平台': '适合发布招聘信息',
    '媒体平台': '适合发布新闻稿',
    '技术社区': '适合发布技术文章',
    '社交平台': '适合传播内容',
    '企业官网': '直接优化企业官网'
  };
  const total = Array.from(platformDistribution.values()).reduce((a, b) => a + b, 0);
  for (const [type, count] of Array.from(platformDistribution.entries()).sort((a, b) => b[1] - a[1])) {
    const percentage = ((count / total) * 100).toFixed(1);
    const desc = typeDescriptions[type] || '';
    lines.push(`| ${type} | ${count} | ${percentage}% | ${desc} |`);
  }
  lines.push('');

  lines.push('---');
  lines.push('');

  lines.push('## 四、外链质量分析');
  lines.push('');
  lines.push('### 高权重域名（被3个以上引擎引用）');
  lines.push('');
  lines.push('| 域名 | 平台 | 引用引擎数 | 外链数 | 推荐操作 |');
  lines.push('|------|------|------------|--------|----------|');
  const highWeightDomains = sortedDomains.filter(([_, stat]) => stat.totalEngines >= 3);
  for (const [domain, stat] of highWeightDomains) {
    const platform = stat.platform || '其他';
    const recommendation = getRecommendation(platform, stat.totalEngines);
    lines.push(`| ${domain} | ${platform} | ${stat.totalEngines} | ${stat.totalUrls} | ${recommendation} |`);
  }
  lines.push('');

  lines.push('---');
  lines.push('');

  lines.push('## 五、优化建议');
  lines.push('');
  lines.push('### 优先发帖平台（按推荐度排序）');
  lines.push('');
  const recommendations = generateRecommendations(sortedDomains);
  for (let i = 0; i < recommendations.length; i++) {
    const rec = recommendations[i];
    lines.push(`#### ${i + 1}. ${rec.domain}`);
    lines.push('');
    lines.push(`- **类型**: ${rec.platform}`);
    lines.push(`- **引用引擎数**: ${rec.totalEngines} / 16`);
    lines.push(`- **外链数**: ${rec.totalUrls}`);
    lines.push(`- **推荐操作**: ${rec.recommendation}`);
    lines.push(`- **引用引擎**: ${rec.engines.join(', ')}`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  lines.push('## 六、数据来源');
  lines.push('');
  lines.push('本报告基于以下 AI 搜索引擎的数据采集：');
  lines.push('');
  results.forEach((r, i) => {
    const info = r.engineInfo;
    lines.push(`${i + 1}. **${info?.name || r.engine}** (${r.engine})`);
    if (r.domainExtraction) {
      lines.push(`   - 外链数: ${r.domainExtraction.totalUrls}`);
      lines.push(`   - 域名数: ${r.domainExtraction.totalDomains}`);
    }
    lines.push('');
  });

  lines.push('---');
  lines.push('');
  lines.push(`> 报告生成时间: ${new Date().toLocaleString('zh-CN')}`);
  lines.push(`> 数据来源: ${results.length} 个 AI 搜索引擎`);

  return lines.join('\n');
}

function getRecommendation(platform: string, engineCount: number): string {
  if (platform === '招聘平台') return '发布企业招聘信息';
  if (platform === '媒体平台') return '发布行业新闻稿';
  if (platform === '技术社区') return '发布技术文章或解决方案';
  if (platform === '社交平台') return '传播品牌内容';
  if (platform === '企业官网') return '优化官网内容，提高收录';
  if (engineCount >= 5) return '重点优化，优先发帖';
  if (engineCount >= 3) return '常规优化，定期发帖';
  return '观望，视情况而定';
}

function generateRecommendations(sortedDomains: any[]): any[] {
  const recommendations: any[] = [];

  for (const [domain, stat] of sortedDomains.slice(0, 15)) {
    recommendations.push({
      domain,
      platform: stat.platform || '其他',
      totalEngines: stat.totalEngines,
      totalUrls: stat.totalUrls,
      engines: stat.engines,
      recommendation: getRecommendation(stat.platform || '其他', stat.totalEngines)
    });
  }

  return recommendations;
}

function generateExcelData(
  sortedDomains: any[],
  sortedEngines: any[],
  platformDistribution: Map<string, number>
) {
  return {
    domains: sortedDomains.map(([domain, stat], index) => ({
      '排名': index + 1,
      '域名': domain,
      '平台': stat.platform || '其他',
      '引用引擎数': stat.totalEngines,
      '外链数': stat.totalUrls,
      '引用引擎': stat.engines.join(', '),
      '推荐操作': getRecommendation(stat.platform || '其他', stat.totalEngines)
    })),
    engines: sortedEngines.map((e, index) => ({
      '排名': index + 1,
      '引擎': e.name,
      '外链数': e.totalUrls,
      '域名数': e.totalDomains,
      '平均外链/域名': (e.totalUrls / e.totalDomains).toFixed(1)
    })),
    platformTypes: Array.from(platformDistribution.entries()).map(([type, count]) => {
      const total = Array.from(platformDistribution.values()).reduce((a, b) => a + b, 0);
      return {
        '类型': type,
        '数量': count,
        '占比': ((count / total) * 100).toFixed(1) + '%'
      };
    })
  };
}

// 主函数
async function main() {
  try {
    await ensureDir(OUTPUT_DIR);

    console.log('📊 GEO 外链排名分析');
    console.log(`🔑 关键词: ${QUERY}`);
    console.log(`📂 输出目录: ${OUTPUT_DIR}`);
    console.log('');

    // Step 1: 批量采集
    const results = await batchSearch();

    if (results.length === 0) {
      console.error('❌ 没有成功采集到任何数据');
      process.exit(1);
    }

    console.log(`\n✅ 采集完成，成功采集 ${results.length} / ${ENGINES.length} 个引擎的数据`);

    // Step 2: 聚合分析
    console.log('\n📊 正在进行聚合分析...');
    const aggregated = aggregateResults(results);
    console.log(`   - 发现 ${aggregated.domainStats.size} 个不同域名`);
    console.log(`   - 总计 ${Array.from(aggregated.domainStats.values()).reduce((sum, d) => sum + d.totalUrls, 0)} 个外链`);

    // Step 3: 生成报告
    console.log('\n📝 正在生成报告...');
    const { mdReport, excelData, jsonReport } = await generateReport(results, aggregated);

    // Step 4: 保存报告
    const mdPath = path.join(OUTPUT_DIR, `report-${DATE}.md`);
    const jsonPath = path.join(OUTPUT_DIR, `report-${DATE}.json`);
    const excelPath = path.join(OUTPUT_DIR, `report-${DATE}.xlsx.json`);

    await fs.writeFile(mdPath, mdReport, 'utf-8');
    await fs.writeFile(jsonPath, JSON.stringify(jsonReport, null, 2), 'utf-8');
    await fs.writeFile(excelPath, JSON.stringify(excelData, null, 2), 'utf-8');

    console.log('\n✅ 报告生成完成！');
    console.log(`   - Markdown 报告: ${mdPath}`);
    console.log(`   - JSON 报告: ${jsonPath}`);
    console.log(`   - Excel 数据: ${excelPath}`);
    console.log('');
    console.log('📊 报告摘要:');
    console.log(`   - 成功采集引擎: ${results.length} / ${ENGINES.length}`);
    console.log(`   - 发现域名总数: ${aggregated.domainStats.size}`);
    console.log(`   - 外链总数: ${Array.from(aggregated.domainStats.values()).reduce((sum, d) => sum + d.totalUrls, 0)}`);
    console.log('');
    console.log('🎯 以下是 Markdown 报告预览:');
    console.log('');
    console.log(mdReport);
  } catch (error) {
    console.error('❌ 执行失败:', error);
    process.exit(1);
  }
}

main();
