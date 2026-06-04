/**
 * 国家统计局各省 GDP 数据爬虫
 * 使用 discovered API 直接获取数据
 */

import fs from 'fs';
import path from 'path';

interface ProvinceInfo {
  name_value: string;
  show_name: string;
  name_text: string;
  publicrelease_web_dacatalog_da_id: string;
}

interface GDPData {
  indicatorCid: string;
  indicatorName: string;
  provinces: Array<{
    name: string;
    gdp: number;
    unit: string;
    years: Record<string, number>;
  }>;
}

async function getProvincesList(): Promise<ProvinceInfo[]> {
  const url = 'https://data.stats.gov.cn/dg/website/publicrelease/web/external/getDasByDaCatalogId?daCid=a10dceae75d245008bf4b9a0e6fe1d55';

  try {
    const response = await fetch(url);
    const result = await response.json();

    if (result.success && result.data) {
      return result.data;
    }
  } catch (error) {
    console.error('获取省份列表失败:', error);
  }

  return [];
}

async function getProvinceGDPData(indicatorCid: string, daId: string): Promise<unknown> {
  const url = 'https://data.stats.gov.cn/dg/website/publicrelease/web/external/getEsDataByCidAndDt';

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'accept': 'application/json, text/plain, */*',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'
      },
      body: JSON.stringify({
        cid: indicatorCid,
        dt: '2016-2025',
        daId: daId,
        name: ''
      })
    });

    const result = await response.json();
    return result;
  } catch (error) {
    console.error(`获取省份 ${daId} 数据失败:`, error);
    return null;
  }
}

function extractGDPFromESData(esData: unknown): Record<string, number> | null {
  if (!esData || typeof esData !== 'object') return null;
  const data = esData as Record<string, unknown>;

  if (data.success && data.data) {
    const esData = data.data as Record<string, unknown>;
    const dataValue = esData.data;

    if (Array.isArray(dataValue)) {
      // 尝试从 data 数组中提取 GDP 数据
      const gdpData: Record<string, number> = {};

      dataValue.forEach((item: unknown) => {
        if (item && typeof item === 'object') {
          const objItem = item as Record<string, unknown>;
          if (objItem.data && Array.isArray(objItem.data)) {
            // 日期格式通常是 "2021年" 或 "2021"
            const year = String(objItem.name || objItem.year || objItem.code || '').replace('年', '');
            const value = objItem.data[0];

            if (year && typeof value === 'number') {
              gdpData[year] = value;
            }
          } else if (objItem.strData && Array.isArray(objItem.strData)) {
            const year = String(objItem.name || objItem.year || '').replace('年', '');
            const value = parseFloat(String(objItem.strData[0] || '0'));

            if (year && !isNaN(value)) {
              gdpData[year] = value;
            }
          } else if (objItem.value && typeof objItem.value === 'number') {
            const year = String(objItem.name || objItem.year || '').replace('年', '');
            gdpData[year] = objItem.value;
          }
        }
      });

      return Object.keys(gdpData).length > 0 ? gdpData : null;
    }
  }

  return null;
}

