/**
 * Recording-related type definitions.
 * Extracted from session-recorder.ts to keep the main file focused on logic.
 */

export interface ClickContextItem {
  text: string;
  tag?: string;
  disabled?: boolean;
  href?: string;
  /** Selector of this item, used for replay and AI-driven clicks. */
  selector?: string;
}

export interface ClickContextElement {
  tag: string;
  selector?: string;
  role?: string;
  text: string;
  rect?: { x: number; y: number; w: number; h: number };
  items: ClickContextItem[];
}

export interface ClickContextStateChange {
  tag: string;
  text: string;
  id?: string;
  ariaExpanded?: string;
  ariaSelected?: string;
  disabled?: boolean;
  dataState?: string;
  changed?: boolean;
}

export interface ClickContext {
  appeared: ClickContextElement[];
  disappeared: unknown[];
  stateChanges: ClickContextStateChange[];
}

/**
 * Popup/tooltip/dropdown that appears after a hover action.
 *
 * Captured via async sampling (200/500/1000ms after `mouseover`) plus a
 * short-lived MutationObserver. Each entry records the container that popped
 * up and the visible menu items inside it, so that replay and AI inspection
 * can correlate the hover trigger with the options that became available.
 */
export interface HoverPopupInfo {
  tag: string;
  selector: string;
  role?: string;
  text: string;
  rect: { x: number; y: number; w: number; h: number };
  /** Visible menu items (up to 20) — text + selector for replay targeting. */
  items: ClickContextItem[];
}

export interface HoverContext {
  /** Popups that appeared after the hover trigger. */
  appeared: HoverPopupInfo[];
  /** Popups that disappeared while the hover was active. */
  disappeared: Array<{ selector: string; reason: string }>;
  /** Trigger element's aria-expanded / aria-haspopup state changes. */
  stateChanges: ClickContextStateChange[];
}

export interface UserAction {
  id: number;
  type: 'click' | 'input' | 'change' | 'keydown' | 'submit' | 'scroll'
    | 'navigation' | 'goto' | 'cdp-fill' | 'cdp-click' | 'cdp-eval' | 'filechooser'
    | 'dblclick' | 'contextmenu' | 'hover' | 'drag' | 'resize' | 'clipboard'
    | 'touch' | 'focus' | 'visibility';
  timestamp: number;
  url: string;
  pageTitle: string;
  element?: {
    tag: string;
    selector?: string;
    text: string;
    strategy?: string;
    confidence?: 'high' | 'medium' | 'low';
    textFallback?: {
      type: 'text';
      value: string;
      selector: string;
    };
    popup?: {
      containerSelector: string;
      containerText: string;
    };
    role?: string;
    type?: string;
    placeholder?: string;
    ariaLabel?: string;
    href?: string;
  };
  value?: string;
  key?: string;
  x?: number;
  y?: number;
  scrollX?: number;
  scrollY?: number;
  clickContext?: ClickContext;
  /** Popups/tooltip/dropdown observed after a `hover` action (analog of clickContext). */
  hoverContext?: HoverContext;
  files?: {
    names: string[];
    count: number;
    isMultiple: boolean;
    fileData?: Array<{
      name: string;
      type: string;
      size: number;
      dataUrl: string | null;
    }>;
  };
  drag?: {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    source?: { tag: string; selector?: string; text: string };
    target?: { tag: string; selector?: string; text: string };
  };
  resize?: { width: number; height: number };
  clipboard?: { operation: 'copy' | 'paste' | 'cut'; textPreview?: string };
  touch?: {
    touchType: 'start' | 'move' | 'end';
    touches: Array<{ x: number; y: number }>;
  };
  focus?: { focusType: 'focus' | 'blur' };
  visibility?: { state: 'visible' | 'hidden' };
  trajectory?: {
    points: Array<{ x: number; y: number; dt: number }>;
    distance: number;
    duration: number;
  };
  /** Base64-encoded PNG screenshot of the target element (captured on key actions) */
  elementScreenshot?: string;
}

export interface NetworkEntry {
  id: number;
  timestamp: number;
  method: string;
  url: string;
  path: string;
  status: number;
  resourceType: string;
  contentType: string;
  requestBody?: unknown;
  responseBody?: unknown;
  responseSize: number;
}

export interface ContextChange {
  id: number;
  timestamp: number;
  type: 'navigate' | 'new_tab' | 'tab_closed';
  url?: string;
  detail?: string;
}

export interface ElementRef {
  selector: string;
  tag: string;
  text: string;
  role?: string;
  type?: string;
  placeholder?: string;
  ariaLabel?: string;
  href?: string;
}

export interface RecordingStep {
  step: number;
  ref: string;
  action: UserAction;
  network: NetworkEntry[];
  contextChanges: ContextChange[];
  matchedInputs: Array<{
    inputValue: string;
    networkId: number;
    paramName: string;
  }>;
  signals: ActionSignal[];
}

/** Success / verification signal attached to a recording step */
export interface ActionSignal {
  type: 'network_success' | 'url_change' | 'dialog' | 'dom_change';
  value?: string;
  label: string;
}

export interface RecordingSummary {
  startUrl: string;
  recordedAt: string;
  durationMs: number;
  totalActions: number;
  totalNetworkRequests: number;
  steps: RecordingStep[];
  elements: Record<string, ElementRef>;
  checkpoints: CheckpointEntry[];
}

export type CheckpointType = 'dialog' | 'captcha' | 'login' | 'iframe' | 'slider' | 'custom';

export interface CheckpointEntry {
  id: number;
  type: CheckpointType;
  timestamp: number;
  url: string;
  pageTitle: string;
  hint: string;
  selector?: string;
  source: 'auto' | 'manual';
  relatedActionId?: number;
  context?: Record<string, unknown>;
}

export interface RecordingData {
  startUrl: string;
  sessionName: string;
  startedAt: string;
  actions: UserAction[];
  network: NetworkEntry[];
  contextChanges: ContextChange[];
  checkpoints: CheckpointEntry[];
}

export interface RecordingControlFile {
  pid: number;
  startedAt: string;
  startUrl: string;
  sessionName: string;
}
