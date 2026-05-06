/**
 * Payload sent to a webhook endpoint for lifecycle events.
 */
export interface WebhookPayload {
  event: 'captcha-detected' | 'captcha-resolved' | 'session-started' | 'session-ended';
  timestamp: string;
  sessionId?: string;
  url?: string;
  reason?: string;
  previewUrl?: string;
  targetUrl?: string;
  timeout?: number;
}

/**
 * Sends webhook notifications for browser automation lifecycle events.
 *
 * Reads the webhook URL from the constructor argument or the
 * `XBROWSER_NOTIFY_URL` environment variable.
 */
export class WebhookNotifier {
  private url: string | null;

  constructor(url?: string) {
    this.url = url || process.env.XBROWSER_NOTIFY_URL || null;
  }

  /**
   * Send a webhook notification payload.
   *
   * @param payload - The event payload to send.
   * @returns `true` if the request succeeded (HTTP 2xx), `false` otherwise.
   */
  async notify(payload: WebhookPayload): Promise<boolean> {
    if (!this.url) return false;

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
