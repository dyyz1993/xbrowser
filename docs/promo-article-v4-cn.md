# 凌晨三点，我的爬虫被 reCAPTCHA 干掉了

凌晨 3 点 17 分，手机震了。

是监控报警——定时爬虫挂了。

我翻身打开笔记本，VPN 连上服务器，日志一拉：

```
Error: ElementClickInterceptedException: element click intercepted
  by iframe element: <iframe src="https://www.google.com/recaptcha/...">
```

页面卡在了 reCAPTCHA 上。

说实话，这不是第一次了。上个月是 hCaptcha，上上个月是 Cloudflare Turnstile。每次都是同一个剧本：目标网站升级了反爬策略，我的爬虫猝不及防，数据采集中断，业务线炸锅。

我盯着屏幕上那个验证码框，心想：**这玩意儿到底该怎么搞？**

---

## 方案 1：隐身术——用 stealth 插件隐藏自动化痕迹

最先想到的是"不让对方发现我是机器人"。

Puppetry 社区有个很流行的方案：`puppeteer-extra-plugin-stealth`。它的原理是补全 Headless Chrome 暴露的各种特征——`navigator.webdriver`、Chrome DevTools Protocol 的痕迹、缺失的插件列表等等。

代码大概长这样：

```javascript
import puppeteer from 'puppeteer';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.goto('https://example.com/protected-page');

// 假装自己是真人
await page.evaluate(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
});
```

听起来挺美？问题是——**它不保证 100% 有效**。

Cloudflare 的反机器人检测在持续升级。他们有专门的团队研究如何识别自动化工具，stealth 插件的维护者基本是在玩猫鼠游戏。你今天打了补丁，明天人家又出了新的检测手段。

更要命的是，stealth 只能降低触发验证码的**概率**，而不是消除它。对于一个需要 7x24 小时稳定运行的定时任务来说，"大概率没问题"是不够的。

**结论：有用，但不万能。适合降低触发频率，不能作为唯一防线。**

---

## 方案 2：花钱消灾——验证码识别服务

既然机器过不了，那就找更聪明的"机器"来过。

2Captcha、Anti-Captcha、CapSolver 这类服务的思路很简单：你把验证码截图发过去，那头要么用 AI 识别，要么分发给真人去点，然后把结果返回给你。

```javascript
import { solve } from '2captcha-ts';

async function bypassCaptcha(page, siteKey) {
  const result = await solve({
    sitekey: siteKey,
    pageurl: page.url(),
    method: 'recaptcha'
  });

  await page.evaluate((token) => {
    document.querySelector('#g-recaptcha-response').value = token;
  }, result.data);

  await page.click('#submit-button');
}
```

每次验证大概 $0.001 到 $0.003，听起来不多。但算一笔账：

- 一个采集任务跑 1000 个页面
- 其中 30% 触发了验证码
- 那就是 300 次 × $0.003 = $0.9/天 = $27/月

一个月几十刀还在接受范围内。但真正的问题不在钱：

1. **成功率不稳定**：reCAPTCHA v3 基于用户行为评分，识别服务返回的 token 可能分数不够，过不了验证
2. **隐私风险**：你要把目标网站的 URL、密钥发给第三方
3. **延迟高**：从提交到拿结果，快则 10 秒，慢则一两分钟，严重拖慢采集速度
4. **道德灰色地带**：验证码的初衷是区分人和机器，花钱让真人帮你过验证码，这事儿吧……懂的都懂

**结论：能用，但成本、稳定性和合规性都有问题。适合小规模、非关键场景。**

---

## 方案 3：打游击——IP 代理池轮换

还有一种思路：既然同一 IP 访问太多会触发验证码，那就频繁换 IP。

```javascript
import puppeteer from 'puppeteer';

const proxyList = [
  'http://user:pass@proxy1:8080',
  'http://user:pass@proxy2:8080',
  'http://user:pass@proxy3:8080',
];

async function crawlWithProxy(url) {
  const proxy = proxyList[Math.floor(Math.random() * proxyList.length)];
  const browser = await puppeteer.launch({
    args: [`--proxy-server=${proxy}`]
  });
  const page = await browser.newPage();
  await page.goto(url);
  // ... 采集逻辑
}
```

代理池的问题，用过的都知道：

- **免费代理**：别想了，能连上就是烧高香，速度和稳定性约等于没有
- **付费代理**：住宅代理（Residential Proxy）质量最好，但贵，每 GB 几十块；数据中心代理便宜但容易被识别
- **代理质量参差不齐**：有些 IP 段已经被各大网站拉黑了，买了等于白买

我有个朋友，做跨境电商数据采集，光代理费一个月就花了 2000 多刀。后来他跟我说了句大实话："代理费比服务器贵十倍。"

**结论：能降低触发频率，但成本高，效果取决于代理质量。适合有预算的团队。**

---

## 方案 4：打不过就叫人——检测到验证码就暂停，等人工处理

上面三个方案有一个共同的问题：**它们都在试图"打败"验证码**。

