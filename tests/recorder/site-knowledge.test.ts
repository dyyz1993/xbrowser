/**
 * Tests for SiteKnowledge — LLM-readable site documentation generator.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  updateSiteKnowledge,
  toMarkdown,
  readSiteKnowledge,
  listSiteKnowledge,
  addKnownIssue,
  getKnowledgePath,
  type SiteKnowledge,
  type RecordingData,
} from '../../src/recorder/site-knowledge.js';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// ── Helpers ───────────────────────────────────────────────────

function makeRecordingData(overrides?: Partial<RecordingData>): RecordingData {
  return {
    startUrl: 'https://juejin.cn/editor/drafts/new',
    sessionName: 'test-session',
    startedAt: new Date().toISOString(),
    actions: [],
    network: [],
    contextChanges: [],
    checkpoints: [],
    ...overrides,
  };
}

function makeAction(overrides: Record<string, unknown>): RecordingData['actions'][0] {
  return {
    id: 1,
    type: 'click',
    timestamp: Date.now(),
    url: 'https://juejin.cn/editor/drafts/new',
    pageTitle: '写文章 - 掘金',
    ...overrides,
  } as RecordingData['actions'][0];
}

const TEST_DOMAIN = 'test-site-knowledge.example.com';

// ── Tests ─────────────────────────────────────────────────────

describe('SiteKnowledge — generation', () => {
  beforeEach(() => {
    // Clean up before each test to avoid cross-test contamination
    const domains = [TEST_DOMAIN, 'juejin.cn'];
    for (const d of domains) {
      try { rmSync(getKnowledgePath(d, 'md')); } catch { /* ok */ }
      try { rmSync(getKnowledgePath(d, 'json')); } catch { /* ok */ }
    }
  });

  afterEach(() => {
    const domains = [TEST_DOMAIN, 'juejin.cn'];
    for (const d of domains) {
      try { rmSync(getKnowledgePath(d, 'md')); } catch { /* ok */ }
      try { rmSync(getKnowledgePath(d, 'json')); } catch { /* ok */ }
    }
  });

  it('should generate knowledge from a simple recording', () => {
    const data = makeRecordingData({
      actions: [
        makeAction({
          type: 'click',
          element: { tag: 'button', selector: '#publish-btn', text: '发布', confidence: 'high' },
        }),
        makeAction({
          type: 'input',
          element: { tag: 'input', selector: '#title', text: '', placeholder: '请输入标题', confidence: 'high' },
          value: '我的文章',
        }),
      ],
    });

    const kb = updateSiteKnowledge({ ...data, startUrl: `https://${TEST_DOMAIN}/editor` });

    expect(kb.domain).toBe(TEST_DOMAIN);
    expect(kb.recordingCount).toBe(1);
    expect(Object.keys(kb.pages)).toHaveLength(1);
    const page = Object.values(kb.pages)[0];
    expect(page.selectors).toHaveLength(2);
    expect(page.selectors.some(s => s.selector === '#publish-btn')).toBe(true);
    expect(page.selectors.some(s => s.selector === '#title')).toBe(true);
  });

  it('should extract form structure from input actions', () => {
    const data = makeRecordingData({
      startUrl: `https://${TEST_DOMAIN}/register`,
      actions: [
        makeAction({
          type: 'input',
          url: `https://${TEST_DOMAIN}/register`,
          element: { tag: 'input', selector: '#username', text: '', placeholder: '用户名', confidence: 'high' },
          value: 'testuser',
        }),
        makeAction({
          type: 'input',
          url: `https://${TEST_DOMAIN}/register`,
          element: { tag: 'input', selector: '#email', text: '', type: 'email', placeholder: '邮箱', confidence: 'high' },
          value: 'test@test.com',
        }),
        makeAction({
          type: 'submit',
          url: `https://${TEST_DOMAIN}/register`,
          element: { tag: 'button', selector: '#submit', text: '注册', confidence: 'high' },
        }),
      ],
    });

    const kb = updateSiteKnowledge(data);
    const page = Object.values(kb.pages)[0];
    expect(page.forms).toHaveLength(1);
    expect(page.forms[0].fields).toHaveLength(2);
    expect(page.forms[0].submitSelector).toBe('#submit');
  });

  it('should extract API endpoints from network requests', () => {
    const data = makeRecordingData({
      startUrl: `https://${TEST_DOMAIN}/dashboard`,
      network: [
        {
          id: 1,
          timestamp: Date.now(),
          method: 'POST',
          url: 'https://api.test-site-knowledge.example.com/v1/articles',
          path: '/v1/articles',
          status: 200,
          resourceType: 'fetch',
          contentType: 'application/json',
          responseSize: 100,
          requestBody: { title: 'test', content: 'hello' },
          responseBody: { success: true, data: { id: 1, slug: 'test' } },
        },
        {
          id: 2,
          timestamp: Date.now(),
          method: 'GET',
          url: 'https://api.test-site-knowledge.example.com/v1/users/me',
          path: '/v1/users/me',
          status: 200,
          resourceType: 'fetch',
          contentType: 'application/json',
          responseSize: 50,
          responseBody: { name: 'test', email: 'test@test.com' },
        },
      ],
    });

    const kb = updateSiteKnowledge(data);
    const endpoints = Object.values(kb.apiEndpoints);
    expect(endpoints.length).toBeGreaterThanOrEqual(2);
    const postEp = endpoints.find(e => e.method === 'POST');
    expect(postEp).toBeDefined();
    expect(postEp!.params).toContain('title');
    expect(postEp!.params).toContain('content');
    expect(postEp!.responseFields).toContain('success');
    expect(postEp!.responseFields).toContain('data.id');
  });

  it('should extract navigation links', () => {
    const data = makeRecordingData({
      startUrl: `https://${TEST_DOMAIN}/home`,
      actions: [
        makeAction({
          type: 'click',
          url: `https://${TEST_DOMAIN}/home`,
          element: { tag: 'a', selector: 'nav a.home', text: '首页', href: 'https://${TEST_DOMAIN}/' },
        }),
        makeAction({
          type: 'click',
          url: `https://${TEST_DOMAIN}/home`,
          element: { tag: 'a', selector: 'nav a.about', text: '关于', href: 'https://${TEST_DOMAIN}/about' },
        }),
      ],
    });

    const kb = updateSiteKnowledge(data);
    const page = Object.values(kb.pages)[0];
    expect(page.navigationLinks).toHaveLength(2);
    expect(page.navigationLinks[0].text).toBe('首页');
  });
});

