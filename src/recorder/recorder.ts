import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import type { Page } from '../browser-shim.js';

/**
 * A single recorded browser event (click, type, scroll, navigate, etc.).
 */
export interface RecordedEvent {
  id: string;
  type: 'click' | 'type' | 'scroll' | 'navigate' | 'keypress' | 'page_load';
  timestamp: number;
  selector?: string;
  data?: Record<string, unknown>;
}

/**
 * A complete recording session with metadata and captured events.
 */
export interface RecordingSession {
  id: string;
  name: string;
  startUrl: string;
  startTime: string;
  duration: number;
  events: RecordedEvent[];
}

/**
 * Current status of an active recording.
 */
export interface RecorderStatus {
  isRecording: boolean;
  eventCount: number;
  duration: number;
}

const RECORDER_INJECT = `
(function() {
  if (window.__xbrowserRecorder) return;
  window.__xbrowserRecorder = {
    events: [],
    startTime: Date.now(),
    recording: true,

    recordEvent(type, data) {
      if (!this.recording) return;
      this.events.push({
        id: 'evt_' + String(this.events.length + 1).padStart(3, '0'),
        type: type,
        timestamp: Date.now() - this.startTime,
        data: data
      });
    },

    init() {
      document.addEventListener('click', (e) => {
        const sel = this.getSelector(e.target);
        this.recordEvent('click', { selector: sel, x: e.clientX, y: e.clientY });
      }, true);

      document.addEventListener('input', (e) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
          this.recordEvent('type', { selector: this.getSelector(e.target), value: e.target.value });
        }
      }, true);

      document.addEventListener('scroll', () => {
        this.recordEvent('scroll', { scrollX: window.scrollX, scrollY: window.scrollY });
      }, true);

      document.addEventListener('keydown', (e) => {
        if (e.key.length === 1 || ['Enter', 'Tab', 'Escape', 'Backspace'].includes(e.key)) {
          this.recordEvent('keypress', { key: e.key, selector: this.getSelector(e.target) });
        }
      }, true);
    },

    getSelector(el) {
      if (el.id) return '#' + el.id;
      if (el.className && typeof el.className === 'string') {
        const cls = el.className.trim().split(/\\s+/).join('.');
        return el.tagName.toLowerCase() + '.' + cls;
      }
      return el.tagName.toLowerCase();
    },

    stop() {
      this.recording = false;
      return this.events;
    },

    getEvents() {
      return this.events;
    }
  };
  window.__xbrowserRecorder.init();
})();
`;

/**
 * Controller for recording browser interactions on a page.
 *
 * Injects a client-side recorder script that captures click, input,
 * scroll, and keyboard events. The recording can be stopped and saved
 * to a YAML file.
 */
export class RecorderController {
  private page: Page;
  private isRecordingFlag = false;
  private events: RecordedEvent[] = [];
  private startTime = 0;
  private startUrl = '';
  private name = '';

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Start recording browser interactions.
   *
   * Injects the recorder script into the page and optionally navigates
   * to a starting URL.
   *
   * @param options - Recording options with optional starting URL and session name.
   * @throws If a recording is already in progress.
   */
  async start(options: { url?: string; name?: string } = {}): Promise<void> {
    if (this.isRecordingFlag) {
      throw new Error('Recording is already in progress');
    }

    this.isRecordingFlag = true;
    this.startTime = Date.now();
    this.events = [];
    this.name = options.name || '';

    await this.page.addInitScript(RECORDER_INJECT);

    if (options.url) {
      await this.page.goto(options.url, { waitUntil: 'domcontentloaded' });
      this.startUrl = options.url;
    } else {
      this.startUrl = this.page.url();
    }

    await this.page.evaluate(RECORDER_INJECT);

    this.events.push({
      id: 'evt_001',
      type: 'page_load',
      timestamp: 0,
      data: { url: this.startUrl },
    });
  }

  /**
   * Stop the current recording and save it to a YAML file.
   *
   * Collects all captured events from the page, stops the recorder,
   * and writes the session to disk.
   *
   * @param outputPath - Optional file path to save the recording. Defaults to `recordings/` directory.
   * @returns An object with the output file path and the recording session data.
   * @throws If no recording is in progress.
   */
  async stop(outputPath?: string): Promise<{ path: string; session: RecordingSession }> {
    if (!this.isRecordingFlag) {
      throw new Error('No recording in progress');
    }

    this.isRecordingFlag = false;

    try {
      const injectedEvents = await this.page.evaluate(
        'window.__xbrowserRecorder ? window.__xbrowserRecorder.getEvents() : []'
      );
      if (Array.isArray(injectedEvents)) {
        for (const evt of injectedEvents) {
          this.events.push({
            id: evt.id || `evt_${String(this.events.length + 1).padStart(3, '0')}`,
            type: evt.type,
            timestamp: evt.timestamp || 0,
            selector: evt.data?.selector,
            data: evt.data,
          });
        }
      }
    } catch {
      // page may be closed
    }

    try {
      await this.page.evaluate(
        'window.__xbrowserRecorder ? window.__xbrowserRecorder.stop() : undefined'
      );
    } catch {
      // ignore
    }

    const session: RecordingSession = {
      id: `rec_${Date.now()}`,
      name: this.name,
      startUrl: this.startUrl,
      startTime: new Date(this.startTime).toISOString(),
      duration: Date.now() - this.startTime,
      events: this.events,
    };

    const finalPath = outputPath || this.getDefaultOutputPath();
    const dir = path.dirname(finalPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(finalPath, yaml.stringify(session), 'utf-8');

    return { path: finalPath, session };
  }

  /**
   * Get the current recording status.
   *
   * @returns The recorder status, or `null` if not recording.
   */
  getStatus(): RecorderStatus | null {
    if (!this.isRecordingFlag) return null;
    return {
      isRecording: true,
      eventCount: this.events.length,
      duration: Date.now() - this.startTime,
    };
  }

  private getDefaultOutputPath(): string {
    const recordingsDir = path.join(process.cwd(), 'recordings');
    return path.join(recordingsDir, `recording-${new Date(this.startTime).toISOString().replace(/[:.]/g, '-')}.yaml`);
  }
}
