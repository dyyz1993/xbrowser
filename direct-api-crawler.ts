/**
 * 直接使用 API 获取各省经济数据
 */

interface ReportInfo {
  name: string;
  report_id: string;
  rp_id: string;
  year: string;
}

interface ProvinceData {
  name: string;
  year: string;
  gdp?: number;
  gdpUnit?: string;
  population?: number;
  investment?: number;
  retailSales?: number;
  income?: number;
}

async function getReportList(type: 'year' | 'month' | 'session'): Promise<ReportInfo[]> {
  const url = `https://data.stats.gov.cn/dg/website/publicrelease/web/external/queryAllPblIbs?type=${type}`;

  try {
    const response = await fetch(url);
    const result = await response.json();

    if (result.success && result.data) {
      return result.data.map((item: any) => ({
        name: item.name,
        report_id: item.dsbi_md_report_id,
        rp_id: item.publicrelease_web_rpcatalog_rp_id,
        year: item.stat_report_year
      }));
    }
  } catch (error) {
    console.error(`获取 ${type} 报表列表失败:`, error);
  }

  return [];
}

async function getReportDetail(rpId: string): Promise<any> {
  const url = `https://data.stats.gov.cn/dg/website/publicrelease/web/external/new/queryPbLibCatalogList?code=${rpId}`;

  try {
    const response = await fetch(url);
    const result = await response.json();

    if (result.success && result.data) {
      return result.data;
    }
  } catch (error) {
    console.error(`获取报表详情失败:`, error);
  }

  return null;
}

async function getTableData(reportId: string, tableId: string): Promise<any> {
  // 尝试多个可能的 API 端点
  const possibleUrls = [
    `https://data.stats.gov.cn/dg/website/datascreen/relationweb/getTableData?reportId=${reportId}&tableId=${tableId}`,
    `https://data.stats.gov.cn/dg/website/pblib/data/queryTableData?reportId=${reportId}&tableId=${tableId}`,
    `https://data.stats.gov.cn/dg/website/publicrelease/web/external/new/queryTableData?reportId=${reportId}&tableId=${tableId}`
  ];

  for (const url of possibleUrls) {
    try {
      const response = await fetch(url);
      const result = await response.json();

      if (result.success && result.data) {
        return result.data;
      }
    } catch (error) {
      // 继续尝试下一个 URL
    }
  }

  return null;
}

async function crawlProvinceGDPData(): Promise<Map<string, ProvinceData>> {
  const provinceDataMap = new Map<string, ProvinceData>();

  console.log('📊 开始获取各省经济数据...\n');

  // 1. 获取年度报表列表
  console.log('步骤 1: 获取年度报表列表...');
  const yearReports = await getReportList('year');
  console.log(`   找到 ${yearReports.length} 个年度报表\n`);

  // 2. 查找 GDP 相关的报表
  const gdpReport = yearReports.find(r =>
    r.name.includes('国民') && r.name.includes('核算')
  ) || yearReports.find(r =>
    r.name.includes('GDP') || r.name.includes('生产总值')
  );

  if (!gdpReport) {
    console.log('❌ 未找到 GDP 相关报表');
    return provinceDataMap;
  }

  console.log(`步骤 2: 找到 GDP 报表 - ${gdpReport.name} (${gdpReport.year})`);

  // 3. 获取报表详情（包含表格列表）
  console.log('步骤 3: 获取报表详情...');
  const reportDetail = await getReportDetail(gdpReport.rp_id);

  if (!reportDetail) {
    console.log('   ❌ 获取报表详情失败');
    return provinceDataMap;
  }

  console.log(`   找到 ${reportDetail.length} 个表格/项目`);

  // 4. 查找包含省份数据的表格
  console.log('\n步骤 4: 查找包含省份数据的表格...');

  for (const item of reportDetail) {
    if (item.name && item.report_id) {
      console.log(`   检查: ${item.name}`);

      // 检查是否包含省份信息
      const provinceNames = ['北京', '天津', '河北', '山西', '内蒙古', '辽宁', '吉林', '黑龙江',
        '上海', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南',
        '广东', '广西', '海南', '重庆', '四川', '贵州', '云南', '西藏', '陕西', '甘肃',
        '青海', '宁夏', '新疆', '香港', '澳门', '台湾'];

      if (provinceNames.some(pn => item.name.includes(pn))) {
        console.log(`   ✅ 找到包含省份信息的表格: ${item.name}`);

        // 尝试获取表格数据
        const tableData = await getTableData(gdpReport.report_id, item._id || item.report_id);

        if (tableData) {
          console.log(`   📊 获取到表格数据`);
          extractProvinceDataFromTable(tableData, provinceDataMap, gdpReport.year);
        }
      }
    }
  }

  return provinceDataMap;
}

