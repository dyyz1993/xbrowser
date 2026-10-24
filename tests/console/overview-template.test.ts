import { describe, expect, it } from 'vitest';
import { renderOverviewHtml } from '../../src/console/overview-template.js';
import type { ConsoleOverview } from '../../src/console/types.js';

const overview: ConsoleOverview = {
  generatedAt: '2026-10-21T00:00:00.000Z',
  readonly: true,
  environments: [{
    id: 'daemon',
    kind: 'daemon',
    label: '<script>daemon</script>',
    status: 'available',
    detail: 'PID 1',
    evidence: {},
  }],
  sessions: [{
    id: 's1', name: 'work', url: 'https://example.com', environmentId: 'daemon',
    status: 'running', previewUrl: 'http://127.0.0.1:9224/preview/work',
  }],
  plugins: [],
  stats: { runningSessions: 1, availableEnvironments: 1, installedPlugins: 0, loadedPlugins: 0 },
};

describe('overview template', () => {
  it('renders readonly overview and escapes HTML', () => {
    const html = renderOverviewHtml(overview);
    expect(html).toContain('Read-only prototype');
    expect(html).toContain('&lt;script&gt;daemon&lt;/script&gt;');
    expect(html).toContain('http://127.0.0.1:9224/preview/work');
    expect(html).not.toContain('<script>daemon</script>');
  });
});

describe('renderOverviewHtml（补：数据块与空态）', () => {
  it('渲染 stats 数值与 sessions/plugins 列表条目', () => {
    const html = renderOverviewHtml({
      generatedAt: '2026-10-23T00:00:00.000Z',
      readonly: true,
      environments: [{ id: 'daemon', kind: 'daemon', label: 'Daemon', status: 'available' }],
      sessions: [{ id: 's1', name: 'work', environmentId: 'daemon', status: 'running', previewUrl: 'http://127.0.0.1:9224/preview/work' }],
      plugins: [{ id: 'p1', name: 'xbrowser-plugin-x', displayName: 'x', source: 'local', version: '1.0.0', description: '', tags: [], commands: ['run'], sites: [], status: 'loaded' }],
      stats: { runningSessions: 1, availableEnvironments: 1, installedPlugins: 1, loadedPlugins: 1 },
      evidence: null,
    } as never);
    expect(html).toContain('1');                    // stats 数值
    expect(html).toContain('work');                 // session 名
    expect(html).toContain('run');                 // plugin command（模板渲染 displayName 与 commands）
  });

  it('空数据不崩溃：0 会话/0 插件仍产出完整 HTML', () => {
    const html = renderOverviewHtml({
      generatedAt: '2026-10-23T00:00:00.000Z',
      readonly: true,
      environments: [],
      sessions: [],
      plugins: [],
      stats: { runningSessions: 0, availableEnvironments: 0, installedPlugins: 0, loadedPlugins: 0 },
      evidence: null,
    } as never);
    expect(html).toContain('<html');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('NaN');
  });
});
