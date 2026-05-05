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

export class WebhookNotifier {
  private url: string | null;

  constructor(url?: string) {
    this.url = url || process.env.XBROWSER_NOTIFY_URL || null;
  }

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
