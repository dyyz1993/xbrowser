import { chromium } from 'playwright';

const CDP_ENDPOINT = 'http://localhost:9221';
const DOUBAO_VIDEO_URL = 'https://www.doubao.com/chat/create-video';

async function testDoubaoVideo() {
  console.log('🔗 连接到 CDP 端口 9221...');

  const browser = await chromium.connectOverCDP(CDP_ENDPOINT);
  const context = browser.contexts()[0];
  let page = context.pages()[0];

  if (!page) {
    page = await context.newPage();
  }

  console.log('✅ 已连接到浏览器（CDP 9221）');
  console.log(`📄 当前页面: ${page.url()}`);

  // 导航到豆包视频生成页面
  console.log('🚀 导航到豆包视频生成页面...');
  await page.goto(DOUBAO_VIDEO_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // 等待页面加载
  await page.waitForTimeout(5000);

  console.log('📄 当前页面:', page.url());
  console.log('📝 页面标题:', await page.title());

  // 查找输入框并输入提示词
  const prompt = '一只小猫在草地上追逐蝴蝶，阳光明媚，慢动作镜头';
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

  // 查找生成按钮
  console.log('🔍 查找生成按钮...');

  try {
    const generateButton = await page.waitForSelector('#flow-end-msg-send', { timeout: 5000 });
    console.log('✅ 找到生成按钮: #flow-end-msg-send');

    // 截图查看点击前的状态
    const screenshotPath1 = '/tmp/doubao-video-before.png';
    await page.screenshot({ path: screenshotPath1, fullPage: false });
    console.log(`📸 点击前截图已保存: ${screenshotPath1}`);

    // 点击生成按钮
    console.log('🖱️ 点击生成按钮...');
    await generateButton.click();
    console.log('✅ 已点击生成按钮');

    // 等待视频生成（视频生成比图片慢，多等待一些时间）
    console.log('⏳ 等待视频生成（最多 120 秒）...');

    let generated = false;
    for (let i = 0; i < 120; i++) {
      await page.waitForTimeout(1000);

      // 检查视频是否出现
      const hasVideo = await page.evaluate(() => {
        // 检查是否有视频元素
        const videos = Array.from(document.querySelectorAll('video'));
        if (videos.length > 0) return true;

        // 检查是否有视频相关的图片或标志
        const images = Array.from(document.querySelectorAll('img'));
        return images.some(img => {
          const alt = (img.alt || '').toLowerCase();
          const src = (img.src || '').toLowerCase();
          return alt.includes('video') || alt.includes('视频') ||
            src.includes('video') || src.includes('mp4');
        });
      });

      if (hasVideo) {
        generated = true;
        break;
      }

      if (i % 10 === 0) {
        console.log(`   ${i}s 等待中...`);
      }
    }

    if (generated) {
      console.log('✅ 视频已生成！');

      // 截图查看结果
      const screenshotPath2 = '/tmp/doubao-video-result.png';
      await page.screenshot({ path: screenshotPath2, fullPage: true });
      console.log(`📸 结果截图已保存: ${screenshotPath2}`);

      // 获取视频相关信息
      const videoInfo = await page.evaluate(() => {
        const videos = Array.from(document.querySelectorAll('video'));
        const info = [];

        for (const video of videos) {
          info.push({
            src: video.src || '无src',
            width: video.width,
            height: video.height,
            duration: video.duration || '未知',
            currentTime: video.currentTime
          });
        }

        // 如果没有video元素，查找相关的图片元素
        if (info.length === 0) {
          const images = Array.from(document.querySelectorAll('img'));
          const videoRelated = images
            .filter(img => {
              const alt = (img.alt || '').toLowerCase();
              const src = (img.src || '').toLowerCase();
              return alt.includes('video') || alt.includes('视频') ||
                src.includes('video') || src.includes('mp4');
            })
            .map(img => ({
              type: 'image-related-to-video',
              src: img.src,
              alt: img.alt
            }));

          info.push(...videoRelated);
        }

        return info;
      });

      console.log('🎬 视频信息:', JSON.stringify(videoInfo, null, 2));
    } else {
      console.log('⏰ 等待视频生成超时（视频生成可能需要更长时间）');

      // 再次截图查看当前状态
      const screenshotPath3 = '/tmp/doubao-video-timeout.png';
      await page.screenshot({ path: screenshotPath3, fullPage: false });
      console.log(`📸 超时截图已保存: ${screenshotPath3}`);
      console.log('💡 提示: 视频生成通常比图片慢，可以检查浏览器页面查看进度');
    }

  } catch (e) {
    console.log(`❌ 查找或点击按钮失败: ${e}`);

    const screenshotPath4 = '/tmp/doubao-video-error.png';
    await page.screenshot({ path: screenshotPath4, fullPage: false });
    console.log(`📸 错误截图已保存: ${screenshotPath4}`);
  }

  console.log('');
  console.log('🔍 测试完成！保持浏览器连接以便查看结果');
}

testDoubaoVideo().catch(console.error);
