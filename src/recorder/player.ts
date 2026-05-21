import * as fs from 'fs';
import * as yaml from 'yaml';
import type { Page } from 'playwright';
import type { RecordingSession, RecordedEvent } from './recorder.js';

/**
 * Options for controlling playback speed and error handling.
 */
export interface PlaybackOptions {
  slowMo?: number;
  stopOnError?: boolean;
  onProgress?: (info: { current: number; total: number; event: RecordedEvent }) => void;
}

/**
 * Result of playing back a recording session.
 */
export interface PlaybackResult {
  success: boolean;
  duration: number;
  eventsPlayed: number;
  totalEvents: number;
  errors: Array<{ eventIndex: number; event: RecordedEvent; error: string }>;
}

/**
 * Engine for playing back a recorded browser session.
 *
 * Replays events (click, type, scroll, navigate, keypress) on a live
 * Playwright page, respecting original timing with an optional slow-motion factor.
 */
export class PlaybackEngine {
  private page: Page;
  private recording: RecordingSession;

  constructor(page: Page, recording: RecordingSession) {
    this.page = page;
    this.recording = recording;
  }

  /**
   * Create a PlaybackEngine from a YAML recording file.
   *
   * @param page - The Playwright page to replay events on.
   * @param filePath - Path to the YAML recording file.
   * @returns A new PlaybackEngine instance.
   */
  static fromFile(page: Page, filePath: string): PlaybackEngine {
    const content = fs.readFileSync(filePath, 'utf-8');
    const raw = (filePath.endsWith('.json') ? JSON.parse(content) : yaml.parse(content)) as RecordingSession & {
      actions?: Array<{ type: string; element?: { selector?: string }; value?: string; timestamp: number; key?: string; scrollX?: number; scrollY?: number }>;
    };

    let recording: RecordingSession;
    if (raw.events && raw.events.length > 0) {
      recording = raw;
    } else if (raw.actions && raw.actions.length > 0) {
      const events: RecordedEvent[] = raw.actions.map((a, i) => {
        const mappedType = a.type === 'input' ? 'type' : a.type === 'keydown' ? 'keypress' : a.type === 'submit' ? 'click' : a.type;
        const data: Record<string, unknown> = {};
        if (a.value) data.value = a.value;
        if (a.key) data.key = a.key;
        if (a.scrollX !== undefined) data.scrollX = a.scrollX;
        if (a.scrollY !== undefined) data.scrollY = a.scrollY;
        return {
          id: String(i),
          type: mappedType as RecordedEvent['type'],
          selector: a.element?.selector,
          timestamp: a.timestamp,
          data,
        };
      });
      recording = { id: 'replay', name: 'replay', startUrl: raw.startUrl, startTime: new Date().toISOString(), duration: 0, events };
    } else {
      recording = { id: 'replay', name: 'replay', startUrl: raw.startUrl || '', startTime: new Date().toISOString(), duration: 0, events: [] };
    }

    return new PlaybackEngine(page, recording);
  }

  /**
   * Play back all recorded events on the page.
   *
   * Navigates to the recording's start URL, then replays each event
   * with original inter-event timing multiplied by the slow-motion factor.
   *
   * @param options - Playback options for slow motion, error handling, and progress callbacks.
   * @returns A PlaybackResult with success status, duration, and any errors.
   */
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
          await this.page.click((event.selector || data.selector) as string, { force: true, timeout: 10000 });
        }
        break;

      case 'type':
        if ((event.selector || data.selector) && data.value !== undefined) {
          await this.page.fill(
            (event.selector || data.selector) as string,
            data.value as string,
            { force: true, timeout: 10000 },
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
