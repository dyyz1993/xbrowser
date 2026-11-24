import type { UserAction } from '../recorder/recording-types.js';

/**
 * A single event in a browser recording.
 */
export interface RecordingEvent {
  type: string;
  selector?: string;
  tagName?: string;
  data?: { value?: string; key?: string; x?: number; y?: number };
  timestamp?: number;
  pageState?: { url?: string; title?: string };
}

/**
 * A browser recording session with a start URL and captured events.
 *
 * Two on-disk formats exist: the legacy `events` list (selector at the top
 * level, values under `data`) and the `actions` list written by the current
 * recorder (selector under `element`, value/key/coords at the top level).
 */
export interface Recording {
  startUrl: string;
  events?: RecordingEvent[];
  actions?: UserAction[];
  sessionName?: string;
  id?: string;
  name?: string;
  startTime?: string;
  duration?: number;
}
