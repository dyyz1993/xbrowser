import type { Request, Response } from '../browser-shim.js';
import type { NetworkEntry } from './recording-types.js';

export interface NetworkCaptureState {
  entries: NetworkEntry[];
  counter: { value: number };
  lastRequestKey: string;
  lastRequestTs: number;
}

export function createNetworkCaptureState(): NetworkCaptureState {
  return { entries: [], counter: { value: 0 }, lastRequestKey: '', lastRequestTs: 0 };
}

export function handleNetworkRequest(request: Request, state: NetworkCaptureState): void {
  const resourceType = request.resourceType();
  if (['image', 'stylesheet', 'font', 'manifest', 'other'].includes(resourceType)) return;

  const url = request.url();
  if (url.startsWith('data:') || url.startsWith('chrome-extension://') || url.startsWith('blob:')) return;

  // Dedup: skip if same URL+method was seen in last 100ms (forwarded event duplication)
  const dedupKey = request.method() + ' ' + url;
  const now = Date.now();
  if (state.lastRequestKey === dedupKey && now - state.lastRequestTs < 100) return;
  state.lastRequestKey = dedupKey;
  state.lastRequestTs = now;

  state.counter.value++;
  const entry: NetworkEntry = {
    id: state.counter.value,
    timestamp: Date.now(),
    method: request.method(),
    url,
    path: new URL(url).pathname,
    status: 0,
    resourceType,
    contentType: '',
    responseSize: 0,
  };

  // Capture request body for mutation methods
  if (['POST', 'PATCH', 'PUT'].includes(request.method())) {
    try {
      const postData = request.postData();
      if (postData) {
        try {
          entry.requestBody = JSON.parse(postData);
        } catch {
          entry.requestBody = postData.substring(0, 500);
        }
      }
    } catch { /* ignore */ }
  }

  state.entries.push(entry);
}

export async function handleNetworkResponse(response: Response, state: NetworkCaptureState): Promise<void> {
  const url = response.url();
  if (url.startsWith('data:') || url.startsWith('chrome-extension://') || url.startsWith('blob:')) return;

  // Find matching request entry (status still 0)
  const entry = [...state.entries].reverse().find(e => e.url === url && e.status === 0);
  if (!entry) return;

  entry.status = response.status();
  entry.contentType = response.headers()['content-type'] || '';

  // Only capture response body for API-like requests
  const resourceType = response.request().resourceType();
  const isApi = ['fetch', 'xhr'].includes(resourceType) ||
    entry.contentType.includes('json') ||
    entry.contentType.includes('text/');

  if (isApi) {
    try {
      const text = await response.text();
      entry.responseSize = text.length;
      if (text.length <= 20480) {
        try {
          entry.responseBody = JSON.parse(text);
        } catch {
          entry.responseBody = text.substring(0, 500);
        }
      }
    } catch { /* unable to read */ }
  } else {
    try {
      entry.responseSize = parseInt(response.headers()['content-length'] || '0', 10);
    } catch { /* ignore */ }
  }
}
