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
    | 'touch' | 'focus' | 'visibility'
    // Proactive sensing actions (not user-initiated, but observed by recorder)
    | 'popup_appear' | 'discovered_filters';
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
    /** 结构地址（r6）：祖先 form 在同级 form 中的序 + 元素在 form 内同 tag
     * 兄弟中的序（仅 form 直接子元素捕获）。布局位移后坐标失效时仍可定位。 */
    ordinal?: { formNth: number; tagNth: number };
    /** 关联 label 的文本（r16）：for= 关联或祖先 label 包裹。行重排/虚拟
     * 列表重建后结构序失效时的内容锚。 */
    labelText?: string;
    /** 元素尺寸（r25）：录制时 rounded rect。同指纹诱饵消歧的评分信号
     * （仅加分不否决——响应式布局合法改变尺寸）。 */
    size?: { w: number; h: number };
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

  /**
   * Auto-captured snapshot for this action (key types only).
   * PNG stored in .tmp/snapshots/ (easy to clean up);
   * aria tree stored inline as compact text (searchable via grep).
   */
  snapshots?: {
    /** Viewport screenshot path (relative, under .tmp/snapshots/) */
    png?: string;
    /** Compact accessibility tree text (inline, grep-able) */
    aria?: string;
  };

  /** For type='popup_appear' — proactive sensing of a popover/dropdown/menu
   * becoming visible (whether triggered by user hover/click, or auto-shown). */
  popupAppear?: {
    /** The trigger element that caused the popup (if known) */
    trigger?: { selector: string; text: string };
    /** The popup container */
    popup: {
      selector: string;
      text: string;
      rect: { x: number; y: number; w: number; h: number };
      /** Menu items inside the popup */
      items: Array<{ text: string; selector: string; disabled?: boolean }>;
    };
    /** What caused the popup to appear */
    cause: 'user-hover' | 'user-click' | 'auto' | 'script';
    /** True if a real user action triggered it (false for auto-shown popups) */
    userTriggered: boolean;
  };

  /** For type='discovered_filters' — proactive baseline scan of the page.
   * Pushed on start and after navigation; merged into RecordingData.discoveredFilters. */
  discoveredFilters?: DiscoveredFilter[];
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

export interface DiscoveredTrigger {
  /** Selector for replay/AI targeting */
  selector: string;
  /** Text label (e.g. "新发布", "综合", "价格") */
  text: string;
  /** Semantic role, if any */
  role?: string;
  /** Category — helps AI understand what this trigger does */
  category: 'sort' | 'filter' | 'tab' | 'menu' | 'navigation' | 'unknown';
  /** Set to true once we observe a popup appearing for this trigger */
  hasPopup: boolean;
  /** Set to true when the user actually clicks or hovers it */
  userInteracted: boolean;
  /** Set to true when the mouse lingered on it (>800ms) without clicking */
  explored: boolean;
}

export interface DiscoveredFilter {
  /** Container element selector (the surrounding bar/region) */
  containerSelector: string;
  /** Container category */
  category: 'sort' | 'filter' | 'tab' | 'menu' | 'navigation';
  /** Container text (first 60 chars, for AI context) */
  containerText: string;
  /** Triggers found inside this container */
  triggers: DiscoveredTrigger[];
}

export interface RecordingData {
  startUrl: string;
  sessionName: string;
  startedAt: string;
  actions: UserAction[];
  network: NetworkEntry[];
  contextChanges: ContextChange[];
  checkpoints: CheckpointEntry[];
  /** Proactive baseline scan of filter/sort/tab/menu regions on the page.
   * Populated on start and after navigation; updated as popups are observed. */
  discoveredFilters?: DiscoveredFilter[];
}

export interface RecordingControlFile {
  pid: number;
  startedAt: string;
  startUrl: string;
  sessionName: string;
}
