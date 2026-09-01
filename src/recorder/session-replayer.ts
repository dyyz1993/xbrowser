/**
 * Session Replay Engine — replays a recorded session step by step.
 *
 * Usage:
 *   const replayer = new SessionReplayer({ cdpUrl: 'http://localhost:9221' });
 *   await replayer.load('/path/to/recording.json');
 *   await replayer.run();
 */

import type { UserAction, RecordingData } from './session-recorder.js';
import type { XBPage, XBFilePayload } from '../cdp-driver/types.js';
import { queryJS } from '../cdp-driver/selector-utils.js';

export interface ReplayOptions {
  cdpUrl?: string;
  /** Provide an existing page (from daemon session) instead of connecting */
  page?: XBPage;
  /** Delay between steps in ms (default: 500) */
  stepDelay?: number;
  /** Timeout per step in ms (default: 10000) */
  stepTimeout?: number;
  /** Called before each step */
  onStep?: (action: UserAction, index: number, total: number) => void;
  /** Called on step error */
  onError?: (action: UserAction, error: Error, index: number) => void;
  /** S202: 自愈回放——选择器失效时自动降级到语义匹配（默认开启） */
  selfHealing?: boolean;
  /** Called when a step is self-healed via fallback strategy */
  onHealed?: (action: UserAction, strategy: string, index: number) => void;
}

export class SessionReplayer {
  private opts: Required<Pick<ReplayOptions, 'stepDelay' | 'stepTimeout'>> & Omit<ReplayOptions, 'stepDelay' | 'stepTimeout'>;
  private recording: RecordingData | null = null;
  private page: XBPage | null = null;

  constructor(opts: ReplayOptions) {
    this.opts = {
      cdpUrl: opts.cdpUrl,
      page: opts.page,
      stepDelay: opts.stepDelay ?? 500,
      stepTimeout: opts.stepTimeout ?? 10000,
      onStep: opts.onStep,
      onError: opts.onError,
      selfHealing: opts.selfHealing !== false,
      onHealed: opts.onHealed,
    } as typeof this.opts;
  }

  /** Load a recording from a file path or parsed JSON */
  async load(source: string | RecordingData | Record<string, unknown>): Promise<void> {
    if (typeof source === 'string') {
      const fs = await import('fs');
      const raw = fs.readFileSync(source, 'utf8');
      this.recording = JSON.parse(raw);
    } else {
      this.recording = source as RecordingData;
    }
  }

  /** Run the full replay */
  async run(): Promise<{ success: number; failed: number; skipped: number }> {
    if (!this.recording) throw new Error('No recording loaded. Call load() first.');

    // Use provided page or connect to browser via CDP
    if (this.opts.page) {
      this.page = this.opts.page;
    } else if (this.opts.cdpUrl) {
      const { launch } = await import('../cdp-driver/index.js');
      const { browser } = await launch({ cdpEndpoint: this.opts.cdpUrl });
      // Wait for contexts to populate (CDP connection may need a moment)
      let contexts = browser.contexts();
      for (let i = 0; i < 10 && contexts.length === 0; i++) {
        await new Promise(r => setTimeout(r, 500));
        contexts = browser.contexts();
      }
      const context = contexts[0];
      if (!context) throw new Error('No browser context available');
      const pages = context.pages();
      this.page = pages[0];
    }

    if (!this.page) throw new Error('No page available. Provide cdpUrl or page.');

    const actions = this.dedupAdjacentActions(this.recording.actions);
    let success = 0;
    let failed = 0;
    let skipped = 0;

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      this.opts.onStep?.(action, i, actions.length);

      // Tab-following: a click may open a new tab (target=_blank). Track the
      // context's page count; when it grows, follow the newest page so the
      // next action (recorded in that tab) replays against the right target (d07).
      const pagesBefore = this.listContextPages();

      try {
        // Replay mouse trajectory before the action (if present)
        if (action.trajectory) {
          await this.replayTrajectory(action.trajectory);
        }
        await this.replayAction(action);

        // X3: After each non-informational action, stabilize the page
        // so the next step doesn't race with async rendering.
        if (action.type !== 'resize' && action.type !== 'clipboard' && action.type !== 'visibility') {
          try {
            await this.page!.waitForLoadState('domcontentloaded', this.opts.stepTimeout);
          } catch {
            // Non-critical — best-effort stabilization
          }
        }

        success++;

        // Follow newly-opened tabs after clicks
        if (action.type === 'click' || action.type === 'cdp-click') {
          const pagesAfter = this.listContextPages();
          if (pagesAfter && pagesBefore && pagesAfter.length > pagesBefore.length) {
            const newest = pagesAfter[pagesAfter.length - 1];
            await newest.bringToFront().catch(() => {});
            this.page = newest as unknown as NonNullable<typeof this.page>;
          }
        }
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        this.opts.onError?.(action, err, i);
        // X6: Navigation failures are fatals (like any other failure).
        // A page that fails to load makes all subsequent actions invalid.
        failed++;
      }

      // Delay between steps
      if (i < actions.length - 1) {
        await new Promise(r => setTimeout(r, this.opts.stepDelay));
      }
    }

