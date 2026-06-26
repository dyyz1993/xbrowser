/**
 * Custom window fields injected by xbrowser's recording/monitoring JS.
 *
 * These are set by addInitScript / evaluate and read back in evaluate callbacks.
 * Declared globally so callbacks can access them without `as unknown as`.
 */

export {};

declare global {
  interface Window {
    // Element descriptor (injected by ACTION_SIGNAL_SCRIPT in session-recorder.ts)
    __xb_describe?: (el: Element) => Record<string, unknown>;
    // Element focus tracking (injected by element-monitor.ts)
    __xb_last_focused?: unknown;
    __xb_focus_seq?: number;
    // Anti-bot detection signals
    __webdriver_script_fn?: unknown;
    __webdriver_evaluate?: unknown;
    chrome?: unknown;
    // React DevTools (checked by interaction.ts for SPA detection)
    __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown;
  }

  interface Navigator {
    webdriver?: boolean;
    permissions?: unknown;
  }
}
