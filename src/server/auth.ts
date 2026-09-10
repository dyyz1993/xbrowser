/**
 * Resolve the list of valid authentication tokens from config and environment.
 *
 * Merges tokens from the config file and the `XBROWSER_SERVER_TOKEN` environment
 * variable (comma-separated). Duplicates are removed.
 *
 * @param configTokens - Tokens from the server configuration.
 * @returns Deduplicated array of valid token strings.
 */
export function resolveTokens(configTokens?: string[]): string[] {
  const tokens = new Set<string>();

  if (configTokens) {
    for (const t of configTokens) {
      if (t) tokens.add(t);
    }
  }

  const envTokens = process.env.XBROWSER_SERVER_TOKEN;
  if (envTokens) {
    for (const t of envTokens.split(',')) {
      const trimmed = t.trim();
      if (trimmed) tokens.add(trimmed);
    }
  }

  return Array.from(tokens);
}

/**
 * Validate a Bearer token from the Authorization header.
 *
 * @param authHeader - The raw `Authorization` header value (e.g. `Bearer abc123`).
 * @param validTokens - Array of accepted tokens.
 * @returns `true` if the token is valid, `false` otherwise.
 */
export function validateAuth(authHeader: string | undefined, validTokens: string[]): boolean {
  if (!isAuthRequired(validTokens)) return true;
  if (!authHeader) return false;

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;

  return validTokens.includes(match[1]);
}

/**
 * Check whether authentication is required based on configured tokens.
 *
 * If no tokens are configured (empty array + no env var), authentication is
 * considered disabled (dev mode).
 *
 * @param validTokens - Array of configured tokens.
 * @returns `true` if at least one token is configured, `false` otherwise.
 */
export function isAuthRequired(validTokens: string[]): boolean {
  return validTokens.length > 0;
}

const IPV6_LOOPBACK = new Set(['::1', '0:0:0:0:0:0:0:1']);

/**
 * Check whether a bind host is a loopback address.
 *
 * Accepts `localhost`, the whole 127.0.0.0/8 range, and IPv6 `::1`
 * (with or without brackets). Wildcard binds (`0.0.0.0`, `::`) are NOT
 * loopback — they listen on every interface and are treated as remote.
 *
 * @param host - The host string the server would bind to.
 * @returns `true` if the host only accepts loopback connections.
 */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (h === 'localhost') return true;
  if (IPV6_LOOPBACK.has(h)) return true;
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  return ipv4 !== null && ipv4[1] === '127';
}

/**
 * Check whether a browser Origin header value points at a loopback host.
 *
 * Used by the CORS policy: by default only loopback browser origins
 * (a local dev page served from localhost or 127.0.0.1, any port) may
 * call the API; anything else needs an explicit allowlist entry.
 *
 * @param origin - The raw `Origin` request header value.
 * @returns `true` if the origin is an http(s) URL with a loopback hostname.
 */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}
