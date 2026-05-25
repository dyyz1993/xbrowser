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
    const httpResp = await fetchNoProxy('http://localhost:9222/json/version');
    const data = (await httpResp.json()) as { webSocketDebuggerUrl?: string };
    if (!data.webSocketDebuggerUrl) {
      throw new Error('Could not auto-discover CDP endpoint from localhost:9222');
    }
    return data.webSocketDebuggerUrl;
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
