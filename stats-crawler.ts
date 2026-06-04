/**
 * 国家统计局数据爬虫 - 完整实现
 * 使用 Playwright 拦截网络请求获取完整数据
 */

import { chromium, Browser, Page, Response } from 'playwright';
import fs from 'fs';
import path from 'path';

interface DataPoint {
  name: string;
  unit: string;
  data: Array<{
    name: string;
    data: {
      value: string | number;
      year: string;
    }[];
  }>;
}

class StatsDataCrawler {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private capturedData: Map<string, any> = new Map();

  async init(): Promise<void> {
    console.log('启动浏览器...');
    this.browser = await chromium.launch({
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    });

    this.page = await context.newPage();

    // 监控所有响应
    this.page.on('response', async (response: Response) => {
      await this.handleResponse(response);
    });
  }

  private async handleResponse(response: Response): Promise<void> {
    const url = response.url();

    // 拦截数据 API 响应
    if (this.isDataApi(url)) {
      try {
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('json') || contentType.includes('application')) {
          const data = await response.json();
          const key = this.getApiName(url);

          this.capturedData.set(key, {
            url,
            timestamp: new Date().toISOString(),
            data
          });

          console.log(`\n✅ 捕获数据: ${key}`);
          console.log(`   URL: ${url}`);
          console.log(`   数据大小: ${JSON.stringify(data).length} 字节`);

          // 实时保存
          this.saveCapturedData(key, data);
        }
      } catch (e) {
        console.log(`⚠️  无法解析响应: ${url}`);
      }
    }
  }

  private isDataApi(url: string): boolean {
    return url.includes('api') ||
      url.includes('data') ||
      url.includes('query') ||
      url.includes('external');
  }

  private getApiName(url: string): string {
    const match = url.match(/query(\w+)|(\w+)\.htm/);
    return match ? match[0] : `api_${Date.now()}`;
  }

  private saveCapturedData(key: string, data: any): void {
    const outputDir = path.join(process.cwd(), 'output', 'stats-data');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const fileName = `${key.replace(/[^a-zA-Z0-9]/g, '_')}.json`;
    const filePath = path.join(outputDir, fileName);

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async crawlProvinceData(): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    console.log('\n🎯 开始爬取各省经济数据...');
    console.log('='.repeat(50));

    // 访问首页
    console.log('\n📍 访问国家统计局数据网站...');
    await this.page.goto('https://data.stats.gov.cn/', {
      waitUntil: 'networkidle',
      timeout: 60000
    });
    await this.page.waitForTimeout(3000);

    // 截图
    await this.page.screenshot({ path: 'output/stats-homepage.png', fullPage: true });
    console.log('✅ 已保存首页截图');

    // 尝试点击地区数据
    console.log('\n📍 尝试点击地区数据...');
    try {
      // 查找地区数据相关的元素
      const regionSelectors = [
        'a:has-text("地区数据")',
        '[href*="region"]',
        '[href*="province"]',
        '.menu-item:has-text("地区")'
      ];

      for (const selector of regionSelectors) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            console.log(`找到元素: ${selector}`);
            await element.click();
            await this.page.waitForTimeout(2000);
            break;
          }
        } catch (e) {
          // 继续尝试下一个选择器
        }
      }
    } catch (e) {
      console.log('⚠️  地区数据按钮未找到，尝试直接导航');
    }

    // 尝试点击年度数据
    console.log('\n📍 尝试点击年度数据...');
    try {
      await this.page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        for (const link of links) {
          if (link.textContent?.includes('年度数据')) {
            (link as HTMLElement).click();
            return true;
          }
        }
        return false;
      });
      await this.page.waitForTimeout(3000);
    } catch (e) {
      console.log('⚠️  年度数据点击失败');
    }

    // 等待数据加载
    console.log('\n⏳ 等待数据加载 (30秒)...');
    await this.page.waitForTimeout(30000);

    // 尝试触发更多数据加载
    console.log('\n📍 尝试触发更多数据加载...');

    // 滚动页面
    await this.page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await this.page.waitForTimeout(2000);

    // 尝试触发任何下拉菜单或选择器
    try {
      await this.page.evaluate(() => {
        // 查找并点击所有可能的触发元素
        const triggers = Array.from(document.querySelectorAll(
          '.el-select, .el-dropdown, [class*="select"], [class*="dropdown"]'
        ));
        triggers.forEach((trigger, index) => {
          if (index < 5) { // 只点击前5个
            setTimeout(() => {
              (trigger as HTMLElement).click();
            }, index * 500);
          }
        });
      });
      await this.page.waitForTimeout(5000);
    } catch (e) {
      console.log('⚠️  触发元素点击失败');
    }

    // 最终截图
    await this.page.screenshot({ path: 'output/stats-final.png', fullPage: true });
    console.log('✅ 已保存最终截图');

    // 保存所有捕获的数据汇总
    this.saveSummary();
  }

  private saveSummary(): void {
    const summary = {
      timestamp: new Date().toISOString(),
      totalCaptured: this.capturedData.size,
      capturedApis: Array.from(this.capturedData.keys()),
      details: Object.fromEntries(this.capturedData)
    };

    const summaryPath = path.join(process.cwd(), 'output', 'stats-summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');

    console.log('\n✅ 已保存数据汇总到: stats-summary.json');
    console.log(`📊 总共捕获 ${this.capturedData.size} 个 API 响应`);
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
  const crawler = new StatsDataCrawler();

  try {
    await crawler.init();
    await crawler.crawlProvinceData();

    console.log('\n' + '='.repeat(50));
    console.log('🎉 爬取完成！');
    console.log('='.repeat(50));
    console.log('\n📁 数据保存在: output/stats-data/');
    console.log('📋 汇总文件: output/stats-summary.json');
    console.log('📸 截图: output/stats-homepage.png, output/stats-final.png');

  } catch (error) {
    console.error('\n❌ 爬取过程中出错:', error);
  } finally {
    await crawler.close();
  }
}

main().catch(console.error);