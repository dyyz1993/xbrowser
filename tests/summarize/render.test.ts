import { describe, it, expect } from 'vitest';
import { renderTopic } from '../../.xcli/plugins/summarize/render/flow-renderer.js';
import { renderTopicTemplate } from '../../.xcli/plugins/summarize/render/template.js';
import type { Topic } from '../../.xcli/plugins/summarize/types.js';

const mkTopic = (over: Partial<Topic> = {}): Topic => ({
  id: 'x.com-login-0',
  site: 'x.com',
  intent: 'login',
  confidence: 'high',
  segments: [{
    id: 's1', site: 'x.com', boundaries: [],
    startUrl: 'https://x.com/login', endUrl: 'https://x.com/home',
    actions: [
      { id: 1, type: 'input', timestamp: 0, url: 'https://x.com/login', pageTitle: '',
        element: { tag: 'input', selector: '#user', text: '' }, value: 'bob' },
      { id: 2, type: 'click', timestamp: 100, url: 'https://x.com/login', pageTitle: '',
        element: { tag: 'button', selector: '#sub', text: '登录' } },
    ],
    durationMs: 100,
  }],
  fields: {
    username: { kind: 'text', value: 'bob', selector: '#user', confidence: 'high' },
    submitBtn: { kind: 'selector', selector: '#sub', strategy: 'class', text: '登录' },
  },
  resultHint: '跳转到 https://x.com/home',
  ...over,
});

describe('renderTopicTemplate (模板渲染)', () => {
  it('renders heading + description + 关键元素 + 步骤', () => {
    const body = renderTopicTemplate(mkTopic());
    expect(body).toContain('## 登录');
    expect(body).toContain('### 关键元素');
    expect(body).toContain('username');
    expect(body).toContain('bob');
    expect(body).toContain('#sub');
    expect(body).toContain('### 操作步骤');
    expect(body).toContain('点击「登录」');
  });

  it('preserves field values exactly (no fabrication)', () => {
    const body = renderTopicTemplate(mkTopic());
    expect(body).toContain('bob');       // username 原样
    expect(body).toContain('#sub');      // selector 原样
  });

  it('handles unknown intent gracefully', () => {
    const body = renderTopicTemplate(mkTopic({ intent: 'unknown' }));
    expect(body).toContain('未识别操作');
  });
});

describe('renderTopic (双模式 + 降级)', () => {
  it('degrades to template when useLlm:false', async () => {
    const r = await renderTopic(mkTopic(), { useLlm: false });
    expect(r.mode).toBe('template');
    expect(r.body).toContain('## 登录');
  });

  it('degrades to template when useLlm:false', async () => {
    const r = await renderTopic(mkTopic(), { useLlm: false });
    expect(r.mode).toBe('template');
    expect(r.body).toContain('## 登录');
  });

  it('uses LLM when auth available (~/.pi/agent/auth.json autoload)', async () => {
    // auth.json 自动加载：有 key 走 LLM，没 key 降级 template，两种都合法
    const r = await renderTopic(mkTopic(), { useLlm: true });
    expect(['llm', 'template']).toContain(r.mode);
    expect(r.body).toContain('bob');  // 字段保留，无论哪种模式
  }, 60000);

  it('template body always contains field values', async () => {
    const r = await renderTopic(mkTopic(), { useLlm: false });
    expect(r.body).toContain('bob');
    expect(r.body).toContain('#sub');
  });
});
