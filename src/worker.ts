import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

interface WorkerSession {
  id: string;
  name: string;
  context: BrowserContext;
  page: Page;
  createdAt: string;
}

const sessions = new Map<string, WorkerSession>();
let browser: Browser | null = null;

export async function getBrowser(ctx?: WorkerContext): Promise<Browser> {
  if (browser) return browser;
  const executablePath =
    process.env.XBROWSER_CHROMIUM_PATH ||
    ctx?.chromiumPath ||
    '/Applications/Chromium.app/Contents/MacOS/Chromium';
  browser = await chromium.launch({ executablePath, headless: true });
  return browser;
}

export function findSession(name: string): WorkerSession | undefined {
  for (const [, session] of sessions) {
    if (session.name === name) return session;
  }
  return undefined;
}

export function getSessionById(id: string): WorkerSession | undefined {
  return sessions.get(id);
}

export function getAllSessions(): WorkerSession[] {
  return Array.from(sessions.values());
}

export interface WorkerContext {
  chromiumPath?: string;
  cdpEndpoint?: string;
}

export class BrowserWorker {
  private ctx: WorkerContext;

  constructor(ctx?: WorkerContext) {
    this.ctx = ctx ?? {};
  }

  async init(): Promise<void> {
    await getBrowser(this.ctx);
  }

  async execute(method: string, params: Record<string, unknown>): Promise<unknown> {
    return routeWorkerCommand(method, params, this.ctx);
  }

  async destroy(): Promise<void> {
    for (const [, session] of sessions) {
      try {
        await session.context.close();
      } catch {
        // ignore close errors
      }
    }
    sessions.clear();
    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore close errors
      }
      browser = null;
    }
  }
}

function requireSessionByName(name: string): WorkerSession {
  const s = findSession(name);
  if (!s) throw new Error('Session not found');
  return s;
}

