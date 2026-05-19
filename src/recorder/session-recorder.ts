import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { BrowserContext, Page, Request, Response, Frame } from 'playwright';
import { getSelectorGeneratorScript } from './selector-utils.js';

export interface UserAction {
  id: number;
  type: 'click' | 'input' | 'change' | 'keydown' | 'scroll' | 'submit' | 'focus';
  timestamp: number;
  url: string;
  pageTitle: string;
  element?: {
    tag: string;
    text: string;
    role?: string;
    type?: string;
    placeholder?: string;
    ariaLabel?: string;
    id?: string;
    className?: string;
    href?: string;
  };
  value?: string;
  key?: string;
  x?: number;
  y?: number;
  scrollX?: number;
  scrollY?: number;
  selector?: string;
  selectorStrategy?: string;
  selectorConfidence?: 'high' | 'medium' | 'low';
}

export interface NetworkEntry {
  id: number;
  timestamp: number;
  method: string;
  url: string;
  path: string;
  status: number;
  resourceType: string;
  contentType: string;
  requestBody?: unknown;
  responseBody?: unknown;
  responseSize: number;
}

export interface ContextChange {
  id: number;
  timestamp: number;
  type: 'navigate' | 'popup_appeared' | 'popup_dismissed' | 'new_tab' | 'toast' | 'dom_change';
  url?: string;
  title?: string;
  detail?: string;
}

export interface RecordingStep {
  step: number;
  action: UserAction;
  networkIds: number[];
  contextChanges: ContextChange[];
  matchedInputs: Array<{
    inputValue: string;
    networkId: number;
    paramName: string;
  }>;
}

export interface RecordingSummary {
  startUrl: string;
  recordedAt: string;
  durationMs: number;
  totalActions: number;
  totalNetworkRequests: number;
  networkMap: Record<number, { id: number; method: string; url: string; path: string; status: number; resourceType: string }>;
  steps: RecordingStep[];
}

export interface RecordingData {
  startUrl: string;
  sessionName: string;
  startedAt: string;
  actions: UserAction[];
  network: NetworkEntry[];
  contextChanges: ContextChange[];
}

const ACTION_SIGNAL_SCRIPT = getSelectorGeneratorScript() + `
(function() {
  if (window.__xb_action_signal) return;
  window.__xb_action_signal = true;
  window.__xb_pending_actions = [];

  function describe(el) {
    if (!el || !el.tagName) return null;
    var selResult = window.__xb_generateSelector ? window.__xb_generateSelector(el) : null;
    return {
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || '').trim().substring(0, 80),
      role: el.getAttribute('role'),
      type: el.getAttribute('type'),
      placeholder: el.getAttribute('placeholder'),
      ariaLabel: el.getAttribute('aria-label'),
      href: el.getAttribute('href') ? el.getAttribute('href').substring(0, 100) : undefined,
      id: el.id || undefined,
      className: (typeof el.className === 'string' ? el.className : '').substring(0, 80) || undefined,
      selector: selResult ? selResult.selector : undefined,
      selectorStrategy: selResult ? selResult.strategy : undefined,
      selectorConfidence: selResult ? selResult.confidence : undefined,
    };
  }

  function pushAction(type, detail) {
    window.__xb_pending_actions.push({
      type: type,
      ts: Date.now(),
      url: location.href,
      title: document.title,
      detail: detail,
    });
  }

  document.addEventListener('click', function(e) {
    pushAction('click', { element: describe(e.target), x: e.clientX, y: e.clientY });
  }, true);

  document.addEventListener('input', function(e) {
    var val = e.target.value || e.target.textContent || '';
    pushAction('input', { element: describe(e.target), value: val.substring(0, 200) });
  }, true);

  document.addEventListener('change', function(e) {
    var val = e.target.value || '';
    pushAction('change', { element: describe(e.target), value: val.substring(0, 100) });
  }, true);

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'Escape' || e.key.indexOf('Arrow') === 0) {
      pushAction('keydown', { key: e.key, element: describe(e.target) });
    }
  }, true);

  document.addEventListener('submit', function(e) {
    pushAction('submit', { element: describe(e.target) });
  }, true);

  var __xb_last_scroll = 0;
  document.addEventListener('scroll', function() {
    if (Date.now() - __xb_last_scroll > 500) {
      __xb_last_scroll = Date.now();
      pushAction('scroll', { scrollX: window.scrollX, scrollY: window.scrollY });
    }
  }, true);
})();
`;

export class SessionRecorder {
  private context: BrowserContext;
  private page: Page;
  private sessionName: string;
  private startUrl = '';
  private startedAt = 0;

  private actions: UserAction[] = [];
  private network: NetworkEntry[] = [];
  private contextChanges: ContextChange[] = [];

  private actionCounter = 0;
  private networkCounter = 0;
  private contextCounter = 0;

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastActionTs = 0;
  private activePages = new Set<Page>();
  private lastNavigateUrl = '';

  private _isRecording = false;

  constructor(context: BrowserContext, page: Page, sessionName: string) {
    this.context = context;
    this.page = page;
    this.sessionName = sessionName;
  }

