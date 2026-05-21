import { chromium } from 'playwright';

const CDP_ENDPOINT = 'http://localhost:9221';
const DOUBAO_IMAGE_URL = 'https://www.doubao.com/chat/create-image';

async function testDoubaoImageComplete() {
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

  // 查找 contenteditable 的输入框
  const textarea = await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
  console.log('✅ 找到 contenteditable 输入框');

  // 输入提示词
  await textarea.focus();
  await page.keyboard.type(prompt);
  console.log('✅ 已输入提示词');

  // 等待一下让界面响应
  await page.waitForTimeout(2000);

  // 查找并点击生成按钮
  console.log('🔍 查找生成按钮...');

  const buttonSelectors = [
    'button:has-text("生成")',
    'button:has-text("立即生成")',
    'button[type="submit"]',
    '.generate-btn',
    '[class*="generate"]',
    '[class*="submit"]',
    'button'
  ];

  let foundButton = null;
  for (const selector of buttonSelectors) {
    try {
      const buttons = await page.$$(selector);
      console.log(`  检查选择器: ${selector}, 找到 ${buttons.length} 个按钮`);

      if (buttons.length > 0) {
        // 尝试找到包含"生成"文本的按钮
        for (const btn of buttons) {
          const text = await btn.textContent();
          console.log(`    按钮文本: "${text?.trim()}"`);

          if (text && (text.includes('生成') || text.includes('Generate') || text.includes('Submit'))) {
            foundButton = btn;
            console.log(`✅ 找到生成按钮: "${text?.trim()}"`);
            break;
          }
        }

        if (foundButton) break;
      }
    } catch (e) {
      continue;
    }
  }

  if (!foundButton) {
    console.log('❌ 未找到明确的生成按钮，尝试查找所有按钮...');

    const allButtons = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.map(btn => ({
        text: btn.textContent?.trim(),
        className: btn.className,
        id: btn.id,
        disabled: btn.disabled,
        type: btn.type
      }));
    });
    console.log('页面所有按钮:', JSON.stringify(allButtons, null, 2));
  }

  // 截图查看当前状态
  const screenshotPath = '/tmp/doubao-image-prompt.png';
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`📸 页面截图已保存到: ${screenshotPath}`);

  // 如果找到了按钮，点击它
  if (foundButton) {
    console.log('🖱️ 点击生成按钮...');
    await foundButton.click();

    // 等待图片生成
    console.log('⏳ 等待图片生成（最多 30 秒）...');

    // 检查图片是否出现
    try {
      const imageElement = await page.waitForSelector('img[alt*="生成"], img[src*="doubao"], .result-image, .generated-image', {
        timeout: 30000
      });

      if (imageElement) {
        console.log('✅ 图片已生成！');
        const screenshotPath2 = '/tmp/doubao-image-result.png';
        await page.screenshot({ path: screenshotPath2, fullPage: false });
        console.log(`📸 结果截图已保存到: ${screenshotPath2}`);

        // 获取图片 URL
        const imageUrl = await imageElement.getAttribute('src');
        console.log(`🖼️ 图片 URL: ${imageUrl}`);
      }
    } catch (e) {
      console.log('⏰ 等待图片超时，可能还在生成中');

      // 再次截图查看当前状态
      const screenshotPath3 = '/tmp/doubao-image-timeout.png';
      await page.screenshot({ path: screenshotPath3, fullPage: false });
      console.log(`📸 超时截图已保存到: ${screenshotPath3}`);
    }
  } else {
    console.log('⚠️ 未找到生成按钮，无法自动生成');
    console.log('💡 你可以手动在浏览器中点击生成按钮');
  }

  console.log('');
  console.log('🔍 测试完成！保持浏览器连接以便查看结果');
}

testDoubaoImageComplete().catch(console.error);