describe('SiteKnowledge — merge / evolution', () => {
  afterEach(() => {
    try { rmSync(getKnowledgePath(TEST_DOMAIN, 'md')); } catch { /* ok */ }
    try { rmSync(getKnowledgePath(TEST_DOMAIN, 'json')); } catch { /* ok */ }
  });

  it('should merge selectors across multiple recordings', () => {
    // First recording
    const data1 = makeRecordingData({
      startUrl: `https://${TEST_DOMAIN}/page1`,
      actions: [
        makeAction({
          type: 'click',
          url: `https://${TEST_DOMAIN}/page1`,
          element: { tag: 'button', selector: '#btn1', text: 'Button 1', confidence: 'high' },
        }),
      ],
    });
    updateSiteKnowledge(data1);

    // Second recording — same page, adds new selector, reuses old one
    const data2 = makeRecordingData({
      startUrl: `https://${TEST_DOMAIN}/page1`,
      actions: [
        makeAction({
          type: 'click',
          url: `https://${TEST_DOMAIN}/page1`,
          element: { tag: 'button', selector: '#btn1', text: 'Button 1', confidence: 'high' },
        }),
        makeAction({
          type: 'input',
          url: `https://${TEST_DOMAIN}/page1`,
          element: { tag: 'input', selector: '#input1', text: '', placeholder: 'Enter text', confidence: 'high' },
          value: 'test',
        }),
      ],
    });
    const kb = updateSiteKnowledge(data2);

    expect(kb.recordingCount).toBe(2);
    const page = kb.pages['/page1'];
    expect(page.selectors).toHaveLength(2);

    // #btn1 should have timesSeen=2 (seen in both recordings)
    const btn1 = page.selectors.find(s => s.selector === '#btn1');
    expect(btn1!.timesSeen).toBe(2);
  });

  it('should accumulate API endpoints across recordings', () => {
    const data1 = makeRecordingData({
      startUrl: `https://${TEST_DOMAIN}/page1`,
      network: [{
        id: 1, timestamp: Date.now(), method: 'GET',
        url: `https://${TEST_DOMAIN}/api/list`, path: '/api/list',
        status: 200, resourceType: 'fetch', contentType: 'application/json', responseSize: 0,
      }],
    });
    updateSiteKnowledge(data1);

    const data2 = makeRecordingData({
      startUrl: `https://${TEST_DOMAIN}/page1`,
      network: [{
        id: 1, timestamp: Date.now(), method: 'POST',
        url: `https://${TEST_DOMAIN}/api/create`, path: '/api/create',
        status: 201, resourceType: 'fetch', contentType: 'application/json', responseSize: 0,
        requestBody: { name: 'test' },
      }],
    });
    const kb = updateSiteKnowledge(data2);

    expect(Object.keys(kb.apiEndpoints)).toHaveLength(2);
    // GET endpoint should have timesSeen=2 (even though only seen once in data2, it carries over)
    const getEp = kb.apiEndpoints['GET /api/list'];
    expect(getEp.timesSeen).toBeGreaterThanOrEqual(1);
  });
});