  get isRecording(): boolean {
    return this._isRecording;
  }

  async start(url?: string): Promise<void> {
    if (this._isRecording) throw new Error('Already recording');

    this._isRecording = true;
    this.startedAt = Date.now();
    this.actions = [];
    this.network = [];
    this.contextChanges = [];
    this.lastNavigateUrl = '';

    if (url) {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      this.startUrl = url;
    } else {
      this.startUrl = this.page.url();
    }

    await this.injectActionScript(this.page);
    await this.page.addInitScript(ACTION_SIGNAL_SCRIPT);

    this.startNetworkCapture();

    this.context.on('page', this.handleNewPage);
    this.page.on('framenavigated', this.handleFrameNavigated);

    this.pollTimer = setInterval(() => {
      this.pollActions().catch(() => {});
    }, 200);
  }

  async stop(): Promise<{ data: RecordingData; summary: RecordingSummary }> {
    if (!this._isRecording) throw new Error('Not recording');

    this._isRecording = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    this.context.off('page', this.handleNewPage);
    this.context.off('request', this.handleRequest);
    this.context.off('response', this.handleResponse);
    this.page.off('framenavigated', this.handleFrameNavigated);

    for (const p of this.activePages) {
      try {
        p.off('framenavigated', this.handleFrameNavigated);
      } catch {
        // page may be closed
      }
    }

    await this.flushPendingActions(this.page);

    const data: RecordingData = {
      startUrl: this.startUrl,
      sessionName: this.sessionName,
      startedAt: new Date(this.startedAt).toISOString(),
      actions: this.actions,
      network: this.network,
      contextChanges: this.contextChanges,
    };

    const summary = this.buildSummary(data);

    const dir = this.getRecordingsDir();
    mkdirSync(dir, { recursive: true });

    const dataPath = join(dir, 'recording.json');
    const summaryPath = join(dir, 'summary.json');

    writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf-8');
    writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');

    return { data, summary };
  }

  getRecordingsDir(): string {
    return join(homedir(), '.xbrowser', 'sessions', this.sessionName, 'recordings');
  }