export async function routeWorkerCommand(
  method: string,
  params: Record<string, unknown>,
  workerCtx?: WorkerContext
): Promise<unknown> {
  const p = params ?? {};

  switch (method) {
    case 'session.create': {
      const b = await getBrowser(workerCtx);
      const context = await b.newContext();
      const page = await context.newPage();
      if (p.url) {
        await page.goto(p.url as string, { waitUntil: 'domcontentloaded' });
      }
      const session: WorkerSession = {
        id: (p.sessionId as string) || crypto.randomUUID(),
        name: (p.name as string) || 'default',
        context,
        page,
        createdAt: new Date().toISOString(),
      };
      sessions.set(session.id, session);
      return { id: session.id, name: session.name };
    }

    case 'session.close': {
      const sessionName = p.name as string;
      for (const [id, session] of sessions) {
        if (session.name === sessionName || session.id === sessionName) {
          await session.context.close();
          sessions.delete(id);
          return { ok: true };
        }
      }
      return { ok: true };
    }

    case 'session.closeAll': {
      for (const [, session] of sessions) {
        try {
          await session.context.close();
        } catch {
          // ignore
        }
      }
      sessions.clear();
      return { ok: true };
    }

    case 'session.list': {
      return {
        sessions: Array.from(sessions.values()).map((s) => ({
          id: s.id,
          name: s.name,
          createdAt: s.createdAt,
        })),
      };
    }

    case 'page.goto': {
      const gs = requireSessionByName(p.name as string);
      const response = await gs.page.goto(p.url as string, {
        waitUntil: (p.waitUntil as 'load' | 'domcontentloaded' | 'networkidle') || 'domcontentloaded',
      });
      return { ok: true, url: p.url, status: response?.status() };
    }

    case 'page.click': {
      const cs = requireSessionByName(p.name as string);
      await cs.page.click(p.selector as string);
      return { ok: true, selector: p.selector };
    }

    case 'page.fill': {
      const fs = requireSessionByName(p.name as string);
      await fs.page.fill(p.selector as string, p.value as string);
      return { ok: true, selector: p.selector, value: p.value };
    }

    case 'page.type': {
      const ts = requireSessionByName(p.name as string);
      await ts.page.type(p.selector as string, p.text as string);
      return { ok: true, selector: p.selector };
    }

    case 'page.press': {
      const ps = requireSessionByName(p.name as string);
      await ps.page.press((p.selector as string) || 'body', p.key as string);
      return { ok: true, key: p.key };
    }

    case 'page.select': {
      const ss = requireSessionByName(p.name as string);
      await ss.page.selectOption(p.selector as string, p.value as string);
      return { ok: true, selector: p.selector, value: p.value };
    }

    case 'page.check': {
      const cks = requireSessionByName(p.name as string);
      await cks.page.check(p.selector as string);
      return { ok: true, selector: p.selector };
    }

    case 'page.hover': {
      const hs = requireSessionByName(p.name as string);
      await hs.page.hover(p.selector as string);
      return { ok: true, selector: p.selector };
    }

    case 'page.dblclick': {
      const ds = requireSessionByName(p.name as string);
      await ds.page.dblclick(p.selector as string);
      return { ok: true, selector: p.selector };
    }

    case 'page.back': {
      const bs = requireSessionByName(p.name as string);
      await bs.page.goBack();
      return { ok: true };
    }

    case 'page.forward': {
      const fwd = requireSessionByName(p.name as string);
      await fwd.page.goForward();
      return { ok: true };
    }

    case 'page.refresh': {
      const rs = requireSessionByName(p.name as string);
      await rs.page.reload();
      return { ok: true };
    }

    case 'page.title': {
      const tls = requireSessionByName(p.name as string);
      const title = await tls.page.title();
      return { ok: true, title };
    }

    case 'page.url': {
      const us = requireSessionByName(p.name as string);
      return { ok: true, url: us.page.url() };
    }

    case 'page.html': {
      const hts = requireSessionByName(p.name as string);
      const html = await hts.page.content();
      return { ok: true, html };
    }

    case 'page.text': {
      const txts = requireSessionByName(p.name as string);
      if (p.selector) {
        const text = await txts.page.textContent(p.selector as string);
        return { ok: true, text: text || '' };
      }
      const text = await txts.page.evaluate(() => document.body?.innerText || '');
      return { ok: true, text };
    }

    case 'page.getProperty': {
      const gps = requireSessionByName(p.name as string);
      const prop = p.property as string;
      if (p.selector) {
        const value = await gps.page.getAttribute(p.selector as string, prop);
        return { ok: true, property: prop, value };
      }
      return { ok: true, property: prop, value: null };
    }

    case 'page.screenshot': {
      const scs = requireSessionByName(p.name as string);
      const screenshotOptions: Record<string, unknown> = {
        fullPage: (p.fullPage as boolean) || false,
        type: (p.type as 'png' | 'jpeg') || 'png',
      };
      let buffer: Buffer;
      if (p.selector) {
        buffer = await scs.page.locator(p.selector as string).first().screenshot(screenshotOptions);
      } else {
        buffer = await scs.page.screenshot(screenshotOptions);
      }
      return { ok: true, data: buffer.toString('base64'), format: screenshotOptions.type, size: buffer.length };
    }

    case 'page.snapshot': {
      const sns = requireSessionByName(p.name as string);
      const elements = await sns.page.evaluate(
        (interactive: boolean) => {
          const allElements = document.querySelectorAll(
            interactive
              ? 'a, button, input, select, textarea, [onclick], [role="button"]'
              : '*'
          );
          const results: Array<{ tag: string; text: string; attrs: Record<string, string> }> = [];
          const seen = new Set<string>();

          allElements.forEach((el) => {
            const tag = el.tagName.toLowerCase();
            const text = el.textContent?.trim().slice(0, 100) || '';
            const attrs: Record<string, string> = {};
            for (const attr of el.attributes) {
              attrs[attr.name] = attr.value;
            }
            const key = `${tag}-${text}-${Object.keys(attrs).join(',')}`;
            if (!seen.has(key) && (text || tag === 'img' || tag === 'input')) {
              seen.add(key);
              results.push({ tag, text, attrs });
            }
          });

          return results.slice(0, 100).map((item, idx) => ({
            ref: `@e${idx + 1}`,
            ...item,
          }));
        },
        (p.interactiveOnly as boolean) || false
      );
      return { elements };
    }

    case 'page.waitForSelector': {
      const ws = requireSessionByName(p.name as string);
      await ws.page.waitForSelector(p.selector as string, {
        state: (p.state as 'attached' | 'detached' | 'visible' | 'hidden') || 'visible',
        timeout: (p.timeout as number) || 30000,
      });
      return { ok: true, selector: p.selector, found: true };
    }

    case 'page.waitForTimeout': {
      const wts = requireSessionByName(p.name as string);
      await wts.page.waitForTimeout((p.timeout as number) || 1000);
      return { ok: true, waited: p.timeout };
    }

    case 'page.scroll': {
      const scrl = requireSessionByName(p.name as string);
      const distance = (p.distance as number) || 500;
      const direction = (p.direction as string) || 'down';
      const deltas: Record<string, [number, number]> = {
        down: [0, distance],
        up: [0, -distance],
        right: [distance, 0],
        left: [-distance, 0],
      };
      const [dx, dy] = deltas[direction] || [0, distance];
      if (p.selector) {
        const element = scrl.page.locator(p.selector as string).first();
        await element.evaluate((el, args) => {
          const [dxx, dyy] = args as [number, number];
          el.scrollBy(dxx, dyy);
        }, [dx, dy] as [number, number]);
      } else {
        await scrl.page.mouse.wheel(dx, dy);
      }
      return { ok: true, direction, distance };
    }

    case 'page.mouse': {
      const ms = requireSessionByName(p.name as string);
      const action = (p.action as string) || 'click';
      const x = (p.x as number) || 0;
      const y = (p.y as number) || 0;
      const button = (p.button as 'left' | 'right' | 'middle') || 'left';
      switch (action) {
        case 'move':
          await ms.page.mouse.move(x, y, { steps: (p.steps as number) || 1 });
          break;
        case 'down':
          await ms.page.mouse.down({ button });
          break;
        case 'up':
          await ms.page.mouse.up({ button });
          break;
        case 'click':
          await ms.page.mouse.click(x, y, { button });
          break;
        case 'dblclick':
          await ms.page.mouse.dblclick(x, y, { button });
          break;
      }
      return { ok: true, action, x, y };
    }

    case 'page.eval': {
      const evs = requireSessionByName(p.name as string);
      const result = await evs.page.evaluate(p.expression as string);
      return { ok: true, result };
    }

    case 'page.evaluateFn': {
      const evfs = requireSessionByName(p.name as string);
      const evResult = await evfs.page.evaluate(
        (args: { fnBody: string; fnArgs: unknown[] }) => {
          const fn = new Function('...args', args.fnBody);
          return fn(...args.fnArgs);
        },
        { fnBody: p.fn as string, fnArgs: (p.args as unknown[]) || [] }
      );
      return { ok: true, result: evResult };
    }

    case 'page.getCookies': {
      const gcs = requireSessionByName(p.name as string);
      const cookies = await gcs.context.cookies();
      return { ok: true, cookies };
    }

    case 'page.setCookie': {
      const scs2 = requireSessionByName(p.name as string);
      const cookieData = {
        name: p.name as string,
        value: p.value as string,
        domain: p.domain as string | undefined,
        path: (p.path as string) || '/',
        expires: p.expires as number | undefined,
        httpOnly: p.httpOnly as boolean | undefined,
        secure: p.secure as boolean | undefined,
        sameSite: p.sameSite as 'Strict' | 'Lax' | 'None' | undefined,
      };
      await scs2.context.addCookies([cookieData]);
      return { ok: true, name: p.name };
    }

    case 'page.clearCookies': {
      const ccs = requireSessionByName(p.name as string);
      await ccs.context.clearCookies();
      return { ok: true, cleared: true };
    }

    case 'page.getLocalStorage': {
      const gls = requireSessionByName(p.name as string);
      if (p.key) {
        const value = await gls.page.evaluate((k) => localStorage.getItem(k as string), p.key);
        return { ok: true, key: p.key, value };
      }
      const data = await gls.page.evaluate(() => {
        const entries: Record<string, string> = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key) entries[key] = localStorage.getItem(key) ?? '';
        }
        return entries;
      });
      return { ok: true, data };
    }

    case 'page.setLocalStorage': {
      const sls = requireSessionByName(p.name as string);
      await sls.page.evaluate(
        (args) => {
          const { key, value } = args as { key: string; value: string };
          localStorage.setItem(key, value);
        },
        { key: p.key, value: p.value }
      );
      return { ok: true, key: p.key };
    }

    case 'page.clearLocalStorage': {
      const cls = requireSessionByName(p.name as string);
      await cls.page.evaluate(() => localStorage.clear());
      return { ok: true, cleared: true };
    }

    case 'page.structure': {
      const strs = requireSessionByName(p.name as string);
      const structure = await strs.page.evaluate(
        (args) => {
          const { sel, maxDepth } = args as { sel: string; maxDepth: number };
          const root = sel ? document.querySelector(sel) : document.body;
          if (!root) return { tag: 'none', role: '', text: '', children: [] };

          function buildTree(el: Element, d: number) {
            if (d <= 0) {
              return {
                tag: el.tagName.toLowerCase(),
                role: el.getAttribute('role') ?? '',
                text: '',
                children: [],
              };
            }
            const children: Array<{
              tag: string;
              role: string;
              text: string;
              children: unknown[];
            }> = [];
            for (const child of Array.from(el.children)) {
              children.push(buildTree(child, d - 1));
            }
            return {
              tag: el.tagName.toLowerCase(),
              role: el.getAttribute('role') ?? '',
              text: (el.textContent ?? '').substring(0, 100),
              children,
            };
          }

          return buildTree(root, maxDepth);
        },
        { sel: (p.selector as string) || 'body', maxDepth: (p.depth as number) || 5 }
      );
      return { ok: true, structure };
    }

    case 'page.setViewport': {
      const vps = requireSessionByName(p.name as string);
      const viewport = vps.page.viewportSize();
      const width = (p.width as number) ?? viewport?.width ?? 1280;
      const height = (p.height as number) ?? viewport?.height ?? 720;
      await vps.page.setViewportSize({ width, height });
      return { ok: true, width, height };
    }

    case 'page.frames': {
      const frs = requireSessionByName(p.name as string);
      const frameList = frs.page.frames().map((frame, index) => ({
        index,
        name: frame.name(),
        url: frame.url(),
      }));
      return { ok: true, frames: frameList };
    }

    case 'page.frame': {
      const fr = requireSessionByName(p.name as string);
      const allFrames = fr.page.frames();
      let targetFrame;
      if (p.index !== undefined) {
        targetFrame = allFrames[p.index as number];
      } else if (p.name !== undefined) {
        targetFrame = allFrames.find((f) => f.name() === p.name);
      } else {
        return { ok: false, error: 'Must provide index or name' };
      }
      if (!targetFrame) {
        return { ok: false, error: 'Frame not found' };
      }
      return { ok: true, name: targetFrame.name(), url: targetFrame.url() };
    }

    default:
      throw new Error(`Unknown method: ${method}`);
  }
}