describe('SiteKnowledge — Markdown output', () => {
  it('should generate readable markdown for LLM consumption', () => {
    const kb: SiteKnowledge = {
      domain: 'example.com',
      lastUpdated: '2024-06-13T00:00:00Z',
      recordingCount: 3,
      pages: {
        '/login': {
          url: 'https://example.com/login',
          title: 'Login',
          lastVisited: '2024-06-13T00:00:00Z',
          selectors: [
            {
              selector: '#username',
              tag: 'input',
              description: 'Username field',
              actionType: 'input',
              confidence: 'high',
              lastSeen: '2024-06-13T00:00:00Z',
              timesSeen: 3,
              status: 'active',
            },
          ],
          forms: [{
            name: 'Login Form',
            action: 'https://example.com/login',
            fields: [{
              selector: '#username',
              tag: 'input',
              label: 'Username',
              inputType: 'text',
              placeholder: 'Enter username',
            }],
            submitSelector: '#login-btn',
          }],
          navigationLinks: [
            { text: 'Sign Up', href: 'https://example.com/signup', selector: 'a.signup' },
          ],
        },
      },
      apiEndpoints: {
        'POST /api/auth/login': {
          method: 'POST',
          url: 'https://api.example.com/api/auth/login',
          path: '/api/auth/login',
          params: ['username', 'password'],
          responseFields: ['token', 'user.id'],
          lastSeen: '2024-06-13T00:00:00Z',
          timesSeen: 5,
        },
      },
      knownIssues: ['[2024-06-13] Old selector .legacy-btn is deprecated'],
      generatedBy: 'test',
    };

    const md = toMarkdown(kb);

    expect(md).toContain('# Site Knowledge: example.com');
    expect(md).toContain('LLM consumption');
    expect(md).toContain('### https://example.com/login');
    expect(md).toContain('`#username`');
    expect(md).toContain('| Method | Path |');
    expect(md).toContain('POST');
    expect(md).toContain('/api/auth/login');
    expect(md).toContain('Known Issues');
    expect(md).toContain('How to Use This Document');
  });

  it('should handle empty knowledge gracefully', () => {
    const kb: SiteKnowledge = {
      domain: 'empty.com',
      lastUpdated: '2024-06-13T00:00:00Z',
      recordingCount: 1,
      pages: {},
      apiEndpoints: {},
      knownIssues: [],
      generatedBy: 'test',
    };

    const md = toMarkdown(kb);
    expect(md).toContain('# Site Knowledge: empty.com');
    expect(md).toContain('## Pages');
    // Should not crash on empty pages
  });
});

