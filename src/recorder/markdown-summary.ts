import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { RecordingData, RecordingSummary, UserAction, CheckpointEntry, NetworkEntry, RecordingStep } from './recording-types.js';

export function buildMarkdownSummary(_data: RecordingData, summary: RecordingSummary): string {
  const lines: string[] = [];
  const durSec = Math.round(summary.durationMs / 1000);

  lines.push('# Recording Summary');
  lines.push('');
  lines.push(`- **URL**: ${summary.startUrl}`);
  lines.push(`- **Recorded**: ${summary.recordedAt}`);
  lines.push(`- **Duration**: ${durSec}s`);
  lines.push(`- **Steps**: ${summary.totalActions} actions, ${summary.totalNetworkRequests} network requests`);
  if (summary.checkpoints.length > 0) {
    const cpTypes = summary.checkpoints.map(c => c.type);
    lines.push(`- **Checkpoints**: ${summary.checkpoints.length} (${[...new Set(cpTypes)].join(', ')})`);
  } else {
    lines.push('- **Checkpoints**: 0');
  }

  const checkpointSteps = new Map<number, CheckpointEntry>();
  for (const cp of summary.checkpoints) {
    if (cp.relatedActionId != null) {
      for (const step of summary.steps) {
        if (step.action.id === cp.relatedActionId) {
          checkpointSteps.set(step.step, cp);
          break;
        }
      }
    }
  }

  lines.push('');
  lines.push('## Steps');
  lines.push('');

  for (const step of summary.steps) {
    const a = step.action;
    const el = a.element;
    const cp = checkpointSteps.get(step.step);

    if (cp) {
      lines.push(`### Step ${step.step}: ⚠️ CHECKPOINT — ${cp.hint}`);
      lines.push(`- **Type**: ${cp.type} (${cp.source})`);
      lines.push(`- **Hint**: ${cp.hint}`);
      if (cp.selector) lines.push(`- **Selector**: \`${cp.selector}\``);
      lines.push(`- **Action needed**: Human intervention required before continuing`);
    } else {
      const title = describeActionTitle(a);
      lines.push(`### Step ${step.step}: ${title}`);
    }

    if (el) {
      const parts: string[] = [`\`${el.selector || el.tag}\``];
      if (el.text) parts.push(`"${el.text.substring(0, 60)}"`);
      parts.push(`(${el.tag})`);
      if (el.type) parts.push(`type=${el.type}`);
      lines.push(`- **Element**: ${parts.join(' ')}`);
    }

    if (a.value != null && a.type === 'input') {
      lines.push(`- **Value**: "${a.value.substring(0, 100)}"`);
    }

    if (step.network.length > 0) {
      const netDescs = step.network.map(n => {
        let desc = `${n.method} ${n.path}`;
        if (n.status) desc += ` → ${n.status}`;
        if (n.responseSize > 0) desc += ` (${formatBytes(n.responseSize)})`;
        return desc;
      });
      lines.push(`- **Network**: ${netDescs.join(', ')}`);

      for (const n of step.network) {
        if (n.requestBody && typeof n.requestBody === 'object') {
          const bodyStr = JSON.stringify(n.requestBody);
          if (bodyStr.length <= 300) {
            lines.push(`  - \`${n.method} ${n.path}\` body: \`${bodyStr}\``);
          } else {
            lines.push(`  - \`${n.method} ${n.path}\` body: \`${bodyStr.substring(0, 300)}...\` (${bodyStr.length} bytes)`);
          }
        }
      }
    } else {
      lines.push('- **Network**: none');
    }

    if (step.matchedInputs.length > 0) {
      for (const m of step.matchedInputs) {
        lines.push(`- **Input matched**: "${m.inputValue}" → ${m.paramName} (network #${m.networkId})`);
      }
    }

    for (const ctx of step.contextChanges) {
      if (ctx.type === 'navigate') {
        lines.push(`- **Navigate**: → ${ctx.url}`);
      } else if (ctx.type === 'new_tab') {
        lines.push(`- **New tab**: ${ctx.url}`);
      }
    }

    if (a.clickContext) {
      if (a.clickContext.appeared?.length > 0) {
        for (const popup of a.clickContext.appeared) {
          const roleStr = popup.role ? ` [${popup.role}]` : '';
          lines.push(`- **Popup**: <${popup.tag}${roleStr}> "${(popup.text || '').substring(0, 60)}"`);
          if (popup.items?.length > 0) {
            const itemStrs = popup.items.slice(0, 8).map(i => {
              const dis = i.disabled ? ' [disabled]' : '';
              return `"${i.text}"${dis}`;
            });
            let itemLine = `  - Items: ${itemStrs.join(', ')}`;
            if (popup.items.length > 8) itemLine += ` ... +${popup.items.length - 8} more`;
            lines.push(itemLine);
          }
        }
      }
      if (a.clickContext.stateChanges?.length > 0) {
        for (const sc of a.clickContext.stateChanges) {
          const parts: string[] = [];
          if (sc.ariaExpanded !== undefined) parts.push(`expanded=${sc.ariaExpanded}`);
          if (sc.disabled) parts.push('disabled');
          if (sc.ariaSelected !== undefined) parts.push(`selected=${sc.ariaSelected}`);
          if (sc.dataState) parts.push(`state=${sc.dataState}`);
          if (parts.length > 0) {
            lines.push(`- **State**: <${sc.tag}> "${(sc.text || '').substring(0, 30)}" ${parts.join(', ')}`);
          }
        }
      }
    }

    lines.push('');
  }

  const allNetwork = summary.steps.flatMap(s => s.network);
  if (allNetwork.length > 0) {
    lines.push('## Network Timeline');
    lines.push('');
    allNetwork.forEach((n: NetworkEntry, i: number) => {
      let line = `${i + 1}. ${n.method} ${n.path}`;
      if (n.status) line += ` → ${n.status}`;
      if (n.requestBody && typeof n.requestBody === 'object') {
        const bodyStr = JSON.stringify(n.requestBody);
        if (bodyStr.length <= 150) {
          line += ` ${bodyStr}`;
        }
      }
      if (n.responseSize > 0) line += ` (${formatBytes(n.responseSize)})`;
      lines.push(line);
    });
    lines.push('');
  }

  const orphanCheckpoints = summary.checkpoints.filter(
    (cp: CheckpointEntry) => cp.relatedActionId == null || !checkpointSteps.has(
      summary.steps.find((s: RecordingStep) => s.action.id === cp.relatedActionId)?.step ?? -1,
    ),
  );
  if (orphanCheckpoints.length > 0) {
    lines.push('## Unresolved Checkpoints');
    lines.push('');
    for (const cp of orphanCheckpoints) {
      const src = cp.source === 'auto' ? '[auto]' : '[manual]';
      lines.push(`- ${src} **${cp.type}**: ${cp.hint}`);
      if (cp.selector) lines.push(`  - Selector: \`${cp.selector}\``);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function readMarkdownSummary(sessionName: string): string | null {
  const mdPath = join(homedir(), '.xbrowser', 'recordings', sessionName, 'summary.md');
  try {
    return readFileSync(mdPath, 'utf8');
  } catch {
    return null;
  }
}

function describeActionTitle(a: UserAction): string {
  const el = a.element;
  const elText = el?.text ? `"${el.text.substring(0, 40)}"` : '';
  const elTag = el?.tag ? `<${el.tag}>` : '';

  switch (a.type) {
    case 'click':
      return `Click ${elText || elTag} button`.replace(/ +/g, ' ').trim();
    case 'input':
      return `Input "${(a.value || '').substring(0, 50)}" in ${elText || elTag || 'field'}`.replace(/ +/g, ' ').trim();
    case 'change':
      return `Change ${elText || elTag} to "${(a.value || '').substring(0, 30)}"`;
    case 'keydown':
      return `Press ${a.key || 'key'} on ${elText || elTag || 'element'}`;
    case 'submit':
      return `Submit ${elText || elTag || 'form'}`;
    default:
      return `${a.type} ${elText || elTag}`.trim() || a.type;
  }
}
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
