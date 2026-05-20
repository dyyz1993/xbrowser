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
  { domain: 'tieba.baidu.com', platform: '贴吧' },
  { domain: 'jianshu.com', platform: '简书' },
  { domain: 'csdn.net', platform: 'CSDN' },
  { domain: 'zhuanlan.zhihu.com', platform: '知乎专栏' },
  { domain: 'toutiao.com', platform: '今日头条' },
  { domain: 'sohu.com', platform: '搜狐' },
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
    .filter(p => domains.some(d => d.domain.includes(p.domain) || p.domain.includes(d.domain)))
    .map(p => p.platform);
}

// Read all v2 results
const v2Results = {};
const resultFiles = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('-result-v2.json'));
for (const f of resultFiles) {
  const name = f.replace('-result-v2.json', '');
  try {
    v2Results[name] = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, f), 'utf-8'));
  } catch {}
}

// Results from v2 had combined URLs including assets. Extract just the content URLs.
function isContentUrlFilter(url) {
  const domain = getDomain(url);
  const skipDomains = [
    'eb-static.cdn.bcebos.com', 'eb118-file.cdn.bcebos.com', 'hm.baidu.com',
    'ppui-static-wap.cdn.bcebos.com', 'wappass.baidu.com', 'hercules.cdn.bcebos.com',
    'banti-static.cdn.bcebos.com', 'dlswbr.baidu.com', 'xlab.baidu.com', 'himg.bdimg.com',
    'bat.bing.com', 'googletagmanager.com', 'clarity.ms', 'snap.licdn.com',
    'js.stripe.com', 'connect.facebook.net', 'business.yingliangads.com',
    'js.live.net', 'retcode.alicdn.com', 'o.alicdn.com', 'at.alicdn.com',
    'g.alicdn.com', 'res.wx.qq.com', 'beian.miit.gov.cn',
    'static.airwallex.com', 'scripts.clarity.ms',
    'static-s3.skyworkcdn.com', 'static-us-img.skywork.ai', 's.yimg.jp',
    'lf3-data.volccdn.com', 'metaso-static.oss-accelerate.aliyuncs.com',
    'uranus-static.oss-cn-beijing.aliyuncs.com',
    'hy-openapi-pulbic.hunyuan.tencent.com', 'cdn-hybrid-prod.hunyuan.tencent.com',
    'cdn-yb.icon.qq.com', 'snowflake.qq.com', 'rumt-zh.com', 'rdelivery.qq.com',
    'mapapi.qq.com',
    'hy-openapi-public-1258344703.cos.ap-nanjing.myqcloud.com',
    'hunyuan-prod-1258344703.cos.ap-guangzhou.myqcloud.com',
    'static.airwallex.com',
    'cdn-yb.icon.qq.com',
    'www.googletagmanager.com',
  ];
  if (skipDomains.includes(domain)) return false;
  // Skip static assets
  if (url.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|webp|woff2?|eot|ttf|otf|map)(\?|$)/i)) return false;
  // Skip tracking/analytics
  if (domain.includes('analytics') || domain.includes('tracking') || domain.includes('gtag')) return false;
  if (url.includes('hm.baidu') || url.includes('google-analytics')) return false;
  return true;
}

const compiled = {};

// Read v2 results and extract content URLs
for (const [name, r] of Object.entries(v2Results)) {
  const allUrls = r.allLinks || [];
  const contentUrls = [...new Set(allUrls.filter(isContentUrlFilter))];
  const domainMap = {};
  for (const url of contentUrls) {
    const domain = getDomain(url);
    if (!domainMap[domain]) domainMap[domain] = { count: 0, urls: [] };
    domainMap[domain].count++;
    if (domainMap[domain].urls.length < 5) domainMap[domain].urls.push(url);
  }

  const platforms = identifyPlatforms(Object.entries(domainMap).map(([d]) => ({ domain: d })));

  compiled[name] = {
    status: r.status === 'success' ? (contentUrls.length > 0 ? 'success' : 'partial') : r.status,
    error: r.error,
    urlCount: contentUrls.length,
    domainCount: Object.keys(domainMap).length,
    domains: Object.entries(domainMap).map(([d, info]) => ({ domain: d, count: info.count, urls: info.urls })),
    platforms,
  };
}

