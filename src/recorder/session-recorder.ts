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
import type { BrowserContext, Frame, Page, Request, Response, Dialog } from '../browser-shim.js';
import { updateSiteKnowledge } from './site-knowledge.js';
import { createNetworkCaptureState, handleNetworkRequest, handleNetworkResponse } from './network-capture.js';
import { injectActionScript } from './script-injector.js';
import { ACTION_SIGNAL_SCRIPT, CHECKPOINT_OVERLAY_SCRIPT } from './injection-scripts.js';
import { getSelectorGeneratorScript } from './selector-utils.js';
import { buildSummary } from './summary-builder.js';
import { buildMarkdownSummary } from './markdown-summary.js';
import { detectCheckpoints, verifyAction } from './observation-insights.js';
import {
  captureAutoSnapshot,
  captureClickContext,
  captureElementScreenshot,
} from './page-context.js';
import type { UserAction, RecordingData, RecordingSummary, RecordingControlFile, CheckpointEntry, CheckpointType, ContextChange, ClickContext, ActionSignal, DiscoveredFilter } from './recording-types.js';
export type {
  ClickContextItem, ClickContextElement, ClickContextStateChange, ClickContext,
  UserAction, NetworkEntry, ContextChange, ElementRef,
  RecordingStep, RecordingSummary, CheckpointType, CheckpointEntry,
  RecordingData, RecordingControlFile, ActionSignal,
} from './recording-types.js';

// ─── SessionRecorder ─────────────────────────────────────────────

export class SessionRecorder {
  private context: BrowserContext;
  private page: Page;
  private sessionName: string;
  private startUrl = '';
  private startedAt = 0;

  private actions: UserAction[] = [];
  private networkCapture = createNetworkCaptureState();
  private contextChanges: ContextChange[] = [];
  private checkpoints: CheckpointEntry[] = [];
  /** Proactive baseline scan of filter/sort/tab/menu regions. Keyed by
   * containerSelector so re-scans after navigation replace rather than dup. */
  private discoveredFilters: Map<string, DiscoveredFilter> = new Map();

  private actionCounter = 0;
    private contextCounter = 0;
  private checkpointCounter = 0;

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private lastActionTs = 0;
  private activePages = new Set<Page>();
  private lastKnownUrl = '';

  private dedupMap = new Map<string, { expires: number; origin: 'signal' | 'command' }>();
  private dedupActionCount = 0;
  private _isRecording = false;
  private streamMode: 'clean' | 'raw' = 'clean';
  private snapshotThrottle = new Map<string, number>();

  private static readonly AMBIENT_TYPES = new Set([
    'hover', 'focus', 'scroll', 'visibility', 'resize', 'clipboard', 'touch', 'contextmenu',
  ]);

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

