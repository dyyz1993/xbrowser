/**
 * RPC method handlers for the daemon HTTP server.
 *
 * Each method is a separate handler function, grouped by domain.
 * This replaces the giant switch/case in the old daemon-worker.ts.
 */
import { errMsg } from '../utils/error.js';
import { readFileSync } from 'fs';

import type { RPCHandler } from '@dyyz1993/xcli-core';
import {
  createSessionMeta,
  removeSession,
} from '@dyyz1993/xcli-core';

import {
  createSession,
  findSession,
  closeSessionByName,
  getAllSessions,
  saveSessionDiskMeta,
} from '../browser.js';
import { executeCommand, executeChain } from '../executor.js';
import { queryJS } from '../cdp-driver/selector-utils.js';
import { networkStore, commandLogStore } from './network-store.js';
import { scoreEntries } from './network-scorer.js';
import { enrichEntries } from './api-analyzer.js';
import { generateCurl, replayEntry } from './curl-generator.js';
import type { CurlOptions } from './curl-generator.js';
import { feedbackStore } from './feedback-store.js';
import { exportEntry } from './code-export.js';
import type { ExportLang } from './code-export.js';
import { WSServer } from '../websocket-server.js';
import { SessionRecorder } from '../recorder/session-recorder.js';
import type { RecordingSummary, CheckpointEntry, UserAction } from '../recorder/session-recorder.js';
import { PlaybackEngine } from '../recorder/player.js';
import type { PlaybackResult } from '../recorder/player.js';
import { resolveCDPEndpoint } from '../utils/cdp.js';
import { getPluginStorage } from '../executor.js';
import { attachDetectAntiBot } from '../context.js';
import { checkPluginLoginRequired } from '../plugin/login-guard.js';
import { TipCollector } from '@dyyz1993/xcli-core';
import { getPluginLoader as getPluginLoaderSingleton } from '../utils/plugin-singleton.js';

const activeRecorders = new Map<string, SessionRecorder>();
const replayResumeResolvers = new Map<string, () => void>();