    return { success, failed, skipped };
  }

  /** Replay a single action */
  /** Pages of the replayer page's context (best-effort; null if unavailable). */
  private listContextPages(): Array<{ bringToFront: () => Promise<void> }> | null {
    try {
      const ctx = (this.page as unknown as { context?: () => { pages?: () => unknown[] } }).context?.();
      const pages = ctx?.pages?.();
      return Array.isArray(pages) ? (pages as Array<{ bringToFront: () => Promise<void> }>) : null;
    } catch {
      return null;
    }
  }

  /**
   * Replay-time adjacent dedup (rec-duel d02/d03/d05).
   *
   * The recorder can emit both the real action signal AND the injected cdp
   * command action for a single interaction when the signal flush lags behind
   * the recorder-side dedup window (heavy snapshot capture slows polling).
   * Replaying both executes the interaction twice. Filter here: an action is
   * skipped when a nearby (≤15s apart) earlier action matches on
   * type-normalized key (selector + text) AND coordinates agree — either side
   * lacks coords (cdp actions carry none) or both are within 30px. Two real
   * clicks on the same element at different spots (canvas buttons) survive.
   */
  private dedupAdjacentActions(actions: UserAction[]): UserAction[] {
    const normType = (t: string): string =>
      t === 'cdp-click' ? 'click' : t === 'cdp-fill' ? 'input' : t;
    // Drop generic-target clicks: when describe fails to resolve a meaningful
    // element the signal lands on html/body. Replaying such a click moves the
    // mouse to the page center — destroying hover state (menus close) without
    // ever hitting the intended target (rec-duel d09).
    const generic = (a: UserAction): boolean =>
      (a.type === 'click' || a.type === 'dblclick' || a.type === 'contextmenu')
      && (a.element?.selector === 'html' || a.element?.selector === 'body');
    const keyOf = (a: UserAction): string =>
      `${normType(a.type)}|${a.element?.selector || ''}|${a.element?.text || ''}`;
    const coordsOf = (a: UserAction): { x: number; y: number } | null =>
      typeof a.x === 'number' && typeof a.y === 'number' ? { x: a.x, y: a.y } : null;
    const near = (p: { x: number; y: number }, q: { x: number; y: number }): boolean =>
      Math.abs(p.x - q.x) <= 30 && Math.abs(p.y - q.y) <= 30;
    const lastKept = new Map<string, Array<{ ts: number; c: { x: number; y: number } | null }>>();
    return actions.filter((a) => {
      if (generic(a)) return false;
      const key = keyOf(a);
      const c = coordsOf(a);
      const recent = lastKept.get(key) || [];
      const dup = recent.some(e => Math.abs(a.timestamp - e.ts) <= 15000
        && (!c || !e.c || near(c, e.c)));
      if (dup) return false;
      recent.push({ ts: a.timestamp, c });
      lastKept.set(key, recent);
      return true;
    });
  }

  private async replayAction(action: UserAction): Promise<void> {    const page = this.page!;
    const timeout = this.opts.stepTimeout;

    switch (action.type) {
      // Proactive sensing actions are observations, not user actions — skip
      // them during replay (they don't represent anything the user did).
      case 'popup_appear':
      case 'discovered_filters':
        return;

      case 'navigation':
        // X3: waitUntil: 'load' ensures the page is fully loaded
        // before subsequent actions try to interact with elements.
        await page.goto(action.url, { waitUntil: 'load', timeout });
        break;

      case 'goto':
        await page.goto(action.url, { waitUntil: 'load', timeout });
        break;

      case 'click':
      case 'cdp-click': {
        // Coordinate-faithful click: when the recording captured x/y AND the
        // resolved element actually contains that point, click the recorded
        // coordinates instead of the element center — required when one
        // element hosts multiple hit targets (canvas buttons, rec-duel d05).
        const selector = await this.resolveAndWait(action);
        if (typeof action.x === 'number' && typeof action.y === 'number') {
          const hit = await page.evaluate<boolean>(`
            (function() {
              const el = ${queryJS(selector)};
              if (!el) return false;
              const r = el.getBoundingClientRect();
              return ${action.x} >= r.x - 2 && ${action.x} <= r.x + r.width + 2
                  && ${action.y} >= r.y - 2 && ${action.y} <= r.y + r.height + 2;
            })()
          `).catch(() => false);
          if (hit) {
            await page.mouse.click(action.x, action.y, { stealth: true });
            break;
          }
        }
        await page.click(selector, { timeout });
        break;
      }

      case 'scroll': {
        // value format "direction:distance" (encoded by the daemon on record)
        const [dir, distStr] = (action.value || 'down:300').split(':');
        const dist = Number(distStr) || 300;
        const sign = dir === 'up' ? -1 : dir === 'left' ? 0 : 1;
        const selector = await this.resolveAndWait(action).catch(() => undefined);
        if (selector) {
          await page.evaluate(`
            (function() {
              const el = ${queryJS(selector)};
              if (el) el.scrollTop += ${sign * dist};
            })()
          `).catch(() => {});
        } else {
          await page.evaluate(`window.scrollBy(0, ${sign * dist})`).catch(() => {});
        }
        break;
      }

      case 'input': {
        const selector = await this.resolveAndWait(action);
        await page.fill(selector, action.value ?? '', { timeout });
        break;
      }

      case 'cdp-fill': {
        const selector = await this.resolveAndWait(action);
        await page.fill(selector, action.value ?? '', { timeout });
        break;
      }

      case 'change': {
        // select element change
        const selector = await this.resolveAndWait(action);
        if (action.value) {
          await page.selectOption(selector, action.value);
        }
        break;
      }

      case 'filechooser': {
        const selector = await this.resolveAndWait(action);
        const files = this.resolveFiles(action);
        if (files.length > 0) {
          await page.setInputFiles(selector, files);
        }
        break;
      }

      case 'keydown': {
        const key = action.key ?? '';
        // Special keys
        if (key === 'Enter' || key === 'Tab' || key === 'Escape') {
          await page.keyboard.press(key);
        } else if (key === 'Backspace') {
          await page.keyboard.press('Backspace');
        } else if (key === 'Delete') {
          await page.keyboard.press('Delete');
        } else if (key.startsWith('Arrow')) {
          await page.keyboard.press(key);
        } else if (key.includes('+')) {
          // Modifier combination like Ctrl+C, Meta+Shift+Z
          await page.keyboard.press(key.replace('Meta', 'Meta').replace('Ctrl', 'Control'));
        }
        break;
      }

      case 'dblclick': {
        const selector = this.resolveSelector(action);
        if (selector) {
          await page.waitForSelector(selector, { state: 'visible', timeout });
          await page.dblclick(selector, { timeout });
        } else if (action.x !== undefined && action.y !== undefined) {
          await page.mouse.dblclick(action.x, action.y);
        }
        break;
      }

      case 'contextmenu': {
        const selector = this.resolveSelector(action);
        if (selector) {
          await page.waitForSelector(selector, { state: 'visible', timeout });
          await page.click(selector, { button: 'right', timeout });
        } else if (action.x !== undefined && action.y !== undefined) {
          await page.mouse.click(action.x, action.y, { button: 'right' });
        }
        break;
      }

      case 'hover': {
        const selector = await this.resolveAndWait(action);
        if (selector) {
          await page.hover(selector);
        }
        // If the recording captured popups that appeared after this hover,
        // wait briefly for the first one to become visible so a subsequent
        // click on an item inside it can resolve reliably.
        const firstPopup = action.hoverContext?.appeared?.[0];
        if (firstPopup?.selector) {
          try {
            await page.waitForSelector(firstPopup.selector, {
              state: 'visible',
              timeout: 1000,
            });
          } catch {
            // Popup may legitimately not reappear (e.g. timing differs on replay);
            // fall through and let the next action attempt its own resolution.
          }
        }
        break;
      }

      case 'drag': {
        if (action.drag) {
          const { fromX, fromY, toX, toY } = action.drag;
          await page.mouse.move(fromX, fromY);
          await page.mouse.down();
          // Move in steps for realistic drag
          const steps = 5;
          for (let i = 1; i <= steps; i++) {
            await page.mouse.move(
              fromX + (toX - fromX) * i / steps,
              fromY + (toY - fromY) * i / steps,
            );
            await new Promise(r => setTimeout(r, 30));
          }
          await page.mouse.up();
        }
        break;
      }

      case 'resize': {
        // Resize is informational — no replay needed (viewport is controlled externally)
        break;
      }

      case 'clipboard': {
        // Clipboard operations are informational — the actual content change
        // is captured by input events
        break;
      }

      case 'touch': {
        if (action.touch) {
          const { touchType, touches } = action.touch;
          if (touchType === 'start' && touches.length > 0) {
            await page.mouse.move(touches[0].x, touches[0].y);
            await page.mouse.down();
          } else if (touchType === 'end' && touches.length > 0) {
            await page.mouse.move(touches[0].x, touches[0].y);
            await page.mouse.up();
          }
        }
        break;
      }

      case 'focus': {
        const selector = await this.resolveAndWait(action);
        if (action.focus?.focusType === 'focus') {
          // X4: Use locator.focus() instead of page.click() to avoid
          // unintended duplicate clicks. XBLocator supports focus().
          await page.locator(selector).focus();
        }
        break;
      }

      case 'visibility': {
        // Tab visibility change is informational — no replay
        break;
      }

      case 'submit': {
        // X5: Use form.requestSubmit() instead of page.click() to trigger
        // the proper submit event. The selector points to the <form> element
        // recorded during the submit action. If the form doesn't have
        // requestSubmit, fall back to dispatching a submit event.
        const selector = await this.resolveAndWait(action);
        await page.evaluate((sel: string) => {
          const form = document.querySelector<HTMLFormElement>(sel);
          if (!form) return;
          if (typeof form.requestSubmit === 'function') {
            form.requestSubmit();
          } else {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          }
        }, selector);
        break;
      }

      case 'scroll': {
        await page.evaluate(() => {
          window.scrollBy(action.scrollX ?? 0, action.scrollY ?? 0);
        });
        break;
      }

      default:
        // Unknown action type — skip
        break;
    }
  }

  /** Replay a mouse trajectory (smooth movement between actions) */
  private async replayTrajectory(trajectory: NonNullable<UserAction['trajectory']>): Promise<void> {
    const page = this.page!;
    const { points } = trajectory;

    if (!points || points.length < 2) return;

    // Move mouse along the simplified waypoints with original timing
    for (let i = 0; i < points.length; i++) {
      const { x, y, dt } = points[i];

      // Wait the recorded delta time (clamped to 0-200ms per segment for safety)
      if (dt > 0) {
        await new Promise(r => setTimeout(r, Math.min(dt, 200)));
      }

      await page.mouse.move(x, y);
    }
  }

  /** Resolve the best selector for an action (primary selector only) */
  private resolveSelector(action: UserAction): string {
    const el = action.element;
    if (!el) return '';

    if (el.selector) {
      return el.selector;
    }

    if (el.tag) {
      return el.tag;
    }

    return '';
  }

  /**
   * S202: 自愈选择器解析——主选择器失败后，生成语义备选并逐级尝试。
   *
   * Fallback chain:
   *   1. Primary selector + textFallback + tag (existing)
   *   2. Partial id match (extract stable substring from original id)
   *   3. Type-based (input[type=text] etc — survives id/class/name mutations)
   *   4. Tag + positional (form input:nth-of-type(N))
   *   5. Text content match (visible text contains a stable substring)
   */
  private async healResolve(action: UserAction, primaryFailed: string[]): Promise<{ selector: string; strategy: string }> {
    const page = this.page!;
    const el = action.element;
    const timeout = Math.min(this.opts.stepTimeout, 5000);

    // 从 primary selector 提取语义核心（用于部分匹配）
    const coreId = this.extractSemanticCore(primaryFailed[0] || '');
    const tagName = el?.tag || 'input';

    // 生成语义备选选择器
    const candidates: Array<{ sel: string; strategy: string }> = [];

    // 2a. 部分 id 匹配（original id 可能只是加了后缀）
    if (coreId) {
      candidates.push({ sel: `[id*="${coreId}"]`, strategy: 'partial-id' });
    }

    // 2b. name 属性部分匹配
    if (coreId) {
      candidates.push({ sel: `[name*="${coreId}"]`, strategy: 'partial-name' });
    }

    // 2c. placeholder 部分匹配
    if (coreId) {
      candidates.push({ sel: `[placeholder*="${coreId}"]`, strategy: 'partial-placeholder' });
    }

    // 2d. aria-label / data-testid
    if (coreId) {
      candidates.push({ sel: `[aria-label*="${coreId}"]`, strategy: 'aria-label' });
      candidates.push({ sel: `[data-testid*="${coreId}"]`, strategy: 'data-testid' });
    }

    // 2f. class 核心部分匹配（S203 cron r3）：class 改版常见形态是加后缀/
    // 前缀装饰（css-modules 全哈希除外），录制时的 class 核心仍是锚点。
    // 仅当主选择器本身是 class 型时生成——id/name 录制不添无谓候选。
    if (coreId && primaryFailed[0]?.trimStart().startsWith('.')) {
      candidates.push({ sel: `[class*="${coreId}"]`, strategy: 'partial-class' });
    }

    // 2e. 录制元数据候选（S203 cron r2）：element.type/placeholder/ariaLabel
    // 是录制器实捕的属性快照，不随 id/class/name 变异消失——id 随机化后
    // coreId 全灭时仍能确定性消歧（type=text vs password vs email 逐字段唯一），
    // 且内容定位不依赖文档序，shuffleForm 重排不影响。
    if (el?.type) {
      candidates.push({ sel: `${tagName}[type="${el.type}"]`, strategy: 'meta-type' });
    }
    if (el?.placeholder) {
      candidates.push({ sel: `[placeholder="${el.placeholder}"]`, strategy: 'meta-placeholder' });
    }
    if (el?.ariaLabel) {
      candidates.push({ sel: `[aria-label="${el.ariaLabel}"]`, strategy: 'meta-aria' });
    }

    // 3. type-based（input[type=text] 等不随 DOM 变异改变）
    const typeMap: Record<string, string> = {
      username: 'text', password: 'password', email: 'email',
      search: 'search', phone: 'tel', url: 'url',
    };
    if (typeMap[coreId]) {
      candidates.push({ sel: `${tagName}[type="${typeMap[coreId]}"]`, strategy: 'type-based' });
    }

    // 4. tag 直接匹配（textarea/select/button 天然少量）
    const uniqueTags = ['textarea', 'select'];
    if (uniqueTags.includes(tagName)) {
      candidates.push({ sel: tagName, strategy: 'tag-unique' });
    }

    // 5. tag + positional（form 内第 N 个 input/button）
    candidates.push({ sel: `form ${tagName}:first-of-type`, strategy: 'tag-first' });
    candidates.push({ sel: `form ${tagName}`, strategy: 'tag-in-form' });

    // 批量探测（S203 cron r4）：此前逐候选 waitForSelector，每个 miss 都烧满
    // 超时（N 候选最坏 N×stepTimeout，单动作实测 18s）。一次 evaluate 批测
    // 全部候选的存在性，再按优先级只对命中者做短确认等待；无命中时快速
    // 重试数次兜底异步渲染。
    const probeList = candidates.filter(c => c.sel && c.sel !== primaryFailed[0]);
    const probeSels = [...new Set(probeList.map(c => c.sel))];
    let hitSels: string[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 200));
      hitSels = await page.evaluate<string[]>(`
        (function() {
          var sels = ${JSON.stringify(probeSels)};
          var hits = [];
          for (var i = 0; i < sels.length; i++) {
            try { if (document.querySelector(sels[i])) hits.push(sels[i]); } catch (e) { /* invalid selector */ }
          }
          return hits;
        })()
      `).catch(() => []);
      if (hitSels.length > 0) break;
    }

    for (const c of probeList) {
      if (!hitSels.includes(c.sel)) continue;
      try {
        await page.waitForSelector(c.sel, { state: 'visible', timeout: Math.min(timeout, 1000) });
        return { selector: c.sel, strategy: c.strategy };
      } catch {
        // 存在但不可见——试下一个命中
      }
    }

    throw new Error(`Self-healing exhausted all ${candidates.length} strategies. Primary: ${primaryFailed.join(', ')}`);
  }

  /** 从选择器字符串提取语义核心（去掉版本号/前缀/后缀等噪声） */
  private extractSemanticCore(selector: string): string {
    // 提取 id 值（#username-input-v3 → username-input-v3）
    const idMatch = selector.match(/#([\w-]+)/);
    if (idMatch) {
      // 去掉版本号后缀（-v3, -v2 等）
      return idMatch[1].replace(/-v\d+$/, '').replace(/-mut$/, '');
    }
    // 提取 name 值（[name="username"] → username）
    const nameMatch = selector.match(/\[name=["']([\w-]+)["']\]/);
    if (nameMatch) return nameMatch[1];
    // 提取 placeholder 值
    const phMatch = selector.match(/\[placeholder=["']([\w-]+)["']\]/);
    if (phMatch) return phMatch[1];
    // 提取 data-testid
    const dtMatch = selector.match(/\[data-testid=["']([\w-]+)["']\]/);
    if (dtMatch) return dtMatch[1];
    // class 核心（S203 cron r3）：class 型主选择器（.btn-primary）此前返回空，
    // 导致 class 录制在改版后只剩盲位置候选
    const classMatch = selector.match(/\.([\w-]+)/);
    if (classMatch) return classMatch[1];
    return '';
  }

  /**
   * X2: Wait for an element using the best available selector, with
   * confidence-based fallback support.
   *
   * Returns the first matching selector, or throws if none match.
   * Fallback order:
   *   1. Primary CSS selector (always tried first)
   *   2. textFallback selector (used when primary fails — not just for low
   *      confidence, since high-confidence selectors from dynamic attributes
   *      like data-spm-anchor-id can also fail on replay)
   *   3. Tag-based fallback (last resort)
   */
  private async resolveAndWait(action: UserAction): Promise<string> {
    const el = action.element;
    if (!el) throw new Error('No element metadata');

    const page = this.page!;
    const timeout = this.opts.stepTimeout;

    // Build ordered candidate list
    const candidates: string[] = [];
    if (el.selector) candidates.push(el.selector);
    // Fall back to textFallback whenever primary may fail (low confidence OR
    // dynamic attribute source) — replay will try each in order.
    if (el.textFallback?.selector && !candidates.includes(el.textFallback.selector)) {
      candidates.push(el.textFallback.selector);
    }
    // Bare-tag fallback only for naturally unique tags. A bare 'input'/'button'
    // resolves to the FIRST match on the page — it silently targets the wrong
    // element AND short-circuits healResolve (S203 production arena: semantic
    // correctness 40%, healed=0 across every attack level). Generic tags fall
    // through to the heal chain, which still tries form-scoped tag candidates
    // after the semantic ones.
    const UNIQUE_TAGS = new Set(['textarea', 'select']);
    if (el.tag && UNIQUE_TAGS.has(el.tag) && !candidates.includes(el.tag)) {
      candidates.push(el.tag);
    }

    if (candidates.length === 0 && this.opts.selfHealing === false) {
      throw new Error('No selector available for element');
    }

    // Try each candidate in order
    for (const sel of candidates) {
      try {
        await page.waitForSelector(sel, { state: 'visible', timeout });
        return sel;
      } catch {
        // Try next fallback
      }
    }

    // S202: 自愈回放——所有候选选择器失败时，尝试语义备选
    if (this.opts.selfHealing !== false) {
      try {
        const healed = await this.healResolve(action, candidates);
        this.opts.onHealed?.(action, healed.strategy, candidates.length);
        return healed.selector;
      } catch {
        // Self-healing also failed — rethrow original error
      }
    }

    if (candidates.length === 0) throw new Error('No selector available for element');
    throw new Error(`Element not found, tried: ${candidates.join(', ')}`);
  }

  /** Resolve file payloads from a filechooser action */
  private resolveFiles(action: UserAction): XBFilePayload[] {
    if (!action.files?.fileData) return [];

    return action.files.fileData
      .filter(f => f.dataUrl)
      .map(f => {
        // dataUrl format: "data:<mime>;base64,<base64data>"
        const match = f.dataUrl!.match(/^data:[^;]+;base64,(.+)$/);
        if (!match) return null;
        return {
          name: f.name,
          mimeType: f.type || 'application/octet-stream',
          buffer: Buffer.from(match[1], 'base64'),
        } as XBFilePayload;
      })
      .filter((f): f is XBFilePayload => f !== null);
  }

  /** Clean up */
  async close(): Promise<void> {
    // Don't close the browser — just disconnect
    this.page = null;
  }
}
