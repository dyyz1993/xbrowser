export interface RecordingEvent {
  type: string;
  selector?: string;
  tagName?: string;
  data?: { value?: string; key?: string; x?: number; y?: number };
  timestamp?: number;
  pageState?: { url?: string; title?: string };
}

export interface Recording {
  startUrl: string;
  events?: RecordingEvent[];
  id?: string;
  name?: string;
  startTime?: string;
  duration?: number;
}
