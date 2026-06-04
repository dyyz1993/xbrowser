/**
 * 国家统计局数据爬虫 - 增强版
 * 深度爬取各省经济数据（GDP、人口、投资等）
 */

import { chromium, Browser, Page, Response, Route } from 'playwright';
import fs from 'fs';
import path from 'path';

interface ProvinceData {
  name: string;
  gdp?: number;
  gdpRank?: number;
  population?: number;
  investment?: number;
  retailSales?: number;
  income?: number;
  year: string;
}

class EnhancedStatsCrawler {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private capturedData: Map<string, any> = new Map();
  private apiCalls: Map<string, number> = new Map();
  private provinceData: Map<string, ProvinceData> = new Map();

  async init(): Promise<void> {
    console.log('🚀 启动浏览器...');

    this.browser = await chromium.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage'
      ]
    });

    const context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      extraHTTPHeaders: {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Referer': 'https://data.stats.gov.cn/'
      }
    });

    this.page = await context.newPage();

    // 监听所有响应
    this.page.on('response', async (response: Response) => {
      await this.handleResponse(response);
    });

    console.log('✅ 浏览器已启动');
  }

  private async handleResponse(response: Response): Promise<void> {
    const url = response.url();
    const request = response.request();

    // 统计 API 调用
    if (this.isDataApi(url)) {
      const count = this.apiCalls.get(url) || 0;
      this.apiCalls.set(url, count + 1);
    }

    // 只拦截数据 API
    if (this.isDataApi(url)) {
      try {
        const contentType = response.headers()['content-type'] || '';

        // 尝试解析 JSON
        if (contentType.includes('json') ||
          contentType.includes('application') ||
          url.includes('query') ||
          url.includes('api') ||
          url.includes('external')) {

          const data = await response.json().catch(() => null);

          if (data && data.success) {
            const apiName = this.getApiName(url);

            this.capturedData.set(`${apiName}_${this.apiCalls.get(url)}`, {
              url,
              method: request.method(),
              timestamp: new Date().toISOString(),
              data
            });

            console.log(`\n✅ 捕获 API: ${apiName}`);
            console.log(`   URL: ${url}`);
            console.log(`   方法: ${request.method()}`);

            // 尝试提取省份数据
            this.extractProvinceData(data, apiName);
          }
        }
      } catch (e) {
        // 静默忽略非 JSON 响应
      }
    }
  }

  private isDataApi(url: string): boolean {
    const dataKeywords = [
      'query',
      'api',
      'external',
      'datascreen',
      'pblib',
      'dg/website'
    ];

    return dataKeywords.some(keyword =>
      url.toLowerCase().includes(keyword.toLowerCase())
    ) && !url.includes('.js') && !url.includes('.css');
  }

  private getApiName(url: string): string {
    // 从 URL 中提取 API 名称
    const match = url.match(/query(\w+)|(\w+)\.htm|(\w+)\?/);
    if (match) {
      return match[1] || match[2] || match[3] || 'unknown';
    }

    // 尝试从路径中提取
    const pathParts = url.split('/').filter(p => p);
    if (pathParts.length > 0) {
      const lastPart = pathParts[pathParts.length - 1];
      return lastPart.split('?')[0].substring(0, 30);
    }

    return `api_${Date.now()}`;
  }

  private extractProvinceData(data: any, apiName: string): void {
    if (!data || !data.data) return;

    const dataValue = data.data;

    // 检查是否是数组格式
    if (Array.isArray(dataValue)) {
      dataValue.forEach((item: any) => {
        if (item.name && (item.data || item.value)) {
          const provinceName = item.name.trim();
          this.updateProvinceData(provinceName, item, apiName);
        }
      });
    }

    // 检查是否是对象格式
    else if (typeof dataValue === 'object') {
      Object.keys(dataValue).forEach(key => {
        if (Array.isArray(dataValue[key])) {
          dataValue[key].forEach((item: any) => {
            if (item.name && (item.data || item.value)) {
              const provinceName = item.name.trim();
              this.updateProvinceData(provinceName, item, apiName);
            }
          });
        }
      });
    }
  }

  private updateProvinceData(provinceName: string, item: any, apiName: string): void {
    if (!this.provinceData.has(provinceName)) {
      this.provinceData.set(provinceName, {
        name: provinceName,
        year: '2023'
      });
    }

    const province = this.provinceData.get(provinceName)!;

    // 根据数据类型更新字段
    const dataValue = item.data || item.value;

    if (typeof dataValue === 'number') {
      // 尝试根据 API 名称推断数据类型
      if (apiName.includes('gdp') || apiName.includes('Gdp') || apiName.includes('核算')) {
        province.gdp = dataValue;
      } else if (apiName.includes('pop') || apiName.includes('人口')) {
        province.population = dataValue;
      } else if (apiName.includes('invest') || apiName.includes('投资')) {
        province.investment = dataValue;
      } else if (apiName.includes('retail') || apiName.includes('消费')) {
        province.retailSales = dataValue;
      } else if (apiName.includes('income') || apiName.includes('收入')) {
        province.income = dataValue;
      }
    }

    this.provinceData.set(provinceName, province);
  }

  async crawl(): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    const outputDir = path.join(process.cwd(), 'output', 'province-data');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    console.log('\n🎯 开始深度爬取各省经济数据...');
    console.log('='.repeat(60));

    // 1. 访问首页
    console.log('\n📍 步骤 1: 访问国家统计局数据首页...');
    await this.page.goto('https://data.stats.gov.cn/', {
      waitUntil: 'networkidle',
      timeout: 60000
    });
    await this.page.waitForTimeout(3000);

    // 截图
    await this.page.screenshot({ path: 'output/province-data/01-homepage.png' });
    console.log('   ✅ 已保存首页截图');

    // 2. 尝试获取并点击年度数据
    console.log('\n📍 步骤 2: 查找年度数据菜单...');
    await this.tryClickYearData();

    // 3. 尝试导航到地区数据
    console.log('\n📍 步骤 3: 查找地区数据菜单...');
    await this.tryClickRegionData();

    // 4. 尝试点击具体的指标
    console.log('\n📍 步骤 4: 尝试点击国民经济核算指标...');
    await this.tryClickEconomicIndicators();

    // 5. 等待并滚动以触发更多数据加载
    console.log('\n📍 步骤 5: 等待数据加载并触发更多 API...');
    await this.triggerDataLoading();

    // 6. 尝试触发数据表格
    console.log('\n📍 步骤 6: 尝试触发数据表格加载...');
    await this.triggerDataTable();

    // 7. 最终等待
    console.log('\n📍 步骤 7: 最终等待数据加载...');
    await this.page.waitForTimeout(15000);

    // 8. 最终截图
    await this.page.screenshot({ path: 'output/province-data/02-final.png', fullPage: true });
    console.log('   ✅ 已保存最终截图');

    // 保存所有数据
    this.saveAllData(outputDir);

    console.log('\n' + '='.repeat(60));
    console.log('🎉 爬取完成！');
    console.log('='.repeat(60));
  }

  private async tryClickYearData(): Promise<void> {
    if (!this.page) return;

    try {
      // 查找年度数据相关的选择器
      const selectors = [
        'a:has-text("年度数据")',
        '[href*="year"]',
        '.menu-item:has-text("年度")',
        'span:has-text("年度数据")',
        'div:has-text("年度数据")'
      ];

      for (const selector of selectors) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            console.log(`   找到元素: ${selector}`);
            await element.click();
            await this.page.waitForTimeout(3000);
            console.log('   ✅ 已点击年度数据');
            return;
          }
        } catch (e) {
          // 继续尝试
        }
      }

      // 尝试通过 JavaScript 点击
      await this.page.evaluate(() => {
        const allText = Array.from(document.querySelectorAll('*')).map(el => ({
          tag: el.tagName,
          text: el.textContent?.trim(),
          element: el
        }));

        const yearDataElement = allText.find(item =>
          item.text && (
            item.text.includes('年度数据') ||
            item.text.includes('年度')
          ) && item.tag === 'A'
        );

        if (yearDataElement) {
          (yearDataElement.element as HTMLElement).click();
          return true;
        }
        return false;
      });

      await this.page.waitForTimeout(2000);
    } catch (e) {
      console.log('   ⚠️  年度数据点击失败');
    }
  }

  private async tryClickRegionData(): Promise<void> {
    if (!this.page) return;

    try {
      const selectors = [
        'a:has-text("地区数据")',
        '[href*="region"]',
        '[href*="province"]',
        '.menu-item:has-text("地区")',
        'span:has-text("地区数据")'
      ];

      for (const selector of selectors) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            console.log(`   找到元素: ${selector}`);
            await element.click();
            await this.page.waitForTimeout(3000);
            console.log('   ✅ 已点击地区数据');
            return;
          }
        } catch (e) {
          // 继续尝试
        }
      }

      await this.page.evaluate(() => {
        const allText = Array.from(document.querySelectorAll('*')).map(el => ({
          tag: el.tagName,
          text: el.textContent?.trim(),
          element: el
        }));

        const regionDataElement = allText.find(item =>
          item.text && item.text.includes('地区数据')
        );

        if (regionDataElement) {
          (regionDataElement.element as HTMLElement).click();
          return true;
        }
        return false;
      });

      await this.page.waitForTimeout(2000);
    } catch (e) {
      console.log('   ⚠️  地区数据点击失败');
    }
  }

  private async tryClickEconomicIndicators(): Promise<void> {
    if (!this.page) return;

    try {
      await this.page.evaluate(() => {
        // 查找包含"国民经济核算"的元素
        const allText = Array.from(document.querySelectorAll('*')).map(el => ({
          tag: el.tagName,
          text: el.textContent?.trim(),
          element: el
        }));

        const indicatorElement = allText.find(item =>
          item.text && (
            item.text.includes('国民经济核算') ||
            item.text.includes('GDP') ||
            item.text.includes('生产总值')
          )
        );

        if (indicatorElement) {
          (indicatorElement.element as HTMLElement).click();
          return true;
        }
        return false;
      });

      await this.page.waitForTimeout(3000);
    } catch (e) {
      console.log('   ⚠️  经济指标点击失败');
    }
  }

  private async triggerDataLoading(): Promise<void> {
    if (!this.page) return;

    console.log('   滚动页面以触发更多数据加载...');

    // 滚动到页面底部
    await this.page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await this.page.waitForTimeout(2000);

    // 滚动回顶部
    await this.page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await this.page.waitForTimeout(2000);

    // 尝试触发所有下拉框
    await this.page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll(
        'select, [role="combobox"], .el-select, [class*="select"]'
      ));

      selects.forEach((select, index) => {
        if (index < 5) { // 只触发前 5 个
          (select as HTMLElement).click();
        }
      });
    });

    await this.page.waitForTimeout(3000);
  }

  private async triggerDataTable(): Promise<void> {
    if (!this.page) return;

    console.log('   尝试触发数据表格加载...');

    // 尝试查找并点击表格相关的元素
    await this.page.evaluate(() => {
      // 查找可能触发数据加载的元素
      const triggers = Array.from(document.querySelectorAll(
        '[class*="table"], [class*="grid"], [class*="chart"], [class*="data"], ' +
        'button, .el-button, [role="button"]'
      ));

      triggers.forEach((trigger, index) => {
        if (index < 10) { // 只点击前 10 个
          setTimeout(() => {
            (trigger as HTMLElement).click();
          }, index * 200);
        }
      });
    });

    await this.page.waitForTimeout(5000);
  }

  private saveAllData(outputDir: string): void {
    // 1. 保存所有 API 响应
    const apiData: any = {};
    this.capturedData.forEach((value, key) => {
      apiData[key] = value;
    });

    const apiFilePath = path.join(outputDir, 'all-api-responses.json');
    fs.writeFileSync(apiFilePath, JSON.stringify(apiData, null, 2), 'utf-8');
    console.log(`\n📊 已保存 API 响应: ${apiFilePath}`);

    // 2. 保存省份数据
    const provinceArray = Array.from(this.provinceData.values());
    const provinceFilePath = path.join(outputDir, 'provinces.json');
    fs.writeFileSync(provinceFilePath, JSON.stringify(provinceArray, null, 2), 'utf-8');
    console.log(`📊 已保存省份数据: ${provinceFilePath}`);

    // 3. 保存 API 调用统计
    const apiStats = Array.from(this.apiCalls.entries()).map(([url, count]) => ({
      url,
      count
    }));
    const statsFilePath = path.join(outputDir, 'api-stats.json');
    fs.writeFileSync(statsFilePath, JSON.stringify(apiStats, null, 2), 'utf-8');
    console.log(`📊 已保存 API 统计: ${statsFilePath}`);

    // 4. 生成汇总报告
    this.generateSummaryReport(outputDir);

    // 5. 输出统计信息
    console.log('\n📈 统计信息:');
    console.log(`   捕获 API 响应: ${this.capturedData.size} 个`);
    console.log(`   识别省份数量: ${this.provinceData.size} 个`);
    console.log(`   API 调用次数: ${this.apiCalls.size} 个 API`);
  }

  private generateSummaryReport(outputDir: string): void {
    const report: any = {
      timestamp: new Date().toISOString(),
      summary: {
        totalApiResponses: this.capturedData.size,
        totalProvinces: this.provinceData.size,
        totalApiCalls: this.apiCalls.size
      },
      provinces: Array.from(this.provinceData.values()).map(p => ({
        name: p.name,
        year: p.year,
        gdp: p.gdp,
        population: p.population,
        investment: p.investment,
        retailSales: p.retailSales,
        income: p.income
      })),
      topApis: Array.from(this.apiCalls.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([url, count]) => ({ url, count }))
    };

    const reportPath = path.join(outputDir, 'summary-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`📊 已生成汇总报告: ${reportPath}`);
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      console.log('\n🔚 浏览器已关闭');
    }
  }
}

// 主函数
async function main() {
  const crawler = new EnhancedStatsCrawler();

  try {
    await crawler.init();
    await crawler.crawl();

    console.log('\n🎯 所有数据已保存到: output/province-data/');
    console.log('📄 查看文件:');
    console.log('   - all-api-responses.json (所有 API 响应)');
    console.log('   - provinces.json (省份数据)');
    console.log('   - api-stats.json (API 统计)');
    console.log('   - summary-report.json (汇总报告)');
    console.log('   - 01-homepage.png (首页截图)');
    console.log('   - 02-final.png (最终截图)');

  } catch (error) {
    console.error('\n❌ 爬取过程中出错:', error);
  } finally {
    await crawler.close();
  }
}

main().catch(console.error);