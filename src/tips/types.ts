export type TipPriority = 'p0' | 'p1' | 'p2' | 'p3';

export type TipCategory =
  | 'dialog'
  | 'modal'
  | 'popover'
  | 'notification'
  | 'toast'
  | 'dropdown'
  | 'tooltip'
  | 'overlay'
  | 'unknown';

export interface DetectedElement {
  selector: string;
  tag: string;
  role?: string;
  text?: string;
  ariaLabel?: string;
  size: { width: number; height: number };
  position: { x: number; y: number };
  zIndex: number;
  category: TipCategory;
}

export interface SmartTip {
  priority: TipPriority;
  category: TipCategory;
  element: DetectedElement;
  message: string;
  suggestions: string[];
}

export interface ExecutionContext {
  commandName: string;
  params: Record<string, unknown>;
  timestamp: number;
  targetSelector?: string;
}

export interface Snapshot {
  timestamp: number;
  overlaySelectors: string[];
}
