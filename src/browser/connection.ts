import { existsSync } from 'node:fs';
import { launch } from '../cdp-driver/index.js';
import { CDPInterceptorProxy } from '../cdp-interceptor/proxy.js';
import type { CDPInterceptorConfig } from '../cdp-interceptor/types.js';
import type { Browser } from '../browser-shim.js';
import type { BrowserCommandContext } from '../context.js';
import { resolveCDPEndpoint } from '../utils/cdp.js';
import { errMsg } from '../utils/error.js';
import type { BrowserLaunchOptions } from './state.js';

export async function getCDPTargets(
  cdpEndpoint: string | number
): Promise<Array<{ id: string; url: string; title: string; webSocketDebuggerUrl: string }>> {
  try {
    const endpoint = String(cdpEndpoint);
    let url = 'http://localhost:9222/json/list';
    if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
      const parsed = new URL(endpoint);
      parsed.pathname = (parsed.pathname.replace(/\/+$/, '') || '') + '/json/list';
      url = parsed.toString();
    } else if (/^\d+$/.test(endpoint)) {
      url = `http://localhost:${endpoint}/json/list`;
    }
    const response = await fetch(url);
    return (await response.json()) as Array<{ id: string; url: string; title: string; webSocketDebuggerUrl: string }>;
  } catch {
    return [];
  }
}

export async function findTargetPage(
  cdpEndpoint: string | number,
  target: string
): Promise<{ pageId: string; wsUrl: string; title: string; url: string } | null> {
  const targets = await getCDPTargets(cdpEndpoint);
  const pages = targets.filter((item) => item.url
    && !item.url.startsWith('about:blank')
    && !item.url.startsWith('chrome://')
    && !item.url.startsWith('chrome-untrusted://')
    && !item.url.startsWith('chrome-error://'));
  const byId = pages.find((item) => item.id === target);
  if (byId) return { pageId: byId.id, wsUrl: byId.webSocketDebuggerUrl, title: byId.title, url: byId.url };
  const lowerTarget = target.toLowerCase();
  const byTitle = pages.find((item) => item.title?.toLowerCase().includes(lowerTarget));
  if (byTitle) return { pageId: byTitle.id, wsUrl: byTitle.webSocketDebuggerUrl, title: byTitle.title, url: byTitle.url };
  const byUrl = pages.find((item) => item.url.toLowerCase().includes(lowerTarget));
  if (byUrl) return { pageId: byUrl.id, wsUrl: byUrl.webSocketDebuggerUrl, title: byUrl.title, url: byUrl.url };
  return null;
}

export function resolveLaunchOpts(ctx: BrowserCommandContext): BrowserLaunchOptions {
  return ctx.cdpEndpoint ? { cdpEndpoint: ctx.cdpEndpoint } : { headless: true };
}

const CHROMIUM_CANDIDATES = [
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
];

function discoverChromiumPath(): string | undefined {
  return CHROMIUM_CANDIDATES.find((path) => existsSync(path));
}

const browserPool = new Map<string, Browser>();
let sharedCdpProxy: CDPInterceptorProxy | null = null;

export function getSharedCdpProxy(): CDPInterceptorProxy | null {
  return sharedCdpProxy;
}

export function setSharedCdpProxy(proxy: CDPInterceptorProxy | null): void {
  sharedCdpProxy = proxy;
}

export async function createBrowser(options?: BrowserLaunchOptions): Promise<Browser> {
  if (options?.cdpEndpoint) {
    const realEndpoint = await resolveCDPEndpoint(options.cdpEndpoint);
    if (!options.intercept) {
      const pooled = browserPool.get(realEndpoint);
      if (pooled && !pooled.disconnected) return pooled;
      if (pooled) browserPool.delete(realEndpoint);
    }

    if (options.intercept) {
      const config: CDPInterceptorConfig = typeof options.intercept === 'object'
        ? { ...options.intercept, cdpEndpoint: realEndpoint }
        : { cdpEndpoint: realEndpoint };
      sharedCdpProxy = new CDPInterceptorProxy(config);
      const proxyPort = await sharedCdpProxy.start();
      console.error(`[CDP Interceptor] Proxy running on ws://localhost:${proxyPort}, forwarding to ${realEndpoint}`);
      const { browser } = await launch({ cdpEndpoint: `ws://localhost:${proxyPort}` });
      return browser;
    }

    const { browser } = await launch({ cdpEndpoint: realEndpoint });
    await browser.discoverContexts().catch((error: unknown) => {
      console.error(`[browser] discoverContexts failed: ${errMsg(error)}`);
    });
    browserPool.set(realEndpoint, browser);
    return browser;
  }

  const executablePath = options?.executablePath
    || process.env.XBROWSER_CHROMIUM_PATH
    || discoverChromiumPath();
  const { browser } = await launch({ executablePath, headless: options?.headless ?? true });
  return browser;
}
