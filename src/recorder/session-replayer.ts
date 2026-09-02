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
import { queryJS, queryAllDeepJS } from '../cdp-driver/selector-utils.js';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/** r12: heal 知识条目 TTL——写入时剪枝，长期未验证的映射不配继续占位 */
const HEAL_KB_TTL_DAYS = 30;

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
  /** r10: heal 知识库目录（默认 ~/.xbrowser/knowledge）。同域 heal 命中
   * 写回、二次回放直接复用；设为空串可关闭。 */
  healKnowledgeDir?: string;
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
      healKnowledgeDir: opts.healKnowledgeDir ?? join(homedir(), '.xbrowser', 'knowledge'),
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
  async run(): Promise<{
    success: number; failed: number; skipped: number;
    healed: number; healedDetails: Array<{ index: number; strategy: string }>;
  }> {
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
    const healedDetails: Array<{ index: number; strategy: string }> = [];

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      this.opts.onStep?.(action, i, actions.length);

      // Tab-following: a click may open a new tab (target=_blank). Track the
      // context's page count; when it grows, follow the newest page so the
      // next action (recorded in that tab) replays against the right target (d07).
      const pagesBefore = this.listContextPages();

      // r13: 包装 onHealed 收集本步 heal 明细（step index 比候选数更有意义）
      const prevOnHealed = this.opts.onHealed;
      this.opts.onHealed = (a, strategy, idx) => {
        healedDetails.push({ index: i, strategy });
        prevOnHealed?.(a, strategy, idx);
      };

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
      } finally {
        this.opts.onHealed = prevOnHealed;
      }

      // Delay between steps
      if (i < actions.length - 1) {
        await new Promise(r => setTimeout(r, this.opts.stepDelay));
      }
    }

    return {
      success, failed, skipped,
      healed: healedDetails.length,
      healedDetails,
    };
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
      // 双生窗口收窄（r20）：cdp 注入回声的延迟受录制端 flush 约束
      //（约 1.5-2s）。旧 15s 窗口会把人类节奏的合法重复动作（连点加购、
      // 二次提交）误杀成双生——购物车少一件这类静默错账。
      const dup = recent.some(e => {
        if (Math.abs(a.timestamp - e.ts) > 2500) return false;
        if (!c || !e.c) return true; // 一侧无坐标 = cdp 双生签名
        return near(c, e.c);
      });
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
        // r23: 接入 resolveAndWait（自愈链）——此前走 resolveSelector，
        // 选择器失效即失败且无指纹/遮挡保护，裸 tag 还会误点第一个同 tag 元素
        const selector = await this.resolveAndWait(action).catch(() => '');
        if (selector) {
          await page.dblclick(selector, { timeout });
        } else if (action.x !== undefined && action.y !== undefined) {
          await page.mouse.dblclick(action.x, action.y);
        }
        break;
      }

      case 'contextmenu': {
        const selector = await this.resolveAndWait(action).catch(() => '');
        if (selector) {
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

    // 0. 知识复用（r10）：同域同主选择器的既往 heal 直接复用——二次回放
    //    零成本自愈。可见性 + 指纹硬检通过才复用；失效则遗忘并落入常规链。
    const domain = this.pageDomain(action);
    if (this.opts.healKnowledgeDir) {
      const known = this.lookupHealKnowledge(domain, primaryFailed[0] ?? '');
      if (known) {
        try {
          await page.waitForSelector(known.healed, { state: 'visible', timeout: Math.min(timeout, 2000) });
          const verdict = await this.verifyHealHit(action, known.healed);
          if (verdict !== 'hard') {
            this.bumpHealKnowledge(domain, primaryFailed[0] ?? '');
            return { selector: known.healed, strategy: 'known-heal' };
          }
          this.forgetHealKnowledge(domain, primaryFailed[0] ?? '');
        } catch {
          this.forgetHealKnowledge(domain, primaryFailed[0] ?? '');
        }
      }
    }

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

    // 2g. 文案锚点（r15）：class/id 全量替换（非后缀装饰）是改版常态，而
    // 按钮文案极少动——录制文案是最强内容锚。仅对 button/a 等文本承载
    // 元素生成（input 的录制 text 是当时的 value，不可靠）。
    // r25 排序：内容锚（text/label）先于 meta 属性——内容是更强的身份证据，
    // 同指纹多匹配时 meta 型候选易被同 type 元素稀释。
    const anchorText = (el?.text || '').trim().replace(/"/g, '');
    if (anchorText && (tagName === 'button' || tagName === 'a')) {
      candidates.push({
        sel: `xpath=//${tagName}[contains(normalize-space(.), "${anchorText}")]`,
        strategy: 'text-anchor',
      });
    }

    // 2h. label 锚点（r16）：表单行重排/虚拟列表重建后结构序失效，但 label
    // 文本与控件同行移动——内容走到哪锚点跟到哪。两条路径：label 包裹
    // （后代控件）与 label[for] 关联（按 id 反查）。
    const labelText = (el?.labelText || '').trim().replace(/"/g, '');
    if (labelText) {
      candidates.push({
        sel: `xpath=//label[contains(normalize-space(.), "${labelText}")]//${tagName}`,
        strategy: 'label-anchor',
      });
      candidates.push({
        sel: `xpath=//${tagName}[@id=(//label[contains(normalize-space(.), "${labelText}")]/@for)]`,
        strategy: 'label-for-anchor',
      });
    }

    // 2i. 行文本锚点（r27）：表格/列表行（tr/li）重排后 ordinal 失效，行内
    // 文本随内容移动——label 缺失的行式表单（表格单元格里的 input）靠它锚定。
    const rowText = (el?.rowText || '').trim().replace(/"/g, '');
    if (rowText) {
      candidates.push({
        sel: `xpath=//tr[contains(normalize-space(.), "${rowText}")]//${tagName}`,
        strategy: 'row-anchor',
      });
      candidates.push({
        sel: `xpath=//li[contains(normalize-space(.), "${rowText}")]//${tagName}`,
        strategy: 'row-anchor',
      });
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

    // 5b. 录制序号定位（r6）：describe 时的结构地址快照。布局位移（banner
    // 插入/视口变化）使坐标失效，但结构序保持时此处仍精确命中。仅 form
    // 直接子元素有捕获（ordinal 为空则跳过）。
    const ord = el?.ordinal;
    if (ord && ord.formNth > 0 && ord.tagNth > 0) {
      candidates.push({
        sel: `form:nth-of-type(${ord.formNth}) ${tagName}:nth-of-type(${ord.tagNth})`,
        strategy: 'ordinal',
      });
    }

    // 5. tag + positional（form 内第 N 个 input/button）
    candidates.push({ sel: `form ${tagName}:first-of-type`, strategy: 'tag-first' });
    candidates.push({ sel: `form ${tagName}`, strategy: 'tag-in-form' });

    // 批量探测（S203 cron r4）+ 三层优先级（r5）：
    //   语义候选（partial/meta/唯一 tag）→ 坐标兜底 → 盲位置候选。
    // 盲位置（tag-first/tag-in-form）恒可命中且是 wrong-target 惯犯，必须
    // 排在坐标之后——否则永远饿死坐标层（r5 首跑实测 0/2 教训）。
    const blindPositional = new Set(['tag-first', 'tag-in-form']);
    const inList = (c: { sel: string; strategy: string }): boolean =>
      !!c.sel && c.sel !== primaryFailed[0];
    const semanticList = candidates.filter(c => inList(c) && !blindPositional.has(c.strategy));
    const blindList = candidates.filter(c => inList(c) && blindPositional.has(c.strategy));

    const tryProbe = async (
      list: Array<{ sel: string; strategy: string }>,
    ): Promise<{ kind: 'hit' | 'alt'; hit: { selector: string; strategy: string } } | null> => {
      const probeSels = [...new Set(list.map(c => c.sel))];
      if (probeSels.length === 0) return null;
      // r25: 指纹逐匹配评分——每候选取深查全部匹配，页内按录制指纹打分：
      //   type/placeholder 正性矛盾 = -1 淘汰；text 正性矛盾 = 1（软）；
      //   干净 = 10 + labelText 命中 +2 + 尺寸 ±40% 内 +1。
      // 取每候选最优匹配，按候选优先级取第一个含非淘汰匹配者；最优匹配
      // 非首个时用组合树 nth-of-type 路径钉住。解决"首个匹配是同指纹诱饵"
      // 的整候选误选（旧逻辑只看每个候选的第一个匹配）。
      const probeExprs = JSON.stringify(probeSels.map(s => queryAllDeepJS(s)));
      const metaJson = JSON.stringify({
        type: el?.type ?? null,
        placeholder: el?.placeholder ?? null,
        text: (el?.text || '').trim(),
        labelText: (el?.labelText || '').trim(),
        size: el?.size ?? null,
      });
      const probeSrc = `
        (function() {
          var sels = ${JSON.stringify(probeSels)};
          var meta = ${metaJson};
          var pairs = ${probeExprs};
          function pathOf(m) {
            var root = m.getRootNode ? m.getRootNode() : null;
            if (root && root.nodeType !== 9) return null; // 阴影/iframe——路径不跨界，退回原选择器
            var parts = [];
            var cur = m;
            while (cur && cur !== document.body) {
              var parent = cur.parentElement;
              if (!parent) return null;
              var same = Array.prototype.filter.call(parent.children, function(c) { return c.tagName === cur.tagName; });
              parts.unshift(cur.tagName.toLowerCase() + ':nth-of-type(' + (same.indexOf(cur) + 1) + ')');
              cur = parent;
            }
            return parts.length ? parts.join(' > ') : null;
          }
          function scoreMatch(m) {
            var mt = m.getAttribute ? m.getAttribute('type') : null;
            var mp = m.getAttribute ? m.getAttribute('placeholder') : null;
            var mtext = (String(m.value ?? '') || m.textContent || '').trim().slice(0, 80);
            if (meta.type && mt && mt !== meta.type) return -1;
            if (meta.placeholder && mp && mp !== meta.placeholder) return -1;
            var s = 10;
            if (meta.text && mtext && mtext.indexOf(meta.text) === -1) s = 1;
            if (meta.labelText) {
              var label = '';
              try {
                var lb = m.closest ? m.closest('label') : null;
                if (lb) label = (lb.textContent || '').trim();
              } catch (e) {}
              if (label && label.indexOf(meta.labelText) !== -1) s += 2;
            }
            if (meta.size) {
              var r = m.getBoundingClientRect();
              if (r.width > 0 && r.height > 0) {
                var dw = Math.abs(r.width - meta.size.w) / Math.max(meta.size.w, 1);
                var dh = Math.abs(r.height - meta.size.h) / Math.max(meta.size.h, 1);
                if (dw <= 0.4 && dh <= 0.4) s += 1;
              }
            }
            return s;
          }
          var best = null;
          for (var i = 0; i < sels.length; i++) {
            var matches = [];
            try { matches = (new Function('return (' + pairs[i] + ')'))() || []; } catch (e) { continue; }
            var cap = Math.min(matches.length, 20);
            var candBest = null;
            for (var k = 0; k < cap; k++) {
              var m = matches[k];
              if (!m) continue;
              var sc = scoreMatch(m);
              if (sc < 0) continue;
              if (!candBest || sc > candBest.score) {
                candBest = { score: sc, k: k, soft: sc <= 1 };
              }
            }
            if (candBest && (!best || candBest.score > best.score)) {
              var pinned = candBest.k > 0 ? pathOf(matches[candBest.k]) : null;
              if (candBest.k === 0 || pinned) {
                best = { selIndex: i, k: candBest.k, pinned: pinned, soft: candBest.soft };
              }
            }
          }
          return best;
        })()
      `;
      let best: { selIndex: number; k: number; pinned: string | null; soft: boolean } | null = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 200));
        best = await page
          .evaluate<{ selIndex: number; k: number; pinned: string | null; soft: boolean } | null>(probeSrc)
          .catch((e) => {
            if (process.env.XBROWSER_HEAL_DEBUG) console.error('[heal] probe evaluate error:', e instanceof Error ? e.message.split('\n')[0] : String(e).slice(0, 200));
            return null;
          });
        if (best) break;
      }
      if (!best) return null;

      const originSel = probeSels[best.selIndex];
      const finalSel = best.pinned ?? originSel;
      const strategyName = list.find(c => c.sel === originSel)?.strategy ?? 'probe';
      if (process.env.XBROWSER_HEAL_DEBUG) {
        console.error(`[heal] cand=${finalSel} (via ${originSel}) soft=${best.soft}`);
      }
      try {
        await page.waitForSelector(finalSel, { state: 'visible', timeout: Math.min(timeout, 1000) });
        // click 类动作遮挡确认（r9）——pinned 元素被盖时整层放弃，交给坐标/盲位置
        const needsHitTest = action.type === 'click' || action.type === 'cdp-click';
        if (needsHitTest && await this.isClickOccluded(finalSel)) return null;
        return {
          kind: best.soft ? 'alt' : 'hit',
          hit: { selector: finalSel, strategy: strategyName },
        };
      } catch {
        return null;
      }
    };

    const semanticHit = await tryProbe(semanticList);
    if (semanticHit?.kind === 'hit') return semanticHit.hit;

    // 坐标兜底（S203 cron r5，AGENTS §20.6 承诺的最终兜底）：属性全灭且
    // 布局未变时，录制的视口 x/y 仍指向目标——elementFromPoint 反解
    // nth-of-type 路径。tag 匹配守卫：遮挡层在顶时会指错元素，tag 不符即弃。
    // 已知限制：坐标是视口相对，回放时页面滚动状态不同则失效。
    if (typeof action.x === 'number' && typeof action.y === 'number') {
      try {
        const pathSel = await page.evaluate<string>(`
          (function() {
            var el = document.elementFromPoint(${action.x}, ${action.y});
            if (!el || el === document.body || el === document.documentElement) return '';
            if (el.tagName.toLowerCase() !== ${JSON.stringify(el?.tag ?? '')}) return '';
            var parts = [];
            var cur = el;
            while (cur && cur !== document.body) {
              var parent = cur.parentElement;
              if (!parent) break;
              var same = Array.prototype.filter.call(parent.children, function(c) { return c.tagName === cur.tagName; });
              parts.unshift(cur.tagName.toLowerCase() + ':nth-of-type(' + (same.indexOf(cur) + 1) + ')');
              cur = parent;
            }
            return parts.length ? parts.join(' > ') : '';
          })()
        `);
        if (pathSel) {
          await page.waitForSelector(pathSel, { state: 'visible', timeout: Math.min(timeout, 1000) });
          return { selector: pathSel, strategy: 'coords' };
        }
      } catch {
        // 坐标兜底失败——落入盲位置层
      }
    }

    const blindHit = await tryProbe(blindList);
    if (blindHit?.kind === 'hit') return blindHit.hit;

    // 软矛盾备选（r8）：文案改版下正确元素被 text 校验降级——全链无干净
    // 命中时启用，宁可用"标签可疑但结构正确"的元素也不放弃回放。
    // r13: ~soft 后缀标记低置信，onHealed/run() 消费方可观测。
    const softAlt = semanticHit?.kind === 'alt' ? semanticHit.hit : (blindHit?.kind === 'alt' ? blindHit.hit : null);
    if (softAlt) return { selector: softAlt.selector, strategy: `${softAlt.strategy}~soft` };

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

  // ── heal 知识库（r10）：heal 一次、同域记住、二次回放零成本 ──

  private pageDomain(action: UserAction): string {
    try {
      const u = new URL(action.url || this.page!.url());
      return u.hostname || u.protocol.replace(':', '') || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private healKnowledgeFile(domain: string): string {
    return join(this.opts.healKnowledgeDir as string, `heals-${domain}.json`);
  }

  private readHealFile(file: string): Record<string, { healed: string; strategy: string; lastSeen: string; hits: number }> {
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return {};
    }
  }

  private lookupHealKnowledge(domain: string, primary: string): { healed: string; strategy: string } | null {
    if (!primary || !this.opts.healKnowledgeDir) return null;
    const data = this.readHealFile(this.healKnowledgeFile(domain));
    const e = data[primary];
    return e ? { healed: e.healed, strategy: e.strategy } : null;
  }

  private persistHealKnowledge(action: UserAction, primary: string, healed: { selector: string; strategy: string }): void {
    if (!this.opts.healKnowledgeDir || !primary || healed.strategy === 'known-heal') return;
    try {
      const file = this.healKnowledgeFile(this.pageDomain(action));
      const data = this.readHealFile(file);
      data[primary] = {
        healed: healed.selector,
        strategy: healed.strategy,
        lastSeen: new Date().toISOString(),
        hits: (data[primary]?.hits ?? 0) + 1,
      };
      // TTL 剪枝（r12）：超期条目在写入时一并清除，文件不无界增长
      const cutoff = Date.now() - HEAL_KB_TTL_DAYS * 86_400_000;
      for (const k of Object.keys(data)) {
        const ts = Date.parse(data[k]?.lastSeen ?? '');
        if (!(ts >= cutoff)) delete data[k];
      }
      mkdirSync(this.opts.healKnowledgeDir, { recursive: true });
      writeFileSync(file, JSON.stringify(data, null, 2));
    } catch {
      // 知识沉淀失败不阻塞回放
    }
  }

  private bumpHealKnowledge(domain: string, primary: string): void {
    try {
      const file = this.healKnowledgeFile(domain);
      const data = this.readHealFile(file);
      const e = data[primary];
      if (!e) return;
      e.hits += 1;
      e.lastSeen = new Date().toISOString();
      writeFileSync(file, JSON.stringify(data, null, 2));
    } catch { /* best-effort */ }
  }

  private forgetHealKnowledge(domain: string, primary: string): void {
    try {
      const file = this.healKnowledgeFile(domain);
      const data = this.readHealFile(file);
      if (!data[primary]) return;
      delete data[primary];
      writeFileSync(file, JSON.stringify(data, null, 2));
    } catch { /* best-effort */ }
  }

  /**
   * r9: click 类动作遮挡校验——元素"可见"（rect+样式）但被覆盖层（弹窗/
   * 横幅）盖住时，点击只会落在覆盖层上。elementFromPoint 顶元素非目标
   * 自身/子孙即判遮挡。视口外（top 为 null）不判定——点击路径会自行滚动。
   * r17: 阴影边界重定向——elementFromPoint 对阴影内命中点返回宿主，
   * el.contains 不跨 shadow 边界，需沿 getRootNode().host 攀升做组合树
   * 祖先判定，否则阴影内元素恒误判遮挡。
   */
  private async isClickOccluded(selector: string): Promise<boolean> {
    try {
      return await this.page!.evaluate<boolean>(`
        (function() {
          var el = ${queryJS(selector)};
          if (!el) return true;
          var r = el.getBoundingClientRect();
          var top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          if (!top) return false;
          function chainReaches(node, stop) {
            while (node) {
              if (node === stop) return true;
              var root = node.getRootNode ? node.getRootNode() : null;
              if (root && root.host) node = root.host;
              else node = node.parentNode;
            }
            return false;
          }
          // 双向组合树判定（r17）：top 在 el 的组合子树内（命中目标的子孙），
          // 或 el 在 top 的组合祖先链上（阴影重定向：top=宿主代表影子内命中）
          var related = chainReaches(top, el) || chainReaches(el, top);
          return !related;
        })()
      `);
    } catch {
      return false;
    }
  }

  /**
   * r7/r8: heal 命中指纹校验——"找对"而非"找到"。
   * 录制的 type/placeholder/text 与命中元素比对，裁决分三级：
   *   hard — type/placeholder 正性矛盾（两侧都有值但不等）：判 wrong-target，
   *          丢弃该候选。文案改版不会动这两个属性，硬拒不会误杀。
   *   soft — 仅 text 正性矛盾：最常见改版恰恰是文案改版，硬拒会误杀正确
   *          元素，降级为备选（alt）——全链无干净命中时才启用。
   *   pass — 无矛盾（元素侧属性缺失不算矛盾；无信号/异常放行）。
   */
  private async verifyHealHit(action: UserAction, selector: string): Promise<'pass' | 'soft' | 'hard'> {
    const m = action.element;
    if (!m?.type && !m?.placeholder && !m?.text) return 'pass';
    try {
      const meta = await this.page!.evaluate<{ type: string | null; placeholder: string | null; text: string } | null>(`
        (function() {
          var el = ${queryJS(selector)};
          if (!el) return null;
          return {
            type: el.getAttribute('type'),
            placeholder: el.getAttribute('placeholder'),
            text: (String(el.value ?? '') || el.textContent || '').trim().substring(0, 80),
          };
        })()
      `);
      if (!meta) return 'pass';
      if (m.type && meta.type && meta.type !== m.type) return 'hard';
      if (m.placeholder && meta.placeholder && meta.placeholder !== m.placeholder) return 'hard';
      const wantText = (m.text || '').trim();
      if (wantText && meta.text && !meta.text.includes(wantText)) return 'soft';
      return 'pass';
    } catch {
      return 'pass';
    }
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
    const isClick = action.type === 'click' || action.type === 'cdp-click';
    for (const sel of candidates) {
      try {
        await page.waitForSelector(sel, { state: 'visible', timeout });
        if (isClick && await this.isClickOccluded(sel)) continue; // 遮挡——点击只会落在覆盖层
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
        this.persistHealKnowledge(action, candidates[0] ?? '', healed);
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
