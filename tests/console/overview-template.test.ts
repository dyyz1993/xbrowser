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