但换个思路想——验证码的存在是有意义的。它就是为了区分人和机器。那为什么不让**人**来处理呢？

这就是"人机协作"模式的核心思路：

1. 自动化脚本正常运行
2. 一旦检测到验证码，**立即暂停**
3. 通知人工（发消息、弹通知、推预览链接）
4. 人工在浏览器里手动完成验证
5. 自动化脚本恢复运行

### CAPTCHA 检测逻辑

第一步，你得知道页面上出现了验证码。检测逻辑其实不复杂：

```javascript
const CAPTCHA_SELECTORS = [
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  'iframe[src*="challenges.cloudflare.com"]',
  'iframe[src*="turnstile"]',
  '.g-recaptcha',
  '.h-captcha',
  '#captcha',
  'div[data-sitekey]',
];

async function detectCaptcha(page) {
  for (const selector of CAPTCHA_SELECTORS) {
    try {
      const element = await page.$(selector);
      if (element) {
        const box = await element.boundingBox();
        return {
          detected: true,
          type: guessCaptchaType(selector),
          selector,
          position: box,
        };
      }
    } catch {
      // selector 不匹配，跳过
    }
  }
  return { detected: false };
}

function guessCaptchaType(selector) {
  if (selector.includes('recaptcha')) return 'reCAPTCHA';
  if (selector.includes('hcaptcha')) return 'hCaptcha';
  if (selector.includes('cloudflare') || selector.includes('turnstile')) return 'Cloudflare Turnstile';
  return 'unknown';
}
```

这段代码覆盖了市面上主流的几种验证码：Google reCAPTCHA、hCaptcha、Cloudflare Turnstile。用 iframe src 和 class 名做特征匹配，简单但有效。

### 检测到之后怎么办？

检测到验证码后，关键是要**让真人能看到当前页面**，并且能**手动操作**：

```javascript
async function handleCaptcha(page) {
  const captcha = await detectCaptcha(page);
  if (!captcha.detected) return false;

  console.log(`[CAPTCHA] 检测到 ${captcha.type}，暂停等待人工处理...`);

  // 生成实时预览链接
  const previewUrl = `http://localhost:9222/devtools/inspector.html?ws=localhost:9222`;

  // 发送通知（可以是飞书、Slack、Telegram 等）
  await sendNotification({
    title: '遇到验证码，需要人工处理',
    message: `类型: ${captcha.type}\n预览: ${previewUrl}`,
    urgent: true,
  });

  // 轮询等待验证码消失（说明人工已处理）
  while (true) {
    await sleep(2000);
    const check = await detectCaptcha(page);
    if (!check.detected) {
      console.log('[CAPTCHA] 验证码已消失，继续执行');
      break;
    }
  }

  return true;
}
```

### 完整的工作流

把检测逻辑嵌入到正常的采集流程里：

```javascript
async function smartCrawl(urls) {
  const browser = await puppeteer.launch({ headless: false }); // 注意：非 headless 模式
  const page = await browser.newPage();

  for (const url of urls) {
    await page.goto(url, { waitUntil: 'networkidle2' });

    // 每次页面加载后检查验证码
    const blocked = await handleCaptcha(page);
    if (blocked) {
      // 验证码处理完毕，重新加载页面
      await page.reload({ waitUntil: 'networkidle2' });
    }

    // 正常采集逻辑
    const data = await page.evaluate(() => {
      return {
        title: document.querySelector('h1')?.textContent,
        price: document.querySelector('.price')?.textContent,
      };
    });

    await saveData(data);
    await sleep(randomInt(1000, 3000)); // 随机延迟，模拟人类行为
  }
}
```

### 这个方案的好处

1. **100% 成功率**：验证码是人过的，不存在"识别失败"的问题
2. **零额外成本**：不需要买代理池，不需要验证码服务
3. **合规**：人是真的在操作，没有"绕过"任何东西
4. **稳定**：不管对方怎么升级反爬，最后一步都是人处理的

当然，这个方案的前提是：**你的场景不需要完全无人值守**。对于大多数中小规模的采集任务来说，偶尔需要人工干预一下，完全在可接受范围内。

---

## 回到凌晨三点那个报警

说实话，我现在已经不太担心验证码了。

我的做法很简单：**stealth 插件做第一道防线降低触发概率，检测到验证码就暂停弹通知，我醒了顺手点一下，采集继续**。

比花钱买验证码服务便宜，比维护代理池省心，比硬刚验证码靠谱。

验证码的存在是有意义的。它保护网站不被恶意爬虫滥刷，这个设计初衷没有错。与其试图"打败"它，不如让自动化脚本学会在适当的时候**喊救命**。

毕竟，**最好的代码不是能解决所有问题的代码，而是知道什么时候该找人的代码**。

---

如果你也想试试这种"人机协作"模式，可以了解一下 [xbrowser](https://github.com/xuyingzhou/xbrowser)——它内置了 CAPTCHA 检测和实时预览功能，检测到验证码会自动暂停并生成预览链接，点一下就能接管操作。
