import { chromium } from 'playwright';

const CDP_ENDPOINT = 'http://localhost:9221';
const DOUBAO_IMAGE_URL = 'https://www.doubao.com/chat/create-image';

async function testDoubaoImage() {
  console.log('🔗 连接到 CDP 端口 9221...');

  const browser = await chromium.connectOverCDP(CDP_ENDPOINT);
  const context = browser.contexts()[0];
  let page = context.pages()[0];

  if (!page) {
    page = await context.newPage();
  }

  console.log('✅ 已连接到浏览器');
  console.log(`📄 当前页面: ${page.url()}`);

  // 导航到豆包文生图页面
  console.log('🚀 导航到豆包文生图页面...');
  await page.goto(DOUBAO_IMAGE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // 等待页面加载
  await page.waitForTimeout(5000);

  console.log('📄 当前页面:', page.url());
  console.log('📝 页面标题:', await page.title());

  // 查找输入框并输入提示词
  const prompt = '夕阳下的金色沙滩，海浪轻柔，远处有椰树';
  console.log(`📝 输入提示词: ${prompt}`);

  // 尝试多种可能的选择器
  const inputSelectors = [
    'textarea[placeholder*="描述"]',
    'textarea[placeholder*="输入"]',
    'textarea[placeholder*="prompt"]',
    'textarea',
    'input[type="text"]',
    '[contenteditable="true"]'
  ];

  let inputElement = null;
  for (const selector of inputSelectors) {
    try {
      inputElement = await page.waitForSelector(selector, { timeout: 2000 });
      if (inputElement) {
        console.log(`✅ 找到输入框: ${selector}`);
        break;
      }
    } catch (e) {
      continue;
    }
  }

  if (!inputElement) {
    console.log('❌ 未找到输入框，尝试获取页面内容...');
    const pageContent = await page.content();
    console.log('页面片段:', pageContent.substring(0, 500));

    // 尝试执行 JS 查找所有可交互元素
    const allTextareas = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('textarea, input[type="text"]'));
      return elements.map(el => ({
        tag: el.tagName,
        placeholder: (el as any).placeholder,
        id: el.id,
        className: el.className,
        name: (el as any).name
      }));
    });
    console.log('页面文本输入框:', JSON.stringify(allTextareas, null, 2));
  }

  // 截图查看页面状态
  const screenshotPath = '/tmp/doubao-image-page.png';
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`📸 页面截图已保存到: ${screenshotPath}`);

  // 不保持连接，方便测试
  console.log('🔍 页面分析完成，保持浏览器连接...');
  console.log('');
  console.log('💡 提示: 你可以手动在浏览器中操作豆包文生图功能');

  // 保持连接但不退出，方便用户手动操作
  // await browser.close();
}

testDoubaoImage().catch(console.error);
