import type { ScoredEntry } from './network-scorer.js';

export interface ReusabilityAnalysis {
  level: 'high' | 'medium' | 'low' | 'unknown';
  score: number;
  reasons: string[];
  detections: {
    needsSignature: boolean;
    needsTimestamp: boolean;
    needsAuthToken: boolean;
    needsCookies: boolean;
    hasFixedCredentials: boolean;
  };
}

export interface AnalyzedEntry extends ScoredEntry {
  reusability: ReusabilityAnalysis;
}

const SIGNATURE_KEYS = new Set(['sign', 'signature', 'sig', '_sign', 'sign_str', 'sign_data', 'signstr']);
const TIMESTAMP_KEYS = new Set(['timestamp', 'ts', '_t', 'nonce', '_timestamp', 'timestr']);
const CREDENTIAL_KEYS = new Set(['appkey', 'appid', 'clientid', 'client_id', 'app_key', 'api_key']);

function extractKeys(obj: unknown): string[] {
  if (typeof obj !== 'object' || obj === null) return [];
  return Object.keys(obj as Record<string, unknown>);
}

function extractQueryKeys(url: string): string[] {
  try {
    const u = new URL(url);
    return [...u.searchParams.keys()];
  } catch {
    return [];
  }
}

function scanKeys(keys: string[]): { needsSignature: boolean; needsTimestamp: boolean; hasFixedCredentials: boolean } {
  let needsSignature = false;
  let needsTimestamp = false;
  let hasFixedCredentials = false;
  for (const raw of keys) {
    const k = raw.toLowerCase().replace(/[-_]/g, '');
    if (SIGNATURE_KEYS.has(k) || SIGNATURE_KEYS.has(raw.toLowerCase())) needsSignature = true;
    if (TIMESTAMP_KEYS.has(k) || TIMESTAMP_KEYS.has(raw.toLowerCase())) needsTimestamp = true;
    if (CREDENTIAL_KEYS.has(k) || CREDENTIAL_KEYS.has(raw.toLowerCase())) hasFixedCredentials = true;
  }
  return { needsSignature, needsTimestamp, hasFixedCredentials };
}

function scanUrl(url: string): Partial<ReusabilityAnalysis['detections']> {
  return scanKeys(extractQueryKeys(url));
}

function scanBody(body: unknown): Partial<ReusabilityAnalysis['detections']> {
  if (typeof body !== 'object' || body === null) return {};
  const root = body as Record<string, unknown>;
  const keys = extractKeys(root);
  if (root.data && typeof root.data === 'object' && root.data !== null) {
    keys.push(...extractKeys(root.data));
  }
  if (root.params && typeof root.params === 'object' && root.params !== null) {
    keys.push(...extractKeys(root.params));
  }
  return scanKeys(keys);
}

function scanHeaders(headers: Record<string, string>): Partial<ReusabilityAnalysis['detections']> {
  const detections: Partial<ReusabilityAnalysis['detections']> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'authorization' && v) {
      detections.needsAuthToken = true;
    }
    if (k.toLowerCase() === 'cookie' && v) {
      detections.needsCookies = true;
    }
  }
  return detections;
}

export function analyzeEntry(entry: { url: string; headers: Record<string, string>; body?: unknown }): ReusabilityAnalysis {
  const urlDetect = scanUrl(entry.url);
  const bodyDetect = scanBody(entry.body);
  const headerDetect = scanHeaders(entry.headers);

  const detections = {
    needsSignature: urlDetect.needsSignature || bodyDetect.needsSignature || false,
    needsTimestamp: urlDetect.needsTimestamp || bodyDetect.needsTimestamp || false,
    needsAuthToken: headerDetect.needsAuthToken || false,
    needsCookies: headerDetect.needsCookies || false,
    hasFixedCredentials: urlDetect.hasFixedCredentials || bodyDetect.hasFixedCredentials || false,
  };

  let score = 100;
  const reasons: string[] = [];

  if (detections.needsSignature) {
    score -= 40;
    reasons.push('Requires signature parameter');
  }

  if (detections.needsTimestamp) {
    score -= 20;
    reasons.push('Requires fresh timestamp');
  }

  if (detections.needsAuthToken) {
    score -= 20;
    reasons.push('Requires authorization token');
  }

  if (detections.needsCookies) {
    score -= 15;
    reasons.push('Requires session cookies');
  }

  if (detections.hasFixedCredentials) {
    score += 10;
    reasons.push('Has fixed API credentials');
  }

  score = Math.max(0, Math.min(100, score));

  let level: ReusabilityAnalysis['level'];
  if (score >= 80) level = 'high';
  else if (score >= 50) level = 'medium';
  else if (score > 0) level = 'low';
  else level = 'unknown';

  return { level, score, reasons, detections };
}

export function enrichEntry(entry: ScoredEntry): AnalyzedEntry {
  return { ...entry, reusability: analyzeEntry(entry) };
}

export function enrichEntries(entries: ScoredEntry[]): AnalyzedEntry[] {
  return entries.map(enrichEntry);
}