async function crawlAllProvincesGDP(): Promise<void> {
  const outputDir = path.join(process.cwd(), 'output', 'province-data');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('📊 开始爬取各省 GDP 数据...\n');

  // 获取省份列表
  console.log('步骤 1: 获取省份列表...');
  const provinces = await getProvincesList();
  console.log(`   找到 ${provinces.length} 个省份/地区\n`);

  if (provinces.length === 0) {
    console.log('❌ 未找到省份列表');
    return;
  }

  // GDP 指标 CID（从网络请求中获得）
  const indicatorCid = '6f8fbd415cbc40ffa7ecb7fd917f2598';

  // 爬取每个省份的数据
  console.log('步骤 2: 爬取各省 GDP 数据...');
  const results: Array<{
    province: ProvinceInfo;
    gdpData: Record<string, number> | null;
  }> = [];

  for (let i = 0; i < provinces.length; i++) {
    const province = provinces[i];
    console.log(`   ${i + 1}/${provinces.length}: ${province.show_name}...`);

    const esData = await getProvinceGDPData(indicatorCid, province.publicrelease_web_dacatalog_da_id);
    const gdpData = extractGDPFromESData(esData);

    results.push({
      province,
      gdpData
    });

    // 添加延迟避免请求过快
    if (i < provinces.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  // 整理数据
  console.log('\n步骤 3: 整理数据...');
  const validResults = results.filter(r => r.gdpData !== null && Object.keys(r.gdpData).length > 0);
  const finalData = validResults.map(r => {
    const gdpData = r.gdpData!;
    const years = Object.keys(gdpData).map(Number);
    const latestYear = Math.max(...years);
    return {
      province: r.province.show_name,
      code: r.province.name_value,
      gdp: gdpData,
      latestYear,
      latestGDP: gdpData[String(latestYear)]
    };
  }).sort((a, b) => (b.latestGDP || 0) - (a.latestGDP || 0));

  console.log(`   成功获取 ${finalData.length} 个省份数据\n`);

  // 保存 JSON 数据
  const jsonPath = path.join(outputDir, 'province-gdp-data.json');
  fs.writeFileSync(jsonPath, JSON.stringify(finalData, null, 2), 'utf-8');
  console.log(`📄 JSON 数据已保存: ${jsonPath}`);

  // 生成 CSV 数据
  const years = new Set<string>();
  finalData.forEach(d => {
    if (d.gdp) {
      Object.keys(d.gdp).forEach(y => years.add(y));
    }
  });
  const sortedYears = Array.from(years).sort();

  const csvHeader = ['排名', '省份', '代码', ...sortedYears, '最新年份', '最新GDP（亿元）'];
  const csvRows = finalData.map((d, i) => {
    const gdpValues = sortedYears.map(y => String(d.gdp?.[y] || ''));
    return [
      String(i + 1),
      d.province,
      d.code,
      ...gdpValues,
      String(d.latestYear),
      String(d.latestGDP || '')
    ];
  });

  const csvContent = [csvHeader.join(','), ...csvRows.map(r => r.join(','))].join('\n');
  const csvPath = path.join(outputDir, 'province-gdp-data.csv');
  fs.writeFileSync(csvPath, csvContent, 'utf-8');
  console.log(`📄 CSV 数据已保存: ${csvPath}`);

  // 生成统计报告
  const totalGDP = finalData.reduce((sum, d) => sum + (d.latestGDP || 0), 0);
  const avgGDP = totalGDP / finalData.length;
  const maxGDP = Math.max(...finalData.map(d => d.latestGDP || 0));
  const minGDP = Math.min(...finalData.map(d => d.latestGDP || 0));

  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      totalProvinces: finalData.length,
      totalGDP: Math.round(totalGDP * 100) / 100,
      averageGDP: Math.round(avgGDP * 100) / 100,
      maxGDP: Math.round(maxGDP * 100) / 100,
      minGDP: Math.round(minGDP * 100) / 100
    },
    top5: finalData.slice(0, 5).map(d => ({
      province: d.province,
      gdp: d.latestGDP,
      year: d.latestYear
    })),
    data: finalData
  };

  const reportPath = path.join(outputDir, 'province-gdp-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`📊 统计报告已保存: ${reportPath}`);

  // 输出结果
  console.log('\n' + '='.repeat(60));
  console.log('🎉 爬取完成！');
  console.log('='.repeat(60));
  console.log(`\n📈 统计信息:`);
  console.log(`   省份总数: ${finalData.length}`);
  console.log(`   GDP 总和: ${Math.round(totalGDP * 100) / 100} 亿元`);
  console.log(`   平均 GDP: ${Math.round(avgGDP * 100) / 100} 亿元`);
  console.log(`   最高 GDP: ${Math.round(maxGDP * 100) / 100} 亿元`);
  console.log(`   最低 GDP: ${Math.round(minGDP * 100) / 100} 亿元`);

  console.log(`\n🏆 GDP 前5名:`);
  finalData.slice(0, 5).forEach((d, i) => {
    console.log(`   ${i + 1}. ${d.province}: ${d.latestGDP} 亿元 (${d.latestYear}年)`);
  });

  console.log(`\n📊 数据文件:`);
  console.log(`   - ${jsonPath}`);
  console.log(`   - ${csvPath}`);
  console.log(`   - ${reportPath}`);
}

crawlAllProvincesGDP().catch(console.error);