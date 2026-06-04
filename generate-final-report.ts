/**
 * 综合经济数据报告生成器
 */

import fs from 'fs';

interface DataStore {
  metadata: {
    source: string;
    extractDate: string;
    method: string;
    indicators: string[];
  };
  gdp: {
    unit: string;
    years: string[];
    provinces: Array<{ province: string; data: Record<string, number> }>;
  };
  retailSales: {
    unit: string;
    indicator: string;
    years: string[];
    provinces: Array<{ province: string; data: Record<string, number> }>;
  };
}

function generateReport(): void {
  const rawData = fs.readFileSync('output/province-data/comprehensive-economic-data.json', 'utf-8');
  const data: DataStore = JSON.parse(rawData);

  console.log('\n' + '═'.repeat(80));
  console.log('  📊 全国各省市区经济数据综合报告');
  console.log('═'.repeat(80));
  console.log(`  数据来源: ${data.metadata.source}`);
  console.log(`  提取日期: ${data.metadata.extractDate}`);
  console.log(`  提取方法: ${data.metadata.method}`);
  console.log(`  指标数量: ${data.metadata.indicators.length} 个`);
  console.log('═'.repeat(80));

  // 1. GDP 排名
  const gdpSorted = [...data.gdp.provinces]
    .sort((a, b) => (b.data["2025"] || 0) - (a.data["2025"] || 0));

  console.log('\n📈 2025年 GDP 排名（亿元）:\n');
  console.log('  排名  省份              GDP        同比    社消零售(2024)');
  console.log('  ' + '─'.repeat(65));

  gdpSorted.forEach((item, i) => {
    const gdp2025 = item.data["2025"] || 0;
    const gdp2024 = item.data["2024"] || 0;
    const growth = gdp2024 ? ((gdp2025 - gdp2024) / gdp2024 * 100).toFixed(1) : 'N/A';

    // 查找对应的零售数据
    const retailItem = data.retailSales.provinces.find(p => p.province === item.province);
    const retail2024 = retailItem?.data["2024"] || 0;
    const retailRatio = gdp2025 ? (retail2024 / gdp2025 * 100).toFixed(1) : 'N/A';

    const rank = String(i + 1).padStart(2);
    const name = item.province.padEnd(12);
    const gdpStr = gdp2025.toLocaleString().padStart(12);
    const growthStr = (growth + '%').padStart(7);
    const retailStr = retail2024.toLocaleString().padStart(12);
    const ratioStr = retailRatio !== 'N/A' ? (retailRatio + '%').padStart(6) : '   N/A';

    console.log(`  ${rank}.  ${name} ${gdpStr}  ${growthStr}  ${retailStr}  ${ratioStr}`);
  });

  // 2. 统计摘要
  const totalGDP2025 = data.gdp.provinces.reduce((s, p) => s + (p.data["2025"] || 0), 0);
  const totalGDP2024 = data.gdp.provinces.reduce((s, p) => s + (p.data["2024"] || 0), 0);
  const totalRetail2024 = data.retailSales.provinces.reduce((s, p) => s + (p.data["2024"] || 0), 0);

  console.log('\n  ' + '─'.repeat(65));
  console.log(`  合计  ${''.padEnd(12)} ${totalGDP2025.toLocaleString().padStart(12)}  ${((totalGDP2025 - totalGDP2024) / totalGDP2024 * 100).toFixed(1)}%  ${totalRetail2024.toLocaleString().padStart(12)}`);
  console.log('  ' + '─'.repeat(65));

  // 3. 增速排名
  const growthRanking = data.gdp.provinces
    .map(p => ({
      province: p.province,
      gdp2025: p.data["2025"] || 0,
      gdp2024: p.data["2024"] || 0,
      growth: p.data["2024"] ? ((p.data["2025"] || 0) - p.data["2024"]) / p.data["2024"] * 100 : 0
    }))
    .sort((a, b) => b.growth - a.growth);

  console.log('\n🚀 2025年 GDP 增速排名:\n');
  growthRanking.forEach((item, i) => {
    const growthStr = item.growth >= 0 ? `+${item.growth.toFixed(1)}%` : `${item.growth.toFixed(1)}%`;
    const bar = item.growth >= 0
      ? '▓'.repeat(Math.round(item.growth))
      : '░'.repeat(Math.round(Math.abs(item.growth)));
    console.log(`  ${(i + 1).toString().padStart(2)}. ${item.province.padEnd(12)} ${growthStr.padStart(8)}  ${bar}`);
  });

  // 4. 区域分析
  const regions: Record<string, string[]> = {
    "东部": ["北京市", "天津市", "河北省", "上海市", "江苏省", "浙江省", "福建省", "山东省", "广东省", "海南省"],
    "中部": ["山西省", "安徽省", "江西省", "河南省", "湖北省", "湖南省"],
    "西部": ["内蒙古自治区", "广西壮族自治区", "重庆市", "四川省", "贵州省", "云南省", "西藏自治区", "陕西省", "甘肃省", "青海省", "宁夏回族自治区", "新疆维吾尔自治区"],
    "东北": ["辽宁省", "吉林省", "黑龙江省"]
  };

  console.log('\n🗺️  区域经济分析（2025年）:\n');
  console.log('  区域    GDP(亿元)       占比    社消零售(亿元)   占比');
  console.log('  ' + '─'.repeat(60));

  for (const [region, provs] of Object.entries(regions)) {
    const regionGDP = provs.reduce((s, name) => {
      const found = data.gdp.provinces.find(p => p.province === name);
      return s + (found?.data["2025"] || 0);
    }, 0);

    const regionRetail = provs.reduce((s, name) => {
      const found = data.retailSales.provinces.find(p => p.province === name);
      return s + (found?.data["2024"] || 0);
    }, 0);

    const gdpPct = (regionGDP / totalGDP2025 * 100).toFixed(1);
    const retailPct = (regionRetail / totalRetail2024 * 100).toFixed(1);

    console.log(`  ${region}    ${regionGDP.toLocaleString().padStart(14)}  ${gdpPct.padStart(5)}%  ${regionRetail.toLocaleString().padStart(14)}  ${retailPct.padStart(5)}%`);
  }

  console.log('  ' + '─'.repeat(60));
  console.log(`  全国    ${totalGDP2025.toLocaleString().padStart(14)}  100.0%  ${totalRetail2024.toLocaleString().padStart(14)}  100.0%`);

  // 5. 数据文件
  console.log('\n' + '═'.repeat(80));
  console.log('  📁 数据文件:');
  console.log('    • output/province-data/comprehensive-economic-data.json  (综合 JSON)');
  console.log('    • output/province-data/province-gdp-2017-2025.json       (GDP JSON)');
  console.log('    • output/province-data/province-gdp-2017-2025.csv        (GDP CSV)');
  console.log('═'.repeat(80) + '\n');
}

generateReport();