  /** Record an action triggered by a CDP command (e.g. xbrowser fill/click/goto) */
  async recordCommandAction(action: { type: string; selector?: string; value?: string; url?: string; element?: UserAction['element'] }): Promise<void> {
    // Reverse dedup: skip only when the matching entry was set by a real
    // action SIGNAL (the command is a duplicate of an already-captured event).
    // Entries set by other commands never match a command twice here.
    const dedupFromAction = this.dedupKey(action.type, action.selector, action.element?.tag, action.value);
    if (dedupFromAction) {
      const entry = this.dedupMap.get(dedupFromAction);
      if (entry && entry.origin === 'signal' && Date.now() < entry.expires) {
        return; // Skip duplicate — action signal already captured it
      }
    }

    this.actionCounter++;
    const ts = Date.now();
    // Use lastKnownUrl if action url is about:blank or empty (page may have navigated)
    const actionUrl = action.url && action.url !== 'about:blank'
      ? action.url
      : (this.lastKnownUrl || this.page.url());
    const actionToPush: UserAction = {
      id: this.actionCounter,
      type: action.type as UserAction['type'],
      timestamp: ts,
      url: actionUrl,
      pageTitle: '',
      element: action.element || (action.selector ? { tag: '', selector: action.selector, text: '' } : undefined),
      value: action.value,
    };
	    this.actions.push(actionToPush);

	    // Capture element screenshot for key action types (non-critical).
	    // Hard 3s budget: the internal fallback chain (locator.screenshot →
	    // waitForSelector) can burn 2×30s on iframe-internal elements because
	    // waitForActionable's default timeout is not threaded through — a
	    // decoration must never stall command execution (rec-duel d01: +60s/click).
	    actionToPush.elementScreenshot = await Promise.race([
	      captureElementScreenshot(this.page, {
	        type: action.type,
	        element: actionToPush.element,
	      }).catch(() => undefined),
	      new Promise<undefined>(r => setTimeout(r, 3000)),
	    ]);

	    // Capture auto-snapshot (viewport + accessibility tree) after key actions
	    await Promise.race([
	      captureAutoSnapshot(this.page, actionToPush, 'after', this.snapshotsDir, this.snapshotThrottle).catch(() => {}),
	      new Promise<void>(r => setTimeout(r, 6000)),
	    ]);

	    // Update lastActionTs and set dedup window (4s) for matching action signals.
    // 4s covers stealth-mode click duration: bezier trajectory (10-28 mouseMoved
    // events with sleeps) delays the real click event ~2-3s after the injected
    // cdp-click command, which previously escaped the old 2s window (rec-duel d02/d03).
    this.lastActionTs = ts;
    this.dedupMap.set(dedupFromAction, { expires: Date.now() + 4000, origin: 'command' });
    this.dedupActionCount++;

    // Periodic cleanup: purge expired entries every 200 actions
    if (this.dedupActionCount % 200 === 0) {
      const now = Date.now();
      for (const [k, v] of this.dedupMap) {
        if (now >= v.expires) this.dedupMap.delete(k);
      }
    }

    // Update URL tracking for goto/navigation commands
    if (action.url && action.url !== 'about:blank') {
      this.lastKnownUrl = action.url;
    } else if (action.type === 'goto' && action.value && action.value !== 'about:blank') {
      this.lastKnownUrl = action.value;
    }
  }

  /** Generate dedup key for an action (normalized type + selector/tag + value). */
  private dedupKey(type: string, selector?: string, tag?: string, value?: string): string {
    const normType = type === 'cdp-click' ? 'click'
      : type === 'cdp-fill' ? 'input'
      : type === 'cdp-eval' ? 'eval' : type;
    const selOrTag = selector || tag || '';
    return `${normType}|${selOrTag}|${value || ''}`;
  }

  get networkCount(): number {
    return this.networkCapture.entries.length;
  }

  getLiveData(): RecordingData {
    return this.buildData();
  }

  addManualCheckpoint(type: string, hint: string, selector?: string): CheckpointEntry {
    this.checkpointCounter++;
    const cp: CheckpointEntry = {
      id: this.checkpointCounter,
      type: type as CheckpointType,
      timestamp: Date.now(),
      url: this.page.url(),
      pageTitle: '',
      hint,
      selector,
      source: 'manual',
    };
    this.checkpoints.push(cp);
    return cp;
  }

  /** Directory for this session's recordings. */
  get recordingsDir(): string {
    return SessionRecorder.getRecordingsDir(this.sessionName);
  }

