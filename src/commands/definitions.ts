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
 */
export interface Recording {
  startUrl: string;
  events?: RecordingEvent[];
  id?: string;
  name?: string;
  startTime?: string;
  duration?: number;
}
