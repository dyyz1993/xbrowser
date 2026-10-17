import type { BrowserContext, Page } from '../browser-shim.js';
import { createBrowser } from './connection.js';
import { findSession } from './lifecycle.js';
import { sessions, type BrowserLaunchOptions, type ManagedSession } from './state.js';

interface CreateSessionDependencies {
  closeSessionByName(name: string): Promise<boolean>;
  installNetworkCapture(page: Page, sessionName: string): Promise<void>;
  registerSession(session: Omit<ManagedSession, 'id' | 'createdAt' | 'lastActivityAt'> & Partial<Pick<ManagedSession, 'id' | 'createdAt' | 'lastActivityAt'>>): ManagedSession;
  logSessionEvent(event: string, details: string): void;
  getCDPTargets(endpoint: string | number): Promise<Array<{ id: string; url: string; title: string; webSocketDebuggerUrl: string }>>;
}

export async function createSessionImpl(
  name: string,
  url: string | undefined,
  options: BrowserLaunchOptions | undefined,
  deps: CreateSessionDependencies
): Promise<ManagedSession> {
  // Enforce name uniqueness: close any existing session with the same name.
  // A session name is a unique identifier — there can be only one per name.
  const existing = findSession(name);
  if (existing) {
    deps.logSessionEvent('replace_session', `name="${name}" id="${existing.id}" — closing existing session before creating new one`);
    await deps.closeSessionByName(name);
  }

  const b = await createBrowser(options);
  const isCDP = !!options?.cdpEndpoint;
  let context: BrowserContext;
  let page: Page;

  if (isCDP) {
    // Defense (2026-08-15 rung-2, browser-agent-product 真实站点冒烟):
    // attach 后 contexts 枚举出的 page 的 url() 可能为 null（内部 target info
    // 异步填充，实测 5s 内不出现）——原固定 sleep 500ms×2 后页面匹配全落空 →
    // newPage() 新开 tab → 录制 session 的监听与命令实际操作的 tab 分离 →
    // record stop 只剩 navigation、0 用户动作（多 tab 时必现，单 tab 偶尔幸存）。
    // 解法：url 为空时用 page.evaluate('location.href') 主动向页面取真实 URL。
    const targetHostname = url ? (() => { try { return new URL(url).hostname; } catch { return ''; } })() : '';
    const isRealPageUrl = (u: string) =>
      !!u && u !== 'about:blank' && !u.startsWith('chrome://') &&
      !u.startsWith('chrome-untrusted://') && !u.startsWith('chrome-error://');
    const resolvePageUrl = async (p: Page): Promise<string> => {
      const u = p.url();
      if (u && u !== 'about:blank') return u;
      try { return await p.evaluate<string>('location.href'); } catch { return u ?? ''; }
    };

    const pollStart = Date.now();
    for (;;) {
      const ctxs = b.contexts();
      let hostHit = false;
      let anyHit = false;
      for (const ctx of ctxs) {
        for (const p of ctx.pages()) {
          const u = await resolvePageUrl(p);
          if (!isRealPageUrl(u)) continue;
          anyHit = true;
          if (targetHostname && u.includes(targetHostname)) { hostHit = true; break; }
        }
        if (hostHit) break;
      }
      if (process.env.XB_DEBUG_SESSION_POLL) {
        console.error(`[poll] t=${Date.now() - pollStart}ms ctxs=${ctxs.length} hostHit=${hostHit} anyHit=${anyHit}`);
      }
      if (hostHit) break;
      if (anyHit && Date.now() - pollStart >= 2000) break;
      if (Date.now() - pollStart >= 5000) break;
      await new Promise(r => setTimeout(r, 200));
    }
    let contexts = b.contexts();
    if (contexts.length === 0) {
      await new Promise(r => setTimeout(r, 500));
      contexts = b.contexts();
    }

    context = contexts[0] || (await b.newContext());

    let targetPage: Page | null = null;

    // 第零遍（S96，d07 下一切片）：精确 URL 匹配 —— goto 特定 URL 时优先
    // 绑定"已是该 URL"的页面（无需导航，也绝不会把别的 session 的页面
    // 导航走）。S95 实战：hostname 匹配绑到遗留 tab 后导航超时静默，title
    // 残留旧页 —— hostname 级匹配只该是次选。
    const ownedUrls = new Set<string>();
    for (const ssn of sessions.list()) {
      try { const u = ssn.page?.url(); if (u && u !== 'about:blank') ownedUrls.add(u); } catch { /* ignore */ }
    }
    if (url) {
      for (const ctx of contexts) {
        for (const p of ctx.pages()) {
          try {
            const pUrl = await resolvePageUrl(p);
            if (ownedUrls.has(pUrl)) continue;
            if (pUrl === url) { targetPage = p; break; }
          } catch { /* ignore */ }
        }
        if (targetPage) break;
      }
    }

    // 第一遍：找 hostname 匹配的页面（修复"session 总被绑到错 tab"bug；
    // url 可能为 null，走 resolvePageUrl 主动获取）。占用检查（S97）：
    // hostname 匹配会绑走他 session 的页面再导航 —— M1 漂移根因。
    if (!targetPage && targetHostname) {
      for (const ctx of contexts) {
        const pages = ctx.pages();
        for (const p of pages) {
          const pUrl0 = await resolvePageUrl(p);
          if (ownedUrls.has(pUrl0)) continue;
          const pUrl = pUrl0;
          if (isRealPageUrl(pUrl) && pUrl.includes(targetHostname)) {
            targetPage = p;
            break;
          }
        }
        if (targetPage) break;
      }
    }

    // 第二遍：fallback 到任意非空白、非 chrome:// 页面（占用检查 S97）
    if (!targetPage) {
      for (const ctx of contexts) {
        const pages = ctx.pages();
        for (const p of pages) {
          const pUrl0 = await resolvePageUrl(p);
          if (ownedUrls.has(pUrl0)) continue;
          const pUrl = pUrl0;
          if (isRealPageUrl(pUrl)) {
            targetPage = p;
            break;
          }
        }
        if (targetPage) break;
      }
    }

    if (!targetPage && options?.cdpEndpoint) {
      const targets = await deps.getCDPTargets(options.cdpEndpoint);
      // S98：matchTarget 本身必须尊重占用 —— 旧逻辑 find 只筛 URL 非空白，
      // 被 session 占用的 tab 也会命中，随后 newPage+goto(matchTarget.url)
      // 把别的 session 的页面导航走（Q1 漂移全链根因）。占用 tab 直接跳过。
      const ownedUrlsT = new Set<string>();
      for (const ssn of sessions.list()) {
        try { const u = ssn.page?.url(); if (u && u !== 'about:blank') ownedUrlsT.add(u); } catch { /* ignore */ }
      }
      const matchTarget = targets.find(t =>
        t.url && t.url !== 'about:blank' && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-untrusted://') && !t.url.startsWith('chrome-error://') &&
        !ownedUrlsT.has(t.url) &&
        (url ? t.url === url || t.url.includes(new URL(url).hostname) : true)
      );
      if (matchTarget && matchTarget.url) {
        // d07 第六层（S82）：复用已有 page —— 旧逻辑每条命令 newPage 复制
        // target（3 条命令繁殖 9 个 tab，S72 七 tab 泥潭的真根因）。
        // 同 URL 的 page 已存在则直接复用，仅无匹配时才开新 tab。
        // URL 比对而非对象比对（S98 坐实：--cdp 模式每命令新建连接，
        // 旧连接的 page wrapper 与本连接 pages() 的不可比，=== 恒 false）
        const ownedUrls = new Set<string>();
        for (const ssn of sessions.list()) {
          try { const u = ssn.page?.url(); if (u && u !== 'about:blank') ownedUrls.add(u); } catch { /* ignore */ }
        }
        const isOwned = (p: unknown) => {
          try { return ownedUrls.has((p as { url(): string }).url()); } catch { return false; }
        };
        // 复用需未被其他 session 占用（S95 实战：J-draft 的 hostname 匹配
        // 复用了 J-home 绑定的 tab 并导航走 —— 跨 session 页面漂移）
        const existing = context.pages().find(p => {
          try { return p.url() === matchTarget.url && !isOwned(p); } catch { return false; }
        });
        if (existing) {
          targetPage = existing;
        } else {
          targetPage = await context.newPage();
          await targetPage.goto(matchTarget.url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        }
      }
    }

    if (!targetPage) {
      const pages = context.pages();
      if (pages.length > 1) {
        // d07 第六层最小切片（S81）：多 tab 时优先激活 tab ——
        // visibilityState=visible 的 tab 全浏览器唯一（后台 tab 全 hidden）。
        // pages[0] 是注册顺序不是激活顺序（S72 七 tab 泥潭的选错根因）。
        try {
          const owned = new Set<unknown>();
          for (const ssn of sessions.list()) owned.add(ssn.page);
          for (const p of pages) {
            if (owned.has(p)) continue; // 他 session 占用的 page 不抢（S95）
            const vis = await p.evaluate<string>('document.visibilityState').catch(() => 'hidden');
            if (vis === 'visible') { targetPage = p; break; }
          }
        } catch { /* best-effort */ }
      }
      if (!targetPage && pages.length > 0) {
        targetPage = pages[0];
      }
      if (!targetPage) {
        targetPage = await context.newPage();
      }
    }

    page = targetPage;

    // CDP 多 tab 激活保障（S72 掘金实战）：同源多 tab 时 attach 可能选中
    // 后台 tab —— 后台 tab 的输入管线被节流/挂起，Input.dispatchMouseEvent
    // 直接 30s 超时（d07 第六层同源症状）。attach 后立即 bringToFront，
    // 确保后续输入派发打在激活 tab 上。
    if (isCDP) {
      // 可选调用：测试 mock 可能不带 bringToFront（同步 TypeError 会穿透
      // .catch —— CI 抓过一次，tests/browser.test.ts 3 用例）
      await Promise.resolve(targetPage.bringToFront?.()).catch(() => { /* best-effort */ });
    }

    // Note: auto-attach for new tab detection is only enabled for self-launched Chromium
    // (via newContext -> _enableAutoAttach). CDP tunnels may not support it reliably.
  } else {
    context = await b.newContext({ viewport: { width: 1920, height: 1080 } });
    page = await context.newPage();
  }

  if (url && page.url() !== url) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
  }

  const session = deps.registerSession({
    name,
    context,
    page,
    browser: b,
    isCDP,
    cdpEndpoint: options?.cdpEndpoint,
  });
  deps.logSessionEvent('create_session', `name="${name}" id="${session.id}" url="${url || '(no url)'}" isCDP=${isCDP} cdpEndpoint=${options?.cdpEndpoint || '(none)'}`);
  await deps.installNetworkCapture(page, name);
  return session;
}
