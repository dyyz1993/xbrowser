import type { ConsoleOverview } from './types.js';

function badge(status: string): string {
  if (status === 'available' || status === 'running' || status === 'loaded') {
    return '<span class="badge ok">available</span>';
  }
  if (status === 'degraded' || status === 'ready' || status === 'installed') {
    return '<span class="badge warn">limited</span>';
  }
  return '<span class="badge bad">unavailable</span>';
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderOverviewHtml(overview: ConsoleOverview): string {
  const environmentRows = (overview.environments ?? []).map(environment => `
    <tr>
      <td>${escapeHtml(environment.label)}</td>
      <td>${escapeHtml(environment.kind)}</td>
      <td>${badge(environment.status)}</td>
      <td>${escapeHtml(environment.detail)}</td>
    </tr>`).join('');

  const sessionRows = (overview.sessions ?? []).map(session => `
    <tr>
      <td>${escapeHtml(session.name)}</td>
      <td>${escapeHtml(session.url ?? '-')}</td>
      <td>${badge(session.status)}</td>
      <td><a href="${escapeHtml(session.previewUrl)}" target="_blank" rel="noreferrer">preview</a></td>
    </tr>`).join('');

  const pluginRows = (overview.plugins ?? []).map(plugin => `
    <tr>
      <td>${escapeHtml(plugin.displayName)}</td>
      <td>${escapeHtml(plugin.version)}</td>
      <td>${escapeHtml(plugin.source)}</td>
      <td>${badge(plugin.status)}</td>
      <td>${escapeHtml(plugin.commands.slice(0, 8).join(', ') || '-')}</td>
    </tr>`).join('');

  const evidence = overview.evidence
    ? `<pre>${escapeHtml(JSON.stringify(overview.evidence, null, 2))}</pre>`
    : '<p class="muted">No session selected for evidence.</p>';

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>xBrowser Console - readonly overview</title>
  <style>
    :root { color-scheme: light; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif; }
    body { margin: 0; background: #f6f8fb; color: #16202b; }
    main { max-width: 1180px; margin: 0 auto; padding: 32px 24px 56px; }
    h1 { font-size: 26px; margin: 0; }
    h2 { margin: 30px 0 12px; font-size: 17px; }
    p { line-height: 1.5; }
    .readonly { display: inline-block; margin-top: 8px; padding: 3px 8px; border: 1px solid #7da2c7; color: #21527d; border-radius: 999px; font-size: 12px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; margin-top: 20px; }
    .card { background: white; border: 1px solid #dbe2e9; border-radius: 12px; padding: 16px; }
    .card strong { display: block; font-size: 25px; margin-top: 5px; }
    table { width: 100%; border-collapse: collapse; background: white; border: 1px solid #dbe2e9; border-radius: 10px; overflow: hidden; }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #e7ecf1; font-size: 13px; }
    th { background: #22436b; color: white; font-weight: 600; }
    tr:last-child td { border-bottom: 0; }
    a { color: #21527d; }
    .badge { font-size: 11px; padding: 2px 7px; border-radius: 999px; }
    .ok { background: #e5f6ec; color: #176538; }
    .warn { background: #fff4dc; color: #84590c; }
    .bad { background: #fdeaea; color: #8b2020; }
    pre { background: #10202f; color: #dceaf5; padding: 14px; border-radius: 10px; overflow: auto; font-size: 12px; }
    .muted { color: #596877; }
  </style>
</head>
<body>
  <main>
    <h1>xBrowser Console</h1>
    <span class="readonly">Read-only prototype</span>
    <p>Generated at ${escapeHtml(overview.generatedAt)} · 阶段 0 / Console Facade 总览</p>
    <section class="cards">
      <div class="card"><span>运行会话</span><strong>${overview.stats.runningSessions}</strong></div>
      <div class="card"><span>可用环境</span><strong>${overview.stats.availableEnvironments}</strong></div>
      <div class="card"><span>已安装插件</span><strong>${overview.stats.installedPlugins}</strong></div>
      <div class="card"><span>已加载插件</span><strong>${overview.stats.loadedPlugins}</strong></div>
    </section>
    <h2>统一环境状态</h2>
    <table><thead><tr><th>环境</th><th>类型</th><th>状态</th><th>详情</th></tr></thead><tbody>${environmentRows}</tbody></table>
    <h2>会话</h2>
    <table><thead><tr><th>名称</th><th>当前 URL</th><th>状态</th><th>画面</th></tr></thead><tbody>${sessionRows || '<tr><td colspan="4" class="muted">暂无运行会话</td></tr>'}</tbody></table>
    <h2>插件</h2>
    <table><thead><tr><th>名称</th><th>版本</th><th>来源</th><th>状态</th><th>命令</th></tr></thead><tbody>${pluginRows || '<tr><td colspan="5" class="muted">暂无已安装插件</td></tr>'}</tbody></table>
    <h2>最近证据</h2>
    ${evidence}
  </main>
</body>
</html>`;
}
