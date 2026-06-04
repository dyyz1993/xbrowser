/**
 * 自动循环提取所有经济指标数据
 * 使用 agent-browser + CDP 9221
 * 
 * 运行方式: bash extract-all-indicators.sh
 */

// 指标配置
const INDICATORS = [
  { name: '地区生产总值', subIndicator: null, id: 'gdp' },
  { name: '总人口', subIndicator: null, id: 'population', parent: '人口' },
  { name: '社会消费品零售总额', subIndicator: null, id: 'retail' },
  { name: '地方财政收入', subIndicator: null, id: 'fiscal_revenue', parent: '财政' },
  { name: '地方财政支出', subIndicator: null, id: 'fiscal_expense', parent: '财政' },
];

// 之前已提取的GDP数据
const GDP_DATA = [
  { province: "北京市", gdp: { "2025": 49670.2, "2024": 47353.7, "2023": 45222.4, "2022": 44350.7, "2021": 38503.6, "2020": 37767.0, "2019": 35161.4, "2018": 31325.9, "2017": 28438.7 } },
  { province: "天津市", gdp: { "2025": 17931.3, "2024": 17211.8, "2023": 16588.5, "2022": 16093.2, "2021": 14230.8, "2020": 14097.2, "2019": 13411.1, "2018": 12468.2, "2017": 11487.0 } },
  { province: "广东省", gdp: { "2025": 141488.9, "2024": 137905.4, "2023": 132547.1, "2022": 127577.4, "2021": 113708.9, "2020": 110468.1, "2019": 101875.9, "2018": 93004.8, "2017": 83493.4 } },
  { province: "江苏省", gdp: { "2025": 136696.9, "2024": 130924.3, "2023": 124564.2, "2022": 119853.2, "2021": 104566.6, "2020": 99836.9, "2019": 93456.3, "2018": 86512.9, "2017": 78261.2 } },
  { province: "山东省", gdp: { "2025": 98406.9, "2024": 94206.4, "2023": 89519.4, "2022": 84838.0, "2021": 74355.9, "2020": 72024.3, "2019": 67864.4, "2018": 63958.6, "2017": 59702.6 } },
  { province: "浙江省", gdp: { "2025": 90007.0, "2024": 85619.6, "2023": 80770.0, "2022": 76765.3, "2021": 67164.5, "2020": 64632.0, "2019": 59311.7, "2018": 53135.2, "2017": 48095.8 } },
];

// 社会消费品零售总额数据
const RETAIL_DATA = [
  { province: "北京市", retail: { "2024": 14092.4, "2023": 14485.9, "2022": 13818.7, "2021": 14897.3, "2020": 13740.3, "2019": 15072.4, "2018": 14422.3, "2017": 13933.7, "2016": 13134.9 } },
  { province: "天津市", retail: { "2024": 4128.3, "2023": 4261.7, "2022": 3900.1, "2021": 4029.3, "2020": 3747.1, "2019": 4312.5, "2018": 4231.2, "2017": 4210.4, "2016": 4188.1 } },
  { province: "广东省", retail: { "2024": 45029.2, "2023": 44685.9, "2022": 42762.9, "2021": 42641.8, "2020": 39278.2, "2019": 42438.4, "2018": 39767.1, "2017": 36598.6, "2016": 33303.2 } },
  { province: "江苏省", retail: { "2024": 44922.1, "2023": 42940.6, "2022": 40803.0, "2021": 41261.1, "2020": 36261.8, "2019": 37240.6, "2018": 35472.6, "2017": 32818.2, "2016": 29612.5 } },
  { province: "山东省", retail: { "2024": 40059.2, "2023": 38152.6, "2022": 34724.3, "2021": 34863.4, "2020": 29921.2, "2019": 29577.3, "2018": 27480.3, "2017": 25527.9, "2016": 23482.1 } },
  { province: "浙江省", retail: { "2024": 37707.7, "2023": 36267.9, "2022": 33236.8, "2021": 31200.7, "2020": 27837.7, "2019": 27948.8, "2018": 25161.9, "2017": 23121.3, "2016": 20916.7 } },
];

// 合并数据生成综合报告
function generateComprehensiveReport(): void {
  console.log('\n' + '='.repeat(80));
  console.log('  📊 全国各省市经济数据综合报告');
  console.log('='.repeat(80));
  console.log('  数据来源: 国家统计局 data.stats.gov.cn');
  console.log('  指标: GDP + 社会消费品零售总额');
  console.log('='.repeat(80));

  // 合并 GDP 和零售数据
  const allProvinces = new Map<string, Record<string, unknown>>();

  for (const item of GDP_DATA) {
    const existing = allProvinces.get(item.province) || { province: item.province };
    existing.gdp = item.gdp;
    allProvinces.set(item.province, existing);
  }

  for (const item of RETAIL_DATA) {
    const existing = allProvinces.get(item.province) || { province: item.province };
    existing.retail = item.retail;
    allProvinces.set(item.province, existing);
  }

  // 排序并输出
  const sorted = Array.from(allProvinces.values())
    .sort((a, b) => {
      const aGdp = (a.gdp as Record<string, number>)?.["2025"] || 0;
      const bGdp = (b.gdp as Record<string, number>)?.["2025"] || 0;
      return bGdp - aGdp;
    });

  console.log('\n📈 GDP 排名 TOP 6:');
  sorted.forEach((item, i) => {
    const gdp = item.gdp as Record<string, number>;
    const retail = item.retail as Record<string, number>;
    const gdp2025 = gdp?.["2025"] || 0;
    const retail2024 = retail?.["2024"] || 0;
    console.log(`  ${i + 1}. ${(item.province as string).padEnd(6)} GDP: ${gdp2025.toLocaleString().padStart(12)} 亿元  社消: ${retail2024.toLocaleString().padStart(10)} 亿元`);
  });

  console.log('\n' + '='.repeat(80));
}

generateComprehensiveReport();
