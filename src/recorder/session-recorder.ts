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
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { BrowserContext, Frame, Page, Request, Response } from 'playwright';

// ─── Types ───────────────────────────────────────────────────────

export interface ClickContextItem {
  text: string;
  tag?: string;
  disabled?: boolean;
  href?: string;
}

export interface ClickContextElement {
  tag: string;
  selector?: string;
  role?: string;
  text: string;
  rect?: { x: number; y: number; w: number; h: number };
  items: ClickContextItem[];
}

export interface ClickContextStateChange {
  tag: string;
  text: string;
  id?: string;
  ariaExpanded?: string;
  ariaSelected?: string;
  disabled?: boolean;
  dataState?: string;
  changed?: boolean;
}

export interface ClickContext {
  appeared: ClickContextElement[];
  disappeared: unknown[];
  stateChanges: ClickContextStateChange[];
}

export interface UserAction {
  id: number;
  type: 'click' | 'input' | 'change' | 'keydown' | 'submit' | 'scroll';
  timestamp: number;
  url: string;
  pageTitle: string;
  element?: {
    tag: string;
    selector?: string;  // unique short CSS selector for replay
    text: string;
    role?: string;
    type?: string;
    placeholder?: string;
    ariaLabel?: string;
    href?: string;
  };
  value?: string;
  key?: string;
  x?: number;
  y?: number;
  scrollX?: number;
  scrollY?: number;
  /** Click context: popover/dropdown/menu items captured 200ms after click */
  clickContext?: ClickContext;
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

export interface ElementRef {
  selector: string;
  tag: string;
  text: string;
  role?: string;
  type?: string;
  placeholder?: string;
  ariaLabel?: string;
  href?: string;
}

export interface RecordingStep {
  step: number;
  ref: string;       // e.g. "e1", "e2" — reference into elements map
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
  /** Ref → element descriptor map. Steps reference elements via ref to reduce size. */
  elements: Record<string, ElementRef>;
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

  // --- Unique short selector generator ---
  function uniqueSelector(el) {
    if (!el || !el.tagName) return null;
    var doc = el.ownerDocument || document;

    function isUnique(sel) {
      try { return doc.querySelectorAll(sel).length === 1; } catch(e) { return false; }
    }

    // 1. #id (shortest, globally unique)
    if (el.id) {
      var idSel = '#' + CSS.escape(el.id);
      if (isUnique(idSel)) return idSel;
    }

    // 2. [data-testid="..."]
    var testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id');
    if (testId) {
      var sel = '[data-testid="' + testId + '"]';
      if (isUnique(sel)) return sel;
    }

    // 3. [name="..."]
    var name = el.getAttribute('name');
    if (name) {
      var sel = el.tagName.toLowerCase() + '[name="' + name + '"]';
      if (isUnique(sel)) return sel;
    }

    // 4. [aria-label="..."]
    var aria = el.getAttribute('aria-label');
    if (aria) {
      var sel = '[aria-label="' + aria.substring(0, 50) + '"]';
      if (isUnique(sel)) return sel;
    }

    // 5. [placeholder="..."]
    var ph = el.getAttribute('placeholder');
    if (ph) {
      var sel = el.tagName.toLowerCase() + '[placeholder="' + ph.substring(0, 50) + '"]';
      if (isUnique(sel)) return sel;
    }

    // 6. tag.class — pick shortest combo that's unique
    var tag = el.tagName.toLowerCase();
    if (typeof el.className === 'string' && el.className.trim()) {
      var classes = el.className.trim().split(/\\s+/).filter(function(c) {
        return c && !/^(ng-|_|css-|sc-|styled-|emotion-)/.test(c);
      });
      // Sort by rarity (less common class first)
      classes.sort(function(a, b) {
        return doc.querySelectorAll('.' + a).length - doc.querySelectorAll('.' + b).length;
      });
      // Try tag + single class
      for (var i = 0; i < classes.length; i++) {
        var sel = tag + '.' + CSS.escape(classes[i]);
        if (isUnique(sel)) return sel;
      }
      // Try tag + two classes
      if (classes.length >= 2) {
        var sel = tag + '.' + CSS.escape(classes[0]) + '.' + CSS.escape(classes[1]);
        if (isUnique(sel)) return sel;
      }
    }

    // 7. parent > tag  (one level up)
    var parent = el.parentElement;
    if (parent) {
      var parentSel = parent.id ? '#' + CSS.escape(parent.id) : parent.tagName.toLowerCase();
      var sel = parentSel + ' > ' + tag;
      if (isUnique(sel)) return sel;
    }

    // 8. :nth-child fallback (tag:nth-child(n) under parent)
    if (parent) {
      var siblings = Array.from(parent.children);
      var idx = siblings.indexOf(el) + 1;
      var parentSel = parent.id ? '#' + CSS.escape(parent.id) : parent.tagName.toLowerCase();
      var sel = parentSel + ' > ' + tag + ':nth-child(' + idx + ')';
      if (isUnique(sel)) return sel;
    }

    // 9. Last resort: full tag
    return tag;
  }

