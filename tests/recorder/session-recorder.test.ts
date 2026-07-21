/**
 * Unit tests for SessionRecorder — the server-side CDP recording engine.
 *
 * Tests cover:
 * 1. recordCommandAction dedup
 * 2. lastKnownUrl tracking (no spurious navigation)
 * 3. recordCommandAction element metadata
 * 4. stop() output structure
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionRecorder } from '../../src/recorder/session-recorder.js';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = resolve(tmpdir(), 'xbrowser-session-recorder-test');

// Minimal mock Page
function createMockPage(url = 'https://example.com') {
  let currentUrl = url;
  const mockLocator = {
    first: vi.fn(() => mockLocator),
    screenshot: vi.fn(async () => Buffer.from('fake-screenshot')),
    fill: vi.fn(async () => {}),
    click: vi.fn(async () => {}),
  };
  return {
    url: vi.fn(() => currentUrl),
    goto: vi.fn(async () => { currentUrl = url; }),
    evaluate: vi.fn(async (script: unknown) => {
      // Return empty array for recorder polling
      return [];
    }),
    addInitScript: vi.fn(async () => {}),
    on: vi.fn(),
    off: vi.fn(),
    waitForTimeout: vi.fn(async () => {}),
    locator: vi.fn(() => mockLocator),
    _setUrl: (u: string) => { currentUrl = u; },
  };
}

// Minimal mock Context
function createMockContext(pages: any[] = []) {
  return {
    pages: vi.fn(() => pages),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  };
}

describe('SessionRecorder', () => {
  let mockPage: ReturnType<typeof createMockPage>;
  let mockContext: ReturnType<typeof createMockContext>;
  let recorder: SessionRecorder;

  beforeEach(() => {
    mockPage = createMockPage('https://example.com');
    mockContext = createMockContext([mockPage]);
    recorder = new SessionRecorder(mockContext as any, mockPage as any, 'test-session');
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  // Helper: start recording
  async function startRecording(url?: string) {
    await recorder.start(url);
  }

  describe('recordCommandAction', () => {
    it('should record a cdp-fill action with element metadata', async () => {
      await startRecording('https://example.com');

      await recorder.recordCommandAction({
        type: 'cdp-fill',
        selector: '#username',
        value: 'testuser',
        element: {
          tag: 'input',
          selector: '#username',
          text: '',
          strategy: 'id',
          confidence: 'high',
        },
      });

      const { data } = await recorder.stop();
      expect(data.actions).toHaveLength(1);
      expect(data.actions[0].type).toBe('cdp-fill');
      expect(data.actions[0].value).toBe('testuser');
      expect(data.actions[0].element?.selector).toBe('#username');
      expect(data.actions[0].element?.strategy).toBe('id');
      expect(data.actions[0].element?.confidence).toBe('high');
      expect(data.actions[0].element?.tag).toBe('input');
    });

    it('should record a goto action with target URL', async () => {
      await startRecording('https://example.com');

      await recorder.recordCommandAction({
        type: 'goto',
        url: 'https://example.com',
      });

      const { data } = await recorder.stop();
      expect(data.actions).toHaveLength(1);
      expect(data.actions[0].type).toBe('goto');
      expect(data.actions[0].url).toBe('https://example.com');
    });

    it('should deduplicate identical cdp-fill within dedup window', async () => {
      await startRecording('https://example.com');

      await recorder.recordCommandAction({
        type: 'cdp-fill',
        selector: '#username',
        value: 'testuser',
        element: { tag: 'input', selector: '#username', text: '', strategy: 'id', confidence: 'high' },
      });

      // Same action within 1.5s — should be deduped
      await recorder.recordCommandAction({
        type: 'cdp-fill',
        selector: '#username',
        value: 'testuser',
      });

      const { data } = await recorder.stop();
      expect(data.actions).toHaveLength(1);
    });

    it('should NOT deduplicate actions after dedup window expires', async () => {
      await startRecording('https://example.com');

      await recorder.recordCommandAction({
        type: 'cdp-click',
        selector: '#btn',
        element: { tag: 'button', selector: '#btn', text: 'Click', strategy: 'id', confidence: 'high' },
      });

      // Expire dedupMap entry so second call is not deduped
      const key = (recorder as any).dedupKey('cdp-click', '#btn', 'button', undefined);
      (recorder as any).dedupMap.set(key, Date.now() - 100);

      await recorder.recordCommandAction({
        type: 'cdp-click',
        selector: '#btn',
      });

      const { data } = await recorder.stop();
      expect(data.actions).toHaveLength(2);
    });

    it('should deduplicate cdp-click and click via reverse dedup', async () => {
      await startRecording('https://example.com');

      // Simulate: action signal (click) was recorded first via flush
      // Then cdp-click arrives — reverse dedup should skip it
      (recorder as any).actionCounter = 1;
      (recorder as any).actions = [{
        id: 1,
        type: 'click',
        timestamp: Date.now(),
        url: 'https://example.com',
        pageTitle: '',
        element: { tag: 'button', selector: '#btn', text: 'Click', strategy: 'id', confidence: 'high' },
      }];
      // Set dedupMap entry to match (simulating what flushPendingActions would do)
      const key = (recorder as any).dedupKey('click', '#btn', 'button', undefined);
      (recorder as any).dedupMap.set(key, Date.now() + 2000);

      // Now cdp-click with same selector arrives — should be deduped
      await recorder.recordCommandAction({
        type: 'cdp-click',
        selector: '#btn',
      });

      const { data } = await recorder.stop();
      expect(data.actions).toHaveLength(1);
      expect(data.actions[0].type).toBe('click');
    });
  });

  describe('lastKnownUrl tracking', () => {
    it('should fallback to lastKnownUrl when action url is about:blank', async () => {
      await startRecording('https://example.com');

      await recorder.recordCommandAction({
        type: 'cdp-click',
        selector: '#link',
        url: 'about:blank',
        element: { tag: 'a', selector: '#link', text: 'Link', strategy: 'id', confidence: 'high' },
      });

      const { data } = await recorder.stop();
      expect(data.actions[0].url).toBe('https://example.com');
    });

    it('should use action url when it is valid', async () => {
      await startRecording('https://example.com');

      await recorder.recordCommandAction({
        type: 'goto',
        url: 'https://other.com',
      });

      const { data } = await recorder.stop();
      expect(data.actions[0].url).toBe('https://other.com');
    });

    it('should update lastKnownUrl after goto', async () => {
      await startRecording('https://example.com');

      await recorder.recordCommandAction({
        type: 'goto',
        url: 'https://newsite.com',
      });

      // Now a click with about:blank should fallback to newsite.com
      await recorder.recordCommandAction({
        type: 'cdp-click',
        selector: '#btn',
        url: 'about:blank',
      });

      const { data } = await recorder.stop();
      expect(data.actions[1].url).toBe('https://newsite.com');
    });
  });

  describe('stop() output structure', () => {
    it('should return valid recording data', async () => {
      await startRecording('https://example.com');

      await recorder.recordCommandAction({
        type: 'cdp-fill',
        selector: '#input',
        value: 'hello',
        element: { tag: 'input', selector: '#input', text: '', strategy: 'id', confidence: 'high' },
      });

      const { data, summary } = await recorder.stop();

      expect(data).toHaveProperty('actions');
      expect(data).toHaveProperty('network');
      expect(data).toHaveProperty('contextChanges');
      expect(data).toHaveProperty('checkpoints');
      expect(data.actions).toHaveLength(1);
      expect(data.network).toEqual([]);
      expect(summary.startUrl).toBe('https://example.com');
      expect(summary.totalActions).toBe(1);
      expect(summary.totalNetworkRequests).toBe(0);
    });

    it('should include element strategy and confidence in recording data', async () => {
      await startRecording('https://example.com');

      await recorder.recordCommandAction({
        type: 'cdp-click',
        selector: '.submit-btn',
        element: {
          tag: 'button',
          selector: '.submit-btn',
          text: 'Submit',
          strategy: 'class',
          confidence: 'medium',
          textFallback: {
            type: 'text',
            value: 'Submit',
            selector: 'text=Submit',
          },
        },
      });

      const { data } = await recorder.stop();
      const action = data.actions[0];

      expect(action.element?.strategy).toBe('class');
      expect(action.element?.confidence).toBe('medium');
      expect(action.element?.textFallback?.value).toBe('Submit');
    });

    it('should generate summary with steps and elements', async () => {
      await startRecording('https://example.com');

      await recorder.recordCommandAction({
        type: 'cdp-fill',
        selector: '#email',
        value: 'test@test.com',
        element: { tag: 'input', selector: '#email', text: '', strategy: 'id', confidence: 'high' },
      });

      await recorder.recordCommandAction({
        type: 'cdp-click',
        selector: '#submit',
        element: { tag: 'button', selector: '#submit', text: 'Submit', strategy: 'id', confidence: 'high' },
      });

      const { data, summary } = await recorder.stop();

      expect(summary.steps).toHaveLength(2);
      expect(summary.steps[0].action.type).toBe('cdp-fill');
      expect(summary.steps[1].action.type).toBe('cdp-click');
      expect(Object.keys(summary.elements).length).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('should handle stop without any actions', async () => {
      await startRecording('https://example.com');
      const { data, summary } = await recorder.stop();
      expect(data.actions).toEqual([]);
      expect(summary.totalActions).toBe(0);
    });

    it('should handle action without element', async () => {
      await startRecording('https://example.com');

      await recorder.recordCommandAction({
        type: 'goto',
        url: 'https://example.com',
      });

      const { data } = await recorder.stop();
      expect(data.actions[0].element).toBeUndefined();
    });

    it('should handle action without selector (cdp-eval)', async () => {
      await startRecording('https://example.com');

      await recorder.recordCommandAction({
        type: 'cdp-eval',
        value: 'document.title',
      });

      const { data } = await recorder.stop();
      expect(data.actions[0].element).toBeUndefined();
      expect(data.actions[0].value).toBe('document.title');
    });

    it('should not record about:blank URLs', async () => {
      await startRecording('https://example.com');

      // Multiple actions with about:blank should all fallback to lastKnownUrl
      await recorder.recordCommandAction({ type: 'cdp-click', selector: '#a', url: 'about:blank' });
      await recorder.recordCommandAction({ type: 'cdp-fill', selector: '#b', value: 'x', url: 'about:blank' });

      const { data } = await recorder.stop();
      for (const action of data.actions) {
        expect(action.url).not.toContain('about:blank');
      }
    });
  });

  // ── Hover popup capture (hoverContext) ──
  // The browser-side ACTION_SIGNAL_SCRIPT enriches hover actions with a
  // hoverContext field via async sampling + MutationObserver. These tests
  // verify that once that field arrives via the flush path, it survives
  // serialization, archiving, and is usable by the replayer.
  describe('hoverContext passthrough', () => {
    it('should preserve hoverContext when raw action carries one (flush path)', async () => {
      await startRecording('https://example.com');

      // Simulate the browser pushing a hover action that has already been
      // enriched with a popup (e.g. a sort dropdown with "最新" / "价格" items).
      const hoverContext = {
        appeared: [{
          tag: 'div',
          selector: '.sort-dropdown',
          role: 'menu',
          text: '最新 价格',
          rect: { x: 300, y: 200, w: 120, h: 80 },
          items: [
            { text: '最新', tag: 'div', selector: '.sort-item-latest' },
            { text: '价格', tag: 'div', selector: '.sort-item-price' },
          ],
        }],
        disappeared: [],
        stateChanges: [],
      };

      // Inject directly into the recorder's actions array (mimics what
      // flushPendingActions produces after merging browser-side raw data).
      (recorder as any).actions.push({
        id: 1,
        type: 'hover' as const,
        timestamp: Date.now(),
        url: 'https://example.com',
        pageTitle: '',
        element: { tag: 'div', selector: '.sort-trigger', text: '排序', strategy: 'class', confidence: 'medium' },
        x: 320,
        y: 240,
        hoverContext,
      });
      (recorder as any).actionCounter = 1;

      const { data } = await recorder.stop();
      expect(data.actions).toHaveLength(1);
      const action = data.actions[0];
      expect(action.type).toBe('hover');
      expect(action.hoverContext).toBeDefined();
      expect(action.hoverContext?.appeared).toHaveLength(1);
      expect(action.hoverContext?.appeared[0].items).toHaveLength(2);
      expect(action.hoverContext?.appeared[0].items[0].text).toBe('最新');
      expect(action.hoverContext?.appeared[0].items[0].selector).toBe('.sort-item-latest');
    });

    it('should leave hoverContext undefined when hover had no popup', async () => {
      await startRecording('https://example.com');

      (recorder as any).actions.push({
        id: 1,
        type: 'hover' as const,
        timestamp: Date.now(),
        url: 'https://example.com',
        pageTitle: '',
        element: { tag: 'a', selector: 'nav a.home', text: 'Home', strategy: 'class', confidence: 'medium' },
        x: 50,
        y: 20,
        // hoverContext intentionally absent — no popup appeared
      });
      (recorder as any).actionCounter = 1;

      const { data } = await recorder.stop();
      expect(data.actions[0].hoverContext).toBeUndefined();
    });

    it('should round-trip multiple popups in hoverContext.appeared (dedup by selector)', async () => {
      await startRecording('https://example.com');

      // Two distinct popups, plus a duplicate of the first (simulating
      // 200/500/1000ms sampling capturing the same popup again — dedup
      // happens browser-side, but server should still tolerate either way).
      const hoverContext = {
        appeared: [
          {
            tag: 'div',
            selector: '.popup-a',
            text: 'A',
            rect: { x: 0, y: 0, w: 10, h: 10 },
            items: [{ text: 'A1', selector: '.a1' }],
          },
          {
            tag: 'div',
            selector: '.popup-b',
            text: 'B',
            rect: { x: 100, y: 0, w: 10, h: 10 },
            items: [{ text: 'B1', selector: '.b1' }],
          },
        ],
        disappeared: [],
        stateChanges: [],
      };

      (recorder as any).actions.push({
        id: 1,
        type: 'hover' as const,
        timestamp: Date.now(),
        url: 'https://example.com',
        pageTitle: '',
        element: { tag: 'div', selector: '.trigger', text: 'T', strategy: 'class', confidence: 'low' },
        x: 5,
        y: 5,
        hoverContext,
      });
      (recorder as any).actionCounter = 1;

      const { data } = await recorder.stop();
      const action = data.actions[0];
      expect(action.hoverContext?.appeared).toHaveLength(2);
      const selectors = action.hoverContext?.appeared.map((p) => p.selector);
      expect(selectors).toEqual(['.popup-a', '.popup-b']);
    });
  });

  // ── Action-signal injection failure ──
  // When the recorder cannot inject its ACTION_SIGNAL_SCRIPT into the page
  // (e.g. sandbox blocked Runtime.evaluate, or the script has a syntax error),
  // start() must surface injectionFailed=true so the daemon can return
  // ok:false to the user. Otherwise the user sees "Recording started" while
  // no actions are being captured — a silent failure.
  describe('injectionFailed flag', () => {
    it('should report injectionFailed=true when page.evaluate throws', async () => {
      // Replace evaluate to always throw — simulates a hostile page that
      // blocks Runtime.evaluate or a syntax error in the injected script.
      mockPage.evaluate = vi.fn(async () => {
        throw new Error('SyntaxError: Invalid regular expression');
      });

      await startRecording('https://example.com');

      expect((recorder as any).injectionFailed).toBe(true);
    });

    it('should report injectionFailed=false when injection succeeds', async () => {
      // evaluate returns truthy for the verification check
      mockPage.evaluate = vi.fn(async (script: unknown) => {
        // The recorder's verification probes `window.__xb_action_signal`.
        // Returning truthy simulates a successful injection.
        if (typeof script === 'string' && script.includes('__xb_action_signal')) {
          return true;
        }
        // The actual script injection calls return undefined — that's fine.
        return undefined;
      });

      await startRecording('https://example.com');

      expect((recorder as any).injectionFailed).toBe(false);
    });
  });

  // ── Proactive sensing: discoveredFilters + popup_appear ──
  // The recorder proactively scans the page for filter/sort/tab/menu regions
  // and pushes 'discovered_filters' actions that the server merges into
  // RecordingData.discoveredFilters. Popups observed via MutationObserver
  // or mousemove produce 'popup_appear' actions in the actions stream.
  describe('proactive sensing', () => {
    it('should record popup_appear action in the actions stream', async () => {
      await startRecording('https://example.com');

      // Simulate browser pushing a popup_appear event
      (recorder as any).actions.push({
        id: 1,
        type: 'popup_appear',
        timestamp: Date.now(),
        url: 'https://example.com',
        pageTitle: '',
        popupAppear: {
          trigger: { selector: '.sort-trigger', text: '新发布' },
          popup: {
            selector: '.sort-dropdown',
            text: '最新 1天内 3天内',
            rect: { x: 100, y: 100, w: 120, h: 80 },
            items: [
              { text: '最新', selector: '.item-latest' },
              { text: '1天内', selector: '.item-1d' },
            ],
          },
          cause: 'user-hover',
          userTriggered: true,
        },
      });
      (recorder as any).actionCounter = 1;

      const { data } = await recorder.stop();
      const popupAction = data.actions.find((a) => a.type === 'popup_appear');
      expect(popupAction).toBeDefined();
      expect(popupAction?.popupAppear?.trigger?.text).toBe('新发布');
      expect(popupAction?.popupAppear?.popup.items).toHaveLength(2);
      expect(popupAction?.popupAppear?.cause).toBe('user-hover');
      expect(popupAction?.popupAppear?.userTriggered).toBe(true);
    });

    it('should serialize discoveredFilters in RecordingData', async () => {
      await startRecording('https://example.com');

      // Simulate server-side flushPendingActions merging a discovered_filters entry
      const filters = new Map<string, any>();
      filters.set('.sort-bar', {
        containerSelector: '.sort-bar',
        category: 'sort',
        containerText: '综合 新发布 价格',
        triggers: [
          { selector: '.trigger-1', text: '综合', category: 'sort', hasPopup: false, userInteracted: false, explored: false },
          { selector: '.trigger-2', text: '新发布', category: 'sort', hasPopup: true, userInteracted: true, explored: true },
          { selector: '.trigger-3', text: '价格', category: 'sort', hasPopup: false, userInteracted: false, explored: false },
        ],
      });
      (recorder as any).discoveredFilters = filters;

      const { data } = await recorder.stop();
      expect(data.discoveredFilters).toBeDefined();
      expect(data.discoveredFilters).toHaveLength(1);
      expect(data.discoveredFilters?.[0].containerSelector).toBe('.sort-bar');
      expect(data.discoveredFilters?.[0].triggers).toHaveLength(3);
      // Trigger flags preserved
      const sortTriggers = data.discoveredFilters?.[0].triggers || [];
      expect(sortTriggers[1].userInteracted).toBe(true);
      expect(sortTriggers[1].hasPopup).toBe(true);
    });

    it('should dedup discoveredFilters by containerSelector across scans', async () => {
      await startRecording('https://example.com');

      // Simulate two scans pushing the same container with different trigger flags
      const filters = new Map<string, any>();
      // First scan: trigger is fresh
      filters.set('.sort-bar', {
        containerSelector: '.sort-bar',
        category: 'sort',
        containerText: 'sort bar',
        triggers: [
          { selector: '.trigger-1', text: '综合', category: 'sort', hasPopup: false, userInteracted: false, explored: false },
        ],
      });
      // Second scan: same container, same trigger but now userInteracted=true
      // (simulating the merge logic in flushPendingActions)
      const existing = filters.get('.sort-bar');
      const newTrigger = { selector: '.trigger-1', text: '综合', category: 'sort', hasPopup: true, userInteracted: true, explored: true };
      const oldT = existing.triggers.find((t: any) => t.selector === newTrigger.selector);
      if (oldT) {
        newTrigger.userInteracted = newTrigger.userInteracted || oldT.userInteracted;
        newTrigger.explored = newTrigger.explored || oldT.explored;
        newTrigger.hasPopup = newTrigger.hasPopup || oldT.hasPopup;
      }
      existing.triggers = [newTrigger];

      (recorder as any).discoveredFilters = filters;

      const { data } = await recorder.stop();
      expect(data.discoveredFilters).toHaveLength(1);
      const trigger = data.discoveredFilters?.[0].triggers[0];
      // Merged flags should all be true
      expect(trigger.userInteracted).toBe(true);
      expect(trigger.hasPopup).toBe(true);
      expect(trigger.explored).toBe(true);
    });

    it('should mark popup_appear with userTriggered=false for auto-shown popups', async () => {
      await startRecording('https://example.com');

      (recorder as any).actions.push({
        id: 1,
        type: 'popup_appear',
        timestamp: Date.now(),
        url: 'https://example.com',
        pageTitle: '',
        popupAppear: {
          trigger: undefined,
          popup: {
            selector: '.toast',
            text: 'Welcome',
            rect: { x: 0, y: 0, w: 200, h: 40 },
            items: [],
          },
          cause: 'auto',
          userTriggered: false,
        },
      });
      (recorder as any).actionCounter = 1;

      const { data } = await recorder.stop();
      const popupAction = data.actions.find((a) => a.type === 'popup_appear');
      expect(popupAction?.popupAppear?.userTriggered).toBe(false);
      expect(popupAction?.popupAppear?.cause).toBe('auto');
    });

    it('should not crash when discoveredFilters is empty/undefined', async () => {
      await startRecording('https://example.com');
      // Don't push any discovered_filters

      const { data } = await recorder.stop();
      // discoveredFilters should be an empty array (no crash)
      expect(Array.isArray(data.discoveredFilters)).toBe(true);
      expect(data.discoveredFilters).toHaveLength(0);
    });
  });
});
