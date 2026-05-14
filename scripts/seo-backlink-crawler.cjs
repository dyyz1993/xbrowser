#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const BUILTIN_SOURCES = [
  // ───── 社交资料 (Social Profile) ─────
  { url: 'https://www.linkedin.com', title: 'LinkedIn - 商务社交平台', type: '社交资料', da: '98', submit: '注册账号 → 完善个人资料页添加网站链接', needsRegister: true },
  { url: 'https://www.facebook.com', title: 'Facebook - 社交网络', type: '社交资料', da: '96', submit: '创建主页 → 在简介中添加网站', needsRegister: true },
  { url: 'https://twitter.com', title: 'Twitter / X - 社交媒体', type: '社交资料', da: '95', submit: '注册 → 个人资料添加网站链接', needsRegister: true },
  { url: 'https://www.instagram.com', title: 'Instagram - 图片社交', type: '社交资料', da: '96', submit: '注册 → Bio 中添加网站链接', needsRegister: true },
  { url: 'https://www.pinterest.com', title: 'Pinterest - 图片发现平台', type: '社交资料', da: '92', submit: '注册 → 个人资料添加网站', needsRegister: true },
  { url: 'https://www.reddit.com', title: 'Reddit - 社区论坛', type: '社交资料', da: '91', submit: '注册 → 个人资料可填网站链接', needsRegister: true },
  { url: 'https://medium.com', title: 'Medium - 博客平台', type: 'Web 2.0', da: '94', submit: '注册 → 个人资料添加网站 + 发布文章内链', needsRegister: true },
  { url: 'https://www.tumblr.com', title: 'Tumblr - 轻博客', type: 'Web 2.0', da: '88', submit: '注册 → 博客描述中加链接 + 发帖内链', needsRegister: true },
  { url: 'https://wordpress.com', title: 'WordPress.com - 博客平台', type: 'Web 2.0', da: '92', submit: '注册免费博客 → 侧边栏/文章添加链接', needsRegister: true },
  { url: 'https://www.blogger.com', title: 'Blogger (Google) - 博客平台', type: 'Web 2.0', da: '90', submit: '创建博客 → 添加友情链接小工具', needsRegister: true },
  { url: 'https://github.com', title: 'GitHub - 代码托管', type: '社交资料', da: '97', submit: '注册 → Profile README 添加网站链接', needsRegister: true },
  { url: 'https://about.me', title: 'About.me - 个人主页', type: '社交资料', da: '85', submit: '创建个人页面 → 添加网站链接', needsRegister: true },
  { url: 'https://linktr.ee', title: 'Linktree - 链接汇总', type: '社交资料', da: '82', submit: '创建页面 → 添加网站链接', needsRegister: true },
  { url: 'https://www.behance.net', title: 'Behance - 创意作品集', type: '社交资料', da: '90', submit: '注册 → 个人资料添加网站', needsRegister: true },
  { url: 'https://dribbble.com', title: 'Dribbble - 设计师社区', type: '社交资料', da: '87', submit: '注册 → 个人资料添加网站', needsRegister: true },

  // ───── Web 2.0 建站平台 ─────
  { url: 'https://www.wix.com', title: 'Wix - 免费建站', type: 'Web 2.0', da: '93', submit: '创建免费网站 → 添加外链', needsRegister: true },
  { url: 'https://www.weebly.com', title: 'Weebly - 免费建站', type: 'Web 2.0', da: '86', submit: '创建免费网站 → 添加外链', needsRegister: true },
  { url: 'https://www.jimdo.com', title: 'Jimdo - 免费建站', type: 'Web 2.0', da: '77', submit: '创建免费网站 → 添加外链', needsRegister: true },
  { url: 'https://strikingly.com', title: 'Strikingly - 单页网站', type: 'Web 2.0', da: '80', submit: '创建免费单页 → 添加外链', needsRegister: true },
  { url: 'https://hatenablog.com', title: 'Hatena Blog - 博客平台', type: 'Web 2.0', da: '75', submit: '注册 → 发布文章内链', needsRegister: true },

  // ───── 目录提交 (Directory) ─────
  { url: 'https://www.dmoz.org', title: 'DMOZ / Curlie - 网页目录', type: '目录提交', da: '85', submit: '提交网站到对应分类（需审核）', needsRegister: false },
  { url: 'https://www.hotfrog.com', title: 'Hotfrog - 商业目录', type: '目录提交', da: '68', submit: '注册 → 添加企业信息含网站', needsRegister: true },
  { url: 'https://www.kompass.com', title: 'Kompass - 企业目录', type: '目录提交', da: '72', submit: '注册 → 添加企业信息和网站', needsRegister: true },
  { url: 'https://www.yelp.com', title: 'Yelp - 本地商业目录', type: '目录提交', da: '91', submit: '认领企业 → 添加网站链接', needsRegister: true },
  { url: 'https://www.bbb.org', title: 'BBB - 商业改善局', type: '目录提交', da: '88', submit: '企业认证 → 企业资料含网站', needsRegister: true },
  { url: 'https://www.manta.com', title: 'Manta - 商业目录', type: '目录提交', da: '74', submit: '注册 → 添加企业信息含网站', needsRegister: true },
  { url: 'https://www.cylex.us.com', title: 'Cylex - 商业目录', type: '目录提交', da: '62', submit: '注册 → 添加企业信息和网站', needsRegister: true },

  // ───── 文章提交 (Article) ─────
  { url: 'https://ezinearticles.com', title: 'EzineArticles - 文章目录', type: '文章提交', da: '76', submit: '注册 → 提交文章 → 作者简介含网站链接', needsRegister: true },
  { url: 'https://www.articlesfactory.com', title: 'Articles Factory - 文章提交', type: '文章提交', da: '58', submit: '注册 → 提交文章 → 作者简介含链接', needsRegister: true },
  { url: 'https://www.sooperarticles.com', title: 'Sooper Articles - 文章目录', type: '文章提交', da: '62', submit: '注册 → 提交文章 → 作者简介含链接', needsRegister: true },
  { url: 'https://www.articlecity.com', title: 'Article City - 文章目录', type: '文章提交', da: '55', submit: '注册 → 提交文章 → 作者简介含链接', needsRegister: true },
  { url: 'https://www.articlesnatch.com', title: 'Article Snatch - 文章提交', type: '文章提交', da: '50', submit: '注册 → 提交文章 → 作者简介含链接', needsRegister: true },

  // ───── 书签 (Bookmarking) ─────
  { url: 'https://www.diigo.com', title: 'Diigo - 社会化书签', type: '书签', da: '79', submit: '注册 → 收藏网页加标签和描述（含链接）', needsRegister: true },
  { url: 'https://www.scoop.it', title: 'Scoop.it - 内容策展', type: '书签', da: '78', submit: '注册 → 策展内容含原链接', needsRegister: true },
  { url: 'https://mix.com', title: 'Mix (原 StumbleUpon) - 内容发现', type: '书签', da: '72', submit: '注册 → 提交内容页含链接', needsRegister: true },
  { url: 'https://www.bibsonomy.org', title: 'BibSonomy - 学术书签', type: '书签', da: '50', submit: '注册 → 添加书签含链接', needsRegister: true },
  { url: 'https://www.pearltrees.com', title: 'Pearltrees - 视觉书签', type: '书签', da: '72', submit: '注册 → 创建收藏集含链接', needsRegister: true },

  // ───── 问答平台 (Q&A) ─────
  { url: 'https://www.quora.com', title: 'Quora - 问答社区', type: '问答平台', da: '90', submit: '回答问题 → 引用来源添加链接', needsRegister: true },
  { url: 'https://stackoverflow.com', title: 'Stack Overflow - 技术问答', type: '问答平台', da: '94', submit: '回答问题 → 引用来源或个人资料加链接', needsRegister: true },
  { url: 'https://answers.yahoo.com', title: 'Yahoo Answers - 问答', type: '问答平台', da: '82', submit: '回答问题 → 引用来源含链接', needsRegister: true },
  { url: 'https://www.answerbag.com', title: 'AnswerBag - 问答', type: '问答平台', da: '56', submit: '回答问题 → 个人资料含链接', needsRegister: true },
  { url: 'https://ask.fm', title: 'Ask.fm - 问答社交', type: '问答平台', da: '74', submit: '注册 → 个人资料含网站链接', needsRegister: true },

  // ───── 媒体分享 (Media) ─────
  { url: 'https://www.youtube.com', title: 'YouTube - 视频分享', type: '媒体分享', da: '100', submit: '上传视频 → 描述和评论区加链接', needsRegister: true },
  { url: 'https://www.slideshare.net', title: 'SlideShare - 幻灯片分享', type: '媒体分享', da: '86', submit: '上传幻灯片 → 描述含链接', needsRegister: true },
  { url: 'https://issuu.com', title: 'Issuu - 文档分享', type: '媒体分享', da: '82', submit: '上传文档 → 描述和文档内容含链接', needsRegister: true },
  { url: 'https://www.scribd.com', title: 'Scribd - 文档分享', type: '媒体分享', da: '80', submit: '上传文档 → 描述含链接', needsRegister: true },
  { url: 'https://www.flickr.com', title: 'Flickr - 图片分享', type: '媒体分享', da: '90', submit: '上传图片 → 描述含链接', needsRegister: true },
  { url: 'https://500px.com', title: '500px - 摄影社区', type: '媒体分享', da: '79', submit: '上传照片 → 个人资料含网站链接', needsRegister: true },
  { url: 'https://vimeo.com', title: 'Vimeo - 视频分享', type: '媒体分享', da: '87', submit: '上传视频 → 描述含网站链接', needsRegister: true },
  { url: 'https://www.dailymotion.com', title: 'Dailymotion - 视频分享', type: '媒体分享', da: '81', submit: '上传视频 → 描述含链接', needsRegister: true },
  { url: 'https://imgur.com', title: 'Imgur - 图片托管', type: '媒体分享', da: '87', submit: '上传图片 → 描述含链接', needsRegister: true },
  { url: 'https://www.deviantart.com', title: 'DeviantArt - 艺术社区', type: '媒体分享', da: '82', submit: '上传作品 → 个人资料含网站链接', needsRegister: true },

  // ───── 客座博客 (Guest Post) ─────
  { url: 'https://moz.com/blog', title: 'Moz Blog - SEO 博客（客座）', type: '客座博客', da: '91', submit: '联系编辑 → 提交客座文章（dofollow）', needsRegister: false },
  { url: 'https://searchengineland.com', title: 'Search Engine Land - SEO 新闻', type: '客座博客', da: '89', submit: '投稿 → 审核通过发布含作者链接', needsRegister: false },
  { url: 'https://neilpatel.com/blog/', title: 'Neil Patel Blog - 营销博客', type: '客座博客', da: '90', submit: '联系编辑 → 提交客座文章', needsRegister: false },
  { url: 'https://www.searchenginejournal.com', title: 'Search Engine Journal - SEO 杂志', type: '客座博客', da: '85', submit: '投稿 → 审核 → 作者简介含链接', needsRegister: false },
  { url: 'https://blog.hubspot.com', title: 'HubSpot Blog - 营销博客', type: '客座博客', da: '92', submit: '联系编辑 → 提交客座文章', needsRegister: false },
  { url: 'https://www.smashingmagazine.com', title: 'Smashing Magazine - 设计开发', type: '客座博客', da: '88', submit: '投稿 → 审核 → 作者简介含链接', needsRegister: false },
  { url: 'https://css-tricks.com', title: 'CSS-Tricks - 前端开发', type: '客座博客', da: '87', submit: '联系编辑 → 提交技术文章', needsRegister: false },
  { url: 'https://www.entrepreneur.com', title: 'Entrepreneur - 创业媒体', type: '客座博客', da: '90', submit: '投稿通道 → 审核 → 作者简介含链接', needsRegister: false },
  { url: 'https://www.business2community.com', title: 'Business 2 Community - 商业', type: '客座博客', da: '78', submit: '注册 → 提交文章 → 作者简介含链接', needsRegister: true },
  { url: 'https://www.huffpost.com', title: 'HuffPost (Huffington Post) - 新闻', type: '客座博客', da: '93', submit: '联系投稿 → 审核 → 个人资料含链接', needsRegister: false },

  // ───── 论坛 (Forum) ─────
  { url: 'https://www.digitalpoint.com', title: 'DigitalPoint - 站长论坛', type: '问答平台', da: '76', submit: '注册 → 发帖/回帖 → 签名含链接', needsRegister: true },
  { url: 'https://www.webmasterworld.com', title: 'WebmasterWorld - 站长论坛', type: '问答平台', da: '74', submit: '注册 → 参与讨论 → 个人资料含链接', needsRegister: true },
  { url: 'https://forums.digitalpoint.com', title: 'DigitalPoint Forums - 营销论坛', type: '问答平台', da: '76', submit: '注册 → 论坛签名含链接', needsRegister: true },
  { url: 'https://www.warriorforum.com', title: 'Warrior Forum - 营销者论坛', type: '问答平台', da: '65', submit: '注册 → 签名含链接', needsRegister: true },

  // ───── 新闻稿 (Press Release) ─────
  { url: 'https://www.prlog.org', title: 'PRLog - 免费新闻稿', type: '新闻稿', da: '68', submit: '注册 → 发布新闻稿含网站链接', needsRegister: true },
  { url: 'https://www.prfree.org', title: 'PRFree - 免费新闻稿', type: '新闻稿', da: '52', submit: '注册 → 发布新闻稿含网站链接', needsRegister: true },
  { url: 'https://www.1888pressrelease.com', title: '1888PressRelease - 新闻稿', type: '新闻稿', da: '60', submit: '注册 → 发布新闻稿含网站链接', needsRegister: true },
  { url: 'https://www.newswire.com', title: 'Newswire - 新闻稿分发', type: '新闻稿', da: '72', submit: '注册 → 发布新闻稿含网站链接', needsRegister: true },

  // ───── 高校/政府 (Edu/Gov) ─────
  { url: 'https://www.academia.edu', title: 'Academia.edu - 学术社交', type: '高权重域名', da: '84', submit: '注册 → 上传论文 → 个人资料含链接', needsRegister: true },
  { url: 'https://www.researchgate.net', title: 'ResearchGate - 研究者网络', type: '高权重域名', da: '83', submit: '注册 → 个人资料含网站链接', needsRegister: true },
];

