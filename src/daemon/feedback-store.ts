import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export type FeedbackType = 'like' | 'dislike' | 'none';

export interface FeedbackEntry {
  url: string;
  method: string;
  path: string;
  feedback: FeedbackType;
  timestamp: number;
}

const FEEDBACK_FILE = join(homedir(), '.xbrowser', 'feedback.json');

export class FeedbackStore {
  private entries: FeedbackEntry[] = [];

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const data = readFileSync(FEEDBACK_FILE, 'utf8');
      this.entries = JSON.parse(data);
    } catch {
      this.entries = [];
    }
  }

  private save(): void {
    try {
      mkdirSync(join(homedir(), '.xbrowser'), { recursive: true });
      writeFileSync(FEEDBACK_FILE, JSON.stringify(this.entries, null, 2));
    } catch {
      // ignore
    }
  }

  add(entry: { url: string; method: string; path: string }, feedback: FeedbackType): void {
    this.entries = this.entries.filter(
      e => !(e.url === entry.url && e.method === entry.method)
    );
    if (feedback !== 'none') {
      this.entries.push({
        url: entry.url,
        method: entry.method,
        path: entry.path,
        feedback,
        timestamp: Date.now(),
      });
    }
    this.save();
  }

  get(url: string, method: string): FeedbackType {
    const entry = this.entries.find(
      e => e.url === url && e.method === method
    );
    return entry?.feedback ?? 'none';
  }

  getScoreAdjustment(path: string, _method: string): number {
    let adjustment = 0;
    for (const entry of this.entries) {
      if (entry.path === path || entry.path.startsWith(path + '/') || path.startsWith(entry.path + '/')) {
        if (entry.feedback === 'like') adjustment += 15;
        if (entry.feedback === 'dislike') adjustment -= 15;
      }
    }
    return Math.max(-30, Math.min(30, adjustment));
  }

  list(options?: { limit?: number }): FeedbackEntry[] {
    const limit = options?.limit ?? 50;
    return this.entries.slice(-limit).reverse();
  }

  clear(): void {
    this.entries = [];
    this.save();
  }
}

export const feedbackStore = new FeedbackStore();
