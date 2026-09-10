/**
 * Shared fetch-JSON helper for project-scope API plugins.
 *
 * Replaces bare `fetch(url).then(r => r.json())` call sites, which lack a
 * timeout (hangs forever on stalled APIs) and an HTTP status check (tries to
 * parse HTML error pages as JSON). Mirrors the pattern already used by the
 * google/seo plugins: AbortSignal.timeout + r.ok gate.
 */

export interface FetchJsonInit {
  headers?: Record<string, string>;
  /**
   * Verify HTTP 2xx before parsing (default true). Set false when the API
   * encodes errors in the body of non-2xx responses that the handler needs
   * to read (e.g. dictionaryapi.dev returns 404 + "No Definitions Found").
   */
  checkStatus?: boolean;
  /** Abort timeout in ms (default 15000). */
  timeoutMs?: number;
}

export async function fetchJson(url: string, init: FetchJsonInit = {}): Promise<unknown> {
  const { headers, checkStatus = true, timeoutMs = 15000 } = init;
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (checkStatus && !res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} from ${url}`);
    }
    return await res.json();
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw err;
  }
}
