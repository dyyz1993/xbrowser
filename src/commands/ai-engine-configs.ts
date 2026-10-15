export type AIEngineKey =
  | 'deepseek' | 'doubao' | 'chatgpt' | 'claude'
  | 'kimi' | 'qianwen' | 'yuanbao' | 'chatglm'
  | 'yiyan' | 'metaso' | 'tiangong' | 'xinghuo'
  | 'hailuo' | '360ai';

export interface EngineConfig {
  key: AIEngineKey;
  name: string;
  url: string;
  login: {
    loggedInSelectors: string[];
    loggedOutSelectors: string[];
    urlIndicators?: string[];
  };
  input: {
    selectors: string[];
    type: 'textarea' | 'contenteditable' | 'search';
  };
  internetSearch: {
    type: 'always' | 'toggle' | 'builtin' | 'unknown';
    toggleSelectors?: string[];
    toggleTexts?: string[];
  };
  upload: {
    image: boolean;
    file: boolean;
  };
  isSearchFirst?: boolean;
  extraWait?: number;
  needsChatNav?: boolean;
  sendMethod: 'enter' | 'button' | 'metaEnter';
  sendButtonSelector?: string;
  apiPattern?: string;
  sourceButtonSelector?: string;
  sourceListSelector?: string;
  navigateOnSend?: boolean;
  skipResponseWait?: boolean;
}

