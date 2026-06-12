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

      recorder.recordCommandAction({
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

      recorder.recordCommandAction({
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

      recorder.recordCommandAction({
        type: 'cdp-fill',
        selector: '#username',
        value: 'testuser',
        element: { tag: 'input', selector: '#username', text: '', strategy: 'id', confidence: 'high' },
      });

      // Same action within 1.5s — should be deduped
      recorder.recordCommandAction({
        type: 'cdp-fill',
        selector: '#username',
        value: 'testuser',
      });

      const { data } = await recorder.stop();
      expect(data.actions).toHaveLength(1);
    });

    it('should NOT deduplicate actions after dedup window expires', async () => {
      await startRecording('https://example.com');

      recorder.recordCommandAction({
        type: 'cdp-click',
        selector: '#btn',
        element: { tag: 'button', selector: '#btn', text: 'Click', strategy: 'id', confidence: 'high' },
      });

      // Expire both dedup mechanisms
      (recorder as any).cdpActionDedup.until = Date.now() - 100;
      // Also age the last action's timestamp so reverse dedup doesn't match
      (recorder as any).actions[0].timestamp = Date.now() - 2000;

      recorder.recordCommandAction({
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

      // Now cdp-click with same selector arrives — should be deduped
      recorder.recordCommandAction({
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

      recorder.recordCommandAction({
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

      recorder.recordCommandAction({
        type: 'goto',
        url: 'https://other.com',
      });

      const { data } = await recorder.stop();
      expect(data.actions[0].url).toBe('https://other.com');
    });

    it('should update lastKnownUrl after goto', async () => {
      await startRecording('https://example.com');

      recorder.recordCommandAction({
        type: 'goto',
        url: 'https://newsite.com',
      });

      // Now a click with about:blank should fallback to newsite.com
      recorder.recordCommandAction({
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

      recorder.recordCommandAction({
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

      recorder.recordCommandAction({
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

      recorder.recordCommandAction({
        type: 'cdp-fill',
        selector: '#email',
        value: 'test@test.com',
        element: { tag: 'input', selector: '#email', text: '', strategy: 'id', confidence: 'high' },
      });

      recorder.recordCommandAction({
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

      recorder.recordCommandAction({
        type: 'goto',
        url: 'https://example.com',
      });

      const { data } = await recorder.stop();
      expect(data.actions[0].element).toBeUndefined();
    });

    it('should handle action without selector (cdp-eval)', async () => {
      await startRecording('https://example.com');

      recorder.recordCommandAction({
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
      recorder.recordCommandAction({ type: 'cdp-click', selector: '#a', url: 'about:blank' });
      recorder.recordCommandAction({ type: 'cdp-fill', selector: '#b', value: 'x', url: 'about:blank' });

      const { data } = await recorder.stop();
      for (const action of data.actions) {
        expect(action.url).not.toContain('about:blank');
      }
    });
  });
});
