import type { NetworkCaptureEntry } from './network-store.js';

export interface ScoreWeights {
  method: { post: number; get: number; other: number };
  resourceType: { api: number; document: number; static: number; other: number };
  size: { goodRange: number; tooLarge: number };
  content: { isJson: number; hasDataArray: number; urlContainsApi: number };
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  method: { post: 30, get: 10, other: 5 },
  resourceType: { api: 20, document: 0, static: -50, other: 0 },
  size: { goodRange: 20, tooLarge: -10 },
  content: { isJson: 10, hasDataArray: 15, urlContainsApi: 10 },
};

export interface ScoredEntry extends NetworkCaptureEntry {
  score: number;
  scoreBreakdown: {
    method: number;
    resourceType: number;
    size: number;
    content: number;
  };
}

const STATIC_TYPES = new Set(['stylesheet', 'image', 'font', 'media']);
const DATA_ARRAY_KEYS = new Set(['data', 'list', 'items', 'results', 'records']);

function calcMethodScore(entry: NetworkCaptureEntry, weights: ScoreWeights): number {
  const m = entry.method.toUpperCase();
  if (m === 'POST' || m === 'PUT' || m === 'DELETE') return weights.method.post;
  if (m === 'GET') return weights.method.get;
  return weights.method.other;
}

function calcResourceTypeScore(entry: NetworkCaptureEntry, weights: ScoreWeights): number {
  const rt = entry.resourceType.toLowerCase();
  if (rt === 'xhr' || rt === 'fetch') return weights.resourceType.api;
  if (rt === 'document') return weights.resourceType.document;
  if (STATIC_TYPES.has(rt)) return weights.resourceType.static;
  return weights.resourceType.other;
}

function calcSizeScore(entry: NetworkCaptureEntry, weights: ScoreWeights): number {
  if (entry.size > 1024 * 1024) return weights.size.tooLarge;
  const isJson = entry.contentType.toLowerCase().includes('json');
  if (entry.body !== undefined && isJson && entry.size > 0 && entry.size < 100 * 1024) {
    return weights.size.goodRange;
  }
  return 0;
}

function calcContentScore(entry: NetworkCaptureEntry, weights: ScoreWeights): number {
  let score = 0;
  if (entry.contentType.toLowerCase().includes('json')) {
    score += weights.content.isJson;
  }
  if (typeof entry.body === 'object' && entry.body !== null && !Array.isArray(entry.body)) {
    for (const key of Object.keys(entry.body as Record<string, unknown>)) {
      if (DATA_ARRAY_KEYS.has(key) && Array.isArray((entry.body as Record<string, unknown>)[key])) {
        score += weights.content.hasDataArray;
        break;
      }
    }
  }
  const urlLower = entry.url.toLowerCase();
  if (
    urlLower.includes('/api/') ||
    urlLower.includes('/v1/') ||
    urlLower.includes('/v2/') ||
    urlLower.includes('/graphql')
  ) {
    score += weights.content.urlContainsApi;
  }
  return score;
}

export function scoreEntry(
  entry: NetworkCaptureEntry,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): ScoredEntry {
  const method = calcMethodScore(entry, weights);
  const resourceType = calcResourceTypeScore(entry, weights);
  const size = calcSizeScore(entry, weights);
  const content = calcContentScore(entry, weights);
  return {
    ...entry,
    score: method + resourceType + size + content,
    scoreBreakdown: { method, resourceType, size, content },
  };
}

export function scoreEntries(
  entries: NetworkCaptureEntry[],
  weights: ScoreWeights = DEFAULT_WEIGHTS,
  feedbackFn?: (path: string, method: string) => number,
): ScoredEntry[] {
  return entries
    .map((e) => {
      const scored = scoreEntry(e, weights);
      if (feedbackFn) {
        scored.score += feedbackFn(e.path, e.method);
      }
      return scored;
    })
    .sort((a, b) => b.score - a.score);
}
