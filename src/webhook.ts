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
  /** Drel 等推送服务的通知标题（可选；缺省由 event 推导） */
  title?: string;
  /** Drel 等推送服务的通知正文（可选；缺省由其余字段拼装） */
  body?: string;
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
      // Drel（api.drel.app）等移动推送端点期望 {title, body, url} 简单格式；
      // 其余端点维持原 JSON payload。
      const body = this.isDrelEndpoint(this.url)
        ? JSON.stringify(this.toDrelPayload(payload))
        : JSON.stringify(payload);
      const response = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** Drel 推送端点识别（api.drel.app/<token>） */
  private isDrelEndpoint(url: string): boolean {
    return url.includes('api.drel.app') || url.includes('drel.app');
  }

  private toDrelPayload(payload: WebhookPayload): { title: string; body: string; url?: string } {
    const eventLabel: Record<WebhookPayload['event'], string> = {
      'captcha-detected': '⚠️ 检测到验证码',
      'captcha-resolved': '✅ 验证码已解决',
      'session-started': '▶️ 会话开始',
      'session-ended': '⏹ 会话结束',
    };
    const parts: string[] = [];
    if (payload.reason) parts.push(payload.reason);
    if (payload.targetUrl) parts.push(`目标: ${payload.targetUrl}`);
    if (payload.sessionId) parts.push(`会话: ${payload.sessionId}`);
    if (payload.timeout) parts.push(`超时: ${payload.timeout}s`);
    return {
      title: payload.title || `${eventLabel[payload.event] || payload.event} — 需要你介入`,
      body: payload.body || parts.join('\n') || payload.event,
      ...(payload.previewUrl ? { url: payload.previewUrl } : {}),
    };
  }
}
