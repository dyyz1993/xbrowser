import type { Page } from '../browser-shim.js';
import { getSelectorGeneratorScript } from './selector-utils.js';
import { ACTION_SIGNAL_SCRIPT, CHECKPOINT_OVERLAY_SCRIPT } from './injection-scripts.js';

export async function injectActionScript(page: Page): Promise<boolean> {
    let success = false;
    const maxAttempts = 3;
    let lastError = '';
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Inject the 13-strategy unique selector generator FIRST so action script can use it
        await page.evaluate(getSelectorGeneratorScript());
        await page.evaluate(ACTION_SIGNAL_SCRIPT);
        // Store script source so pollActions can inject into dynamic iframes
        await page.evaluate(`window.__xb_action_script_src = ${JSON.stringify(ACTION_SIGNAL_SCRIPT)};`);

        // Verify injection was successful — check that the action signal flag is set
        const injected = await page.evaluate(`(function() {
          try { return !!window.__xb_action_signal; } catch(e) { return false; }
        })()`).catch(() => false);
        if (injected) {
          success = true;
          break;  // Injection successful, stop retrying
        }
        lastError = 'verification failed (script did not set __xb_action_signal flag)';
        console.error(`[recorder] Action signal injection verification failed (attempt ${attempt}/${maxAttempts})`);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(typeof e === 'string' ? e : 'unknown error');
        lastError = err.message;
        console.error(`[recorder] Action signal injection error (attempt ${attempt}/${maxAttempts}): ${err.message}`);
      }
      // Wait before retrying
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    if (!success) {
      console.error(`[recorder] WARNING: Action signal injection FAILED after ${maxAttempts} attempts. User actions will NOT be recorded. Last error: ${lastError}`);
    }

    // Checkpoint overlay — best-effort, non-critical
    try {
      await page.evaluate(CHECKPOINT_OVERLAY_SCRIPT);
    } catch (e) {
      // Checkpoint overlay is non-critical
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[recorder] Checkpoint overlay injection failed (non-fatal): ${msg}`);
    }

    // Trigger a proactive baseline scan now that the action script is in.
    // The browser-side script also auto-runs on DOMContentLoaded, but this
    // call covers the case where injection happened after DOM ready (very
    // common with CDP attach to existing tabs).
    if (success) {
      try {
        await page.evaluate(`(function() {
          if (typeof window.__xb_scanFilters === 'function') {
            setTimeout(window.__xb_scanFilters, 100);
          }
        })()`);
      } catch {
        // Non-critical — scan will run on next navigation anyway.
      }
    }

    // Inject into same-origin iframes — both existing and dynamically created ones
    try {
      await page.evaluate(`
        (function() {
          var _scriptSrc = ${JSON.stringify(ACTION_SIGNAL_SCRIPT)};
          function injectIframe(iframe) {
            try {
              var w = iframe.contentWindow;
              if (!w) return;
              // Force re-injection: clear old flag
              try { delete w.__xb_action_signal; } catch(e) {}
              w.eval(_scriptSrc);
              // Tag iframe so flushIframes knows it's injected
              iframe.__xb_injected = true;
            } catch(e) {}
          }
          function watchIframe(iframe) {
            if (iframe.__xb_watched) return;
            iframe.__xb_watched = true;
            injectIframe(iframe);
            iframe.addEventListener('load', function() { injectIframe(iframe); });
          }
          // Inject into existing iframes
          try {
            var iframes = document.querySelectorAll('iframe');
            for (var i = 0; i < iframes.length; i++) watchIframe(iframes[i]);
          } catch(e) {}
          // Watch for dynamically inserted iframes
          if (!window.__xb_iframe_observer) {
            window.__xb_iframe_observer = new MutationObserver(function(mutations) {
              for (var m = 0; m < mutations.length; m++) {
                for (var n = 0; n < mutations[m].addedNodes.length; n++) {
                  var node = mutations[m].addedNodes[n];
                  if (node.tagName === 'IFRAME') {
                    watchIframe(node);
                  } else if (node.querySelectorAll) {
                    var sub = node.querySelectorAll('iframe');
                    for (var k = 0; k < sub.length; k++) watchIframe(sub[k]);
                  }
                }
              }
            });
            window.__xb_iframe_observer.observe(document.documentElement, { childList: true, subtree: true });
          }
          // Periodic re-injection for iframes that load late or navigate internally
          if (!window.__xb_iframe_timer) {
            window.__xb_iframe_timer = setInterval(function() {
              try {
                var iframes = document.querySelectorAll('iframe');
                for (var i = 0; i < iframes.length; i++) {
                  if (!iframes[i].__xb_injected) {
                    watchIframe(iframes[i]);
                  }
                }
              } catch(e) {}
            }, 3000);
          }
        })();
      `);
    } catch {
      // ignore
    }
  return success;
  }
