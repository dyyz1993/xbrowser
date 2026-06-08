/**
 * viewer-url — 统一的 viewerUrl 生成工具
 *
 * 仅检测 daemon 状态，不自动启动。
 * 返回 viewer URL 或 undefined（daemon 未运行）。
 */

import { getDaemonConfig, getDaemonProcessStatus } from '../daemon/daemon.js';

export function buildViewerUrl(sessionName: string = 'default'): string | undefined {
  try {
    const status = getDaemonProcessStatus();
    if (!status.running) return undefined;
    const port = status.port || getDaemonConfig().basePort;
    return `http://localhost:${port}/preview/${encodeURIComponent(sessionName)}`;
  } catch {
    return undefined;
  }
}
