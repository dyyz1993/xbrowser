/**
 * SessionRecorder — Server-side CDP recording engine.
 *
 * Captures user actions, network requests, and context changes
 * at the CDP level via Playwright listeners. Data is scoped to
 * a session directory and cleaned up when the session closes.
 *
 * Lifecycle:
 *   record start → process blocks, CDP listeners active
 *   record stop  → signal file written, recording process flushes & exits
 *   session close → recordings directory cleaned up
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, watchFile, unwatchFile } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { BrowserContext, Frame, Page, Request, Response } from 'playwright';

// ─── Types ───────────────────────────────────────────────────────

export interface UserAction {
  id: number;
  type: 'click' | 'input' | 'change' | 'keydown' | 'submit' | 'scroll';
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
  type: 'navigate' | 'new_tab' | 'tab_closed';
  url?: string;
  detail?: string;
}

export interface RecordingStep {
  step: number;
  action: UserAction;
  network: NetworkEntry[];
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

/** Written to disk so `record stop` (separate process) can signal the recorder. */
export interface RecordingControlFile {
  pid: number;
  startedAt: string;
  startUrl: string;
  sessionName: string;
}

// ─── Minimal frontend signal script ──────────────────────────────
// Only captures action signals; all matching happens server-side.

const ACTION_SIGNAL_SCRIPT = `
(function() {
  if (window.__xb_action_signal) return;
  window.__xb_action_signal = true;
  window.__xb_pending_actions = [];

  function describe(el) {
    if (!el || !el.tagName) return null;
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
    };
  }

  function pushAction(type, detail) {
    window.__xb_pending_actions.push({
      type: type,
      ts: Date.now(),
      url: location.href,
      title: document.title,
      ...detail,
    });
  }

  document.addEventListener('click', function(e) {
    pushAction('click', { element: describe(e.target), x: e.clientX, y: e.clientY });
  }, true);

  document.addEventListener('input', function(e) {
    pushAction('input', {
      element: describe(e.target),
      value: (e.target.value || e.target.textContent || '').substring(0, 200),
    });
  }, true);

  document.addEventListener('change', function(e) {
    pushAction('change', { element: describe(e.target), value: (e.target.value || '').substring(0, 100) });
  }, true);

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'Escape' || e.key.startsWith('Arrow')) {
      pushAction('keydown', { key: e.key, element: describe(e.target) });
    }
  }, true);

  document.addEventListener('submit', function(e) {
    pushAction('submit', { element: describe(e.target) });
  }, true);

  document.addEventListener('scroll', function() {
    if (!window.__xb_last_scroll || Date.now() - window.__xb_last_scroll > 500) {
      window.__xb_last_scroll = Date.now();
      pushAction('scroll', { scrollX: window.scrollX, scrollY: window.scrollY });
    }
  }, true);
})();
`;