  static cleanup(sessionName: string): void {
    const dir = join(homedir(), '.xbrowser', 'sessions', sessionName, 'recordings');
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  private async injectActionScript(page: Page): Promise<void> {
    try {
      await page.evaluate(ACTION_SIGNAL_SCRIPT);
    } catch {
      // page may not be ready
    }
  }

  private startNetworkCapture(): void {
    this.context.on('request', this.handleRequest);
    this.context.on('response', this.handleResponse);
  }

  private handleRequest = (request: Request): void => {
    const resourceType = request.resourceType();
    if (['image', 'stylesheet', 'font', 'manifest', 'other'].includes(resourceType)) return;

    const url = request.url();
    if (url.startsWith('data:') || url.startsWith('chrome-extension://')) return;

    this.networkCounter++;
    const entry: NetworkEntry = {
      id: this.networkCounter,
      timestamp: Date.now(),
      method: request.method(),
      url,
      path: new URL(url).pathname,
      status: 0,
      resourceType,
      contentType: '',
      responseSize: 0,
    };

    const method = request.method();
    if (['POST', 'PATCH', 'PUT'].includes(method)) {
      try {
        const postData = request.postData();
        if (postData) {
          try {
            entry.requestBody = JSON.parse(postData);
          } catch {
            entry.requestBody = postData.substring(0, 500);
          }
        }
      } catch {
        // ignore
      }
    }

    this.network.push(entry);
  };

  private handleResponse = async (response: Response): Promise<void> => {
    const url = response.url();
    if (url.startsWith('data:') || url.startsWith('chrome-extension://')) return;

    const entry = this.network.find(e => e.url === url && e.status === 0);
    if (!entry) return;

    entry.status = response.status();
    entry.contentType = response.headers()['content-type'] || '';

    const resourceType = response.request().resourceType();
    const isApi =
      ['fetch', 'xhr'].includes(resourceType) ||
      entry.contentType.includes('json') ||
      entry.contentType.includes('text/');

    if (isApi) {
      try {
        const text = await response.text();
        entry.responseSize = text.length;
        if (text.length <= 20480) {
          try {
            entry.responseBody = JSON.parse(text);
          } catch {
            entry.responseBody = text.substring(0, 500);
          }
        }
      } catch {
        // unable to read body
      }
    } else {
      try {
        entry.responseSize = parseInt(response.headers()['content-length'] || '0', 10);
      } catch {
        // ignore
      }
    }
  };

  private handleNewPage = async (page: Page): Promise<void> => {
    this.activePages.add(page);
    this.contextCounter++;
    this.contextChanges.push({
      id: this.contextCounter,
      timestamp: Date.now(),
      type: 'new_tab',
      url: page.url(),
      detail: 'New tab/popup opened',
    });

    await page.addInitScript(ACTION_SIGNAL_SCRIPT);
    try {
      await this.injectActionScript(page);
    } catch {
      // page may not be ready
    }

    page.on('framenavigated', this.handleFrameNavigated);
    page.on('close', () => {
      this.activePages.delete(page);
    });
  };

  private handleFrameNavigated = (frame: Frame): void => {
    if (frame !== frame.page().mainFrame()) return;
    const url = frame.url();
    if (url === this.lastNavigateUrl) return;
    if (url.startsWith('chrome-extension://') || url.startsWith('about:blank')) return;
    this.lastNavigateUrl = url;
    this.contextCounter++;
    this.contextChanges.push({
      id: this.contextCounter,
      timestamp: Date.now(),
      type: 'navigate',
      url,
      title: '',
    });
  };

  private async pollActions(): Promise<void> {
    const pages = [this.page, ...this.activePages];
    for (const page of pages) {
      try {
        if (page.isClosed()) continue;
        await this.flushPendingActions(page);
      } catch {
        // page may have navigated or closed
      }
    }
  }

  private async flushPendingActions(page: Page): Promise<void> {
    let pending: Array<Record<string, unknown>> = [];
    try {
      pending = (await page.evaluate(() => {
        const w = window as unknown as Record<string, unknown>;
        const actions = (w.__xb_pending_actions as Array<Record<string, unknown>>) || [];
        w.__xb_pending_actions = [];
        return actions;
      })) as Array<Record<string, unknown>>;
    } catch {
      return;
    }

    for (const raw of pending) {
      const ts = raw.ts as number;
      if (ts <= this.lastActionTs) continue;

      const detail = raw.detail as Record<string, unknown> | undefined;
      const elementInfo = detail?.element as Record<string, unknown> | undefined;

      this.actionCounter++;
      const action: UserAction = {
        id: this.actionCounter,
        type: raw.type as UserAction['type'],
        timestamp: ts,
        url: (raw.url as string) || page.url(),
        pageTitle: (raw.title as string) || '',
        element: raw.element as UserAction['element'],
        value: raw.value as string | undefined,
        key: raw.key as string | undefined,
        x: raw.x as number | undefined,
        y: raw.y as number | undefined,
        scrollX: raw.scrollX as number | undefined,
        scrollY: raw.scrollY as number | undefined,
        selector: elementInfo?.selector as string | undefined,
        selectorStrategy: elementInfo?.selectorStrategy as string | undefined,
        selectorConfidence: elementInfo?.selectorConfidence as UserAction['selectorConfidence'],
      };

      this.actions.push(action);
      this.lastActionTs = ts;
    }
  }

  private buildSummary(data: RecordingData): RecordingSummary {
    const TIME_WINDOW = 2000;

    const steps: RecordingStep[] = [];

    const networkMap: RecordingSummary['networkMap'] = {};
    for (const n of data.network) {
      networkMap[n.id] = { id: n.id, method: n.method, url: n.url, path: n.path, status: n.status, resourceType: n.resourceType };
    }

    for (const action of data.actions) {
      if (action.type === 'scroll') continue;

      const nearbyNetwork = data.network.filter(
        n => Math.abs(n.timestamp - action.timestamp) <= TIME_WINDOW,
      );

      const nearbyContext = data.contextChanges.filter(
        c => Math.abs(c.timestamp - action.timestamp) <= TIME_WINDOW,
      );

      const matchedInputs = this.matchInputsToNetwork(action, nearbyNetwork);

      steps.push({
        step: steps.length + 1,
        action,
        networkIds: nearbyNetwork.map(n => n.id),
        contextChanges: nearbyContext,
        matchedInputs,
      });
    }

    return {
      startUrl: data.startUrl,
      recordedAt: new Date(this.startedAt).toISOString(),
      durationMs: Date.now() - this.startedAt,
      totalActions: data.actions.length,
      totalNetworkRequests: data.network.length,
      networkMap,
      steps,
    };
  }

  private matchInputsToNetwork(
    action: UserAction,
    nearbyNetwork: NetworkEntry[],
  ): Array<{ inputValue: string; networkId: number; paramName: string }> {
    const matches: Array<{ inputValue: string; networkId: number; paramName: string }> = [];

    if (!action.value || !action.value.trim()) return matches;

    const inputValue = action.value.trim();

    for (const netEntry of nearbyNetwork) {
      if (!netEntry.requestBody || typeof netEntry.requestBody !== 'object') continue;

      this.searchObjectForValue(
        netEntry.requestBody as Record<string, unknown>,
        inputValue,
        netEntry.id,
        '',
        matches,
      );
    }

    return matches;
  }

  private searchObjectForValue(
    obj: Record<string, unknown>,
    targetValue: string,
    networkId: number,
    prefix: string,
    results: Array<{ inputValue: string; networkId: number; paramName: string }>,
  ): void {
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (typeof value === 'string' && value.includes(targetValue)) {
        results.push({
          inputValue: targetValue,
          networkId,
          paramName: fullKey,
        });
      } else if (typeof value === 'object' && value !== null) {
        this.searchObjectForValue(
          value as Record<string, unknown>,
          targetValue,
          networkId,
          fullKey,
          results,
        );
      }
    }
  }
}
