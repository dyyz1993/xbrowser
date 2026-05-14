import { writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { IncomingMessage, ServerResponse } from 'http';
import { startHttpServer } from '@dyyz1993/xcli-core';
import {
  createSession,
  findSession,
  closeSessionByName,
  getAllSessions,
} from '../browser.js';
import { executeCommand, executeChain } from '../executor.js';
import { networkStore, commandLogStore } from './network-store.js';
import { scoreEntries } from './network-scorer.js';
import { enrichEntries } from './api-analyzer.js';
import { generateCurl, replayEntry } from './curl-generator.js';
import { feedbackStore } from './feedback-store.js';
import { exportEntry } from './code-export.js';
import type { ExportLang } from './code-export.js';

const CONFIG_DIR = join(homedir(), '.xbrowser');
const LOG_FILE = join(CONFIG_DIR, 'daemon.log');

function log(msg: string): void {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const line = `[DAEMON ${ts}] ${msg}\n`;
  try {
    appendFileSync(LOG_FILE, line);
  } catch {
    // ignore file errors
  }
}

// --- Built-in recording JS injected on every session creation ---
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
  document.addEventListener('focus',function(e){var t=e.target.tagName;if(t==='INPUT'||t==='TEXTAREA'||e.target.contentEditable==='true')p('focus',{target:d(e.target)})},true);
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

/** Inject recording JS into a page and set up auto-reinject on navigation */
async function injectRecording(page: import('playwright').Page): Promise<void> {
  try {
    await page.evaluate(RECORDING_INJECT_JS);
    log('Recording JS injected into current page');
  } catch {
    log('Could not inject recording JS (page may be navigating)');
  }
  // Auto-reinject on every new document load via CDP
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: RECORDING_INJECT_JS });
    log('Recording JS registered for auto-reinject on navigation');
  } catch {
    log('Could not register auto-reinject (CDP Page.addScriptToEvaluateOnNewDocument)');
  }
}

async function resolveCDPEndpoint(raw: string): Promise<string> {
  if (raw === 'auto') {
    const httpResp = await fetch('http://localhost:9222/json/version');
    const data = (await httpResp.json()) as { webSocketDebuggerUrl?: string };
    if (!data.webSocketDebuggerUrl) throw new Error('Could not auto-discover CDP from localhost:9222');
    return data.webSocketDebuggerUrl;
  }
  if (/^\d+$/.test(raw)) {
    const httpResp = await fetch(`http://localhost:${raw}/json/version`);
    const data = (await httpResp.json()) as { webSocketDebuggerUrl?: string };
    if (!data.webSocketDebuggerUrl) throw new Error(`Could not discover CDP from localhost:${raw}`);
    return data.webSocketDebuggerUrl;
  }
  return raw;
}

