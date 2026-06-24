async function fetchNoProxy(url: string): Promise<globalThis.Response> {
  const savedProxy = {
    http_proxy: process.env.http_proxy,
    https_proxy: process.env.https_proxy,
    HTTP_PROXY: process.env.HTTP_PROXY,
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    all_proxy: process.env.all_proxy,
    ALL_PROXY: process.env.ALL_PROXY,
  };
  for (const key of Object.keys(savedProxy)) delete process.env[key];
  try {
    return await fetch(url);
  } finally {
    for (const [key, val] of Object.entries(savedProxy)) {
      if (val !== undefined) process.env[key] = val;
    }
  }
}

export async function resolveCDPEndpoint(raw: string): Promise<string> {
  if (raw === 'auto') {
    // Try common CDP ports in order: 9222 (default), 9221 (cdp-tunnel), 9223, 9224
    const ports = [9222, 9221, 9223, 9224];
    for (const port of ports) {
      try {
        const httpResp = await fetchNoProxy(`http://localhost:${port}/json/version`);
        if (httpResp.ok) {
          const data = (await httpResp.json()) as { webSocketDebuggerUrl?: string };
          if (data.webSocketDebuggerUrl) {
            return data.webSocketDebuggerUrl;
          }
        }
      } catch {
        // Port not available, try next
      }
    }
    throw new Error(
      `Could not auto-discover CDP endpoint. Tried ports: ${ports.join(', ')}.\n` +
      `可能原因：没有 Chrome 以 --remote-debugging-port 启动。\n` +
      `解决方法：\n` +
      `  1. 启动 Chrome: google-chrome --remote-debugging-port=9222\n` +
      `  2. 或用 cdp-tunnel: npx cdp-tunnel setup\n` +
      `  3. 或指定端口: --cdp <port>`,
    );
  }

  if (/^\d+$/.test(raw)) {
    const port = raw;
    const httpResp = await fetchNoProxy(`http://localhost:${port}/json/version`);
    const data = (await httpResp.json()) as { webSocketDebuggerUrl?: string };
    if (!data.webSocketDebuggerUrl) {
      throw new Error(`Could not discover CDP endpoint from localhost:${port}`);
    }
    return data.webSocketDebuggerUrl;
  }

  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    try {
      const httpResp = await fetchNoProxy(`${raw}/json/version`);
      const data = (await httpResp.json()) as { webSocketDebuggerUrl?: string };
      if (!data.webSocketDebuggerUrl) {
        throw new Error(`Could not discover CDP endpoint from ${raw}`);
      }
      return data.webSocketDebuggerUrl;
    } catch (error) {
      console.warn(`Failed to fetch WebSocket URL from ${raw}, using endpoint directly: ${error instanceof Error ? error.message : String(error)}`);
      return raw;
    }
  }

  return raw;
}