async function fetchExternalPage(url) {
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) return '';
    return await resp.text();
  } catch {
    return '';
  }
}

function extractLinksFromHtml(html, sourceUrl) {
  const results = [];
  const linkRegex = /<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  let count = 0;
  while ((match = linkRegex.exec(html)) !== null) {
    if (count >= 20) break;
    const url = match[1];
    const text = match[2].replace(/<[^>]+>/g, '').trim();
    if (!url || url.includes(sourceUrl) || url.startsWith('#')) continue;
    try {
      const domain = new URL(url).hostname.replace('www.', '');
      if (domain.length < 4) continue;
      if (['google.com', 'facebook.com', 'twitter.com', 'youtube.com', 'instagram.com', 'linkedin.com', 'github.com', 'reddit.com'].includes(domain)) continue;
      const knownDomains = new Set(BUILTIN_SOURCES.map(s => { try { return new URL(s.url).hostname.replace('www.', ''); } catch { return ''; } }));
      if (knownDomains.has(domain)) continue;
      results.push({
        url, title: text || domain, type: '通用外链', da: 'N/A',
        submit: '访问网站了解具体提交方式',
        needsRegister: '待确认',
      });
      count++;
    } catch {}
  }
  return results;
}

const EXTERNAL_RESOURCES = [
  'https://backlinko.com/free-backlinks',
  'https://ahrefs.com/blog/free-backlinks/',
  'https://neilpatel.com/blog/free-backlinks/',
];

