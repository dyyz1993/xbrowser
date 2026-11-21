import type { CDPConnection } from './connection.js';
import { buildStealthInitScript, DEFAULT_STEALTH_CONFIG } from './stealth.js';
import type { WaitUntilState, XBNavigationResponse } from './types.js';

export interface NavigationState {
  loadFired: boolean;
  domContentFired: boolean;
  networkIdle: boolean;
}

export class NavigationService {
  constructor(private readonly options: {
    conn: CDPConnection;
    sessionId: string;
    state: NavigationState;
    stealthConfig: Record<string, unknown> | undefined;
    waitForLoadState(state?: WaitUntilState, timeout?: number): Promise<void>;
    waitForTimeout(ms: number): Promise<void>;
    evaluate<T>(script: string): Promise<T>;
    isClosed(): boolean;
    setUrl(url: string): void;
  }) {}

  async goto(
    url: string,
    opts: { waitUntil?: WaitUntilState; timeout?: number; referer?: string } = {},
  ): Promise<XBNavigationResponse | null> {
    if (this.options.isClosed()) throw new Error('Page is closed');

    const waitUntil = opts.waitUntil ?? 'load';
    const timeout = opts.timeout ?? 30_000;

    // Reset load state
    this.options.state.loadFired = false;
    this.options.state.domContentFired = false;
    this.options.state.networkIdle = false;

    // Inject stealth hooks BEFORE navigation
    if (process.env.XBROWSER_STEALTH !== 'off') {
      try {
        await this.options.conn.send('Page.addScriptToEvaluateOnNewDocument',
          { source: buildStealthInitScript({ ...DEFAULT_STEALTH_CONFIG, ...(this.options.stealthConfig ?? {}) }) }, this.options.sessionId);
      } catch { /* best-effort */ }
      // HTTP 层 UA 覆盖（2026-09-13 browserscan 实测）：headless Chrome HTTP
      // User-Agent 含 "HeadlessChrome"——stealth init script 只覆盖 JS 层
      // navigator.userAgent，HTTP header 仍泄漏。必须在这里同步清除。
      try {
        const rawUa = await this.options.conn.send<{ value: string }>('Runtime.evaluate',
          { expression: 'navigator.userAgent', returnByValue: true }, this.options.sessionId);
        const ua = rawUa?.value || '';
        const cleaned = ua.replace(/HeadlessChrome/g, 'Chrome');
        if (cleaned !== ua) {
          await this.options.conn.send('Network.setUserAgentOverride',
            { userAgent: cleaned }, this.options.sessionId);
        }
      } catch { /* best-effort */ }
    }

    // Navigate
    const result = await this.options.conn.send<{ errorText?: string; frameId?: string }>(
      'Page.navigate',
      { url, referrer: opts.referer },
      this.options.sessionId,
    );

    if (result.errorText) {
      throw new Error(`Navigation failed: ${result.errorText}`);
    }

    // 'commit' = return immediately after navigation without waiting for load
    if (waitUntil === 'commit') {
      this.options.setUrl(url);
      return {
        status: () => 0,
        ok: () => false,
        url: () => url,
        headers: () => ({}) as Record<string, string>,
      };
    }

    // Wait for the specified load state
    await this.options.waitForLoadState(waitUntil, timeout);

    this.options.setUrl(url);

    // Best-effort navigation response — CDP doesn't expose HTTP status directly
    const statusCode = 200;
    const finalUrl = url;
    const headers: Record<string, string> = {};
    return {
      status: () => statusCode,
      ok: () => statusCode >= 200 && statusCode < 300,
      url: () => finalUrl,
      headers: () => headers,
    };
  }

  async goBack(opts: { timeout?: number; waitUntil?: WaitUntilState } = {}): Promise<void> {
    await this.traverseHistory(-1, opts);
  }

  async goForward(opts: { timeout?: number; waitUntil?: WaitUntilState } = {}): Promise<void> {
    await this.traverseHistory(1, opts);
  }

  private async traverseHistory(
    offset: -1 | 1,
    { timeout = 10_000, waitUntil = 'domcontentloaded' }: { timeout?: number; waitUntil?: WaitUntilState },
  ): Promise<void> {
    if (this.options.isClosed()) throw new Error('Page is closed');
    const { conn, sessionId } = this.options;
    const getHistory = () => conn.send<{ entries: Array<{ id: number; url: string }>; currentIndex: number }>(
      'Page.getNavigationHistory', undefined, sessionId,
    );
    const history = await getHistory();
    const entry = history.entries[history.currentIndex + offset];
    if (!entry) return;

    // Navigating to the URL would add a new entry and discard forward history.
    await conn.send('Page.navigateToHistoryEntry', { entryId: entry.id }, sessionId);
    const deadline = Date.now() + timeout;
    do {
      const updated = await getHistory();
      if (updated.entries[updated.currentIndex]?.id === entry.id) {
        // Same-document and cached history entries can commit without a fresh load event.
        const document = await this.options.evaluate<{ url: string; ready: string }>(
          '({ url: location.href, ready: document.readyState })',
        ).catch(() => null);
        if (document?.url === updated.entries[updated.currentIndex].url && (
          waitUntil === 'commit' || (waitUntil === 'load' ? document.ready === 'complete' : document.ready !== 'loading')
        )) {
          this.options.setUrl(document.url);
          if (waitUntil === 'networkidle') {
            await this.options.waitForLoadState(waitUntil, Math.max(0, deadline - Date.now()));
          }
          return;
        }
      }
      await this.options.waitForTimeout(50);
    } while (Date.now() < deadline);
    throw new Error(`History navigation timed out after ${timeout}ms`);
  }

  async reload(opts: { timeout?: number; waitUntil?: WaitUntilState } = {}): Promise<void> {
    this.options.state.loadFired = false;
    this.options.state.domContentFired = false;
    this.options.state.networkIdle = false;
    await this.options.conn.send('Page.reload', undefined, this.options.sessionId);
    await this.options.waitForLoadState(opts.waitUntil ?? 'load', opts.timeout);
  }

  async waitForLoadState(state: WaitUntilState = 'load', timeout = 30_000): Promise<void> {
    if (this.options.isClosed()) throw new Error('Page is closed');

    const checkState = (): boolean => {
      switch (state) {
        case 'domcontentloaded': return this.options.state.domContentFired;
        case 'load': return this.options.state.loadFired;
        case 'networkidle': return this.options.state.networkIdle;
        case 'commit': return this.options.state.domContentFired;
        default: return true;
      }
    };

    if (checkState()) return;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`waitForLoadState('${state}') timeout after ${timeout}ms`));
      }, timeout);

      const check = (): void => {
        if (checkState()) {
          clearTimeout(timer);
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  }

  async waitForTimeout(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      // Allow process to exit even if timer is pending
      if (typeof timer.unref === 'function') timer.unref();
    });
  }


}