  // --- Element descriptor ---
  function describe(el) {
    if (!el || !el.tagName) return null;
    var tag = el.tagName.toLowerCase();
    var isInputLike = (tag === 'input' || tag === 'textarea' || tag === 'select');
    var displayText = isInputLike
      ? (el.value || el.getAttribute('placeholder') || '').trim().substring(0, 40)
      : (el.textContent || '').trim().substring(0, 40);
    if (tag === 'a' && el.getAttribute('href')) displayText = el.textContent.trim().substring(0, 40);
    return {
      tag: tag,
      selector: uniqueSelector(el),
      text: displayText,
      role: el.getAttribute('role') || undefined,
      type: el.getAttribute('type') || undefined,
      placeholder: el.getAttribute('placeholder') || undefined,
      ariaLabel: el.getAttribute('aria-label') || undefined,
      href: el.getAttribute('href') ? el.getAttribute('href').substring(0, 80) : undefined,
    };
  }

  function isMeaningful(el) {
    if (!el || !el.tagName) return false;
    var tag = el.tagName.toLowerCase();
    if (tag === 'a' || tag === 'button' || tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (el.getAttribute('role')) return true;
    if (el.getAttribute('aria-label')) return true;
    var text = (el.textContent || '').trim();
    if (text.length > 0 && text.length <= 80) return true;
    return false;
  }

  function resolveMeaningful(e) {
    var path = e.composedPath ? e.composedPath() : [e.target];
    for (var i = 0; i < Math.min(path.length, 8); i++) {
      var el = path[i];
      if (isMeaningful(el)) return el;
    }
    return path[0] || e.target;
  }

  function actualTarget(e) {
    var path = e.composedPath && e.composedPath();
    return (path && path.length > 0) ? path[0] : e.target;
  }

  // --- Input debounce: coalesce rapid keystrokes on same element ---
  var __xb_input_timer = null;
  var __xb_input_pending = null;

  function flushInputAction() {
    if (__xb_input_pending) {
      window.__xb_pending_actions.push(__xb_input_pending);
      __xb_input_pending = null;
    }
    __xb_input_timer = null;
  }

  function pushAction(type, detail) {
    if (type === 'input') {
      if (__xb_input_timer) clearTimeout(__xb_input_timer);
      __xb_input_pending = {
        type: type,
        ts: Date.now(),
        url: location.href,
        title: document.title,
        ...detail,
      };
      __xb_input_timer = setTimeout(flushInputAction, 800);
      return;
    }
    if (type === 'click' || type === 'submit' || type === 'keydown') {
      if (__xb_input_timer) { clearTimeout(__xb_input_timer); flushInputAction(); }
    }
    window.__xb_pending_actions.push({
      type: type,
      ts: Date.now(),
      url: location.href,
      title: document.title,
      ...detail,
    });
  }

  // --- Click context: capture popover/dropdown/menu/state changes after click ---
  var POPOVER_SELECTORS = [
    '[role="menu"]','[role="listbox"]','[role="dialog"]','[role="tooltip"]','[role="popover"]',
    '[role="combobox"]','[role="tree"]','[role="grid"]',
    '.popover','.popup','.dropdown','.menu','.modal','.tooltip','.panel',
    '[class*="popover"]','[class*="popup"]','[class*="dropdown"]','[class*="menu"]','[class*="tooltip"]',
    '[class*="modal"]','[class*="panel"]','[class*="overlay"]','[class*="sheet"]',
    '[data-popup]','[data-dropdown]','[data-menu]','[data-popover]',
    '.semi-dropdown','.semi-popover','.semi-modal','.semi-select-option',
    '.ant-dropdown','.ant-popover','.ant-modal','.ant-select-dropdown',
    '.el-dropdown','.el-popover','.el-dialog','.el-select-dropdown',
    '.t-dropdown','.t-popup','.t-dialog'
  ];

  function isNearClick(el, cx, cy, range) {
    try {
      var r = el.getBoundingClientRect();
      if (!r || r.width === 0 || r.height === 0) return false;
      // Element overlaps with or is near the click area
      var margin = range || 300;
      return !(r.left > cx + margin || r.right < cx - margin || r.top > cy + margin || r.bottom < cy - margin);
    } catch(e) { return false; }
  }

  function captureVisibleContext(cx, cy) {
    var result = { appeared: [], disappeared: [], stateChanges: [] };
    try {
      // 1. Find popover/dropdown/menu elements near the click
      for (var i = 0; i < POPOVER_SELECTORS.length; i++) {
        try {
          var els = document.querySelectorAll(POPOVER_SELECTORS[i]);
          for (var j = 0; j < els.length; j++) {
            var el = els[j];
            if (!isNearClick(el, cx, cy, 500)) continue;
            var rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            var items = [];
            // Capture child items (up to 20)
            var children = el.querySelectorAll('a,button,[role="menuitem"],[role="option"],[role="treeitem"],li,div[class*="item"]');
            for (var k = 0; k < Math.min(children.length, 20); k++) {
              var child = children[k];
              var childText = (child.textContent || '').trim().substring(0, 60);
              if (!childText) continue;
              var childInfo = { text: childText };
              if (child.disabled) childInfo.disabled = true;
              if (child.getAttribute('aria-disabled') === 'true') childInfo.disabled = true;
              if (child.tagName) childInfo.tag = child.tagName.toLowerCase();
              if (child.href) childInfo.href = child.href.substring(0, 80);
              items.push(childInfo);
            }
            result.appeared.push({
              tag: el.tagName.toLowerCase(),
              selector: uniqueSelector(el),
              role: el.getAttribute('role'),
              text: (el.textContent || '').trim().substring(0, 100),
              rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
              items: items,
            });
          }
        } catch(e) {}
      }

      // 2. Find elements that changed aria-expanded or disabled state near click
      var nearbyEls = document.elementsFromPoint ? document.elementsFromPoint(cx, cy) : [];
      // Also check elements in a wider area
      var area = document.querySelector('body');
      if (area) {
        var allInteractive = area.querySelectorAll('[aria-expanded],[disabled],[aria-disabled],[aria-selected],[data-state]');
        for (var i = 0; i < allInteractive.length; i++) {
          var el = allInteractive[i];
          if (!isNearClick(el, cx, cy, 400)) continue;
          var info = { tag: el.tagName.toLowerCase(), text: (el.textContent || '').trim().substring(0, 60) };
          if (el.id) info.id = el.id;
          if (el.getAttribute('aria-expanded')) info.ariaExpanded = el.getAttribute('aria-expanded');
          if (el.disabled) info.disabled = true;
          if (el.getAttribute('aria-disabled') === 'true') info.disabled = true;
          if (el.getAttribute('aria-selected')) info.ariaSelected = el.getAttribute('aria-selected');
          if (el.getAttribute('data-state')) info.dataState = el.getAttribute('data-state');
          result.stateChanges.push(info);
        }
      }
    } catch(e) {}
    // Deduplicate appeared by selector
    var seen = {};
    result.appeared = result.appeared.filter(function(item) {
      if (!item.selector) return true;
      if (seen[item.selector]) return false;
      seen[item.selector] = true;
      return true;
    });
    return result;
  }

  document.addEventListener('click', function(e) {
    var cx = e.clientX, cy = e.clientY;
    // Snapshot before (for diff)
    var beforeExpanded = {};
    try {
      var expandedEls = document.querySelectorAll('[aria-expanded]');
      for (var i = 0; i < expandedEls.length; i++) {
        var el = expandedEls[i];
        if (isNearClick(el, cx, cy, 400)) {
          beforeExpanded[el.id || uniqueSelector(el)] = el.getAttribute('aria-expanded');
        }
      }
    } catch(e) {}

    pushAction('click', { element: describe(resolveMeaningful(e)), x: cx, y: cy });

    // After 200ms, capture what changed
    setTimeout(function() {
      try {
        var ctx = captureVisibleContext(cx, cy);
        // Check aria-expanded changes
        try {
          var expandedEls = document.querySelectorAll('[aria-expanded]');
          for (var i = 0; i < expandedEls.length; i++) {
            var el = expandedEls[i];
            var key = el.id || uniqueSelector(el);
            var now = el.getAttribute('aria-expanded');
            if (beforeExpanded[key] !== undefined && beforeExpanded[key] !== now) {
              ctx.stateChanges.push({
                tag: el.tagName.toLowerCase(),
                text: (el.textContent || '').trim().substring(0, 60),
                id: el.id || undefined,
                ariaExpanded: now,
                changed: true,
              });
            }
          }
        } catch(e) {}
        if (ctx.appeared.length > 0 || ctx.stateChanges.length > 0) {
          var lastAction = window.__xb_pending_actions[window.__xb_pending_actions.length - 1];
          if (lastAction && lastAction.type === 'click') {
            lastAction.clickContext = ctx;
          }
        }
      } catch(e) {}
    }, 200);
  }, true);

  document.addEventListener('input', function(e) {
    var target = actualTarget(e);
    pushAction('input', {
      element: describe(target),
      value: (target.value || target.textContent || '').substring(0, 200),
    });
  }, true);

  document.addEventListener('change', function(e) {
    var target = actualTarget(e);
    var tag = target.tagName && target.tagName.toLowerCase();
    if (tag === 'select') {
      pushAction('change', { element: describe(target), value: (target.value || '').substring(0, 100) });
    }
  }, true);

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'Escape' || e.key.startsWith('Arrow')) {
      pushAction('keydown', { key: e.key, element: describe(actualTarget(e)) });
    }
  }, true);

  document.addEventListener('submit', function(e) {
    pushAction('submit', { element: describe(actualTarget(e)) });
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

  get actionCount(): number {
    return this.actions.length;
  }

  get networkCount(): number {
    return this.network.length;
  }

  getLiveData(): RecordingData {
    return this.buildData();
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

      // For click actions, capture popover/dropdown context after a delay
      let clickContext: ClickContext | undefined;
      if (raw.type === 'click' && raw.x !== undefined && raw.y !== undefined) {
        clickContext = await this.captureClickContext(page, raw.x, raw.y);
      }

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
        clickContext,
      });
      this.lastActionTs = raw.ts;
    }
  }

  /**
   * After a click, wait 300ms then scan for popover/dropdown/menu elements
   * near the click position. This runs server-side to avoid race conditions
   * with the client-side poll interval.
   */
  private async captureClickContext(page: Page, cx: number, cy: number): Promise<ClickContext | undefined> {
    // Wait for animations/transitions to settle
    await new Promise(r => setTimeout(r, 300));

    try {
      const ctx = await page.evaluate(([cx, cy]) => {
        const POPOVER_SELECTORS = [
          '[role="menu"]','[role="listbox"]','[role="dialog"]','[role="tooltip"]','[role="popover"]',
          '[role="combobox"]','[role="tree"]','[role="grid"]',
          '.popover','.popup','.dropdown','.menu','.modal','.tooltip','.panel',
          '[class*="popover"]','[class*="popup"]','[class*="dropdown"]','[class*="menu"]',
          '[class*="tooltip"]','[class*="modal"]','[class*="panel"]','[class*="overlay"]','[class*="sheet"]',
          '[data-popup]','[data-dropdown]','[data-menu]','[data-popover"]',
          '.semi-dropdown','.semi-popover','.semi-modal',
          '.ant-dropdown','.ant-popover','.ant-modal',
          '.el-dropdown','.el-popover','.el-dialog',
          '.t-dropdown','.t-popup','.t-dialog',
        ];

        function isNear(el: Element, x: number, y: number, range: number) {
          try {
            const r = el.getBoundingClientRect();
            if (!r || r.width === 0 || r.height === 0) return false;
            return !(r.left > x + range || r.right < x - range || r.top > y + range || r.bottom < y - range);
          } catch { return false; }
        }

        const result: { appeared: unknown[]; disappeared: unknown[]; stateChanges: unknown[] } = {
          appeared: [],
          disappeared: [],
          stateChanges: [],
        };
        const seenSelectors = new Set<string>();

        for (const sel of POPOVER_SELECTORS) {
          try {
            const els = document.querySelectorAll(sel);
            for (let j = 0; j < els.length; j++) {
              const el = els[j];
              if (!isNear(el, cx, cy, 500)) continue;
              const rect = el.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) continue;

              // Deduplicate
              const elSel = el.id ? '#' + el.id : sel;
              if (seenSelectors.has(elSel + rect.x + rect.y)) continue;
              seenSelectors.add(elSel + rect.x + rect.y);

              const items: { text: string; tag?: string; disabled?: boolean; href?: string }[] = [];
              const children = el.querySelectorAll('a,button,[role="menuitem"],[role="option"],[role="treeitem"],li,div[class*="item"]');
              for (let k = 0; k < Math.min(children.length, 20); k++) {
                const child = children[k];
                const childText = (child.textContent || '').trim().substring(0, 60);
                if (!childText) continue;
                const ci: { text: string; tag?: string; disabled?: boolean; href?: string } = { text: childText };
                if ((child as HTMLInputElement).disabled || child.getAttribute('aria-disabled') === 'true') ci.disabled = true;
                if (child.tagName) ci.tag = child.tagName.toLowerCase();
                if ((child as HTMLAnchorElement).href) ci.href = (child as HTMLAnchorElement).href.substring(0, 80);
                items.push(ci);
              }

              result.appeared.push({
                tag: el.tagName.toLowerCase(),
                selector: el.id ? '#' + el.id : undefined,
                role: el.getAttribute('role'),
                text: (el.textContent || '').trim().substring(0, 100),
                rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
                items,
              });
            }
          } catch { /* skip invalid selectors */ }
        }

        // Check aria-expanded / disabled state changes near click
        const allInteractive = document.querySelectorAll('[aria-expanded],[disabled],[aria-disabled],[aria-selected],[data-state]');
        for (let i = 0; i < allInteractive.length; i++) {
          const el = allInteractive[i];
          if (!isNear(el, cx, cy, 400)) continue;
          const info: Record<string, unknown> = {
            tag: el.tagName.toLowerCase(),
            text: (el.textContent || '').trim().substring(0, 60),
          };
          if (el.id) info.id = el.id;
          if (el.getAttribute('aria-expanded')) info.ariaExpanded = el.getAttribute('aria-expanded');
          if ((el as HTMLInputElement).disabled || el.getAttribute('aria-disabled') === 'true') info.disabled = true;
          if (el.getAttribute('aria-selected')) info.ariaSelected = el.getAttribute('aria-selected');
          if (el.getAttribute('data-state')) info.dataState = el.getAttribute('data-state');
          result.stateChanges.push(info);
        }

        return result;
      }, [cx, cy] as const) as ClickContext;

      if (ctx.appeared.length > 0 || ctx.stateChanges.length > 0) {
        return ctx;
      }
    } catch {
      // page may have navigated
    }
    return undefined;
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

  // ─── Summary builder with ref compression + input→network matching ──

  private buildSummary(data: RecordingData): RecordingSummary {
    const POST_WINDOW = 5000;
    const MERGE_WINDOW = 2000;
    const steps: RecordingStep[] = [];

    const selectorToRef = new Map<string, string>();
    const elements: Record<string, ElementRef> = {};
    let refCounter = 0;

    function getRef(action: UserAction): string {
      const sel = action.element?.selector || action.element?.tag || '_none';
      if (selectorToRef.has(sel)) return selectorToRef.get(sel)!;

      refCounter++;
      const ref = 'e' + refCounter;
      selectorToRef.set(sel, ref);

      if (action.element) {
        elements[ref] = {
          selector: action.element.selector || action.element.tag,
          tag: action.element.tag,
          text: action.element.text,
          role: action.element.role,
          type: action.element.type,
          placeholder: action.element.placeholder,
          ariaLabel: action.element.ariaLabel,
          href: action.element.href,
        };
      } else {
        elements[ref] = { selector: '_none', tag: '_', text: '' };
      }
      return ref;
    }

    const isNoiseNetwork = (n: NetworkEntry): boolean => {
      const url = n.url || '';
      const path = n.path || '';
      const rt = n.resourceType || '';
      if (['image', 'stylesheet', 'font', 'manifest', 'other'].includes(rt)) return true;
      if (n.status === 0) return true;
      if (/\/ztbox|\/mwb2\.gif|\/hmslog|\/log\.gif|\/tongji|hm\.baidu|clickstream|\/actionlog|\/collect\?|\/track|\/beacon/i.test(url)) return true;
      if (/\/favicon\.ico|\/robots\.txt/i.test(path)) return true;
      return false;
    };

    const meaningfulNetwork = data.network.filter(n => !isNoiseNetwork(n));

    const filtered = data.actions.filter(a => a.type !== 'scroll');

    type ActionGroup = { actions: UserAction[]; primary: UserAction };
    const groups: ActionGroup[] = [];
    let current: ActionGroup | null = null;

    for (const action of filtered) {
      const sameElement = current
        && current.primary.element?.selector
        && current.primary.element.selector === action.element?.selector
        && action.timestamp - current.primary.timestamp < MERGE_WINDOW;
      const isInputLike = action.type === 'input' || action.type === 'keydown' || action.type === 'change';

      if (current && (sameElement || (isInputLike && current.actions.some(a => a.type === 'input' || a.type === 'click')) && action.timestamp - current.primary.timestamp < MERGE_WINDOW)) {
        current.actions.push(action);
        if (action.type === 'input') current.primary = action;
      } else {
        current = { actions: [action], primary: action };
        groups.push(current);
      }
    }

    for (const group of groups) {
      const primary = group.primary;
      const tsStart = Math.min(...group.actions.map(a => a.timestamp));
      const tsEnd = Math.max(...group.actions.map(a => a.timestamp));
      const inputAction = group.actions.find(a => a.type === 'input');

      const nearbyNetwork = meaningfulNetwork.filter(n =>
        n.timestamp >= tsStart - 500 && n.timestamp <= tsEnd + POST_WINDOW,
      );
      const nearbyContext = data.contextChanges.filter(c =>
        c.timestamp >= tsStart - 500 && c.timestamp <= tsEnd + POST_WINDOW,
      );
      const matchedInputs = inputAction
        ? this.matchActionToNetwork(inputAction, nearbyNetwork)
        : [];
      const clickMatches = primary.type === 'click' && primary.element?.text
        ? this.matchActionToNetwork(primary, nearbyNetwork)
        : [];

      steps.push({
        step: steps.length + 1,
        ref: getRef(primary),
        action: primary,
        network: nearbyNetwork.map(n => ({
          ...n,
          responseBody: n.responseBody && JSON.stringify(n.responseBody).length > 1000
            ? ('[truncated, ' + JSON.stringify(n.responseBody).length + ' bytes]')
            : n.responseBody,
        })),
        contextChanges: nearbyContext,
        matchedInputs: [...matchedInputs, ...clickMatches],
      });
    }

    return {
      startUrl: data.startUrl,
      recordedAt: new Date(this.startedAt).toISOString(),
      durationMs: Date.now() - this.startedAt,
      totalActions: data.actions.length,
      totalNetworkRequests: meaningfulNetwork.length,
      steps,
      elements,
    };
  }

  private matchActionToNetwork(
    action: UserAction,
    nearbyNetwork: NetworkEntry[],
  ): Array<{ inputValue: string; networkId: number; paramName: string }> {
    const matches: Array<{ inputValue: string; networkId: number; paramName: string }> = [];
    const searchValue = (action.value || action.element?.text || '').trim();
    if (!searchValue || searchValue.length < 2) return matches;

    for (const netEntry of nearbyNetwork) {
      if (netEntry.url.includes(encodeURIComponent(searchValue)) || netEntry.url.includes(searchValue)) {
        matches.push({ inputValue: searchValue, networkId: netEntry.id, paramName: 'url' });
      }
      if (netEntry.requestBody && typeof netEntry.requestBody === 'object') {
        this.searchObjectForValue(
          netEntry.requestBody as Record<string, unknown>,
          searchValue,
          netEntry.id,
          '',
          matches,
        );
      }
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