function formatEntry(item, index) {
  const domain = (() => { try { return new URL(item.url).hostname.replace('www.', ''); } catch { return item.url; } })();
  return [
    `## ${index}. ${item.title || domain}`,
    ``,
    `| 字段 | 内容 |`,
    `|------|------|`,
    `| **平台** | ${domain} |`,
    `| **网址** | ${item.url} |`,
    `| **外链类型** | ${item.type} |`,
    `| **预估权重** | DA ${item.da || 'N/A'} |`,
    `| **提交方式** | ${item.submit} |`,
    `| **需注册** | ${item.needsRegister === true ? '是' : item.needsRegister === false ? '否' : item.needsRegister} |`,
    ``,
  ].join('\n');
}

function loadExisting(outputFile) {
  try {
    if (!fs.existsSync(outputFile)) return { urls: new Set(), count: 0 };
    const content = fs.readFileSync(outputFile, 'utf-8');
    const urlMatches = content.match(/\|\*\*网址\*\* \| (https?:\/\/[^\s|]+)/g);
    const urls = new Set();
    if (urlMatches) {
      for (const m of urlMatches) {
        const url = m.replace(/\|\*?\*?网址\*?\*? \| /, '').trim();
        urls.add(url);
      }
    }
    return { urls, count: urls.size };
  } catch {
    return { urls: new Set(), count: 0 };
  }
}