// ─── SessionRecorder ─────────────────────────────────────────────

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
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private lastActionTs = 0;
  private activePages = new Set<Page>();

  private _isRecording = false;

  constructor(context: BrowserContext, page: Page, sessionName: string) {
    this.context = context;
    this.page = page;
    this.sessionName = sessionName;
  }

  get isRecording(): boolean {
    return this._isRecording;
  }

  /** Directory for this session's recordings. */
  get recordingsDir(): string {
    return SessionRecorder.getRecordingsDir(this.sessionName);
  }

  static getRecordingsDir(sessionName: string): string {
    return join(homedir(), '.xbrowser', 'sessions', sessionName, 'recordings');
  }

  /** Path to the control file (used by record stop to signal this process). */
  get controlFilePath(): string {
    return join(this.recordingsDir, '.control.json');
  }

  /** Path to the stop signal file (written by `record stop`). */
  get stopSignalPath(): string {
    return join(this.recordingsDir, '.stop');
  }

  // ─── Start ──────────────────────────────────────────────────────

  async start(url?: string): Promise<void> {
    if (this._isRecording) throw new Error('Already recording');

    this._isRecording = true;
    this.startedAt = Date.now();
    this.actions = [];
    this.network = [];
    this.contextChanges = [];

    // Navigate if URL provided
    if (url) {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      this.startUrl = url;
    } else {
      this.startUrl = this.page.url();
    }

    // Ensure recordings directory exists
    mkdirSync(this.recordingsDir, { recursive: true });

    // Write control file (so record stop can find this process)
    const control: RecordingControlFile = {
      pid: process.pid,
      startedAt: new Date(this.startedAt).toISOString(),
      startUrl: this.startUrl,
      sessionName: this.sessionName,
    };
    writeFileSync(this.controlFilePath, JSON.stringify(control, null, 2), 'utf-8');

    // 1. Inject action signal script (minimal frontend footprint)
    await this.injectActionScript(this.page);
    await this.page.addInitScript(ACTION_SIGNAL_SCRIPT);

    // 2. Network capture at context level (covers all pages/tabs)
    this.context.on('request', this.handleRequest);
    this.context.on('response', this.handleResponse);

    // 3. Track new pages (tabs/popups)
    this.context.on('page', this.handleNewPage);

    // 4. Track navigation on main page
    this.page.on('framenavigated', this.handleFrameNavigated);

    // 5. Poll for frontend action signals
    this.pollTimer = setInterval(() => void this.pollActions(), 200);

    // 6. Periodic flush to disk (so data survives if process crashes)
    this.flushTimer = setInterval(() => this.flushToDisk(), 5000);
  }

  // ─── Stop ───────────────────────────────────────────────────────

  async stop(): Promise<{ data: RecordingData; summary: RecordingSummary }> {
    if (!this._isRecording) throw new Error('Not recording');

    this._isRecording = false;

    // Stop timers
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null; }

    // Remove listeners
    this.context.off('request', this.handleRequest);
    this.context.off('response', this.handleResponse);
    this.context.off('page', this.handleNewPage);
    this.page.off('framenavigated', this.handleFrameNavigated);
    for (const p of this.activePages) {
      try { p.off('framenavigated', this.handleFrameNavigated); } catch { /* page may be closed */ }
    }

    // Final flush of pending frontend actions
    await this.flushPendingActions(this.page);
    for (const p of this.activePages) {
      await this.flushPendingActions(p).catch(() => {});
    }

    // Build final data + summary
    const data = this.buildData();
    const summary = this.buildSummary(data);

    // Write final files
    this.writeFinalOutput(data, summary);

    // Clean up control & signal files
    try { rmSync(this.controlFilePath); } catch { /* ok */ }
    try { rmSync(this.stopSignalPath); } catch { /* ok */ }

    return { data, summary };
  }

  // ─── Cleanup (called on session close) ──────────────────────────

  static cleanup(sessionName: string): void {
    const dir = SessionRecorder.getRecordingsDir(sessionName);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // ─── Wait for stop signal (blocks the process) ──────────────────

  waitForStopSignal(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (existsSync(this.stopSignalPath)) {
          resolve();
        } else {
          setTimeout(check, 300);
        }
      };
      check();
    });
  }

  // ─── Static: send stop signal to a running recorder ─────────────

  static async sendStopSignal(sessionName: string): Promise<RecordingControlFile | null> {
    const dir = SessionRecorder.getRecordingsDir(sessionName);
    const controlPath = join(dir, '.control.json');
    const stopPath = join(dir, '.stop');

    if (!existsSync(controlPath)) return null;

    const control: RecordingControlFile = JSON.parse(readFileSync(controlPath, 'utf-8'));

    // Check if the recorder process is still alive
    let alive = false;
    try { process.kill(control.pid, 0); alive = true; } catch { alive = false; }

    if (!alive) {
      // Recorder process is dead — clean up control file and return
      try { rmSync(controlPath); } catch { /* ok */ }
      return control;
    }

    // Write stop signal
    mkdirSync(dir, { recursive: true });
    writeFileSync(stopPath, JSON.stringify({ stoppedAt: new Date().toISOString() }), 'utf-8');

    // Wait for the recorder to finish (max 10s)
    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 200));
      if (!existsSync(controlPath)) return control; // recorder cleaned up
      // Also check if process died during wait
      try { process.kill(control.pid, 0); } catch {
        try { rmSync(controlPath); } catch { /* ok */ }
        return control;
      }
    }

    // Timeout — force cleanup
    try { rmSync(controlPath); } catch { /* ok */ }
    return control;
  }

  // ─── Static: read recording from disk ───────────────────────────

  static readSummary(sessionName: string): RecordingSummary | null {
    const path = join(SessionRecorder.getRecordingsDir(sessionName), 'summary.json');
    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      return null;
    }
  }

  static readData(sessionName: string): RecordingData | null {
    const path = join(SessionRecorder.getRecordingsDir(sessionName), 'recording.json');
    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      return null;
    }
  }

  // ==================== Private ====================

  private async injectActionScript(page: Page): Promise<void> {
    try {
      await page.evaluate(ACTION_SIGNAL_SCRIPT);
    } catch {
      // page may not be ready
    }
  }

  // ─── Network capture ────────────────────────────────────────────

  private handleRequest = (request: Request): void => {
    const resourceType = request.resourceType();
    if (['image', 'stylesheet', 'font', 'manifest', 'other'].includes(resourceType)) return;

    const url = request.url();
    if (url.startsWith('data:') || url.startsWith('chrome-extension://') || url.startsWith('blob:')) return;

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

    // Capture request body for mutation methods
    if (['POST', 'PATCH', 'PUT'].includes(request.method())) {
      try {
        const postData = request.postData();
        if (postData) {
          try {
            entry.requestBody = JSON.parse(postData);
          } catch {
            entry.requestBody = postData.substring(0, 500);
          }
        }
      } catch { /* ignore */ }
    }

    this.network.push(entry);
  };

  private handleResponse = async (response: Response): Promise<void> => {
    const url = response.url();
    if (url.startsWith('data:') || url.startsWith('chrome-extension://') || url.startsWith('blob:')) return;

    // Find matching request entry (status still 0)
    const entry = [...this.network].reverse().find(e => e.url === url && e.status === 0);
    if (!entry) return;

    entry.status = response.status();
    entry.contentType = response.headers()['content-type'] || '';

    // Only capture response body for API-like requests
    const resourceType = response.request().resourceType();
    const isApi = ['fetch', 'xhr'].includes(resourceType) ||
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
      } catch { /* unable to read */ }
    } else {
      try {
        entry.responseSize = parseInt(response.headers()['content-length'] || '0', 10);
      } catch { /* ignore */ }
    }
  };

  // ─── Page tracking ──────────────────────────────────────────────

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

    // Inject signal script into new page
    await page.addInitScript(ACTION_SIGNAL_SCRIPT);
    await this.injectActionScript(page).catch(() => {});

    page.on('framenavigated', this.handleFrameNavigated);
    page.on('close', () => { this.activePages.delete(page); });
  };

  private handleFrameNavigated = (frame: Frame): void => {
    if (frame !== frame.page().mainFrame()) return;
    this.contextCounter++;
    this.contextChanges.push({
      id: this.contextCounter,
      timestamp: Date.now(),
      type: 'navigate',
      url: frame.url(),
    });
  };

  // ─── Action polling ─────────────────────────────────────────────

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
    interface PendingAction {
      type: string;
      ts: number;
      url: string;
      title: string;
      element?: UserAction['element'];
      value?: string;
      key?: string;
      x?: number;
      y?: number;
      scrollX?: number;
      scrollY?: number;
    }

    let pending: PendingAction[] = [];
    try {
      pending = await page.evaluate(() => {
        const w = window as unknown as Record<string, unknown>;
        const actions = (w.__xb_pending_actions as PendingAction[]) || [];
        w.__xb_pending_actions = [];
        return actions;
      });
    } catch {
      return;
    }

    for (const raw of pending) {
      if (raw.ts <= this.lastActionTs) continue;

      this.actionCounter++;
      this.actions.push({
        id: this.actionCounter,
        type: raw.type as UserAction['type'],
        timestamp: raw.ts,
        url: raw.url || page.url(),
        pageTitle: raw.title || '',
        element: raw.element,
        value: raw.value,
        key: raw.key,
        x: raw.x,
        y: raw.y,
        scrollX: raw.scrollX,
        scrollY: raw.scrollY,
      });
      this.lastActionTs = raw.ts;
    }
  }

  // ─── Periodic disk flush ────────────────────────────────────────

  private flushToDisk(): void {
    const data = this.buildData();
    try {
      writeFileSync(
        join(this.recordingsDir, 'recording.json'),
        JSON.stringify(data, null, 2),
        'utf-8',
      );
    } catch { /* best effort */ }
  }

  private writeFinalOutput(data: RecordingData, summary: RecordingSummary): void {
    mkdirSync(this.recordingsDir, { recursive: true });
    writeFileSync(join(this.recordingsDir, 'recording.json'), JSON.stringify(data, null, 2), 'utf-8');
    writeFileSync(join(this.recordingsDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
  }

  private buildData(): RecordingData {
    return {
      startUrl: this.startUrl,
      sessionName: this.sessionName,
      startedAt: new Date(this.startedAt).toISOString(),
      actions: [...this.actions],
      network: [...this.network],
      contextChanges: [...this.contextChanges],
    };
  }

  // ─── Summary builder with input→network matching ────────────────

  private buildSummary(data: RecordingData): RecordingSummary {
    const TIME_WINDOW = 2000; // ±2s
    const steps: RecordingStep[] = [];

    for (const action of data.actions) {
      if (action.type === 'scroll') continue; // too noisy for summary

      const nearbyNetwork = data.network.filter(n =>
        Math.abs(n.timestamp - action.timestamp) <= TIME_WINDOW,
      );
      const nearbyContext = data.contextChanges.filter(c =>
        Math.abs(c.timestamp - action.timestamp) <= TIME_WINDOW,
      );
      const matchedInputs = this.matchInputsToNetwork(action, nearbyNetwork);

      steps.push({
        step: steps.length + 1,
        action,
        network: nearbyNetwork.map(n => ({
          ...n,
          responseBody: n.responseBody && JSON.stringify(n.responseBody).length > 1000
            ? ('[truncated, ' + JSON.stringify(n.responseBody).length + ' bytes]')
            : n.responseBody,
        })),
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
        results.push({ inputValue: targetValue, networkId, paramName: fullKey });
      } else if (typeof value === 'object' && value !== null) {
        this.searchObjectForValue(value as Record<string, unknown>, targetValue, networkId, fullKey, results);
      }
    }
  }
}