async function main() {
  process.env.XBROWSER_DAEMON_WORKER = '1';
  const cdpEndpoint = process.env.XBROWSER_CDP_ENDPOINT || 'auto';
  const daemonPort = parseInt(process.env.XBROWSER_DAEMON_PORT || '9224', 10);

  const endpoint = await resolveCDPEndpoint(cdpEndpoint);
  log(`Daemon worker starting (pid=${process.pid}, cdp=${cdpEndpoint}, endpoint=${endpoint})`);

  const existing = findSession('default');
  if (!existing) {
    log('Creating default session...');
    const session = await createSession('default', undefined, { cdpEndpoint: endpoint });
    log('Default session created, injecting recording JS...');
    await injectRecording(session.page);
    log('Recording JS injected');
  }

  const server = startHttpServer({
    port: daemonPort,
    rpcHandler: async (method, params) => {
      log(`RPC: ${method} from ${params.session || 'default'}`);
      switch (method) {
        case 'exec': {
          const command = params.command as string;
          const cmdParams = (params.params || {}) as Record<string, unknown>;
          const sessionName = (params.session as string) || 'default';
          log(`RPC exec: command=${command} session=${sessionName}`);
          commandLogStore.add(sessionName, {
            timestamp: Date.now(),
            command,
            params: cmdParams,
            session: sessionName,
          });
          const result = await executeCommand(command, cmdParams, sessionName, { cdpEndpoint: endpoint });
          log(`RPC exec done: command=${command} success=${result.success}`);
          return result;
        }
        case 'chain': {
          const input = params.chain as string;
          const sessionName = (params.session as string) || 'default';
          log(`RPC chain: session=${sessionName} input=${input.substring(0, 80)}`);
          const result = await executeChain(input, { cdpEndpoint: endpoint, sessionName });
          return result;
        }
        case 'session:list':
          return getAllSessions().map((s) => ({
            id: s.id,
            name: s.name,
            url: s.page?.url() ?? null,
            createdAt: s.createdAt,
          }));
        case 'session:close': {
          const name = params.name as string;
          log(`RPC session:close name=${name}`);
          await closeSessionByName(name);
          return { ok: true };
        }
        case 'ping':
          return { ok: true, pid: process.pid };
        case 'network:list': {
          const sessionName = (params.session as string) || 'default';
          const listOpts: { filter?: string; method?: string; limit?: number; offset?: number } = {};
          if (params.filter) listOpts.filter = params.filter as string;
          if (params.method) listOpts.method = params.method as string;
          if (params.limit) listOpts.limit = params.limit as number;
          if (params.offset) listOpts.offset = params.offset as number;
          return networkStore.list(sessionName, listOpts);
        }
        case 'network:inspect': {
          const sessionName = (params.session as string) || 'default';
          const id = params.id as number;
          return networkStore.inspect(sessionName, id);
        }
        case 'network:clear': {
          const sessionName = (params.session as string) || 'default';
          networkStore.clear(sessionName);
          return { ok: true };
        }
        case 'network:top': {
          const sessionName = (params.session as string) || 'default';
          const topOpts: { minScore?: number; limit?: number; feedbackFn?: (path: string, method: string) => number } = {};
          if (params.minScore) topOpts.minScore = params.minScore as number;
          if (params.limit) topOpts.limit = params.limit as number;
          topOpts.feedbackFn = (path, method) => feedbackStore.getScoreAdjustment(path, method);
          return networkStore.top(sessionName, topOpts);
        }
        case 'command:log': {
          const sessionName = (params.session as string) || 'default';
          const limit = (params.limit as number) || 50;
          return { session: sessionName, commands: commandLogStore.list(sessionName, { limit }) };
        }
        case 'network:around': {
          const sessionName = (params.session as string) || 'default';
          const commandId = params.commandId as number;
          const windowMs = (params.window as number) || 5000;
          return networkStore.around(sessionName, commandId, commandLogStore, windowMs);
        }
        case 'network:analyze': {
          const sessionName = (params.session as string) || 'default';
          const entries = networkStore.list(sessionName, { limit: 1000 }).captures;
          const scored = scoreEntries(entries);
          const analyzed = enrichEntries(scored);
          return { session: sessionName, total: entries.length, analyzed };
        }
        case 'network:curl': {
          const sessionName = (params.session as string) || 'default';
          const id = params.id as number;
          const entry = networkStore.inspect(sessionName, id);
          if (!entry.capture) return { error: `Entry #${id} not found` };
          return generateCurl(entry.capture, params as Record<string, unknown> as import('./curl-generator.js').CurlOptions);
        }
        case 'network:replay': {
          const sessionName = (params.session as string) || 'default';
          const id = params.id as number;
          const entry = networkStore.inspect(sessionName, id);
          if (!entry.capture) return { error: `Entry #${id} not found` };
          return await replayEntry(entry.capture, params as Record<string, unknown> as import('./curl-generator.js').CurlOptions);
        }
        case 'network:like': {
          const sessionName = (params.session as string) || 'default';
          const id = params.id as number;
          const entry = networkStore.inspect(sessionName, id);
          if (!entry.capture) return { error: `Entry #${id} not found` };
          feedbackStore.add(entry.capture, 'like');
          return { ok: true, id, feedback: 'like' };
        }
        case 'network:dislike': {
          const sessionName = (params.session as string) || 'default';
          const id = params.id as number;
          const entry = networkStore.inspect(sessionName, id);
          if (!entry.capture) return { error: `Entry #${id} not found` };
          feedbackStore.add(entry.capture, 'dislike');
          return { ok: true, id, feedback: 'dislike' };
        }
        case 'network:feedback': {
          return { feedback: feedbackStore.list({ limit: params.limit as number | undefined }) };
        }
        case 'network:export': {
          const sessionName = (params.session as string) || 'default';
          const id = params.id as number;
          const lang = (params.lang as ExportLang) || 'ts';
          const entry = networkStore.inspect(sessionName, id);
          if (!entry.capture) return { error: `Entry #${id} not found` };
          return exportEntry(entry.capture, lang);
        }
        case 'recording:status': {
          const sess = findSession((params.session as string) || 'default');
          if (!sess) return { recording: false, error: 'No session' };
          try {
            const result = await sess.page.evaluate(() => ({
              active: !!(window as unknown as Record<string, unknown>).__xb_rec,
              events: ((window as unknown as Record<string, unknown>).__xb_evts as unknown[])?.length || 0,
              url: location.href,
            }));
            return { recording: true, ...result };
          } catch {
            return { recording: false, error: 'Page unreachable' };
          }
        }
        case 'recording:events': {
          const sess = findSession((params.session as string) || 'default');
          if (!sess) return { events: [], error: 'No session' };
          try {
            const events = await sess.page.evaluate(() => (window as unknown as Record<string, unknown>).__xb_evts || []);
            return { events, url: sess.page.url() };
          } catch {
            return { events: [], error: 'Page unreachable' };
          }
        }
        case 'recording:clear': {
          const sess = findSession((params.session as string) || 'default');
          if (!sess) return { ok: false, error: 'No session' };
          try {
            await sess.page.evaluate(() => {
              (window as unknown as Record<string, unknown>).__xb_evts = [];
              (window as unknown as Record<string, unknown>).__xb_t0 = Date.now();
            });
            return { ok: true };
          } catch {
            return { ok: false, error: 'Page unreachable' };
          }
        }
        case 'recording:save': {
          const sess = findSession((params.session as string) || 'default');
          if (!sess) return { ok: false, error: 'No session' };
          try {
            const events = await sess.page.evaluate(() => (window as unknown as Record<string, unknown>).__xb_evts || []) as unknown[];
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
            return { ok: false, error: (e as Error).message };
          }
        }
        default:
          log(`RPC unknown method: ${method}`);
          throw new Error(`Unknown method: ${method}`);
      }
    },
    extraRoutes: [
      {
        pathname: '/health',
        handler: (_req: IncomingMessage, res: ServerResponse) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', pid: process.pid }));
        },
      },
    ],
  });

  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(join(CONFIG_DIR, 'daemon.json'), JSON.stringify({
    port: daemonPort,
    pid: process.pid,
    startedAt: Date.now(),
    cdpEndpoint: endpoint,
  }, null, 2));

  console.log(`xbrowser daemon worker started (pid: ${process.pid}, port: ${daemonPort})`);

  process.on('SIGTERM', () => {
    log('Received SIGTERM, shutting down');
    server.close();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    log('Received SIGINT, shutting down');
    server.close();
    process.exit(0);
  });

  log('Daemon worker started successfully');
  setInterval(() => {}, 60000);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('Daemon worker failed:', msg);
  try { appendFileSync(LOG_FILE, `[DAEMON FATAL] ${msg}\n`); } catch { /* ignore */ }
  process.exit(1);
});
