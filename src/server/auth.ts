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
