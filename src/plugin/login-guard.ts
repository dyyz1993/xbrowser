import type { XBPage } from '../cdp-driver/types.js';
import { buildViewerUrl } from '../utils/viewer-url.js';

export interface LoginRequiredData {
  code: 'LOGIN_REQUIRED';
  plugin: string;
  command: string;
  reason: string;
  viewerUrl?: string;
  loginUrl?: string;
}

export interface PluginLoginGuardResult {
  ok: boolean;
  data?: LoginRequiredData;
  message?: string;
  tips?: string[];
}

interface LoginConfigLike {
  loginUrls?: string[];
  loginSelectors?: string[];
  loginKeywords?: string[];
  loggedInSelectors?: string[];
  loginPrompt?: string;
  loginUrl?: string;
}

interface SiteLike {
  name?: string;
  url?: string;
  config?: {
    requiresLogin?: boolean;
    loginConfig?: LoginConfigLike & { requiresLogin?: boolean };
  };
  isLoggedIn?: (ctx?: unknown) => Promise<boolean> | boolean;
}

interface CommandLike {
  name?: string;
  requiresLogin?: boolean;
  loginRequired?: 'required' | 'optional' | 'none';
}

export async function checkPluginLoginRequired(options: {
  site: SiteLike;
  command: CommandLike;
  commandName: string;
  ctx: unknown;
  page?: XBPage | null;
  sessionName: string;
}): Promise<PluginLoginGuardResult> {
  const { site, command, commandName, ctx, page, sessionName } = options;
  if (commandName === 'login' || commandName === 'logout') return { ok: true };

  const loginConfig = site.config?.loginConfig;
  const requiresLogin = command.requiresLogin === true
    || site.config?.requiresLogin === true
    || loginConfig?.requiresLogin === true
    || command.loginRequired === 'required';
  if (!requiresLogin) return { ok: true };

  const pluginName = site.name || 'plugin';

  if (typeof site.isLoggedIn === 'function') {
    try {
      const loggedIn = await site.isLoggedIn(ctx);
      if (loggedIn) return { ok: true };
      return buildLoginRequired({
        plugin: pluginName,
        command: commandName,
        reason: 'plugin isLoggedIn returned false',
        sessionName,
        loginConfig,
      });
    } catch {
      // Fall through to generic detection.
    }
  }

  if (page && loginConfig) {
    const generic = await detectLoginFromPage(page, loginConfig);
    if (generic === 'logged-in') return { ok: true };
    if (generic === 'logged-out') {
      return buildLoginRequired({
        plugin: pluginName,
        command: commandName,
        reason: 'generic loginConfig detected logged-out page',
        sessionName,
        loginConfig,
      });
    }
  }

  return { ok: true };
}

function buildLoginRequired(options: {
  plugin: string;
  command: string;
  reason: string;
  sessionName: string;
  loginConfig?: LoginConfigLike;
}): PluginLoginGuardResult {
  const viewerUrl = buildViewerUrl(options.sessionName);
  const loginUrl = options.loginConfig?.loginUrl;
  const message = options.loginConfig?.loginPrompt
    || `Plugin "${options.plugin}" requires login before running "${options.command}".`;
  const tips = [
    message,
    ...(viewerUrl ? [`Open viewer to complete login: ${viewerUrl}`] : []),
    ...(loginUrl ? [`Login page: ${loginUrl}`] : []),
    `After login, retry: xbrowser ${options.plugin} ${options.command} --session ${options.sessionName}`,
  ];

  return {
    ok: false,
    data: {
      code: 'LOGIN_REQUIRED',
      plugin: options.plugin,
      command: options.command,
      reason: options.reason,
      ...(viewerUrl ? { viewerUrl } : {}),
      ...(loginUrl ? { loginUrl } : {}),
    },
    message,
    tips,
  };
}

async function detectLoginFromPage(page: XBPage, config: LoginConfigLike): Promise<'logged-in' | 'logged-out' | 'unknown'> {
  const url = page.url();
  if (config.loginUrls?.some(part => url.includes(part))) return 'logged-out';

  const result = await page.evaluate((cfg: { loginSelectors: string[]; loginKeywords: string[]; loggedInSelectors: string[] }) => {
    const visible = (selector: string) => {
      try {
        const el = document.querySelector(selector);
        if (!el) return false;
        const rect = (el as HTMLElement).getBoundingClientRect();
        const style = window.getComputedStyle(el as HTMLElement);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      } catch {
        return false;
      }
    };

    if (cfg.loggedInSelectors?.some(visible)) return 'logged-in';
    if (cfg.loginSelectors?.some(visible)) return 'logged-out';

    const bodyText = document.body?.innerText || '';
    const keywords = cfg.loginKeywords || [];
    if (keywords.length > 0 && keywords.every((keyword: string) => bodyText.includes(keyword))) {
      return 'logged-out';
    }

    return 'unknown';
  }, {
    loginSelectors: config.loginSelectors || [],
    loginKeywords: config.loginKeywords || [],
    loggedInSelectors: config.loggedInSelectors || [],
  });

  return result as 'logged-in' | 'logged-out' | 'unknown';
}