function writeHeader(outputFile) {
  if (!fs.existsSync(outputFile) || fs.readFileSync(outputFile, 'utf-8').trim().length === 0) {
    const dir = path.dirname(outputFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outputFile, [
      `# SEO 外链机会采集报告`,
      ``,
      `> 自动采集时间: ${new Date().toISOString()}`,
      `> 说明: 每个条目包含外链平台信息、提交方式及 SEO 建议`,
      ``,
      `---`,
      ``,
    ].join('\n'));
  }
}

function appendToFile(outputFile, content) {
  fs.appendFileSync(outputFile, content);
}

async function run() {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i].startsWith('--')) {
      const key = process.argv[i].slice(2);
      const val = process.argv[i + 1];
      if (val && !val.startsWith('--')) { args[key] = val; i++; }
      else { args[key] = true; }
    }
  }

  const outputFile = args.output || path.resolve(process.cwd(), 'seo-backlinks.md');
  const maxEntries = parseInt(args.max || '50', 10);

  console.log(`输出文件: ${outputFile}`);
  console.log(`目标条目: ${maxEntries}`);

  const existing = loadExisting(outputFile);
  console.log(`已有记录: ${existing.count} 条`);

  writeHeader(outputFile);

  let totalAdded = 0;
  let existingBuiltinCount = existing.count;

  // Phase 1: 内置数据库
  console.log(`\n=== Phase 1: 内置外链库 (${BUILTIN_SOURCES.length} 个来源) ===`);
  for (const source of BUILTIN_SOURCES) {
    if (!existing.urls.has(source.url)) {
      appendToFile(outputFile, formatEntry(source, existingBuiltinCount + totalAdded + 1) + '\n---\n\n');
      totalAdded++;
      console.log(`  [${totalAdded}] ${source.title} -> ${source.url}`);
    }
    if (totalAdded >= maxEntries) break;
  }

  if (totalAdded >= maxEntries) {
    console.log(`\n已收集 ${totalAdded} 条，达到目标。`);
    console.log(`输出文件: ${outputFile}`);
    return;
  }

  // Phase 2: 从资源页抓取补充
  console.log(`\n=== Phase 2: 从资源页抓取补充 ===`);
  for (const resourceUrl of EXTERNAL_RESOURCES) {
    if (totalAdded >= maxEntries) break;
    console.log(`  抓取: ${resourceUrl}`);
    const html = await fetchExternalPage(resourceUrl);
    if (!html) {
      console.log(`  请求失败，跳过`);
      continue;
    }
    const links = extractLinksFromHtml(html, resourceUrl);
    console.log(`  提取到 ${links.length} 个链接`);
    for (const link of links) {
      if (totalAdded >= maxEntries) break;
      if (existing.urls.has(link.url)) continue;
      appendToFile(outputFile, formatEntry(link, existingBuiltinCount + totalAdded + 1) + '\n---\n\n');
      totalAdded++;
      console.log(`  [${totalAdded}] ${link.title}`);

      await new Promise(r => setTimeout(r, 200));
    }
  }

  console.log(`\n=== 完成 ===`);
  console.log(`共收集: ${totalAdded} 条外链机会`);
  console.log(`输出文件: ${outputFile}`);
}

run().catch(e => {
  console.error('任务异常:', e.message);
  process.exit(1);
});
