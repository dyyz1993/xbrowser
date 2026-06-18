import { describe, it, expect } from 'vitest';
import { renderTopic } from '../../.xcli/plugins/summarize/render/flow-renderer.js';
import type { Topic } from '../../.xcli/plugins/summarize/types.js';

// 这个测试需要 OPENCODE_API_KEY 环境变量。没 key 时会降级模板（仍通过）。
const topic: Topic = {
  id: 'test-login', site: 'example.com', intent: 'login', confidence: 'high',
  segments: [{
    id: 's1', site: 'example.com', boundaries: [],
    startUrl: 'https://example.com/login', endUrl: 'https://example.com/home',
    actions: [
      { id: 1, type: 'input', timestamp: 0, url: 'https://example.com/login', pageTitle: '',
        element: { tag: 'input', selector: '#user', text: '' }, value: 'alice' },
      { id: 2, type: 'click', timestamp: 100, url: 'https://example.com/login', pageTitle: '',
        element: { tag: 'button', selector: '#login-btn', text: '登录' } },
    ], durationMs: 100,
  }],
  fields: {
    username: { kind: 'text', value: 'alice', selector: '#user', confidence: 'high' },
    submitBtn: { kind: 'selector', selector: '#login-btn', strategy: 'id', text: '登录' },
  },
  resultHint: '跳转到 https://example.com/home',
};

describe('LLM 渲染（真实 API）', () => {
  // 超时放长，reasoning 模型慢
  it('renders via LLM when OPENCODE_API_KEY available', async () => {
    const r = await renderTopic(topic, { useLlm: true });
    console.log('\n=== mode:', r.mode, '===');
    console.log('warnings:', r.warnings);
    console.log('=== body ===');
    console.log(r.body);
    console.log('=== end ===\n');
    // 有 key → llm；无 key → template，两种都算通过
    expect(['llm', 'template']).toContain(r.mode);
    expect(r.body).toContain('alice');       // 字段保留
    expect(r.body).toContain('#login-btn');  // selector 保留
  }, 60000);
});
