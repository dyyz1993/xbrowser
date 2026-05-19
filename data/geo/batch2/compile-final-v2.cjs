const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = '/Users/xuyingzhou/Project/study-node-ts/xbrowser/data/geo/batch2';

const PLATFORM_KEYWORDS = [
  { domain: '163.com', platform: '网易' },
  { domain: 'zhihu.com', platform: '知乎' },
  { domain: 'bilibili.com', platform: 'B站' },
  { domain: 'douyin.com', platform: '抖音' },
  { domain: 'xiaohongshu.com', platform: '小红书' },
  { domain: 'weibo.com', platform: '微博' },
  { domain: 'jianshu.com', platform: '简书' },
  { domain: 'csdn.net', platform: 'CSDN' },
  { domain: 'toutiao.com', platform: '今日头条' },
  { domain: 'itouchtv.cn', platform: '艾瑞咨询' },
  { domain: 'wanfangdata.com.cn', platform: '万方数据' },
  { domain: 'gd.gov.cn', platform: '广东省政府' },
  { domain: 'cir.cn', platform: '中经网' },
  { domain: 'pdfs.cir.cn', platform: '中经网' },
];

function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function identifyPlatforms(domains) {
  return PLATFORM_KEYWORDS
    .filter(p => domains.some(d => d.includes(p.domain)))
    .map(p => p.platform);
}

const SKIP_DOMAINS = new Set([
  'eb-static.cdn.bcebos.com', 'eb118-file.cdn.bcebos.com', 'hm.baidu.com',
  'ppui-static-wap.cdn.bcebos.com', 'wappass.baidu.com', 'hercules.cdn.bcebos.com',
  'banti-static.cdn.bcebos.com', 'dlswbr.baidu.com', 'xlab.baidu.com', 'himg.bdimg.com',
  'bat.bing.com', 'clarity.ms', 'snap.licdn.com',
  'js.stripe.com', 'connect.facebook.net', 'business.yingliangads.com',
  'js.live.net', 'retcode.alicdn.com', 'o.alicdn.com', 'at.alicdn.com',
  'g.alicdn.com', 'res.wx.qq.com', 'beian.miit.gov.cn',
  'static.airwallex.com', 'scripts.clarity.ms',
  'static-s3.skyworkcdn.com', 'static-us-img.skywork.ai', 's.yimg.jp',
  'lf3-data.volccdn.com', 'metaso-static.oss-accelerate.aliyuncs.com',
  'uranus-static.oss-cn-beijing.aliyuncs.com',
  'static-1.metaso.cn', 'static.yuanbao.tencent.com',
  'analysis.chatglm.cn', 'sfile.chatglm.cn',
]);

function isContentUrl(url) {
  const domain = getDomain(url);
  if (SKIP_DOMAINS.has(domain)) return false;
  // Skip self-domains
  if (domain.includes('googletagmanager') || domain.includes('facebook') || domain.includes('doubleclick')) return false;
  if (domain.match(/^(chatglm|metaso|yuanbao|tongyi)\./)) return false;
  // Skip static assets
  if (url.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|webp|woff2?|eot|ttf|otf|map)(\?|$)/i)) return false;
  // Skip tracking
  if (domain.includes('analytics') || domain.includes('gtag') || url.includes('google-analytics') || domain.includes('googletagmanager')) return false;
  return true;
}

// Read v2 results (they have proper content URL filtering)
const compiled = {};
const v2Files = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('-result-v2.json'));
for (const f of v2Files) {
  const name = f.replace('-result-v2.json', '');
  try {
    const r = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, f), 'utf-8'));
    
    // Use the `urls` field from v2 which already had self-domain filtering
    const allUrls = r.urls || [];
    const contentUrls = [...new Set(allUrls.filter(isContentUrl))];
    
    const domainMap = {};
    for (const url of contentUrls) {
      const domain = getDomain(url);
      if (!domainMap[domain]) domainMap[domain] = { count: 0, urls: [] };
      domainMap[domain].count++;
      if (domainMap[domain].urls.length < 5) domainMap[domain].urls.push(url);
    }

    const platforms = identifyPlatforms(Object.keys(domainMap));

    compiled[name] = {
      status: r.status === 'success' ? (contentUrls.length > 0 ? 'success' : 'partial') : r.status,
      error: r.error,
      urlCount: contentUrls.length,
      domainCount: Object.keys(domainMap).length,
      domains: Object.entries(domainMap).map(([d, info]) => ({ domain: d, count: info.count, urls: info.urls })),
      platforms,
    };
  } catch (e) {
    console.error(`Error reading ${f}: ${e.message}`);
  }
}

