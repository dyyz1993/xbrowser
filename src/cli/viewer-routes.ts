import { outputResult } from './output.js';
import { getDaemonConfig, getDaemonProcessStatus, startDaemonProcess } from '../daemon/daemon.js';
import { forwardViewerCheckSelector } from '../client/daemon-client.js';

export async function handleViewer(
  _args: string[],
  options: Record<string, unknown>,
  mode: string,
  _cdpEndpoint?: string,
): Promise<void> {
  const name = (options.name as string) || process.env.XBROWSER_SESSION || 'default';
  const selector = options.selector as string | undefined;

  let status = getDaemonProcessStatus();
  if (!status.running) {
    await startDaemonProcess();
    status = getDaemonProcessStatus();
  }

  const port = status.port || getDaemonConfig().basePort;
  let url = `http://localhost:${port}/preview/${name}`;

  if (selector) {
    try {
      const resp = await forwardViewerCheckSelector(name, selector);
      if (resp.found) {
        url += `#focus=${encodeURIComponent(selector)}`;
      }
    } catch {
      /* fallback to full view */
    }
  }

  outputResult({ url, name, focused: !!selector && url.includes('#focus=') }, mode);
}