export function createRPCHandler(): RPCHandler & {
  setPreviewWS: (ws: WSServer) => void;
  handleReconnect: (sessionId: string) => Promise<void>;
} {
  let previewWS: WSServer | null = null;
  const INTERACTION_COMMANDS = new Set([
    'click', 'fill', 'type', 'press', 'select', 'check', 'hover', 'dblclick', 'scroll',
  ]);

  const handler: RPCHandler & {
    setPreviewWS: (ws: WSServer) => void;
    handleReconnect: (sessionId: string) => Promise<void>;
  } = Object.assign(
    async (method: string, params: Record<string, unknown>): Promise<unknown> => {
      switch (method) {
        // ── Session management ──
        case 'session:create':
          return handleSessionCreate(params);
        case 'session:close':
          return handleSessionClose(params);
        case 'session:list':
          return handleSessionList();

        // ── Command execution ──
        case 'exec':
          return handleExec(params);
        case 'plugin:exec':
          return handlePluginExec(params);
        case 'chain':
          return handleChain(params);
        case 'agent:observe':
          return handleAgentObserve(params);
        case 'agent:act':
          return handleAgentAct(params);
        case 'agent:wait':
          return handleAgentWait(params);

        // ── Utility ──
        case 'ping':
          return { ok: true, pid: process.pid };
        case 'plugins:reload':
          return handlePluginsReload();

        // ── Network analysis ──
        case 'network:list':
          return handleNetworkList(params);
        case 'network:inspect':
          return handleNetworkInspect(params);
        case 'network:clear':
          return handleNetworkClear(params);
        case 'network:top':
          return handleNetworkTop(params);
        case 'network:around':
          return handleNetworkAround(params);
        case 'network:analyze':
          return handleNetworkAnalyze(params);
        case 'network:curl':
          return handleNetworkCurl(params);
        case 'network:replay':
          return handleNetworkReplay(params);
        case 'network:like':
          return handleNetworkLike(params);
        case 'network:dislike':
          return handleNetworkDislike(params);
        case 'network:feedback':
          return handleNetworkFeedback(params);
        case 'network:export':
          return handleNetworkExport(params);

        // ── Command log ──
        case 'command:log':
          return handleCommandLog(params);

        // ── Session recording ──
        case 'record:start':
          return handleRecordStart(params);
        case 'record:stop':
          return handleRecordStop(params);
        case 'record:status':
          return handleRecordStatus(params);
        case 'record:summary':
          return handleRecordSummary(params);

        case 'record:checkpoint':
          return handleRecordCheckpoint(params);

        case 'replay':
          return handleReplay(params);

        case 'replay:resume':
          return handleReplayResume(params);

        case 'viewer:check-selector':
          return handleViewerCheckSelector(params);

        default:
          throw new Error(`Unknown method: ${method}`);
      }
    },
    {
      setPreviewWS(ws: WSServer) {
        previewWS = ws;
      },
      async handleReconnect(sessionId: string) {
        if (previewWS) {
          await previewWS.reconnectSession(sessionId);
        }
      },
    },
  );

  return handler;

  async function handlePluginExec(params: Record<string, unknown>) {
    // params.command = "devto.draft" (site.command format)
    const command = params.command as string;
    const cmdParams = (params.params || {}) as Record<string, unknown>;
    const sessionName = (params.session as string) || 'default';
    const cdp = params.cdpEndpoint as string | undefined;

    // Split "devto.draft" → plugin name "devto", sub-command "draft"
    const dotIdx = command.indexOf('.');
    if (dotIdx < 0) {
      return { success: false, data: null, message: `Invalid plugin command format: ${command}` };
    }
    const pluginName = command.substring(0, dotIdx);
    const subCommand = command.substring(dotIdx + 1);

    // Find plugin and command
    const loader = await getPluginLoaderSingleton();
    const site = loader.getCore().loader.getSite(pluginName);
    if (!site) {
      return { success: false, data: null, message: `Plugin "${pluginName}" not found` };
    }
    const cmdEntry = site.getCommand(subCommand);
    if (!cmdEntry) {
      return { success: false, data: null, message: `Unknown command "${subCommand}" for plugin "${pluginName}"` };
    }

    const needsBrowser = cmdEntry.scope === 'page' || cmdEntry.scope === 'browser';

    // Find or create session in the daemon (same as built-in commands)
    let session: import('../browser.js').ManagedSession | undefined;
    if (needsBrowser) {
      session = findSession(sessionName);
      if (!session) {
        let endpoint: string | undefined;
        if (cdp) {
          try { endpoint = await resolveCDPEndpoint(cdp); } catch { endpoint = cdp; }
        } else {
          try { endpoint = await resolveCDPEndpoint('auto'); } catch { endpoint = undefined; }
        }
        session = await createSession(sessionName, undefined, endpoint ? { cdpEndpoint: endpoint } : {});
        console.log(`[PLUGIN] Created session "${sessionName}" for plugin "${pluginName}.${subCommand}"`);
      }
    }

    // Build plugin context (mirrors router.ts plugin context construction)
    const ctx = {
      args: [],
      options: {},
      cwd: process.cwd(),
      page: needsBrowser ? session!.page : null,
      browser: needsBrowser ? session!.context.browser()! : null,
      browserContext: needsBrowser ? session!.context : null,
      sessionId: needsBrowser ? session!.id : '',
      cdpEndpoint: cdp || (needsBrowser ? session?.cdpEndpoint : undefined),
      storage: getPluginStorage(pluginName),
      output: { mode: 'text' as const, showTips: true, color: true, emoji: true },
      error: (msg: string) => { throw new Error(msg); },
      config: {},
      site,
      cliName: 'xbrowser',
      waitForHuman: async () => { return { solved: false, timedOut: true }; },
      tips: new TipCollector(),
    };

    attachDetectAntiBot(ctx);

    // Check login requirement
    const loginGuard = await checkPluginLoginRequired({
      site,
      command: cmdEntry,
      commandName: subCommand,
      ctx,
      page: needsBrowser ? session?.page : null,
      sessionName,
    });
    if (!loginGuard.ok) {
      return { success: false, data: loginGuard.data ?? null, message: loginGuard.message };
    }

    // Execute plugin handler
    try {
      const result = await cmdEntry.handler(cmdParams, ctx);
      return result;
    } catch (err) {
      const errorMessage = errMsg(err);
      const { attemptRecovery } = await import('../recovery.js');
      const recovery = await attemptRecovery(
        session?.page,
        sessionName,
        `${pluginName}.${subCommand}`,
        errorMessage,
        previewWS,
      );
      if (recovery.recovered) {
        try {
          const retryResult = await cmdEntry.handler(cmdParams, ctx);
          return retryResult;
        } catch (retryErr) {
          return { success: false, data: null, message: `Retry failed: ${errMsg(retryErr)}` };
        }
      }
      return { success: false, data: null, message: errorMessage };
    }
  }

  // ─── Handler implementations ─────────────────────────────────

  function registerSessionIfNew(sessionName: string) {
    if (!previewWS) return;
    const session = findSession(sessionName);
    if (session) {
      previewWS.registerSession(session.name, session.page);
    }
  }

  async function handleSessionCreate(params: Record<string, unknown>) {
    const name = (params.name as string) || 'default';
    const cdp = params.cdpEndpoint as string;
    const url = params.url as string | undefined;
    let session;

    // Reuse existing session with the same name — don't create a new page/tab.
    // Each CLI command used to create a fresh session, which opened a new tab
    // in the user's browser every time. Now we find and return the existing
    // session so the same tab is reused across commands.
    const existing = findSession(name);
    if (existing) {
      // Navigate to URL if provided (only if different from current)
      if (url && existing.page.url() !== url) {
        await existing.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      }
      saveSessionDiskMeta(name, {
        id: existing.id,
        name: existing.name,
        url: existing.page.url(),
        createdAt: existing.createdAt,
        cdpEndpoint: existing.cdpEndpoint,
      });
      if (previewWS) previewWS.registerSession(existing.name, existing.page);
      return existing.id;
    }

    if (cdp) {
      const endpoint = await resolveCDPEndpoint(cdp);
      session = await createSession(name, url, { cdpEndpoint: endpoint });
    } else {
      // Try auto-discovered CDP first, fallback to self-launched Chromium
      let autoEndpoint: string | undefined;
      try {
        autoEndpoint = await resolveCDPEndpoint('auto');
        session = await createSession(name, url, { cdpEndpoint: autoEndpoint });
        // Verify the connection works by navigating to the URL
        if (url) {
          try {
            await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 8000 });
          } catch {
            // Navigation failed on CDP tunnel — fallback
            try { await closeSessionByName(name); } catch { /* ignore */ }
            session = await createSession(name, url);
          }
        }
      } catch {
        session = await createSession(name, url);
      }
    }
    if (previewWS) previewWS.registerSession(session.name, session.page);
    saveSessionDiskMeta(name, {
      id: session.id,
      name: session.name,
      url: session.page.url(),
      createdAt: session.createdAt,
      cdpEndpoint: session.cdpEndpoint,
    });
    // Also register in xcli-core session store for metadata queries
    createSessionMeta(name, {
      id: session.id,
      url: session.page.url(),
      createdAt: session.createdAt,
      cdpEndpoint: session.cdpEndpoint,
    });
    return { id: session.id, name: session.name, url: session.page.url() };
  }

  async function handleSessionClose(params: Record<string, unknown>) {
    const name = params.name as string;
    if (previewWS) previewWS.unregisterSession(name);
    await closeSessionByName(name);
    removeSession(name);
    return { ok: true };
  }

  function handleSessionList() {
    return getAllSessions().map((s) => ({
      id: s.id,
      name: s.name,
      url: s.page?.url() ?? null,
      createdAt: s.createdAt,
    }));
  }

  async function handleExec(params: Record<string, unknown>) {
    const command = params.command as string;
    const cmdParams = (params.params || {}) as Record<string, unknown>;
    const sessionName = (params.session as string) || 'default';
    const cdp = params.cdpEndpoint as string | undefined;
    const existingSession = findSession(sessionName);
    let endpoint: string | undefined;
    if (cdp) {
      try { endpoint = await resolveCDPEndpoint(cdp); } catch { endpoint = cdp; }
    } else if (existingSession?.cdpEndpoint) {
      endpoint = existingSession.cdpEndpoint;
    } else {
      try { endpoint = await resolveCDPEndpoint('auto'); } catch { endpoint = undefined; }
    }
    commandLogStore.add(sessionName, {
      timestamp: Date.now(),
      command,
      params: cmdParams,
      session: sessionName,
    });
    const needsPause = INTERACTION_COMMANDS.has(command) && !!previewWS;
    if (needsPause) await previewWS!.pauseScreencast(sessionName);

    // Capture URL BEFORE executing command (page may navigate during click)
    let urlBeforeCommand: string | undefined;
    // Describe the target element BEFORE executing: for pages that mutate the DOM
    // on click (rebirth pattern), a post-execution describe resolves to the
    // replacement element, producing wrong selectors and broken dedup (rec-duel d03).
    // Deep describe (iframe + shadow piercing) so the command-side selector
    // CONVERGES with the signal-side __xb_describe selector — mismatched keys
    // broke dedup and double-executed on replay (rec-duel d04/d06).
    let preElement: Record<string, unknown> | undefined;
    try {
      const session = findSession(sessionName);
      urlBeforeCommand = session?.page?.url();
      const sel = (cmdParams.selector as string) || (cmdParams.css as string);
      if (session?.page && sel && INTERACTION_COMMANDS.has(command)) {
        preElement = await session.page.evaluate(`
          (function() {
            const el = ${queryJS(sel)};
            if (!el || typeof window.__xb_describe !== 'function') return null;
            return window.__xb_describe(el);
          })()
        `) as Record<string, unknown> | undefined;
      }
    } catch { /* ignore */ }

    try {
      const result = await executeCommand(command, cmdParams, sessionName, { cdpEndpoint: endpoint });
      registerSessionIfNew(sessionName);
      // Inject CDP command into active recorder if recording
      await injectCommandToRecorder(sessionName, command, cmdParams, urlBeforeCommand, preElement);
      return result;
    } finally {
      if (needsPause) await previewWS!.resumeScreencast(sessionName).catch(() => { });
    }
  }

  async function handleChain(params: Record<string, unknown>) {
    const input = params.chain as string;
    const sessionName = (params.session as string) || 'default';
    const cdp = params.cdpEndpoint as string | undefined;
    const result = await executeChain(input, { cdpEndpoint: cdp, sessionName });
    registerSessionIfNew(sessionName);
    return result;
  }

  async function handlePluginsReload(): Promise<{ ok: boolean; plugins: number }> {
    const { resetPluginLoader } = await import('../utils/plugin-singleton.js');
    resetPluginLoader();
    const loader = await import('../utils/plugin-singleton.js').then(m => m.getPluginLoader());
    const sites = loader.getCore().loader.getSites();
    return { ok: true, plugins: sites.length };
  }

  async function handleAgentObserve(params: Record<string, unknown>) {
    const sessionName = (params.session as string) || 'default';
    const commandParams = {
      includeHidden: !!params.includeHidden,
      ...(typeof params.limit === 'number' ? { limit: params.limit } : {}),
    };
    const result = await executeCommand('observe', commandParams, sessionName, {
      cdpEndpoint: params.cdpEndpoint as string | undefined,
    });
    registerSessionIfNew(sessionName);
    return result;
  }

  async function handleAgentAct(params: Record<string, unknown>) {
    const sessionName = (params.session as string) || 'default';
    const commandParams: Record<string, unknown> = {
      action: params.action || 'click',
      force: !!params.force,
    };
    for (const key of ['ref', 'selector', 'value', 'key', 'timeout']) {
      if (params[key] !== undefined) commandParams[key] = params[key];
    }
    const result = await executeCommand('act', commandParams, sessionName, {
      cdpEndpoint: params.cdpEndpoint as string | undefined,
    });
    registerSessionIfNew(sessionName);
    return result;
  }

  async function handleAgentWait(params: Record<string, unknown>) {
    const sessionName = (params.session as string) || 'default';
    const commandParams: Record<string, unknown> = {};
    for (const key of ['selector', 'state', 'text', 'url', 'load', 'fn', 'screenHashChanged', 'timeout', 'pollInterval']) {
      if (params[key] !== undefined) commandParams[key] = params[key];
    }
    const result = await executeCommand('waitFor', commandParams, sessionName, {
      cdpEndpoint: params.cdpEndpoint as string | undefined,
    });
    registerSessionIfNew(sessionName);
    return result;
  }

  function handleNetworkList(params: Record<string, unknown>) {
    const sessionName = (params.session as string) || 'default';
    const opts: { filter?: string; method?: string; limit?: number; offset?: number } = {};
    if (params.filter) opts.filter = params.filter as string;
    if (params.method) opts.method = params.method as string;
    if (params.limit) opts.limit = params.limit as number;
    if (params.offset) opts.offset = params.offset as number;
    return networkStore.list(sessionName, opts);
  }

  function handleNetworkInspect(params: Record<string, unknown>) {
    const sessionName = (params.session as string) || 'default';
    const id = params.id as number;
    return networkStore.inspect(sessionName, id);
  }

  function handleNetworkClear(params: Record<string, unknown>) {
    const sessionName = (params.session as string) || 'default';
    networkStore.clear(sessionName);
    return { ok: true };
  }

  function handleNetworkTop(params: Record<string, unknown>) {
    const sessionName = (params.session as string) || 'default';
    const opts: { minScore?: number; limit?: number } = {};
    if (params.minScore) opts.minScore = params.minScore as number;
    if (params.limit) opts.limit = params.limit as number;
    const feedbackFn = (path: string, method: string) => feedbackStore.getScoreAdjustment(path, method);
    return networkStore.top(sessionName, { ...opts, feedbackFn });
  }

  function handleNetworkAround(params: Record<string, unknown>) {
    const sessionName = (params.session as string) || 'default';
    const commandId = params.commandId as number;
    const windowMs = (params.window as number) || 5000;
    return networkStore.around(sessionName, commandId, commandLogStore, windowMs);
  }

  function handleNetworkAnalyze(params: Record<string, unknown>) {
    const sessionName = (params.session as string) || 'default';
    const entries = networkStore.list(sessionName, { limit: 1000 }).captures;
    const scored = scoreEntries(entries);
    const analyzed = enrichEntries(scored);
    return { session: sessionName, total: entries.length, analyzed };
  }

  function extractCurlOptions(params: Record<string, unknown>): CurlOptions {
    return {
      includeHeaders: params.includeHeaders as boolean | undefined,
      includeBody: params.includeBody as boolean | undefined,
      compressed: params.compressed as boolean | undefined,
      insecure: params.insecure as boolean | undefined,
    };
  }

  function handleNetworkCurl(params: Record<string, unknown>) {
    const sessionName = (params.session as string) || 'default';
    const id = params.id as number;
    const entry = networkStore.inspect(sessionName, id);
    if (!entry.capture) return { error: `Entry #${id} not found` };
    return generateCurl(entry.capture, extractCurlOptions(params));
  }

  async function handleNetworkReplay(params: Record<string, unknown>) {
    const sessionName = (params.session as string) || 'default';
    const id = params.id as number;
    const entry = networkStore.inspect(sessionName, id);
    if (!entry.capture) return { error: `Entry #${id} not found` };
    return await replayEntry(entry.capture, extractCurlOptions(params));
  }

  function handleNetworkLike(params: Record<string, unknown>) {
    const sessionName = (params.session as string) || 'default';
    const id = params.id as number;
    const entry = networkStore.inspect(sessionName, id);
    if (!entry.capture) return { error: `Entry #${id} not found` };
    feedbackStore.add(entry.capture, 'like');
    return { ok: true, id, feedback: 'like' };
  }

  function handleNetworkDislike(params: Record<string, unknown>) {
    const sessionName = (params.session as string) || 'default';
    const id = params.id as number;
    const entry = networkStore.inspect(sessionName, id);
    if (!entry.capture) return { error: `Entry #${id} not found` };
    feedbackStore.add(entry.capture, 'dislike');
    return { ok: true, id, feedback: 'dislike' };
  }

  function handleNetworkFeedback(params: Record<string, unknown>) {
    return { feedback: feedbackStore.list({ limit: params.limit as number | undefined }) };
  }

  function handleNetworkExport(params: Record<string, unknown>) {
    const sessionName = (params.session as string) || 'default';
    const id = params.id as number;
    const lang = (params.lang as ExportLang) || 'ts';
    const entry = networkStore.inspect(sessionName, id);
    if (!entry.capture) return { error: `Entry #${id} not found` };
    return exportEntry(entry.capture, lang);
  }

  function handleCommandLog(params: Record<string, unknown>) {
    const sessionName = (params.session as string) || 'default';
    const limit = (params.limit as number) || 50;
    return { session: sessionName, commands: commandLogStore.list(sessionName, { limit }) };
  }

  /** Inject CDP command execution into active recorder as a synthetic action */
  async function injectCommandToRecorder(sessionName: string, command: string, params: Record<string, unknown>, urlBeforeCommand?: string, preElement?: Record<string, unknown>): Promise<void> {
    const recorder = activeRecorders.get(sessionName);
    if (!recorder) return;

    const COMMAND_ACTION_MAP: Record<string, string> = {
      goto: 'goto',
      fill: 'cdp-fill',
      click: 'cdp-click',
      type: 'input',
      select: 'change',
      scroll: 'scroll',
    };
    const actionType = COMMAND_ACTION_MAP[command];
    if (!actionType) return;

    const selector = (params.selector as string) || (params.css as string);
    // type 命令的参数名是 text；contenteditable 场景 CDP 键盘输入不触发 input
    // 事件（信号侧无值），命令注入是唯一值来源，必须捕获（rec-duel d10）
    let value: string | undefined = (params.value as string) || (params.expression as string);
    if (value === undefined || value === '') {
      value = params.text as string | undefined;
    }
    // scroll 命令：把方向+距离编码进 value，回放端解码执行
    if (command === 'scroll') {
      const dir = (params.direction as string) || 'down';
      const dist = (params.distance as number) ?? 300;
      value = `${dir}:${dist}`;
    }

    // Capture currentUrl: for goto use params.url (target), for others use page URL before command
    let currentUrl = (params.url as string | undefined) || urlBeforeCommand;
    // For click/fill/type commands, prefer the page URL at the time of the action
    if (command !== 'goto' && urlBeforeCommand && urlBeforeCommand !== 'about:blank') {
      currentUrl = urlBeforeCommand;
    }

    // Element metadata: prefer pre-execution describe (correct target even if the
    // click mutates the DOM); fall back to post-execution deep describe
    let element: Record<string, unknown> | undefined = preElement;
    if (!element && selector) {
      try {
        const session = findSession(sessionName);
        if (session?.page) {
          element = await session.page.evaluate(`
            (function() {
              const el = ${queryJS(selector)};
              if (!el || typeof window.__xb_describe !== 'function') return null;
              return window.__xb_describe(el);
            })()
          `) as Record<string, unknown> | undefined;
        }
      } catch { /* page may have navigated or closed */ }
    }

	    await recorder.recordCommandAction({
	      type: actionType,
	      // Prefer the described unique selector so the dedup key matches the
	      // real action signal's key (which uses element.selector). The raw
	      // command selector (e.g. "button") never equals the generated unique
	      // selector, so dedup silently failed before (rec-duel d02/d03).
	      selector: (element?.selector as string | undefined) || selector,
	      value,
	      url: currentUrl,
	      element: element as UserAction['element'],
	    });
  }

  // ─── Session recording handlers (daemon-managed) ─────────────────

  async function handleRecordStart(params: Record<string, unknown>) {
    const sessionName = (params.session as string) || 'default';
    const url = params.url as string | undefined;
    const cdpEndpoint = params.cdpEndpoint as string | undefined;
    const stream = (params.stream as string) || 'clean';

    if (activeRecorders.has(sessionName)) {
      return { ok: false, error: 'Recording already in progress for session: ' + sessionName };
    }

    let session = findSession(sessionName);
    if (!session) {
      if (!url) {
        return { ok: false, error: 'Session not found: ' + sessionName + '. Provide --url to auto-create.' };
      }
      try {
        // Use CDP endpoint if provided, otherwise self-launch Chromium
        const sessionOpts = cdpEndpoint ? { cdpEndpoint } : undefined;
        session = await createSession(sessionName, url, sessionOpts);
        if (previewWS) previewWS.registerSession(session.name, session.page);
        saveSessionDiskMeta(sessionName, {
          id: session.id,
          name: session.name,
          url: session.page.url(),
          createdAt: session.createdAt,
          cdpEndpoint: session.cdpEndpoint,
        });
        createSessionMeta(sessionName, {
          id: session.id,
          url: session.page.url(),
          createdAt: session.createdAt,
          cdpEndpoint: session.cdpEndpoint,
        });
      } catch (e) {
        return { ok: false, error: 'Failed to auto-create session: ' + errMsg(e) };
      }
    }

    try {
      const recorder = new SessionRecorder(session.context, session.page, sessionName);
      // If the caller explicitly passed --url, navigate to it FIRST. This
      // ensures the recorded page is in the expected state (e.g. fresh
      // search results) rather than whatever the existing tab happens to
      // show — otherwise recording silently captures the wrong tab.
      if (url) {
        try {
          await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch {
          // Navigation may fail for legit reasons (e.g. cross-origin redirect);
          // continue anyway — injection will still happen.
        }
        // Give the page a moment to settle before injecting the recorder
        // script, otherwise the SPA may not have rendered the target UI.
        await new Promise(r => setTimeout(r, 1500));
      }
      await recorder.start(url, { stream: stream as 'clean' | 'raw' });
      // Surface injection failure as a hard error — otherwise the user sees
      // "Recording started" while no actions are actually being captured,
      // which is the worst kind of silent failure.
      if (recorder.injectionFailed) {
        await recorder.stop();
        activeRecorders.delete(sessionName);
        return {
          ok: false,
          error: 'Action signal script injection failed — user actions will NOT be recorded. This usually means the page sandbox blocked Runtime.evaluate, or the injected script has a syntax error. Check the daemon log for details.',
          hint: 'Try: 1) reload the target page in Chrome, 2) restart daemon, 3) check daemon log for the specific error.',
        };
      }
      activeRecorders.set(sessionName, recorder);
      return { ok: true, session: sessionName, startUrl: url || session.page.url() };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  }

  async function handleRecordStop(params: Record<string, unknown>) {
    const sessionName = (params.session as string) || 'default';
    const outputPath = params.output as string | undefined;
    const recorder = activeRecorders.get(sessionName);

    if (!recorder) {
      const existingData = SessionRecorder.readData(sessionName);
      if (existingData) {
        // Copy existing recording to output path if specified
        if (outputPath) {
          const { writeFileSync } = await import('node:fs');
          writeFileSync(outputPath, JSON.stringify(existingData, null, 2), 'utf-8');
        }
        return {
          ok: true,
          message: 'Recorder process already exited. Recording data found on disk.',
          output: outputPath,
          session: sessionName,
          actions: existingData.actions.length,
          network: existingData.network.length,
        };
      }
      return { ok: false, error: 'No active recording found for session: ' + sessionName };
    }

    try {
      const { data, summary } = await recorder.stop();
      activeRecorders.delete(sessionName);

      // Write to user-specified output path if provided
      if (outputPath) {
        const { writeFileSync, mkdirSync } = await import('node:fs');
        const { dirname } = await import('node:path');
        mkdirSync(dirname(outputPath), { recursive: true });
        // If output ends with .yaml/.yml, write YAML; otherwise JSON
        if (outputPath.endsWith('.yaml') || outputPath.endsWith('.yml')) {
          const yaml = (await import('yaml')).default;
          writeFileSync(outputPath, yaml.stringify(data), 'utf-8');
        } else {
          writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
        }
      }

      return {
        ok: true,
        output: outputPath,
        session: sessionName,
        actions: data.actions.length,
        network: data.network.length,
        durationMs: summary.durationMs,
        steps: summary.steps.length,
      };
    } catch (e) {
      activeRecorders.delete(sessionName);
      return { ok: false, error: errMsg(e) };
    }
  }

  function handleRecordStatus(params: Record<string, unknown>) {
    const sessionName = (params.session as string) || 'default';
    const recorder = activeRecorders.get(sessionName);

    if (recorder && recorder.isRecording) {
      return {
        recording: true,
        session: sessionName,
        actions: recorder.actionCount,
        network: recorder.networkCount,
      };
    }

    const summary = SessionRecorder.readSummary(sessionName);
    if (summary) {
      return {
        recording: false,
        session: sessionName,
        hasRecording: true,
        totalActions: summary.totalActions,
        totalNetworkRequests: summary.totalNetworkRequests,
      };
    }

    return { recording: false, session: sessionName, hasRecording: false };
  }

  function handleRecordSummary(params: Record<string, unknown>) {
    const sessionName = (params.session as string) || 'default';
    const recorder = activeRecorders.get(sessionName);

    if (recorder) {
      const data = recorder.getLiveData();
      return { ok: true, live: true, session: sessionName, actions: data.actions.length, network: data.network.length };
    }

    const summary: RecordingSummary | null = SessionRecorder.readSummary(sessionName);
    if (!summary) {
      return { ok: false, error: 'No recording summary found for session: ' + sessionName };
    }
    return { ok: true, live: false, summary };
  }

  function handleRecordCheckpoint(params: Record<string, unknown>): { ok: boolean; checkpoint?: CheckpointEntry; error?: string } {
    const sessionName = (params.session as string) || 'default';
    const recorder = activeRecorders.get(sessionName);
    if (!recorder || !recorder.isRecording) {
      return { ok: false, error: 'No active recording for session: ' + sessionName };
    }

    const type = (params.type as string) || 'custom';
    const hint = (params.hint as string) || '';
    const selector = params.selector as string | undefined;

    if (!hint) {
      return { ok: false, error: 'Please provide a hint describing the checkpoint' };
    }

    const cp = recorder.addManualCheckpoint(type, hint, selector);
    return { ok: true, checkpoint: cp };
  }

  async function handleReplayResume(_params: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
    const resolver = replayResumeResolvers.get('default');
    if (!resolver) {
      return { ok: false, error: 'No paused replay to resume' };
    }
    resolver();
    replayResumeResolvers.delete('default');
    return { ok: true };
  }

  async function handleReplay(params: Record<string, unknown>): Promise<PlaybackResult & { ok: boolean }> {
    const file = params.file as string;
    const sessionName = (params.session as string) || 'default';
    const slowMo = (params.slowMo as number) || 1;

    if (!file) {
      return normalizeReplayResult({ ok: false, errors: [{ eventIndex: -1, error: 'Missing file parameter' }] });
    }

    // Parse and validate the recording file BEFORE requiring a browser session.
    // Failing fast on a bad file avoids the confusing "Session not found" error
    // when the real problem is an unreadable/corrupt/empty file.
    let rawContent: string;
    let parsed: Record<string, unknown>;
    try {
      rawContent = readFileSync(file, 'utf8');
      // Try JSON first, fall back to YAML for .yaml/.yml files or if JSON.parse fails
      try {
        parsed = JSON.parse(rawContent);
      } catch {
        const yaml = (await import('yaml')).default;
        parsed = yaml.parse(rawContent);
      }
      // yaml.parse("") returns null; guard against null/non-object before field access
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return normalizeReplayResult({ ok: false, errors: [{ eventIndex: -1, error: `File "${file}" does not contain a valid recording. Expected a JSON/YAML object with an "actions" or "events" array, got ${parsed === null ? 'empty content' : typeof parsed}.` }] });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // YAML/JSON parse errors contain raw file content + caret pointers; keep it concise
      return normalizeReplayResult({ ok: false, errors: [{ eventIndex: -1, error: `Failed to parse "${file}" as JSON or YAML: ${msg.split('\n')[0]}` }] });
    }

    const session = findSession(sessionName);
    if (!session) {
      return normalizeReplayResult({ ok: false, errors: [{ eventIndex: -1, error: `Session not found: ${sessionName}. Open a browser first: xbrowser goto <url> --session ${sessionName}` }] });
    }
    if (!session.page) {
      return normalizeReplayResult({ ok: false, errors: [{ eventIndex: -1, error: 'Session has no page: ' + sessionName }] });
    }
    const isNewFormat = Array.isArray(parsed.actions);

    if (isNewFormat) {
      // Use SessionReplayer for new format
      try {
        const replayErrors: { eventIndex: number; error: string }[] = [];
        const { SessionReplayer } = await import('../recorder/session-replayer.js');
        const replayer = new SessionReplayer({
          page: session.page,
          stepDelay: slowMo * 500,
          onStep: (action, index, total) => {
            console.log(`[replay] Step ${index + 1}/${total}: ${action.type} ${action.element?.selector || action.url || ''}`);
          },
          onError: (action, error, index) => {
            const msg = `[${action?.type || 'unknown'}] ${error?.message || String(error)}`;
            console.error('[replay] Error at step:', msg);
            replayErrors.push({ eventIndex: index, error: msg });
          },
        });
        // Validate parsed JSON has the required RecordingData fields before loading
        if (!Array.isArray(parsed.actions) || typeof parsed.startUrl !== 'string') {
          return normalizeReplayResult({ ok: false, errors: [{ eventIndex: -1, error: 'Invalid recording format: missing actions or startUrl' }] });
        }
        await replayer.load(parsed);
        const startTime = Date.now();
        const result = await replayer.run();
        const duration = Date.now() - startTime;
        return normalizeReplayResult({
          ok: result.failed === 0,
          duration,
          eventsPlayed: result.success,
          totalEvents: result.success + result.failed + result.skipped,
          healed: result.healed,
          healedDetails: result.healedDetails,
          errors: replayErrors,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[replay] SessionReplayer error:', msg);
        return normalizeReplayResult({ ok: false, errors: [{ eventIndex: -1, error: 'Replay failed: ' + msg }] });
      }
    }

    // Legacy format — use PlaybackEngine
    const engine = PlaybackEngine.fromFile(session.page, file);
    const result = await engine.play({
      slowMo,
      onCheckpoint: async (checkpoint) => {
        return new Promise<boolean>((resolve) => {
          replayResumeResolvers.set(sessionName, () => resolve(true));
          console.log(`[replay] Checkpoint reached: [${checkpoint.type}] ${checkpoint.hint}`);
          console.log('[replay] Send "replay:resume" RPC to continue.');
        });
      },
    });
    return normalizeReplayResult({ ok: result.success, ...result });
  }

  /**
   * Normalize replay result to a stable shape.
   * Ensures all fields exist with sensible defaults so callers/tests can rely on the contract.
   */
  function normalizeReplayResult(input: Partial<PlaybackResult & { ok: boolean }>): PlaybackResult & { ok: boolean } {
    const errors = Array.isArray(input.errors) ? input.errors : [];
    const eventsPlayed = typeof input.eventsPlayed === 'number' ? input.eventsPlayed : 0;
    const totalEvents = typeof input.totalEvents === 'number' ? input.totalEvents : eventsPlayed + errors.length;
    const ok = input.ok ?? (errors.length === 0);
    return {
      ok,
      success: ok,
      duration: typeof input.duration === 'number' ? input.duration : 0,
      eventsPlayed,
      totalEvents,
      healed: typeof input.healed === 'number' ? input.healed : 0,
      healedDetails: Array.isArray(input.healedDetails) ? input.healedDetails : [],
      errors,
    };
  }

  async function handleViewerCheckSelector(params: Record<string, unknown>): Promise<{ found: boolean; box?: { x: number; y: number; width: number; height: number } }> {
    const name = (params.name as string) || 'default';
    const selector = params.selector as string;
    if (!selector) return { found: false };
    const session = findSession(name);
    if (!session?.page) return { found: false };
    try {
      const element = await session.page.$(selector);
      if (!element) return { found: false };
      const box = await element.boundingBox();
      if (!box) return { found: false };
      return { found: true, box };
    } catch {
      return { found: false };
    }
  }
}
