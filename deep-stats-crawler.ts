/**
 * 国家统计局数据深度爬虫
 * 通过模拟用户操作获取各省 GDP 和经济数据
 */

import { chromium, Browser, Page, Response, Route } from 'playwright';
import fs from 'fs';
import path from 'path';

interface ProvinceData {
  name: string;
  year: string;
  gdp?: number;
  gdpUnit?: string;
  gdpRank?: number;
  population?: number;
  investment?: number;
  retailSales?: number;
  income?: number;
}

class DeepStatsCrawler {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private capturedData: Map<string, any> = new Map();
  private provinceData: Map<string, ProvinceData> = new Map();

  async init(): Promise<void> {
    console.log('🚀 启动浏览器...');

    this.browser = await chromium.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--window-size=1920,1080'
      ]
    });

    const context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      permissions: ['geolocation']
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

    // 拦截所有可能包含数据的响应
    if (this.isDataApi(url)) {
      try {
        const data = await response.json().catch(() => null);

        if (data && (data.success !== false)) {
          const apiName = this.getApiName(url);

          // 检查是否包含省份数据
          if (this.containsProvinceData(data)) {
            console.log(`\n✅ 捕获省份数据: ${apiName}`);
            console.log(`   URL: ${url}`);

            this.capturedData.set(apiName, {
              url,
              timestamp: new Date().toISOString(),
              data
            });

            this.extractProvinceData(data);
          }
        }
      } catch (e) {
        // 静默忽略
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
      'dg/website',
      'data',
      'table'
    ];

    return dataKeywords.some(keyword =>
      url.toLowerCase().includes(keyword.toLowerCase())
    ) && !url.includes('.js') && !url.includes('.css') && !url.includes('.png') && !url.includes('.jpg');
  }

  private containsProvinceData(data: any): boolean {
    if (!data || !data.data) return false;

    const dataValue = data.data;
    const provinceKeywords = ['北京', '天津', '河北', '山西', '内蒙古', '辽宁', '吉林', '黑龙江',
      '上海', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南',
      '广东', '广西', '海南', '重庆', '四川', '贵州', '云南', '西藏', '陕西', '甘肃',
      '青海', '宁夏', '新疆', '香港', '澳门'];

    const dataStr = JSON.stringify(dataValue);
    return provinceKeywords.some(keyword => dataStr.includes(keyword));
  }

  private getApiName(url: string): string {
    const match = url.match(/query(\w+)|(\w+)\.htm/);
    if (match) {
      return match[1] || match[2] || 'unknown';
    }

    const pathParts = url.split('/').filter(p => p);
    if (pathParts.length > 0) {
      const lastPart = pathParts[pathParts.length - 1];
      return lastPart.split('?')[0].substring(0, 30);
    }

    return `api_${Date.now()}`;
  }

  private extractProvinceData(data: any): void {
    if (!data || !data.data) return;

    const dataValue = data.data;
    const currentYear = new Date().getFullYear().toString();

    // 递归提取数据
    this.extractDataRecursive(dataValue, currentYear);
  }

  private extractDataRecursive(data: any, year: string): void {
    if (Array.isArray(data)) {
      data.forEach(item => this.extractDataRecursive(item, year));
    } else if (typeof data === 'object' && data !== null) {
      // 检查是否是省份条目
      if (data.name && (data.data || data.value || data.gdp)) {
        const name = String(data.name).trim();
        if (this.isProvinceName(name)) {
          this.updateProvinceData(name, data, year);
        }
      }

      // 递归处理子对象
      Object.values(data).forEach(value => {
        this.extractDataRecursive(value, year);
      });
    }
  }

  private isProvinceName(name: string): boolean {
    const provinces = [
      '北京市', '天津市', '河北省', '山西省', '内蒙古自治区',
      '辽宁省', '吉林省', '黑龙江省', '上海市', '江苏省',
      '浙江省', '安徽省', '福建省', '江西省', '山东省',
      '河南省', '湖北省', '湖南省', '广东省', '广西壮族自治区',
      '海南省', '重庆市', '四川省', '贵州省', '云南省',
      '西藏自治区', '陕西省', '甘肃省', '青海省', '宁夏回族自治区',
      '新疆维吾尔自治区', '香港特别行政区', '澳门特别行政区', '台湾省',
      '北京', '天津', '河北', '山西', '内蒙古', '辽宁', '吉林',
      '黑龙江', '上海', '江苏', '浙江', '安徽', '福建', '江西',
      '山东', '河南', '湖北', '湖南', '广东', '广西', '海南',
      '重庆', '四川', '贵州', '云南', '西藏', '陕西', '甘肃',
      '青海', '宁夏', '新疆', '香港', '澳门', '台湾'
    ];

    return provinces.some(p => name.includes(p) && name.length <= 10);
  }

  private updateProvinceData(provinceName: string, item: any, year: string): void {
    if (!this.provinceData.has(provinceName)) {
      this.provinceData.set(provinceName, {
        name: provinceName,
        year
      });
    }

    const province = this.provinceData.get(provinceName)!;

    // 提取 GDP 数据
    if (item.gdp || item.GDP) {
      province.gdp = item.gdp || item.GDP;
      province.gdpUnit = item.unit || item.gdpUnit || '亿元';
    }

    if (item.data && Array.isArray(item.data)) {
      item.data.forEach((dataItem: any) => {
        if (dataItem.gdp || dataItem.GDP) {
          province.gdp = dataItem.gdp || dataItem.GDP;
          province.gdpUnit = dataItem.unit || '亿元';
        }

        if (dataItem.value && typeof dataItem.value === 'number') {
          // 尝试从上下文推断数据类型
          const context = JSON.stringify(item).toLowerCase();
          if (context.includes('gdp') || context.includes('生产总值') || context.includes('核算')) {
            province.gdp = dataItem.value;
            province.gdpUnit = dataItem.unit || '亿元';
          }
        }
      });
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

    // 步骤 1: 访问首页
    console.log('\n📍 步骤 1: 访问国家统计局数据网站...');
    await this.page.goto('https://data.stats.gov.cn/', {
      waitUntil: 'networkidle',
      timeout: 60000
    });
    await this.page.waitForTimeout(5000);

    // 步骤 2: 查找并点击年度数据
    console.log('\n📍 步骤 2: 点击年度数据菜单...');
    await this.clickYearDataMenu();

    // 步骤 3: 等待数据加载
    await this.page.waitForTimeout(5000);

    // 步骤 4: 尝试点击各种可能的触发器
    console.log('\n📍 步骤 3: 尝试触发数据加载...');
    await this.triggerAllDataTriggers();

    // 步骤 5: 尝试导航到具体的报表页面
    console.log('\n📍 步骤 4: 尝试导航到国民经济核算报表...');
    await this.navigateToGDPReport();

    // 步骤 6: 继续触发更多数据
    console.log('\n📍 步骤 5: 继续触发更多数据...');
    await this.continueTriggeringData();

    // 步骤 7: 最终等待
    console.log('\n📍 步骤 6: 等待数据加载完成...');
    await this.page.waitForTimeout(10000);

    // 步骤 8: 尝试通过 URL 直接访问数据页面
    console.log('\n📍 步骤 7: 尝试直接访问数据页面...');
    await this.tryDirectDataUrls();

    // 保存数据
    this.saveAllData(outputDir);

    console.log('\n' + '='.repeat(60));
    console.log('🎉 爬取完成！');
    console.log('='.repeat(60));
  }

  private async clickYearDataMenu(): Promise<void> {
    if (!this.page) return;

    // 尝试多种选择器
    const selectors = [
      'a:has-text("年度数据")',
      'span:has-text("年度数据")',
      'div:has-text("年度数据")',
      '[class*="year"]',
      '[href*="year"]',
      'li:has-text("年度数据")'
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

    // JavaScript 方式查找并点击
    const clicked = await this.page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('*'));
      const yearDataElement = elements.find(el =>
        el.textContent?.includes('年度数据') && el.tagName === 'A'
      );

      if (yearDataElement) {
        (yearDataElement as HTMLElement).click();
        return true;
      }

      // 尝试查找所有可能的菜单项
      const menuItems = elements.filter(el =>
        el.textContent?.includes('数据') && el.textContent?.length < 20
      );

      // 点击前几个数据相关的菜单项
      for (let i = 0; i < Math.min(3, menuItems.length); i++) {
        setTimeout(() => {
          (menuItems[i] as HTMLElement).click();
        }, i * 500);
      }

      return false;
    });

    if (clicked) {
      console.log('   ✅ 已通过 JavaScript 点击年度数据');
    }

    await this.page.waitForTimeout(3000);
  }

  private async triggerAllDataTriggers(): Promise<void> {
    if (!this.page) return;

    console.log('   触发所有可能的数据加载器...');

    // 触发所有下拉框
    await this.page.evaluate(() => {
      const selects = document.querySelectorAll('select, [role="combobox"]');
      selects.forEach((sel, i) => {
        setTimeout(() => {
          (sel as HTMLElement).click();
        }, i * 300);
      });
    });

    await this.page.waitForTimeout(2000);

    // 触发所有按钮
    await this.page.evaluate(() => {
      const buttons = document.querySelectorAll('button, .el-button, [role="button"]');
      buttons.forEach((btn, i) => {
        setTimeout(() => {
          try {
            (btn as HTMLElement).click();
          } catch (e) {
            // 忽略
          }
        }, i * 200);
      });
    });

    await this.page.waitForTimeout(3000);

    // 触发所有表格
    await this.page.evaluate(() => {
      const tables = document.querySelectorAll('table, [class*="table"]');
      tables.forEach((table, i) => {
        setTimeout(() => {
          const cells = table.querySelectorAll('td, th');
          cells.forEach((cell, j) => {
            setTimeout(() => {
              (cell as HTMLElement).click();
            }, j * 50);
          });
        }, i * 500);
      });
    });

    await this.page.waitForTimeout(5000);
  }

  private async navigateToGDPReport(): Promise<void> {
    if (!this.page) return;

    // 尝试找到 GDP 相关的链接
    const gdpKeywords = ['国民', '核算', 'GDP', '生产总值', '地区'];

    const clicked = await this.page.evaluate((keywords) => {
      const allText = Array.from(document.querySelectorAll('*')).map(el => ({
        text: el.textContent?.trim(),
        element: el,
        href: (el as HTMLAnchorElement).href,
        tagName: el.tagName
      }));

      // 查找包含关键词的元素
      const found = allText.find(item =>
        keywords.some((k: string) => item.text?.includes(k)) &&
        (item.tagName === 'A' || item.href)
      );

      if (found && found.href) {
        window.location.href = found.href;
        return true;
      }

      // 尝试点击包含关键词的元素
      const clickTarget = allText.find(item =>
        keywords.some((k: string) => item.text?.includes(k))
      );

      if (clickTarget) {
        (clickTarget.element as HTMLElement).click();
        return true;
      }

      return false;
    }, gdpKeywords);

    if (clicked) {
      console.log('   ✅ 已导航到 GDP 报表');
      await this.page.waitForTimeout(5000);
    } else {
      console.log('   ⚠️  未找到 GDP 报表链接');
    }
  }

  private async continueTriggeringData(): Promise<void> {
    if (!this.page) return;

    // 滚动页面
    await this.page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await this.page.waitForTimeout(2000);

    await this.page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await this.page.waitForTimeout(2000);

    // 尝试触发图表
    await this.page.evaluate(() => {
      const charts = document.querySelectorAll('[class*="chart"], [id*="chart"]');
      charts.forEach((chart, i) => {
        setTimeout(() => {
          (chart as HTMLElement).click();
        }, i * 300);
      });
    });

    await this.page.waitForTimeout(5000);
  }

  private async tryDirectDataUrls(): Promise<void> {
    if (!this.page) return;

    const possibleUrls = [
      'https://data.stats.gov.cn/easyquery.htm?cn=C01',
      'https://data.stats.gov.cn/easyquery.htm?cn=E0101',
      'https://data.stats.gov.cn/easyquery.htm?cn=E0102',
      'https://data.stats.gov.cn/easyquery.htm?cn=E0103',
      'https://data.stats.gov.cn/easyquery.htm?cn=B01',
      'https://data.stats.gov.cn/easyquery.htm?cn=A01'
    ];

    for (const url of possibleUrls) {
      try {
        console.log(`   尝试访问: ${url}`);
        await this.page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        await this.page.waitForTimeout(5000);

        // 触发页面上的数据加载
        await this.triggerAllDataTriggers();
      } catch (e) {
        console.log(`   ⚠️  访问失败: ${e}`);
      }
    }
  }

  private saveAllData(outputDir: string): void {
    // 保存所有 API 响应
    const apiData: any = {};
    this.capturedData.forEach((value, key) => {
      apiData[key] = value;
    });

    const apiFilePath = path.join(outputDir, 'deep-api-responses.json');
    fs.writeFileSync(apiFilePath, JSON.stringify(apiData, null, 2), 'utf-8');
    console.log(`\n📊 已保存 API 响应: ${apiFilePath}`);

    // 保存省份数据
    const provinceArray = Array.from(this.provinceData.values());
    const provinceFilePath = path.join(outputDir, 'province-deep-data.json');
    fs.writeFileSync(provinceFilePath, JSON.stringify(provinceArray, null, 2), 'utf-8');
    console.log(`📊 已保存省份数据: ${provinceFilePath}`);

    // 生成汇总报告
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalApiResponses: this.capturedData.size,
        totalProvinces: this.provinceData.size
      },
      provinces: provinceArray
    };

    const reportPath = path.join(outputDir, 'deep-summary.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`📊 已生成汇总报告: ${reportPath}`);

    // 输出统计信息
    console.log('\n📈 统计信息:');
    console.log(`   捕获 API 响应: ${this.capturedData.size} 个`);
    console.log(`   识别省份数量: ${this.provinceData.size} 个`);

    if (this.provinceData.size > 0) {
      console.log('\n📊 省份经济数据:');
      Array.from(this.provinceData.values()).forEach(province => {
        console.log(`   ${province.name}: GDP ${province.gdp || 'N/A'} ${province.gdpUnit || ''}`);
      });
    }
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
  const crawler = new DeepStatsCrawler();

  try {
    await crawler.init();
    await crawler.crawl();

    console.log('\n🎯 所有数据已保存到: output/province-data/');
    console.log('📄 查看文件:');
    console.log('   - deep-api-responses.json (所有 API 响应)');
    console.log('   - province-deep-data.json (省份数据)');
    console.log('   - deep-summary.json (汇总报告)');

  } catch (error) {
    console.error('\n❌ 爬取过程中出错:', error);
  } finally {
    await crawler.close();
  }
}

main().catch(console.error);