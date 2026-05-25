import { outputResult, outputError } from './output.js';
import { getDaemonConfig, getDaemonProcessStatus } from '../daemon/daemon.js';
import { forwardViewerCheckSelector } from '../client/daemon-client.js';

export async function handleViewer(
  _args: string[],
  options: Record<string, unknown>,
  mode: string,
  _cdpEndpoint?: string,
): Promise<void> {
  const name = (options.name as string) || process.env.XBROWSER_SESSION || 'default';
  const selector = options.selector as string | undefined;

  const status = getDaemonProcessStatus();
  if (!status.running) {
    outputError('Daemon is not running. Start with: xbrowser daemon start');
    return;
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
      // Daemon doesn't support this RPC or error — fallback to full view
    }
  }

  outputResult({ url, name, focused: !!selector && url.includes('#focus=') }, mode);
}