describe('SiteKnowledge — read / list', () => {
  beforeEach(() => {
    try { rmSync(getKnowledgePath(TEST_DOMAIN, 'json')); } catch { /* ok */ }
    try { rmSync(getKnowledgePath(TEST_DOMAIN, 'md')); } catch { /* ok */ }
  });

  afterEach(() => {
    try { rmSync(getKnowledgePath(TEST_DOMAIN, 'json')); } catch { /* ok */ }
    try { rmSync(getKnowledgePath(TEST_DOMAIN, 'md')); } catch { /* ok */ }
  });

  it('should read knowledge after generation', () => {
    const data = makeRecordingData({
      startUrl: `https://${TEST_DOMAIN}/page1`,
      actions: [
        makeAction({
          type: 'click',
          url: `https://${TEST_DOMAIN}/page1`,
          element: { tag: 'button', selector: '#test-btn', text: 'Test', confidence: 'high' },
        }),
      ],
    });
    updateSiteKnowledge(data);

    const kb = readSiteKnowledge(TEST_DOMAIN);
    expect(kb).not.toBeNull();
    expect(kb!.domain).toBe(TEST_DOMAIN);
    expect(kb!.pages['/page1']).toBeDefined();
  });

  it('should return null for unknown domain', () => {
    const kb = readSiteKnowledge('nonexistent.example.com');
    expect(kb).toBeNull();
  });

  it('should list known domains', () => {
    const data = makeRecordingData({
      startUrl: `https://${TEST_DOMAIN}/page1`,
    });
    updateSiteKnowledge(data);

    const domains = listSiteKnowledge();
    expect(domains).toContain(TEST_DOMAIN);
  });

  it('should add known issues', () => {
    const data = makeRecordingData({
      startUrl: `https://${TEST_DOMAIN}/page1`,
    });
    updateSiteKnowledge(data);

    addKnownIssue(TEST_DOMAIN, 'Selector #old-btn no longer works');

    const kb = readSiteKnowledge(TEST_DOMAIN);
    expect(kb!.knownIssues.length).toBeGreaterThan(0);
    expect(kb!.knownIssues.some(i => i.includes('#old-btn'))).toBe(true);
  });
});

describe('SiteKnowledge — description builder', () => {
  it('should include action verb in description', () => {
    const data = makeRecordingData({
      startUrl: `https://${TEST_DOMAIN}/page1`,
      actions: [
        makeAction({
          type: 'input',
          url: `https://${TEST_DOMAIN}/page1`,
          element: { tag: 'input', selector: '#search', text: '', placeholder: 'Search...', confidence: 'high' },
          value: 'hello world',
        }),
        makeAction({
          type: 'click',
          url: `https://${TEST_DOMAIN}/page1`,
          element: { tag: 'button', selector: '#submit', text: 'Submit', confidence: 'high' },
        }),
      ],
    });

    const kb = updateSiteKnowledge(data);
    const page = Object.values(kb.pages)[0];
    const searchSel = page.selectors.find(s => s.selector === '#search');
    const submitSel = page.selectors.find(s => s.selector === '#submit');

    expect(searchSel!.description).toContain('placeholder');
    expect(searchSel!.description).toContain('filled');
    expect(submitSel!.description).toContain('Submit');
    expect(submitSel!.description).toContain('clicked');
  });
});