// Add engine notes
const ENGINE_NOTES = {
  'qianwen-tongyi': { note: 'URL https://tongyi.aliyun.com/ 显示的是落地页，需要点击"体验千问"才能进入对话界面，或使用 chat.tongyi.aliyun.com' },
  '360ai': { note: 'URL https://ai.360.com/ 显示的是落地页，需要先登录"360智脑"才能使用' },
};

// Now also read v3 response content to extract additional info
const v3Results = {};
const v3Files = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('-result-v3.json'));
for (const f of v3Files) {
  const name = f.replace('-result-v3.json', '');
  try {
    v3Results[name] = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, f), 'utf-8'));
  } catch {}
}

// Check response text files for actual content
for (const name of Object.keys(v3Results)) {
  const textFile = path.join(OUTPUT_DIR, `${name}-response.txt`);
  try {
    const text = fs.readFileSync(textFile, 'utf-8');
    if (text && text.length > 100) {
      compiled[name].responseLength = text.length;
      // Extract content text preview
      compiled[name].responsePreview = text.slice(0, 500).replace(/\n+/g, ' ').trim().slice(0, 200);
    }
  } catch {}
}

// Print final output
console.log('='.repeat(70));
console.log('广东服装加工企业排名 - AI搜索引擎外链采集结果');
console.log('='.repeat(70));

let totalUrls = 0;
const allDomains = new Map();
const allPlatforms = new Set();

for (const [name, r] of Object.entries(compiled)) {
  totalUrls += r.urlCount || 0;
  for (const d of (r.domains || [])) {
    allDomains.set(d.domain, (allDomains.get(d.domain) || 0) + d.count);
  }
  for (const p of (r.platforms || [])) allPlatforms.add(p);

  const note = ENGINE_NOTES[name]?.note;
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`引擎: ${name}`);
  console.log(`状态: ${r.status}${r.error ? ` | 错误: ${r.error}` : ''}`);
  console.log(`外链URLs: ${r.urlCount || 0} | 域名: ${r.domainCount || 0}`);
  if (r.responseLength) console.log(`回复内容: ${r.responseLength} chars`);
  if (r.platforms && r.platforms.length > 0) console.log(`可发帖平台: ${r.platforms.join(', ')}`);
  if (r.domains && r.domains.length > 0) {
    console.log('域名列表:');
    r.domains.forEach((d, i) => {
      console.log(`  ${i+1}. ${d.domain} (${d.count} URLs)`);
      d.urls.slice(0, 3).forEach(u => console.log(`     ${u}`));
    });
  }
  if (note) console.log(`备注: ${note}`);
}

const sortedDomains = [...allDomains.entries()].sort((a, b) => b[1] - a[1]);

console.log(`\n${'='.repeat(70)}`);
console.log('汇总');
console.log('='.repeat(70));
console.log(`总引擎数: 7`);
console.log(`成功(含外链): ${Object.values(compiled).filter(r => r.status === 'success').length}`);
console.log(`部分成功(有回复无外链): ${Object.values(compiled).filter(r => r.status === 'partial').length}`);
console.log(`失败(未登录/落地页): ${Object.values(compiled).filter(r => r.status === 'fail').length}`);
console.log(`\n总外链URLs: ${totalUrls}`);
console.log(`总去重域名: ${sortedDomains.length}`);
console.log(`\n所有域名排名:`);
sortedDomains.forEach(([d, c], i) => console.log(`  ${i+1}. ${d} (${c} URLs)`));

// Save compiled results
const finalSummary = {
  timestamp: new Date().toISOString(),
  query: '广东服装加工企业排名',
  totalEngines: 7,
  summary: {
    success: Object.values(compiled).filter(r => r.status === 'success').length,
    partial: Object.values(compiled).filter(r => r.status === 'partial').length,
    fail: Object.values(compiled).filter(r => r.status === 'fail').length,
    totalUrls,
    totalDomains: sortedDomains.length,
    domains: sortedDomains.map(([d, c]) => ({ domain: d, count: c })),
  },
  engines: compiled,
};

fs.writeFileSync(path.join(OUTPUT_DIR, 'final-summary.json'), JSON.stringify(finalSummary, null, 2));
console.log(`\n完整结果保存至: final-summary.json`);
