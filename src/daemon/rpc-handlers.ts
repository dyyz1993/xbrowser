/**
 * RPC method handlers for the daemon HTTP server.
 *
 * Each method is a separate handler function, grouped by domain.
 * This replaces the giant switch/case in the old daemon-worker.ts.
 */
import type { Page } from '../browser-shim.js';
import { errMsg } from '../utils/error.js';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

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

const activeRecorders = new Map<string, SessionRecorder>();
const replayResumeResolvers = new Map<string, () => void>();

const CONFIG_DIR = join(homedir(), '.xbrowser');

// ─── Recording injection JS (injected on every session creation) ──

const RECORDING_INJECT_JS = `
(function(){
  if(window.__xb_rec) return;
  window.__xb_rec = true;
  window.__xb_evts = [];
  window.__xb_t0 = Date.now();
  function d(el){
    if(!el||!el.tagName) return {tag:'unknown'};
    var o={tag:el.tagName.toLowerCase(),text:(el.textContent||'').trim().substring(0,80)};
    if(el.getAttribute('role')) o.role=el.getAttribute('role');
    if(el.id) o.id=el.id;
    if(el.getAttribute('type')) o.type=el.getAttribute('type');
    if(el.getAttribute('placeholder')) o.placeholder=el.getAttribute('placeholder');
    if(el.getAttribute('aria-label')) o.ariaLabel=el.getAttribute('aria-label');
    if(el.contentEditable==='true') o.contentEditable=true;
    return o;
  }
  function p(t,det){
    var e={type:t,ts:Date.now()-window.__xb_t0,url:location.href};
    for(var k in det) e[k]=det[k];
    window.__xb_evts.push(e);
  }
  document.addEventListener('click',function(e){p('click',{target:d(e.target),x:e.clientX,y:e.clientY})},true);
  document.addEventListener('dblclick',function(e){p('dblclick',{target:d(e.target),x:e.clientX,y:e.clientY})},true);
  document.addEventListener('input',function(e){var el=e.target;p('input',{target:d(el),value:(el.value||el.textContent||'').substring(0,200)})},true);
  document.addEventListener('change',function(e){p('change',{target:d(e.target),value:(e.target.value||'').substring(0,100)})},true);
  document.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key==='Tab'||e.key==='Escape'||e.key.startsWith('Arrow'))p('keydown',{key:e.key,target:d(e.target)})},true);
  document.addEventListener('submit',function(e){p('submit',{target:d(e.target)})},true);
  var __xb_last_focus=null;document.addEventListener('focus',function(e){var t=e.target.tagName;if(t==='INPUT'||t==='TEXTAREA'||e.target.contentEditable==='true'){var sel=e.target.id||e.target.name||e.target.placeholder;if(sel===__xb_last_focus)return;__xb_last_focus=sel;p('input_focused',{target:d(e.target)})}},true);
  var obs=new MutationObserver(function(mutations){
    for(var m of mutations){
      for(var node of m.addedNodes){
        if(node.nodeType===1&&node.tagName){
          var text=(node.textContent||'').trim().substring(0,60);
          if(text&&text.length>1) p('dom_added',{tag:node.tagName.toLowerCase(),role:node.getAttribute&&node.getAttribute('role'),text:text});
        }
      }
    }
  });
  if(document.body) obs.observe(document.body,{childList:true,subtree:true});
  p('recording_started',{url:location.href});
})();
`;

/**
 * Injects recording JS into a page and registers auto-reinject on navigation.
 */
async function injectRecording(page: Page): Promise<void> {
  try {
    await page.evaluate(RECORDING_INJECT_JS);
  } catch {
    // page may be navigating
  }
  try {
    // Use addInitScript for auto-injection on every new document
    // (CDP Page.addScriptToEvaluateOnNewDocument directly)
    await page.addInitScript(RECORDING_INJECT_JS);
  } catch {
    // CDP auto-reinject not available
  }
}