  /** Directory for auto-captured snapshots (PNG screenshots, stored in .tmp for easy cleanup). */
  get snapshotsDir(): string {
    return join(this.recordingsDir, '.tmp', 'snapshots');
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

  async start(url?: string, options?: { stream?: 'clean' | 'raw' }): Promise<void> {
    if (this._isRecording) throw new Error('Already recording');

    this._isRecording = true;
    this.startedAt = Date.now();
    this.actions = [];
    
    this.contextChanges = [];
    this.checkpoints = [];
    this.checkpointCounter = 0;
    this.streamMode = options?.stream ?? 'clean';
    this.lastKnownUrl = this.page.url();  // Initialize URL tracking

    // Register init scripts BEFORE goto so they execute on the freshly loaded page.
    // order matters: selector-utils first, then action signal script (which uses it).
    await this.page.addInitScript(getSelectorGeneratorScript());
    await this.page.addInitScript(ACTION_SIGNAL_SCRIPT);
    await this.page.addInitScript(CHECKPOINT_OVERLAY_SCRIPT);

    // Register event listeners BEFORE goto to capture the initial navigation.
    this.context.on('request', this.handleRequest);
    this.context.on('response', this.handleResponse);
    this.context.on('page', this.handleNewPage);
    for (const p of this.context.pages()) {
      p.on('request', this.handleRequest);
      p.on('response', this.handleResponse);
    }
    this.page.on('framenavigated', this.handleFrameNavigated);
    this.page.on('dialog', this.handleDialog);
    this.page.on('filechooser', this.handleFileChooser);

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

    // 1. Inject action signal script (minimal frontend footprint) — also handles already-loaded page
    await this.injectActionScript(this.page);

    // 3. Track new tabs/popups
    this.context.on('page', this.handleNewPage);

    // 4. Poll for frontend action signals
    this.pollTimer = setInterval(() => void this.pollActions(), 200);

    // 5. Periodic flush to disk (so data survives if process crashes)
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
    this.page.off('dialog', this.handleDialog);
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
    const summary = buildSummary(data, this.startedAt);

    // Write final files
    this.writeFinalOutput(data, summary);

    // Generate/update site knowledge base (LLM-readable documentation)
    try {
      const knowledge = updateSiteKnowledge(data);
      const knowledgeDir = join(this.recordingsDir, 'site-knowledge.md');
      const knowledgeJson = join(this.recordingsDir, 'site-knowledge.json');
      const { readFileSync: rf } = require('fs');
      const { getKnowledgePath } = require('./site-knowledge.js');
      const mdPath = getKnowledgePath(knowledge.domain, 'md');
      try {
        const md = rf(mdPath, 'utf-8');
        writeFileSync(knowledgeDir, md, 'utf-8');
      } catch { /* ok */ }
      writeFileSync(knowledgeJson, JSON.stringify(knowledge, null, 2), 'utf-8');
    } catch {
      // non-critical: recording still succeeds
    }

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

  /** Whether the initial action-signal script injection succeeded. Check this
   * after start() returns — if false, user actions will NOT be recorded and
   * the caller should surface a clear error to the user instead of silently
   * pretending recording is working. */
  private _injectionFailed = false;
  get injectionFailed(): boolean { return this._injectionFailed; }

  private async injectActionScript(page: Page): Promise<void> {
    this._injectionFailed = !(await injectActionScript(page));
  }

  // ─── Network capture ────────────────────────────────────────────

  private handleRequest = (request: Request): void => {
    handleNetworkRequest(request, this.networkCapture);
  };

  private handleResponse = async (response: Response): Promise<void> => {
    await handleNetworkResponse(response, this.networkCapture);
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

    // Inject signal script into new page (addInitScript for future navigations)
    await page.addInitScript(ACTION_SIGNAL_SCRIPT);
    await page.addInitScript(CHECKPOINT_OVERLAY_SCRIPT);
    await page.addInitScript(getSelectorGeneratorScript());

    // Also inject selector generator via addInitScript so it's available on every navigation
    // Inject immediately on current page state, and re-inject after any navigation
    const injectAndRetry = async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const url = page.url();
          if (url && url !== 'about:blank' && !url.startsWith('chrome')) {
            await this.injectActionScript(page);
            return;
          }
        } catch (e) {
          const err = e instanceof Error ? e : new Error(typeof e === 'string' ? e : 'unknown error');
          if (attempt < 4) {
            console.error(`[recorder] injectActionScript retry ${attempt + 1}/5 failed: ${err.message}`);
          }
        }
        await new Promise(r => setTimeout(r, 1000));
      }
    };
    // Fire-and-forget: inject when page is ready
    injectAndRetry();

    page.on('framenavigated', this.handleFrameNavigated);
    page.on('request', this.handleRequest);
    page.on('response', this.handleResponse);
    page.on('filechooser', this.handleFileChooser);
    page.on('dialog', this.handleDialog);
    page.on('close', () => { this.activePages.delete(page); });