function extractProvinceDataFromTable(tableData: any, provinceDataMap: Map<string, ProvinceData>, year: string): void {
  // 查找所有可能的省份字段
  const provinceNames = ['北京市', '天津市', '河北省', '山西省', '内蒙古自治区', '辽宁省', '吉林省', '黑龙江省',
    '上海市', '江苏省', '浙江省', '安徽省', '福建省', '江西省', '山东省', '河南省', '湖北省', '湖南省',
    '广东省', '广西壮族自治区', '海南省', '重庆市', '四川省', '贵州省', '云南省', '西藏自治区',
    '陕西省', '甘肃省', '青海省', '宁夏回族自治区', '新疆维吾尔自治区', '香港特别行政区', '澳门特别行政区', '台湾省',
    '北京', '天津', '河北', '山西', '内蒙古', '辽宁', '吉林', '黑龙江',
    '上海', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南',
    '广东', '广西', '海南', '重庆', '四川', '贵州', '云南', '西藏', '陕西', '甘肃',
    '青海', '宁夏', '新疆', '香港', '澳门', '台湾'];

  if (Array.isArray(tableData)) {
    tableData.forEach((row: any) => {
      if (row.name || row.province) {
        const name = row.name || row.province;

        if (provinceNames.some(pn => name.includes(pn))) {
          let data: ProvinceData = provinceDataMap.get(name) || {
            name,
            year
          };

          // 提取数值数据
          if (row.data && Array.isArray(row.data)) {
            row.data.forEach((item: any) => {
              if (item.value && typeof item.value === 'number') {
                data.gdp = item.value;
                data.gdpUnit = item.unit || '亿元';
              }
            });
          }

          if (row.value && typeof row.value === 'number') {
            data.gdp = row.value;
            data.gdpUnit = row.unit || '亿元';
          }

          provinceDataMap.set(name, data);
        }
      }
    });
  } else if (typeof tableData === 'object') {
    // 递归查找
    Object.keys(tableData).forEach(key => {
      extractProvinceDataFromTable(tableData[key], provinceDataMap, year);
    });
  }
}

async function main() {
  const outputDir = '/Users/xuyingzhou/Project/study-node-ts/xbrowser/output/province-data';

  try {
    const provinceDataMap = await crawlProvinceGDPData();

    console.log('\n' + '='.repeat(60));
    console.log('📊 爬取完成！');
    console.log('='.repeat(60));
    console.log(`\n识别到 ${provinceDataMap.size} 个省份/地区`);

    if (provinceDataMap.size > 0) {
      console.log('\n📈 省份经济数据:');
      Array.from(provinceDataMap.values()).forEach(province => {
        console.log(`   ${province.name}: GDP ${province.gdp || 'N/A'} ${province.gdpUnit || ''}`);
      });
    } else {
      console.log('\n⚠️  未获取到具体省份数据');
      console.log('💡 可能需要使用浏览器自动化来触发特定的数据查询');
    }

    // 保存数据
    const provinceArray = Array.from(provinceDataMap.values());
    const fs = await import('fs');
    const path = await import('path');

    const filePath = path.join(outputDir, 'province-gdp-data.json');
    fs.writeFileSync(filePath, JSON.stringify(provinceArray, null, 2), 'utf-8');
    console.log(`\n📄 数据已保存到: ${filePath}`);

  } catch (error) {
    console.error('\n❌ 爬取过程中出错:', error);
  }
}

main().catch(console.error);