export function createRPCHandler(): RPCHandler & { setPreviewWS: (ws: WSServer) => void } {
  let previewWS: WSServer | null = null;
  const INTERACTION_COMMANDS = new Set([
    'click', 'fill', 'type', 'press', 'select', 'check', 'hover', 'dblclick', 'scroll',
  ]);

  const handler: RPCHandler & { setPreviewWS: (ws: WSServer) => void } = Object.assign(
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

        // ── Recording ──
        case 'recording:status':
          return handleRecordingStatus(params);
        case 'recording:events':
          return handleRecordingEvents(params);
        case 'recording:clear':
          return handleRecordingClear(params);
        case 'recording:save':
          return handleRecordingSave(params);

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
    },
  );

  return handler;

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
    await injectRecording(session.page);
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
    try {
      const session = findSession(sessionName);
      urlBeforeCommand = session?.page?.url();
    } catch { /* ignore */ }

    try {
      const result = await executeCommand(command, cmdParams, sessionName, { cdpEndpoint: endpoint });
      registerSessionIfNew(sessionName);
      // Inject CDP command into active recorder if recording
      await injectCommandToRecorder(sessionName, command, cmdParams, urlBeforeCommand);
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

  async function handleRecordingStatus(params: Record<string, unknown>) {
    const sess = findSession((params.session as string) || 'default');
    if (!sess) return { recording: false, error: 'No session' };
    try {
      const result = await sess.page.evaluate<{ active: boolean; events: number; url: string }>(() => ({
        active: !!window.__xb_rec,
        events: window.__xb_evts?.length || 0,
        url: location.href,
      }));
      return { recording: true, ...result };
    } catch {
      return { recording: false, error: 'Page unreachable' };
    }
  }

  async function handleRecordingEvents(params: Record<string, unknown>) {
    const sess = findSession((params.session as string) || 'default');
    if (!sess) return { events: [], error: 'No session' };
    try {
      const events = await sess.page.evaluate(() => window.__xb_evts || []);
      return { events, url: sess.page.url() };
    } catch {
      return { events: [], error: 'Page unreachable' };
    }
  }

  async function handleRecordingClear(params: Record<string, unknown>) {
    const sess = findSession((params.session as string) || 'default');
    if (!sess) return { ok: false, error: 'No session' };
    try {
      await sess.page.evaluate(() => {
        window.__xb_evts = [];
        window.__xb_t0 = Date.now();
      });
      return { ok: true };
    } catch {
      return { ok: false, error: 'Page unreachable' };
    }
  }

  async function handleRecordingSave(params: Record<string, unknown>) {
    const sess = findSession((params.session as string) || 'default');
    if (!sess) return { ok: false, error: 'No session' };
    try {
      const events: Record<string, unknown>[] = await sess.page.evaluate(() => window.__xb_evts || []);
      const recordingsDir = join(CONFIG_DIR, 'recordings');
      mkdirSync(recordingsDir, { recursive: true });
      const outPath = (params.path as string) || join(recordingsDir, `recording-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      writeFileSync(outPath, JSON.stringify({
        startUrl: sess.page.url(),
        recordedAt: new Date().toISOString(),
        events,
      }, null, 2));
      return { ok: true, path: outPath, events: events.length };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  }

  function handleCommandLog(params: Record<string, unknown>) {
    const sessionName = (params.session as string) || 'default';
    const limit = (params.limit as number) || 50;
    return { session: sessionName, commands: commandLogStore.list(sessionName, { limit }) };
  }

  /** Inject CDP command execution into active recorder as a synthetic action */
  async function injectCommandToRecorder(sessionName: string, command: string, params: Record<string, unknown>, urlBeforeCommand?: string): Promise<void> {
    const recorder = activeRecorders.get(sessionName);
    if (!recorder) return;

    const COMMAND_ACTION_MAP: Record<string, string> = {
      goto: 'goto',
      fill: 'cdp-fill',
      click: 'cdp-click',
      type: 'input',
      select: 'change',
    };
    const actionType = COMMAND_ACTION_MAP[command];
    if (!actionType) return;

    const selector = (params.selector as string) || (params.css as string);
    const value = (params.value as string) || (params.expression as string);

    // Capture currentUrl: for goto use params.url (target), for others use page URL before command
    let currentUrl = (params.url as string | undefined) || urlBeforeCommand;
    // For click/fill/type commands, prefer the page URL at the time of the action
    if (command !== 'goto' && urlBeforeCommand && urlBeforeCommand !== 'about:blank') {
      currentUrl = urlBeforeCommand;
    }

    // Try to get element metadata from the page via describe()
    let element: Record<string, unknown> | undefined;
    if (selector) {
      try {
        const session = findSession(sessionName);
        if (session?.page) {
          element = await session.page.evaluate((sel: string) => {
            const el = document.querySelector(sel);
            if (!el || typeof window.__xb_describe !== 'function') return null;
            return window.__xb_describe(el);
          }, selector);
        }
      } catch { /* page may have navigated or closed */ }
    }

    recorder.recordCommandAction({
      type: actionType,
      selector,
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
        await injectRecording(session.page);
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
      await recorder.start(url);
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
      return { ok: false, success: false, duration: 0, eventsPlayed: 0, totalEvents: 0, errors: [{ eventIndex: -1, error: 'Missing file parameter' }] };
    }

    const session = findSession(sessionName);
    if (!session) {
      return { ok: false, success: false, duration: 0, eventsPlayed: 0, totalEvents: 0, errors: [{ eventIndex: -1, error: 'Session not found: ' + sessionName }] };
    }
    if (!session.page) {
      return { ok: false, success: false, duration: 0, eventsPlayed: 0, totalEvents: 0, errors: [{ eventIndex: -1, error: 'Session has no page: ' + sessionName }] };
    }

    // Detect new session-recorder format (has 'actions' array) vs old format (has 'events' array)
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
    } catch (e) {
      return { ok: false, success: false, duration: 0, eventsPlayed: 0, totalEvents: 0, errors: [{ eventIndex: -1, error: 'Failed to read/parse file: ' + String(e) }] };
    }
    const isNewFormat = Array.isArray(parsed.actions);

    if (isNewFormat) {
      // Use SessionReplayer for new format
      try {
        const { SessionReplayer } = await import('../recorder/session-replayer.js');
        const replayer = new SessionReplayer({
          page: session.page,
          stepDelay: slowMo * 500,
          onStep: (action, index, total) => {
            console.log(`[replay] Step ${index + 1}/${total}: ${action.type} ${action.element?.selector || action.url || ''}`);
          },
          onError: (action, error) => {
            console.error(`[replay] Error at step ${action.type}: ${error.message}`);
          },
        });
        // Validate parsed JSON has the required RecordingData fields before loading
        if (!Array.isArray(parsed.actions) || typeof parsed.startUrl !== 'string') {
          return { ok: false, success: false, duration: 0, eventsPlayed: 0, totalEvents: 0, errors: [{ eventIndex: -1, error: 'Invalid recording format: missing actions or startUrl' }] };
        }
        await replayer.load(parsed);
        const startTime = Date.now();
        const result = await replayer.run();
        const duration = Date.now() - startTime;
        return {
          ok: result.failed === 0,
          success: result.failed === 0,
          duration,
          eventsPlayed: result.success,
          totalEvents: result.success + result.failed + result.skipped,
          errors: [],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[replay] SessionReplayer error:', msg);
        return { ok: false, success: false, duration: 0, eventsPlayed: 0, totalEvents: 0, errors: [{ eventIndex: -1, error: 'Replay failed: ' + msg }] };
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
    return { ok: result.success, ...result };
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
