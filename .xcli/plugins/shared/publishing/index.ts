/**
 * 发布插件公共层。
 *
 * - `md-to-html.ts`：Markdown → HTML（行级语法先于行内转义）
 * - `bridge.ts`：chrome-bridge 传输 + 可信点击 + 定位
 * - `channel.ts`：bridge / local 双通道降级抽象
 * - `sites/*.ts`：各站点的编辑器协议（差异收敛在此）
 */

export {
  escapeHtml,
  markdownToHtml,
  insertImageAfter,
} from './md-to-html.js';

export {
  type BridgeResponse,
  type BridgeTransport,
  type ElementPoint,
  isBridgeAvailable,
  createHttpBridge,
  evaluateInTab,
  cdpCall,
  trustedClick,
  locateByText,
  clickByText,
  openTaskTab,
  closeTaskTab,
  waitFor,
  sleep,
} from './bridge.js';

export {
  type PublishChannel,
  type PageAdapter,
  type ChannelResolution,
  type SitePublisher,
  BridgePageAdapter,
  LocalPageAdapter,
  resolveChannel,
  releaseChannel,
  readMarkdownFile,
} from './channel.js';

export {
  type DraftOptions,
  type RegisterPublishingOptions,
  type SiteRegistrar,
  registerPublishingCommands,
} from './commands.js';

export {
  CTO_EDITOR_URL,
  CTO_CATEGORIES,
  ctoPublisher,
  deriveSummary,
} from './sites/51cto.js';

export {
  CNB_EDITOR_URL,
  CNB_CATEGORIES,
  cnbPublisher,
} from './sites/cnblogs.js';

export {
  OSC_EDITOR_URL,
  OSC_CATEGORIES,
  oscPublisher,
} from './sites/oschina.js';

export {
  JUEJIN_EDITOR_URL,
  juejinPublisher,
} from './sites/juejin.js';

export {
  CSDN_EDITOR_URL,
  csdnPublisher,
} from './sites/csdn.js';

export {
  type BridgeBootstrap,
  bootstrapInUserChrome,
  releaseBootstrap,
  waitForTabReady,
} from './bootstrap.js';