// Read v3 response content
const v3Files = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('-result-v3.json'));
for (const f of v3Files) {
  const name = f.replace('-result-v3.json', '');
  try {
    const r = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, f), 'utf-8'));
    const textFile = path.join(OUTPUT_DIR, `${name}-response.txt`);
    try {
      const text = fs.readFileSync(textFile, 'utf-8');
      if (text && text.length > 100) {
        compiled[name].responseLength = text.length;
        compiled[name].responsePreview = text.replace(/\n+/g, ' ').trim().slice(0, 200);
      }
    } catch {}
  } catch {}
}

// Add engine notes
const ENGINE_NOTES = {
  'qianwen-tongyi': { note: '落地页模式，需登录后才能显示对话界面。通义千问改用 https://tongyi.aliyun.com/qianwen/ 或通过"体验千问"进入' },
  '360ai': { note: '落地页模式，需先登录360账号才能使用。导航栏有"登录后即可体验"提示' },
};

// Check response content from v3
for (const name of Object.keys(compiled)) {
  if (ENGINE_NOTES[name]) {
    compiled[name].note = ENGINE_NOTES[name].note;
  }
}

// Print results
console.log('='.repeat(70));
console.log('广东服装加工企业排名 - AI搜索引擎外链采集结果');
console.log('='.repeat(70));
console.log(`采集时间: ${new Date().toISOString()}`);
console.log(`查询词: 广东服装加工企业排名`);
console.log(`引擎数: 7`);

let totalUrls = 0;
const allDomains = new Map();
const allPlatforms = new Set();

for (const [name, r] of Object.entries(compiled)) {
  totalUrls += r.urlCount || 0;
  for (const d of (r.domains || [])) {
    allDomains.set(d.domain, (allDomains.get(d.domain) || 0) + d.count);
  }
  for (const p of (r.platforms || [])) allPlatforms.add(p);

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`【${name}】`);
  console.log(`  状态: ${r.status}${r.error ? ` (${r.error})` : ''}`);
  console.log(`  外链URLs: ${r.urlCount || 0} | 域名: ${r.domainCount || 0}`);
  if (r.responseLength) console.log(`  回复长度: ${r.responseLength} chars`);
  if (r.platforms && r.platforms.length > 0) console.log(`  可发帖平台: ${r.platforms.join(', ')}`);
  if (r.domains && r.domains.length > 0) {
    r.domains.forEach((d, i) => {
      console.log(`    ${i+1}. ${d.domain} (${d.count})`);
      d.urls.slice(0, 2).forEach(u => console.log(`       ${u}`));
    });
  }
  if (r.note) console.log(`  备注: ${r.note}`);
}

const sortedDomains = [...allDomains.entries()].sort((a, b) => b[1] - a[1]);

console.log(`\n${'='.repeat(70)}`);
console.log('汇总');
console.log('='.repeat(70));
const success = Object.values(compiled).filter(r => r.status === 'success').length;
const partial = Object.values(compiled).filter(r => r.status === 'partial').length;
const fail = Object.values(compiled).filter(r => r.status === 'fail').length;
console.log(`  成功(含外链): ${success}`);
console.log(`  部分成功(有回复无外链): ${partial}`);
console.log(`  失败(未登录/落地页): ${fail}`);
console.log(`  总外链URLs: ${totalUrls}`);
console.log(`  总去重域名: ${sortedDomains.length}`);
console.log(`\n所有域名排名:`);
sortedDomains.forEach(([d, c], i) => console.log(`  ${i+1}. ${d} (${c} URLs)`));

if (allPlatforms.size > 0) {
  console.log(`\n可发帖平台: ${[...allPlatforms].join(', ')}`);
}

const finalSummary = {
  timestamp: new Date().toISOString(),
  query: '广东服装加工企业排名',
  totalEngines: 7,
  summary: {
    success,
    partial,
    fail,
    totalUrls,
    totalDomains: sortedDomains.length,
    domains: sortedDomains.map(([d, c]) => ({ domain: d, count: c })),
    platforms: [...allPlatforms],
  },
  engines: compiled,
};

fs.writeFileSync(path.join(OUTPUT_DIR, 'final-summary.json'), JSON.stringify(finalSummary, null, 2));
console.log(`\n完整结果保存至: final-summary.json`);