    // Wait for page to have a real URL before considering it ready
    // (handles the case where new tab opens with about:blank then navigates)
    page.on('framenavigated', async (frame: Frame) => {
      // Check if this is the main frame navigation by URL comparison
    // (mainFrame() creates a new object each call, so identity check won't work)
    if (frame.isDetached()) return;
      const url = frame.url();
      if (url && url !== 'about:blank' && !url.startsWith('chrome')) {
        try { await this.injectActionScript(page); } catch (e) {
          const err = e instanceof Error ? e : new Error(typeof e === 'string' ? e : 'unknown error');
          console.error(`[recorder] injectActionScript after navigation failed: ${err.message}`);
        }
      }
    });
  };

  private handleFrameNavigated = (frame: Frame): void => {
    // Check if this is the main frame navigation by URL comparison
    // (mainFrame() creates a new object each call, so identity check won't work)
    if (frame.isDetached()) return;
    const newUrl = frame.url();
    this.contextCounter++;
    this.contextChanges.push({
      id: this.contextCounter,
      timestamp: Date.now(),
      type: 'navigate',
      url: newUrl,
    });

    // Also record a navigation action so replay knows the URL changed
    // Skip if the last action already captured this URL (e.g. cdp-click on a link)
    const lastAction = this.actions[this.actions.length - 1];
    const lastActionUrl = lastAction?.url;
    if (newUrl && newUrl !== 'about:blank' && newUrl !== lastActionUrl) {
      this.actionCounter++;
      this.actions.push({
        id: this.actionCounter,
        type: 'navigation',
        timestamp: Date.now(),
        url: newUrl,
        pageTitle: '',
        element: undefined,
      });
    }

    // Re-inject action signal script after navigation (page.evaluate scripts are lost on navigation)
    const page = frame.page();
    if (newUrl && newUrl !== 'about:blank') {
      // Fire-and-forget: don't block the event handler
      this.injectActionScript(page).catch(() => {});
    }
  };

  private handleDialog = async (dialog: Dialog): Promise<void> => {
    this.checkpointCounter++;
    this.checkpoints.push({
      id: this.checkpointCounter,
      type: 'dialog',
      timestamp: Date.now(),
      url: this.page.url(),
      pageTitle: await this.page.title().catch(() => ''),
      hint: `Dialog [${dialog.type}]: "${dialog.message()}"`,
      source: 'auto',
      context: { dialogType: dialog.type, message: dialog.message() },
    });
    await dialog.dismiss().catch(() => {});
  };

  private handleFileChooser = async (fileChooser: { selector: string; isMultiple: boolean }): Promise<void> => {
    const url = this.page.url();

    // Generate element metadata
    const sel = fileChooser.selector || 'input[type="file"]';
    let element: UserAction['element'] | undefined;
    try {
      element = (await this.page.evaluate(new Function('selector', `
        const el = document.querySelector(selector);
        if (!el) return null;
        return window.__xb_describe(el);
      `), sel)) as UserAction['element'] | null ?? undefined;
    } catch { /* ignore */ }

    // Read file data from the input element (async FileReader)
    let fileData: Array<{ name: string; type: string; size: number; dataUrl: string | null }> = [];
    try {
      fileData = (await this.page.evaluate(new Function('selector', `
        return new Promise(resolve => {
          const input = document.querySelector(selector);
          if (!input || !input.files || input.files.length === 0) { resolve([]); return; }
          const readers = [];
          for (let i = 0; i < input.files.length; i++) {
            readers.push(new Promise(r => {
              const reader = new FileReader();
              reader.onload = () => r({ name: input.files[i].name, type: input.files[i].type, size: input.files[i].size, dataUrl: reader.result });
              reader.onerror = () => r({ name: input.files[i].name, type: input.files[i].type, size: input.files[i].size, dataUrl: null });
              reader.readAsDataURL(input.files[i]);
            }));
          }
          Promise.all(readers).then(resolve);
        });
      `), sel)) as typeof fileData;
    } catch { /* ignore */ }

    const names = fileData.map(f => f.name);

    this.actionCounter++;
    this.actions.push({
      id: this.actionCounter,
      type: 'filechooser',
      timestamp: Date.now(),
      url,
      pageTitle: '',
      element: element || {
        selector: sel,
        strategy: 'css',
        confidence: 'high',
        tag: 'input',
        text: '',
      },
      value: names.join(', ') || undefined,
      files: {
        names,
        count: fileData.length,
        isMultiple: fileChooser.isMultiple,
        fileData: fileData.length > 0 ? fileData : undefined,
      },
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
      files?: UserAction['files'];
      /** Browser-side hover enrichment (async-sampled popups). */
      hoverContext?: UserAction['hoverContext'];
      /** For type='drag' — pointer-drag coordinates (fromX/fromY/toX/toY). */
      drag?: UserAction['drag'];
      /** For type='popup_appear' — proactive sensing payload. */
      popupAppear?: UserAction['popupAppear'];
      /** For type='discovered_filters' — proactive baseline scan. */
      discoveredFilters?: DiscoveredFilter[];
    }

    let pending: PendingAction[] = [];
    try {
      pending = await page.evaluate(`(function() {
        var w = window;
        // Flush-time sweep: if there is a hover action still being enriched
        // by async samplers, force one last capture so its hoverContext lands
        // before the action is drained from the pending queue.
        try {
          if (typeof w.__xb_capture_hover_popups === 'function') {
            w.__xb_capture_hover_popups();
          }
        } catch(e) {}
        var actions = w.__xb_pending_actions || [];
        w.__xb_pending_actions = [];

        // Recursively flush pending actions from same-origin iframes (including nested)
        function flushIframes(doc) {
          try {
            var iframes = doc.querySelectorAll('iframe');
            for (var i = 0; i < iframes.length; i++) {
              try {
                var iframeWin = iframes[i].contentWindow;
                if (!iframeWin) continue;
                // Ensure action script is injected into iframe
                if (!iframeWin.__xb_action_script_injected) {
                  iframeWin.__xb_action_script_injected = true;
                  try { delete iframeWin.__xb_action_signal; } catch(e) {}
                  try { iframeWin.eval(w.__xb_action_script_src); } catch(e) {}
                }
                var iframeActions = iframeWin.__xb_pending_actions;
                if (Array.isArray(iframeActions) && iframeActions.length > 0) {
                  // Get iframe position to offset coordinates
                  var rect = iframes[i].getBoundingClientRect();
                  for (var j = 0; j < iframeActions.length; j++) {
                    var act = iframeActions[j];
                    // Offset coordinates from iframe-relative to page-relative
                    if (act.x != null) act.x = act.x + rect.left;
                    if (act.y != null) act.y = act.y + rect.top;
                    // Tag the action as originating from an iframe
                    act.iframeSrc = iframes[i].src || '';
                    actions.push(act);
                  }
                  iframeWin.__xb_pending_actions = [];
                }
                // Recurse into nested iframes
                try { flushIframes(iframeWin.document); } catch(e) {}
              } catch(e) {}
            }
          } catch(e) {}
        }

        flushIframes(document);
        return actions;
      })()`) as PendingAction[];
    } catch {
      return;
    }

    // Detect URL changes (fallback for CDP mode where framenavigated may not fire)
    try {
      const currentUrl = page.url();
      // Normalize: strip trailing slash for comparison
      const normalize = (u: string) => u.replace(/\/+$/, '');
      if (currentUrl && currentUrl !== 'about:blank' && normalize(currentUrl) !== normalize(this.lastKnownUrl)) {
        // Check if we already have a recent navigation/goto to this URL
        const hasNav = this.actions.slice(-3).some(a =>
          (a.type === 'navigation' || a.type === 'goto') && normalize(a.url || '') === normalize(currentUrl)
        );
        if (!hasNav) {
          this.actionCounter++;
          this.actions.push({
            id: this.actionCounter,
            type: 'navigation',
            timestamp: Date.now(),
            url: currentUrl,
            pageTitle: '',
            element: undefined,
          });
        }
        this.lastKnownUrl = currentUrl;
        // SPA route change: trigger proactive baseline scan so the new page's
        // filter/sort regions are discovered without user action.
        try {
          page.evaluate(`(function() {
            if (typeof window.__xb_scanFilters === 'function') {
              setTimeout(window.__xb_scanFilters, 500);
            }
          })()`).catch(() => {});
        } catch { /* non-critical */ }
      }
    } catch { /* page may have closed */ }

    for (const raw of pending) {
      if (raw.ts <= this.lastActionTs) continue;

      // ── Proactive sensing actions: handle separately, not as user actions ──
      if (raw.type === 'discovered_filters') {
        // Merge into this.discoveredFilters (keyed by containerSelector for dedup).
        // Replaces any prior entry for the same container so re-scans update state.
        if (Array.isArray(raw.discoveredFilters)) {
          for (const f of raw.discoveredFilters) {
            if (f && f.containerSelector) {
              // Merge trigger-level updates: preserve userInteracted/explored
              // flags from previous scans (the browser-side map is the source
              // of truth, but if it reset we don't want to lose flags).
              const existing = this.discoveredFilters.get(f.containerSelector);
              if (existing) {
                for (const newT of f.triggers) {
                  const oldT = existing.triggers.find(t => t.selector === newT.selector);
                  if (oldT) {
                    newT.userInteracted = newT.userInteracted || oldT.userInteracted;
                    newT.explored = newT.explored || oldT.explored;
                    newT.hasPopup = newT.hasPopup || oldT.hasPopup;
                  }
                }
              }
              this.discoveredFilters.set(f.containerSelector, f);
            }
          }
        }
        continue;  // Don't add to actions stream
      }

	      if (raw.type === 'popup_appear') {
	        // Only keep user-triggered popups (hover/click), filter auto-detected
	        if (!raw.popupAppear?.userTriggered) continue;

	        // Push as a UserAction (with popupAppear payload) — keeps temporal
	        // ordering with user actions so AI can correlate popups with clicks.
	        this.actionCounter++;
	        const pushed: UserAction = {
	          id: this.actionCounter,
	          type: 'popup_appear',
	          timestamp: raw.ts,
	          url: raw.url || page.url(),
	          pageTitle: raw.title || '',
	          popupAppear: raw.popupAppear,
	        };
	        this.actions.push(pushed);

	        // Capture snapshot of the popup state
	        await captureAutoSnapshot(page, pushed, 'after', this.snapshotsDir, this.snapshotThrottle).catch(() => {});

	        this.lastActionTs = raw.ts;
	        continue;
	      }

      // Dedup: skip only when the matching entry was set by an injected CDP
      // COMMAND (the signal is the real-event echo of that command).
      // Signal-vs-signal entries never dedup: two real clicks on the same
      // element (e.g. canvas buttons) are distinct interactions (rec-duel d05).
      const dedupFromSignal = this.dedupKey(raw.type, raw.element?.selector, raw.element?.tag, raw.value);
      if (dedupFromSignal) {
        const entry = this.dedupMap.get(dedupFromSignal);
        if (entry && entry.origin === 'command' && Date.now() < entry.expires) {
          continue; // Skip duplicate action signal
        }
      }

	      // Denoise: filter ambient actions in clean mode.
	      // - Hover: only keep if it triggered a substantial popup (has items)
	      //   or the same element was clicked within 1.5s (handled below).
	      // - Scroll: skip micro-scrolls (< 50px).
	      if (this.streamMode === 'clean'
	          && SessionRecorder.AMBIENT_TYPES.has(raw.type as string)) {
	        if (raw.type === 'hover') {
	          const hc = raw.hoverContext;
	          if (!hc || hc.appeared.length === 0) continue;
	          // Only keep hover if the popup has at least one interactive menu item
	          // (dialog/menu with items → meaningful; tooltip without items → noise)
	          const hasSubstantialPopup = hc.appeared.some(p => p.items && p.items.length > 0);
	          if (!hasSubstantialPopup) continue;
	        } else if (raw.type === 'scroll') {
	          // Skip micro-scrolls (< 50px total distance)
	          const dx = raw.scrollX || 0;
	          const dy = raw.scrollY || 0;
	          const dist = Math.sqrt(dx * dx + dy * dy);
	          if (dist < 50) continue;
	        } else {
	          continue; // Other ambient types → skip
	        }
	      }

      this.actionCounter++;

      // For click actions, capture popover/dropdown context after a delay
      let clickContext: ClickContext | undefined;
      if (raw.type === 'click' && raw.x !== undefined && raw.y !== undefined) {
        clickContext = await captureClickContext(page, raw.x, raw.y);
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
        // Browser-side hover enrichment writes hoverContext onto the pending
        // action asynchronously (200/500/1000ms after mouseover). Flush may
        // run before the last sample lands — passthrough keeps whatever has
        // been collected so far.
        hoverContext: raw.hoverContext,
        files: raw.files,
        // Pointer-drag payload (fromX/fromY/toX/toY) — replayer replays the
        // drag from these coordinates; dropping it made drags no-ops (d08)
        drag: raw.drag,
      });

	      // Capture element screenshot for key action types (non-critical)
	      const pushed = this.actions[this.actions.length - 1];
	      pushed.elementScreenshot = await captureElementScreenshot(page, raw);

	      // Capture auto-snapshot (viewport + accessibility tree) after key actions
	      await captureAutoSnapshot(page, pushed, 'after', this.snapshotsDir, this.snapshotThrottle).catch(() => {});

	      this.lastActionTs = raw.ts;
      // Set dedupMap entry for reverse dedup (action signal → CDP command dedup)
	      const dedupKey = this.dedupKey(raw.type, raw.element?.selector, raw.element?.tag, raw.value);
	      if (dedupKey) {
	        this.dedupMap.set(dedupKey, { expires: Date.now() + 4000, origin: 'signal' }); // 4s: stealth click delays event ~3s
	        this.dedupActionCount++;
	      }

	      // Verify: collect success signals for key action types
	      const verifyTypes = new Set(['click', 'submit', 'input', 'change', 'cdp-click', 'cdp-fill']);
		      if (verifyTypes.has(raw.type as string)) {
		        const signals = await verifyAction(page, pushed, this.networkCapture.entries, this.checkpoints).catch(() => [] as ActionSignal[]);
		        if (signals.length > 0) {
		          (pushed as unknown as { __signals?: ActionSignal[] }).__signals = signals;
		        }
		      }

		      if (raw.type === 'click' || raw.type === 'navigate' || raw.type === 'submit') {
        const detected = await detectCheckpoints(page, () => ++this.checkpointCounter);
        for (const cp of detected) {
          cp.relatedActionId = this.actionCounter;
          this.checkpoints.push(cp);
        }
      }
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
      // Append-only JSONL: one action per line, easy to grep / sed
      const jsonlPath = join(this.recordingsDir, 'recording.jsonl');
      const lines = data.actions.map(a => JSON.stringify(a)).join('\n') + '\n';
      writeFileSync(jsonlPath, lines, 'utf-8');
    } catch { /* best effort */ }
  }

  private writeFinalOutput(data: RecordingData, summary: RecordingSummary): void {
    mkdirSync(this.recordingsDir, { recursive: true });
    writeFileSync(join(this.recordingsDir, 'recording.json'), JSON.stringify(data, null, 2), 'utf-8');
    // Write final JSONL (one action per line)
    const jsonlPath = join(this.recordingsDir, 'recording.jsonl');
    const lines = data.actions.map(a => JSON.stringify(a)).join('\n') + '\n';
    writeFileSync(jsonlPath, lines, 'utf-8');
    writeFileSync(join(this.recordingsDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
    writeFileSync(join(this.recordingsDir, 'summary.md'), buildMarkdownSummary(data, summary), 'utf-8');
  }

  private buildData(): RecordingData {
    return {
      startUrl: this.startUrl,
      sessionName: this.sessionName,
      startedAt: new Date(this.startedAt).toISOString(),
      actions: [...this.actions],
      network: [...this.networkCapture.entries],
      contextChanges: [...this.contextChanges],
      checkpoints: [...this.checkpoints],
      discoveredFilters: [...this.discoveredFilters.values()],
    };
  }

}
