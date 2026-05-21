import { chromium } from 'playwright';

const CDP_ENDPOINT = 'http://localhost:9221';
const DOUBAO_IMAGE_URL = 'https://www.doubao.com/chat/create-image';

async function testDoubaoGenerate() {
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

  // 查找生成按钮（使用 ID）
  console.log('🔍 查找生成按钮...');

  try {
    const generateButton = await page.waitForSelector('#flow-end-msg-send', { timeout: 5000 });
    console.log('✅ 找到生成按钮: #flow-end-msg-send');

    // 截图查看点击前的状态
    const screenshotPath1 = '/tmp/doubao-before-click.png';
    await page.screenshot({ path: screenshotPath1, fullPage: false });
    console.log(`📸 点击前截图已保存: ${screenshotPath1}`);

    // 点击生成按钮
    console.log('🖱️ 点击生成按钮...');
    await generateButton.click();
    console.log('✅ 已点击生成按钮');

    // 等待图片生成
    console.log('⏳ 等待图片生成（最多 60 秒）...');

    let generated = false;
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(1000);

      // 检查图片是否出现
      const hasImage = await page.evaluate(() => {
        // 查找可能的图片元素
        const images = Array.from(document.querySelectorAll('img'));
        return images.some(img => {
          const src = img.src || '';
          // 检查是否是豆包生成的图片（URL 包含 doubao 或相关关键词）
          return src.includes('doubao') || src.includes('seedream') ||
            src.includes('tob') || src.includes('byteimg') ||
            src.startsWith('blob:') || src.startsWith('data:');
        });
      });

      if (hasImage) {
        generated = true;
        break;
      }

      if (i % 5 === 0) {
        console.log(`   ${i}s 等待中...`);
      }
    }

    if (generated) {
      console.log('✅ 图片已生成！');

      // 截图查看结果
      const screenshotPath2 = '/tmp/doubao-result.png';
      await page.screenshot({ path: screenshotPath2, fullPage: true });
      console.log(`📸 结果截图已保存: ${screenshotPath2}`);

      // 获取生成的图片 URL
      const imageUrls = await page.evaluate(() => {
        const images = Array.from(document.querySelectorAll('img'));
        return images
          .filter(img => {
            const src = img.src || '';
            return src.includes('doubao') || src.includes('seedream') ||
              src.includes('tob') || src.includes('byteimg') ||
              src.startsWith('blob:') || src.startsWith('data:');
          })
          .map(img => ({
            src: img.src,
            alt: img.alt || '无描述',
            width: img.width,
            height: img.height
          }));
      });

      console.log('🖼️ 生成的图片:', JSON.stringify(imageUrls, null, 2));
    } else {
      console.log('⏰ 等待图片生成超时');

      // 再次截图查看当前状态
      const screenshotPath3 = '/tmp/doubao-timeout.png';
      await page.screenshot({ path: screenshotPath3, fullPage: false });
      console.log(`📸 超时截图已保存: ${screenshotPath3}`);
    }

  } catch (e) {
    console.log(`❌ 查找或点击按钮失败: ${e}`);

    const screenshotPath4 = '/tmp/doubao-error.png';
    await page.screenshot({ path: screenshotPath4, fullPage: false });
    console.log(`📸 错误截图已保存: ${screenshotPath4}`);
  }

  console.log('');
  console.log('🔍 测试完成！保持浏览器连接以便查看结果');
}

testDoubaoGenerate().catch(console.error);
