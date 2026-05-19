import { ALL_ENGINE_KEYS } from '../commands/ai-search-engines.js';
import type { CollectorConfig, StorageConfig } from './types.js';

export const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  basePath: './data/xbrowser-collection',
  format: 'json',
  autoBackup: true,
  maxHistoryDays: 90,
};

export const DEFAULT_COLLECTOR_CONFIG: CollectorConfig = {
  engines: ALL_ENGINE_KEYS,
  outputDir: './data/xbrowser-collection',
  format: 'json',
  timeout: 60000,
  maxRetries: 2,
  delayBetweenEngines: 2000,
  saveFullResponse: false,
  extractUrls: true,
};

export const PLATFORM_MAPPING: Record<string, string> = {
  'zhihu.com': '知乎',
  'juejin.cn': '掘金',
  'juejin.im': '掘金',
  'csdn.net': 'CSDN',
  'mp.weixin.qq.com': '微信公众号',
  'weixin.qq.com': '微信',
  'toutiao.com': '今日头条',
  'douyin.com': '抖音',
  'xiaohongshu.com': '小红书',
  'bilibili.com': 'B站',
  'weibo.com': '微博',
  'weibo.cn': '微博',
  '36kr.com': '36氪',
  'ithome.com': 'IT之家',
  'sspai.com': '少数派',
  'baijiahao.baidu.com': '百家号',
  'sohu.com': '搜狐号',
  '163.com': '网易号',
  'segmentfault.com': '思否',
  'cnblogs.com': '博客园',
  'jianshu.com': '简书',
  '51cto.com': '51CTO',
  'oschina.net': '开源中国',
  'infoq.cn': 'InfoQ 中文',
  'infoq.com': 'InfoQ',
  'mp.toutiao.com': '今日头条号',
  'cloud.tencent.com': '腾讯云社区',
  'tencent.com': '腾讯',
  'developer.aliyun.com': '阿里云开发者社区',
  'aliyun.com': '阿里云',
  'huaweicloud.com': '华为云社区',
  'qianfan.cloud.baidu.com': '百度千帆社区',
  'aistudio.baidu.com': '百度 AI Studio',
  'baidu.com': '百度',
  'thepaper.cn': '澎湃新闻',
  'guancha.cn': '观察者网',
  'ifeng.com': '凤凰网',
  'qq.com': '腾讯网',
  'sina.com.cn': '新浪',
  'chinaz.com': '站长之家',
  'iteye.com': 'ITEye',
  'cnbeta.com': 'cnBeta',
  'freebuf.com': 'FreeBuf',
  'ruanyifeng.com': '阮一峰博客',
  'phodal.com': 'Phodal 博客',
  'aibook.ren': 'AI Book',
  'manus.im': 'Manus',
  'aider.chat': 'Aider',
  'medium.com': 'Medium',
  'dev.to': 'DEV',
  'reddit.com': 'Reddit',
  'youtube.com': 'YouTube',
  'tiktok.com': 'TikTok',
  'twitter.com': 'Twitter/X',
  'x.com': 'X',
  'linkedin.com': 'LinkedIn',
  'facebook.com': 'Facebook',
  'instagram.com': 'Instagram',
  'quora.com': 'Quora',
  'producthunt.com': 'Product Hunt',
  'hackernews.com': 'Hacker News',
  'news.ycombinator.com': 'Hacker News',
  'stackshare.io': 'StackShare',
  'substack.com': 'Substack',
  'hashnode.dev': 'Hashnode',
  'dzone.com': 'DZone',
  'techcrunch.com': 'TechCrunch',
  'theverge.com': 'The Verge',
  'wired.com': 'Wired',
  'arstechnica.com': 'Ars Technica',
  'venturebeat.com': 'VentureBeat',
  'github.com': 'GitHub',
  'stackoverflow.com': 'Stack Overflow',
  'stackexchange.com': 'Stack Exchange',
  'developer.mozilla.org': 'MDN',
  'npmjs.com': 'npm',
  'pypi.org': 'PyPI',
  'crates.io': 'crates.io',
  'docs.python.org': 'Python Docs',
  'docs.rs': 'Rust Docs',
  'kubernetes.io': 'Kubernetes',
  'docker.com': 'Docker Hub',
  'huggingface.co': 'Hugging Face',
  'arxiv.org': 'arXiv',
  'paperswithcode.com': 'Papers With Code',
  'openai.com': 'OpenAI',
  'anthropic.com': 'Anthropic',
  'deepseek.com': 'DeepSeek',
};

export const EXCLUDED_DOMAINS = new Set([
  'deepseek.com', 'chat.deepseek.com',
  'doubao.com', 'www.doubao.com',
  'openai.com', 'chat.openai.com',
  'claude.ai', 'www.claude.ai', 'anthropic.com',
  'kimi.com', 'www.kimi.com', 'moonshot.cn',
  'qianwen.com', 'www.qianwen.com',
  'yuanbao.tencent.com',
  'chatglm.cn', 'www.chatglm.cn',
  'yiyan.baidu.com',
  'metaso.cn', 'www.metaso.cn',
  'tiangong.cn', 'www.tiangong.cn',
  'xinghuo.xfyun.cn',
  'hailuoai.com', 'www.hailuoai.com',
  'n.cn', 'www.n.cn',
  'google.com', 'www.google.com', 'bing.com', 'www.bing.com',
  'baidu.com', 'www.baidu.com',
]);

export function getPlatformName(domain: string): string | undefined {
  const normalizedDomain = domain.replace(/^www\./, '');
  return PLATFORM_MAPPING[normalizedDomain];
}

export function getCompanyType(domain: string): 'job-platform' | 'media' | 'gov' | 'ai-platform' | 'enterprise' | 'other' {
  const normalizedDomain = domain.replace(/^www\./, '');
  
  if (normalizedDomain.endsWith('.gov.cn') || normalizedDomain.endsWith('.gov')) {
    return 'gov';
  }
  
  const jobPlatforms = [
    'zhipin.com', 'lagou.com', '51job.com', 'zhaopin.com', 'liepin.com',
    'bosszhipin.com', 'shixiseng.com', 'nowcoder.com',
  ];
  
  if (jobPlatforms.some(suffix => normalizedDomain === suffix || normalizedDomain.endsWith('.' + suffix))) {
    return 'job-platform';
  }
  
  const mediaPlatforms = [
    'thepaper.cn', 'guancha.cn', 'ifeng.com', 'sina.com.cn', '163.com', 'sohu.com',
    '36kr.com', 'ithome.com', 'techcrunch.com', 'theverge.com', 'wired.com',
  ];
  
  if (mediaPlatforms.some(suffix => normalizedDomain === suffix || normalizedDomain.endsWith('.' + suffix))) {
    return 'media';
  }
  
  const aiPlatforms = [
    'openai.com', 'anthropic.com', 'deepseek.com', 'kimi.com', 'moonshot.cn',
    'qianwen.com', 'chatglm.cn', 'metaso.cn', 'huggingface.co',
  ];
  
  if (aiPlatforms.some(suffix => normalizedDomain === suffix || normalizedDomain.endsWith('.' + suffix))) {
    return 'ai-platform';
  }
  
  return 'enterprise';
}