export const ENGINE_CONFIGS: Record<AIEngineKey, EngineConfig> = {
  deepseek: {
    key: 'deepseek',
    name: 'DeepSeek',
    url: 'https://chat.deepseek.com',
    login: {
      loggedInSelectors: ['nav', '.chat-history', '[class*="history"]'],
      loggedOutSelectors: [],
      urlIndicators: ['/sign_in'],
    },
    input: {
      selectors: ['textarea._27c9245', 'textarea', '#chat-input'],
      type: 'textarea',
    },
    internetSearch: { type: 'toggle', toggleSelectors: ['[class*="search"]'], toggleTexts: ['搜索'] },
    upload: { image: true, file: true },
    sendMethod: 'enter',
    apiPattern: '/chat/completion',
  },
  doubao: {
    key: 'doubao',
    name: '豆包',
    url: 'https://www.doubao.com/chat/',
    login: {
      loggedInSelectors: ['[class*="history"]', '[class*="conversation-list"]', 'textarea.semi-input-textarea'],
      loggedOutSelectors: ['[class*="login-dialog"]'],
    },
    input: {
      selectors: ['textarea.semi-input-textarea', 'textarea'],
      type: 'textarea',
    },
    internetSearch: { type: 'builtin' },
    upload: { image: false, file: false },
    extraWait: 8000,
    sendMethod: 'metaEnter',
  },
  chatgpt: {
    key: 'chatgpt',
    name: 'ChatGPT',
    url: 'https://chat.openai.com',
    login: {
      loggedInSelectors: ['[data-testid="profile-button"]'],
      loggedOutSelectors: ['button[data-testid="login-button"]'],
      urlIndicators: ['/auth/login'],
    },
    input: {
      selectors: ['#prompt-textarea', '[data-testid="prompt-textarea"]', 'textarea', '[contenteditable="true"]'],
      type: 'textarea',
    },
    internetSearch: { type: 'toggle', toggleTexts: ['Search'] },
    upload: { image: true, file: true },
    sendMethod: 'enter',
  },
  claude: {
    key: 'claude',
    name: 'Claude',
    url: 'https://claude.ai',
    login: {
      loggedInSelectors: ['[data-testid="user-menu"]'],
      loggedOutSelectors: [],
      urlIndicators: ['/login'],
    },
    input: {
      selectors: ['[contenteditable="true"]', 'div[contenteditable]', 'textarea'],
      type: 'contenteditable',
    },
    internetSearch: { type: 'toggle', toggleTexts: ['Search'] },
    upload: { image: true, file: true },
    sendMethod: 'enter',
  },
  kimi: {
    key: 'kimi',
    name: 'Kimi',
    url: 'https://kimi.moonshot.cn',
    login: {
      loggedInSelectors: ['.user-avatar', 'img[src*="avatar.moonshot"]'],
      loggedOutSelectors: ['.not-login-container'],
    },
    input: {
      selectors: ['.chat-input-editor', '[contenteditable="true"]', '[role="textbox"]'],
      type: 'contenteditable',
    },
    internetSearch: { type: 'builtin' },
    upload: { image: false, file: false },
    sendMethod: 'enter',
  },
  qianwen: {
    key: 'qianwen',
    name: '通义千问',
    url: 'https://tongyi.aliyun.com/qianwen',
    login: {
      loggedInSelectors: ['[class*="history"]', '[class*="conversation"]', '[contenteditable="true"]'],
      loggedOutSelectors: [],
    },
    input: {
      selectors: ['[contenteditable="true"]', '[role="textbox"]'],
      type: 'contenteditable',
    },
    internetSearch: { type: 'builtin' },
    upload: { image: true, file: true },
    extraWait: 8000,
    sendMethod: 'enter',
  },
  yuanbao: {
    key: 'yuanbao',
    name: '腾讯元宝',
    url: 'https://yuanbao.tencent.com/chat/',
    login: {
      loggedInSelectors: ['.yb-common-nav__ft__avatar', '.nick-info-name'],
      loggedOutSelectors: [],
    },
    input: {
      selectors: ['[contenteditable="true"]'],
      type: 'contenteditable',
    },
    internetSearch: {
      type: 'toggle',
      toggleSelectors: ['.yb-common-nav__tool'],
      toggleTexts: ['搜索'],
    },
    upload: { image: false, file: false },
    sendMethod: 'enter',
  },
  chatglm: {
    key: 'chatglm',
    name: '智谱清言',
    url: 'https://chatglm.cn',
    login: {
      loggedInSelectors: ['.userInfoBar'],
      loggedOutSelectors: [],
    },
    input: {
      selectors: ['textarea.scroll-display-none', 'textarea'],
      type: 'textarea',
    },
    internetSearch: {
      type: 'toggle',
      toggleSelectors: ['.mode-button'],
      toggleTexts: ['联网'],
    },
    upload: { image: false, file: true },
    sendMethod: 'enter',
    apiPattern: '/chat/completion',
    sourceButtonSelector: '[class*="sources-tab"]',
  },
  yiyan: {
    key: 'yiyan',
    name: '文心一言',
    url: 'https://yiyan.baidu.com',
    login: {
      loggedInSelectors: ['.avatar__jsWTuLHM', '[contenteditable="true"]'],
      loggedOutSelectors: ['.ebButton__Td1lJFbI'],
    },
    input: {
      selectors: ['[contenteditable="true"]', '[role="textbox"]'],
      type: 'contenteditable',
    },
    internetSearch: { type: 'builtin' },
    upload: { image: false, file: false },
    extraWait: 10000,
    sendMethod: 'enter',
  },
  metaso: {
    key: 'metaso',
    name: '秘塔AI搜索',
    url: 'https://metaso.cn',
    login: {
      loggedInSelectors: ['.MuiAvatar-img', 'img[src*="uranus"]', 'textarea.search-consult-textarea'],
      loggedOutSelectors: [],
    },
    input: {
      selectors: ['textarea.search-consult-textarea', 'textarea'],
      type: 'textarea',
    },
    internetSearch: { type: 'always' },
    upload: { image: true, file: true },
    isSearchFirst: true,
    sendMethod: 'enter',
    navigateOnSend: true,
  },
  tiangong: {
    key: 'tiangong',
    name: '天工AI',
    url: 'https://www.tiangong.cn',
    login: {
      loggedInSelectors: ['.general-hero__avatar', 'img[src*="skyworkcdn"]', '[contenteditable="true"]'],
      loggedOutSelectors: ['.login-btn'],
    },
    input: {
      selectors: ['[contenteditable="true"]', '[role="textbox"]'],
      type: 'contenteditable',
    },
    internetSearch: { type: 'builtin' },
    upload: { image: true, file: false },
    needsChatNav: true,
    extraWait: 8000,
    sendMethod: 'enter',
    skipResponseWait: true,
  },
  xinghuo: {
    key: 'xinghuo',
    name: '讯飞星火',
    url: 'https://xinghuo.xfyun.cn',
    login: {
      loggedInSelectors: ['.ant-dropdown-trigger'],
      loggedOutSelectors: ['.header_login_btn__JSZrf'],
    },
    input: {
      selectors: ['textarea', '[contenteditable="true"]', '[role="textbox"]'],
      type: 'contenteditable',
    },
    internetSearch: { type: 'toggle', toggleSelectors: [], toggleTexts: ['搜索'] },
    upload: { image: false, file: false },
    extraWait: 8000,
    needsChatNav: true,
    sendMethod: 'enter',
  },
  hailuo: {
    key: 'hailuo',
    name: '海螺AI',
    url: 'https://hailuoai.com',
    login: {
      loggedInSelectors: [],
      loggedOutSelectors: [],
    },
    input: {
      selectors: ['[contenteditable]#video-create-textarea', '[contenteditable="true"]'],
      type: 'contenteditable',
    },
    internetSearch: { type: 'unknown' },
    upload: { image: true, file: true },
    sendMethod: 'enter',
  },
  '360ai': {
    key: '360ai',
    name: '纳米AI',
    url: 'https://www.n.cn',
    login: {
      loggedInSelectors: ['.avatar-title-icon', 'img[src*="qcdn"]'],
      loggedOutSelectors: [],
    },
    input: {
      selectors: ['[contenteditable="true"]', '[role="textbox"]'],
      type: 'contenteditable',
    },
    internetSearch: { type: 'always' },
    upload: { image: false, file: true },
    isSearchFirst: true,
    sendMethod: 'enter',
    sendButtonSelector: 'button.send-btn',
  },
};
