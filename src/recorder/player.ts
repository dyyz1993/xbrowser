import * as fs from 'fs';
import * as yaml from 'yaml';
import type { Page } from 'playwright';
import type { RecordingSession, RecordedEvent } from './recorder.js';

export interface PlaybackOptions {
  slowMo?: number;
  stopOnError?: boolean;
  onProgress?: (info: { current: number; total: number; event: RecordedEvent }) => void;
}

export interface PlaybackResult {
  success: boolean;
  duration: number;
  eventsPlayed: number;
  totalEvents: number;
  errors: Array<{ eventIndex: number; event: RecordedEvent; error: string }>;
}

export class PlaybackEngine {
  private page: Page;
  private recording: RecordingSession;

  constructor(page: Page, recording: RecordingSession) {
    this.page = page;
    this.recording = recording;
  }

  static fromFile(page: Page, filePath: string): PlaybackEngine {
    const content = fs.readFileSync(filePath, 'utf-8');
    const recording = yaml.parse(content) as RecordingSession;
    return new PlaybackEngine(page, recording);
  }

  async play(options: PlaybackOptions = {}): Promise<PlaybackResult> {
    const startTime = Date.now();
    const errors: PlaybackResult['errors'] = [];
    const { slowMo = 1, stopOnError = true, onProgress } = options;
    const events = this.recording.events || [];

    if (this.recording.startUrl) {
      try {
        await this.page.goto(this.recording.startUrl, {
          timeout: 30000,
          waitUntil: 'domcontentloaded',
        });
      } catch {
        // continue even if navigation fails
      }
    }

    for (let i = 0; i < events.length; i++) {
      const event = events[i];

      try {
        if (i > 0) {
          const delay = event.timestamp - events[i - 1].timestamp;
          if (delay > 0) {
            await this.page.waitForTimeout(delay * slowMo);
          }
        }

        await this.executeEvent(event);

        if (onProgress) {
          onProgress({ current: i + 1, total: events.length, event });
        }
      } catch (err) {
        errors.push({
          eventIndex: i,
          event,
          error: (err as Error).message,
        });
        if (stopOnError) break;
      }
    }

    return {
      success: errors.length === 0,
      duration: Date.now() - startTime,
      eventsPlayed: events.length - errors.length,
      totalEvents: events.length,
      errors,
    };
  }

  private async executeEvent(event: RecordedEvent): Promise<void> {
    const data = event.data || {};

    switch (event.type) {
      case 'click':
        if (event.selector || data.selector) {
          await this.page.click((event.selector || data.selector) as string);
        }
        break;

      case 'type':
        if ((event.selector || data.selector) && data.value !== undefined) {
          await this.page.fill(
            (event.selector || data.selector) as string,
            data.value as string
          );
        }
        break;

      case 'scroll':
        await this.page.evaluate((scrollData: Record<string, unknown>) => {
          window.scrollTo((scrollData.scrollX as number) || 0, (scrollData.scrollY as number) || 0);
        }, data as Record<string, unknown>);
        break;

      case 'navigate':
        if (data.url) {
          await this.page.goto(data.url as string, { timeout: 15000 });
        }
        break;

      case 'keypress':
        if (data.key) {
          await this.page.keyboard.press(data.key as string);
        }
        break;

      case 'page_load':
        await this.page.waitForLoadState('domcontentloaded');
        break;
    }
  }
}
