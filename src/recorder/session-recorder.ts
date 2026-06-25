/**
 * SessionRecorder — Server-side CDP recording engine.
 *
 * Captures user actions, network requests, and context changes
 * at the CDP level via Playwright listeners. Data is scoped to
 * a session directory and cleaned up when the session closes.
 *
 * Lifecycle:
 *   record start → process blocks, CDP listeners active
 *   record stop  → signal file written, recording process flushes & exits
 *   session close → recordings directory cleaned up
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { BrowserContext, Frame, Page, Request, Response, Dialog } from '../browser-shim.js';
import { getSelectorGeneratorScript } from './selector-utils.js';
import { updateSiteKnowledge } from './site-knowledge.js';
import type { UserAction, RecordingData, RecordingSummary, RecordingControlFile, NetworkEntry, CheckpointEntry, CheckpointType, RecordingStep, ContextChange, ClickContext, ElementRef } from './recording-types.js';
export type {
  ClickContextItem, ClickContextElement, ClickContextStateChange, ClickContext,
  UserAction, NetworkEntry, ContextChange, ElementRef,
  RecordingStep, RecordingSummary, CheckpointType, CheckpointEntry,
  RecordingData, RecordingControlFile,
} from './recording-types.js';

// ─── Minimal frontend signal script ──────────────────────────────
// Only captures action signals; all matching happens server-side.

const ACTION_SIGNAL_SCRIPT = `
(function() {
  if (window.__xb_action_signal) return;
  window.__xb_action_signal = true;
  window.__xb_pending_actions = [];

  // --- Unique short selector generator (delegates to 13-strategy selector-utils) ---
  function uniqueSelector(el) {
    if (!el || !el.tagName) return null;
    var doc = el.ownerDocument || document;

    function isUnique(sel) {
      try { return doc.querySelectorAll(sel).length === 1; } catch(e) { return false; }
    }

    // Prefer window.__xb_generateSelector from selector-utils (13 strategies)
    if (typeof window.__xb_generateSelector === 'function') {
      try {
        var result = window.__xb_generateSelector(el, doc);
        if (result && result.selector) return result.selector;
      } catch(e) { /* fallback to local logic */ }
    }

    // 1. #id (shortest, globally unique)
    if (el.id) {
      var idSel = '#' + CSS.escape(el.id);
      if (isUnique(idSel)) return idSel;
    }

    // 2. [data-testid="..."]
    var testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id');
    if (testId) {
      var sel = '[data-testid="' + testId + '"]';
      if (isUnique(sel)) return sel;
    }

    // 3. [name="..."]
    var name = el.getAttribute('name');
    if (name) {
      var sel = el.tagName.toLowerCase() + '[name="' + name + '"]';
      if (isUnique(sel)) return sel;
    }

    // 4. [aria-label="..."]
    var aria = el.getAttribute('aria-label');
    if (aria) {
      var sel = '[aria-label="' + aria.substring(0, 50) + '"]';
      if (isUnique(sel)) return sel;
    }

    // 5. [placeholder="..."]
    var ph = el.getAttribute('placeholder');
    if (ph) {
      var sel = el.tagName.toLowerCase() + '[placeholder="' + ph.substring(0, 50) + '"]';
      if (isUnique(sel)) return sel;
    }

    // 6. tag.class — pick shortest combo that's unique
    var tag = el.tagName.toLowerCase();
    if (typeof el.className === 'string' && el.className.trim()) {
      var classes = el.className.trim().split(/\\s+/).filter(function(c) {
        return c && !/^(ng-|_|css-|sc-|styled-|emotion-)/.test(c);
      });
      // Sort by rarity (less common class first)
      classes.sort(function(a, b) {
        return doc.querySelectorAll('.' + a).length - doc.querySelectorAll('.' + b).length;
      });
      // Try tag + single class
      for (var i = 0; i < classes.length; i++) {
        var sel = tag + '.' + CSS.escape(classes[i]);
        if (isUnique(sel)) return sel;
      }
      // Try tag + two classes
      if (classes.length >= 2) {
        var sel = tag + '.' + CSS.escape(classes[0]) + '.' + CSS.escape(classes[1]);
        if (isUnique(sel)) return sel;
      }
    }

    // 7. parent > tag  (one level up)
    var parent = el.parentElement;
    if (parent) {
      var parentSel = parent.id ? '#' + CSS.escape(parent.id) : parent.tagName.toLowerCase();
      var sel = parentSel + ' > ' + tag;
      if (isUnique(sel)) return sel;
    }

    // 8. :nth-child fallback (tag:nth-child(n) under parent)
    if (parent) {
      var siblings = Array.from(parent.children);
      var idx = siblings.indexOf(el) + 1;
      var parentSel = parent.id ? '#' + CSS.escape(parent.id) : parent.tagName.toLowerCase();
      var sel = parentSel + ' > ' + tag + ':nth-child(' + idx + ')';
      if (isUnique(sel)) return sel;
    }

    // 9. Last resort: full tag
    return tag;
  }

  // --- Element descriptor ---
  function describe(el) {
    if (!el || !el.tagName) return null;
    var tag = el.tagName.toLowerCase();
    var isInputLike = (tag === 'input' || tag === 'textarea' || tag === 'select');
    var displayText = isInputLike
      ? (el.value || el.getAttribute('placeholder') || '').trim().substring(0, 40)
      : (el.textContent || '').trim().substring(0, 40);
    if (tag === 'a' && el.getAttribute('href')) displayText = el.textContent.trim().substring(0, 40);

    // Prefer window.__xb_generateSelector (13 strategies) — also extracts strategy + confidence
    var selector, strategy, confidence;
    if (typeof window.__xb_generateSelector === 'function') {
      try {
        var result = window.__xb_generateSelector(el, el.ownerDocument || document);
        if (result && result.selector) {
          selector = result.selector;
          strategy = result.strategy;
          confidence = result.confidence;
        }
      } catch(e) { /* fall through to local */ }
    }
    if (!selector) {
      selector = uniqueSelector(el);
    }

    // For low-confidence selectors (nth-of-type), generate a text-based fallback
    // when the element has short, unique text (e.g. menu items "删除", "确认")
    var textFallback;
    var popupContext;

    // Check if element is inside a popup/menu first (needed for scoped text uniqueness)
    var popupEl;
    try {
      popupEl = el.closest('[role="menu"], [role="listbox"], [role="dialog"], [role="tooltip"], [role="list"], [class*="popover"], [class*="popup"], [class*="dropdown"], [class*="menu"], [class*="modal"], [id*="menu"], [id*="dropdown"], [id*="popup"], [id*="modal"]');
    } catch(e) {}

    if (confidence === 'low') {
      var rawText = (el.textContent || '').trim();
      if (rawText && rawText.length >= 1 && rawText.length <= 30 && el.children.length === 0) {
        try {
          var doc = el.ownerDocument || document;
          var escapedText = rawText.replace(/'/g, "\\'");

          // If inside popup, check uniqueness WITHIN popup only
          var count;
          if (popupEl && popupEl !== el) {
            var popupCount = doc.evaluate(
              "count(.//*[normalize-space(text())='" + escapedText + "'])",
              popupEl, null, XPathResult.NUMBER_TYPE, null
            );
            count = popupCount.numberValue;
          } else {
            // Check global uniqueness
            var globalCount = doc.evaluate(
              "count(//*[normalize-space(text())='" + escapedText + "'])",
              doc, null, XPathResult.NUMBER_TYPE, null
            );
            count = globalCount.numberValue;
          }

          if (count === 1) {
            textFallback = {
              type: popupEl && popupEl !== el ? 'popup-text' : 'text',
              value: rawText,
              selector: popupEl && popupEl !== el ? 'popup-text=' + rawText : 'text=' + rawText,
            };
          }
        } catch(e) { /* xpath not available or error */ }
      }
    }

    // Generate popup context info
    if (popupEl && popupEl !== el) {
      try {
        var popupResult = window.__xb_generateSelector
          ? window.__xb_generateSelector(popupEl, el.ownerDocument || document)
          : null;
        if (popupResult && popupResult.selector) {
          popupContext = {
            containerSelector: popupResult.selector,
            containerText: (popupEl.textContent || '').trim().substring(0, 50),
          };
        }
      } catch(e) { /* skip */ }
    }

    return {
      tag: tag,
      selector: selector,
      text: displayText,
      strategy: strategy,
      confidence: confidence,
      textFallback: textFallback,
      popup: popupContext,
      role: el.getAttribute('role') || undefined,
      type: el.getAttribute('type') || undefined,
      placeholder: el.getAttribute('placeholder') || undefined,
      ariaLabel: el.getAttribute('aria-label') || undefined,
      href: el.getAttribute('href') ? el.getAttribute('href').substring(0, 80) : undefined,
    };
  }

  // ── Mouse trajectory capture ──────────────────────────────────────
  // Continuously samples mousemove (every ~60ms).
  // When a meaningful action fires, we snapshot the buffer,
  // simplify it (Douglas-Peucker), and attach as trajectory.
  var __xb_traj_buffer = [];        // raw samples: {x, y, t}
  var __xb_traj_last_action = null; // {x, y, t} of previous action

  document.addEventListener('mousemove', function(e) {
    var now = Date.now();
    // Sample at ~60ms intervals
    if (__xb_traj_buffer.length > 0) {
      var last = __xb_traj_buffer[__xb_traj_buffer.length - 1];
      if (now - last.t < 60) return;
    }
    __xb_traj_buffer.push({ x: e.clientX, y: e.clientY, t: now });
    // Cap buffer at 200 points (~12 seconds at 60ms)
    if (__xb_traj_buffer.length > 200) {
      __xb_traj_buffer = __xb_traj_buffer.slice(-150);
    }
  }, true);

  // Douglas-Peucker simplification: keep only points that define the path shape
  function dpSimplify(pts, epsilon) {
    if (pts.length <= 2) return pts;
    var maxDist = 0, maxIdx = 0;
    var first = pts[0], last = pts[pts.length - 1];
    for (var i = 1; i < pts.length - 1; i++) {
      var d = pointLineDistance(pts[i], first, last);
      if (d > maxDist) { maxDist = d; maxIdx = i; }
    }
    if (maxDist > epsilon) {
      var left = dpSimplify(pts.slice(0, maxIdx + 1), epsilon);
      var right = dpSimplify(pts.slice(maxIdx), epsilon);
      return left.slice(0, -1).concat(right);
    }
    return [first, last];
  }

  function pointLineDistance(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.sqrt((p.x - a.x) * (p.x - a.x) + (p.y - a.y) * (p.y - a.y));
    var t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    var projX = a.x + t * dx, projY = a.y + t * dy;
    return Math.sqrt((p.x - projX) * (p.x - projX) + (p.y - projY) * (p.y - projY));
  }

  // Extract trajectory from buffer ending at (toX, toY, toT).
  // Returns null if no meaningful path.
  function extractTrajectory(toX, toY) {
    var now = Date.now();
    // Add current position as final point
    var raw = __xb_traj_buffer.slice();
    raw.push({ x: toX, y: toY, t: now });

    // Trim to last 5 seconds
    var cutoff = now - 5000;
    while (raw.length > 0 && raw[0].t < cutoff) raw.shift();
    if (raw.length < 2) { __xb_traj_buffer = []; return null; }

    // If we know the previous action position, prepend it as start
    if (__xb_traj_last_action) {
      // Trim raw points before the last action
      while (raw.length > 1 && raw[0].t < __xb_traj_last_action.t) raw.shift();
      raw.unshift({ x: __xb_traj_last_action.x, y: __xb_traj_last_action.y, t: __xb_traj_last_action.t });
    }

    // Simplify (epsilon=3px keeps shape but removes jitter)
    var simplified = dpSimplify(raw, 3);
    if (simplified.length < 2) { __xb_traj_buffer = []; return null; }

    // Build result with delta times
    var totalDist = 0;
    var points = [];
    for (var i = 0; i < simplified.length; i++) {
      var dt = i === 0 ? 0 : simplified[i].t - simplified[i - 1].t;
      if (i > 0) {
        var ddx = simplified[i].x - simplified[i - 1].x;
        var ddy = simplified[i].y - simplified[i - 1].y;
        totalDist += Math.sqrt(ddx * ddx + ddy * ddy);
      }
      points.push({ x: simplified[i].x, y: simplified[i].y, dt: dt });
    }

    var duration = simplified[simplified.length - 1].t - simplified[0].t;

    // Only return if meaningful movement (>5px total distance)
    if (totalDist < 5) { __xb_traj_buffer = []; return null; }

    // Reset buffer
    __xb_traj_buffer = [];
    __xb_traj_last_action = { x: toX, y: toY, t: now };

    return { points: points, distance: Math.round(totalDist), duration: duration };
  }

  // ── End trajectory capture ────────────────────────────────────────

  // Expose describe() for CDP command element metadata extraction
  window.__xb_describe = describe;

  function isMeaningful(el) {
    if (!el || !el.tagName) return false;
    var tag = el.tagName.toLowerCase();
    if (tag === 'a' || tag === 'button' || tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (el.getAttribute('role')) return true;
    if (el.getAttribute('aria-label')) return true;
    var text = (el.textContent || '').trim();
    if (text.length > 0 && text.length <= 80) return true;
    return false;
  }

  function resolveMeaningful(e) {
    var path = e.composedPath ? e.composedPath() : [e.target];
    for (var i = 0; i < Math.min(path.length, 8); i++) {
      var el = path[i];
      if (isMeaningful(el)) return el;
    }
    return path[0] || e.target;
  }

  function actualTarget(e) {
    var path = e.composedPath && e.composedPath();
    return (path && path.length > 0) ? path[0] : e.target;
  }

  // --- Input debounce: coalesce rapid keystrokes on same element ---
  var __xb_input_timer = null;
  var __xb_input_pending = null;

  function flushInputAction() {
    if (__xb_input_pending) {
      window.__xb_pending_actions.push(__xb_input_pending);
      __xb_input_pending = null;
    }
    __xb_input_timer = null;
  }

  function pushAction(type, detail) {
    // Attach mouse trajectory for actions with coordinates
    if (detail && detail.x != null && detail.y != null) {
      var traj = extractTrajectory(detail.x, detail.y);
      if (traj) detail.trajectory = traj;
    }

    if (type === 'input') {
      if (__xb_input_timer) clearTimeout(__xb_input_timer);
      __xb_input_pending = {
        type: type,
        ts: Date.now(),
        url: location.href,
        title: document.title,
        ...detail,
      };
      __xb_input_timer = setTimeout(flushInputAction, 800);
      return;
    }
    if (type === 'click' || type === 'submit' || type === 'keydown') {
      if (__xb_input_timer) { clearTimeout(__xb_input_timer); flushInputAction(); }
    }
    window.__xb_pending_actions.push({
      type: type,
      ts: Date.now(),
      url: location.href,
      title: document.title,
      ...detail,
    });
  }

  // --- Click context: capture popover/dropdown/menu/state changes after click ---
  var POPOVER_SELECTORS = [
    '[role="menu"]','[role="listbox"]','[role="dialog"]','[role="tooltip"]','[role="popover"]',
    '[role="combobox"]','[role="tree"]','[role="grid"]',
    '.popover','.popup','.dropdown','.menu','.modal','.tooltip','.panel',
    '[class*="popover"]','[class*="popup"]','[class*="dropdown"]','[class*="menu"]','[class*="tooltip"]',
    '[class*="modal"]','[class*="panel"]','[class*="overlay"]','[class*="sheet"]',
    '[data-popup]','[data-dropdown]','[data-menu]','[data-popover]',
    '.semi-dropdown','.semi-popover','.semi-modal','.semi-select-option',
    '.ant-dropdown','.ant-popover','.ant-modal','.ant-select-dropdown',
    '.el-dropdown','.el-popover','.el-dialog','.el-select-dropdown',
    '.t-dropdown','.t-popup','.t-dialog'
  ];

  function isNearClick(el, cx, cy, range) {
    try {
      var r = el.getBoundingClientRect();
      if (!r || r.width === 0 || r.height === 0) return false;
      // Element overlaps with or is near the click area
      var margin = range || 300;
      return !(r.left > cx + margin || r.right < cx - margin || r.top > cy + margin || r.bottom < cy - margin);
    } catch(e) { return false; }
  }

  function captureVisibleContext(cx, cy) {
    var result = { appeared: [], disappeared: [], stateChanges: [] };
    try {
      // 1. Find popover/dropdown/menu elements near the click
      for (var i = 0; i < POPOVER_SELECTORS.length; i++) {
        try {
          var els = document.querySelectorAll(POPOVER_SELECTORS[i]);
          for (var j = 0; j < els.length; j++) {
            var el = els[j];
            if (!isNearClick(el, cx, cy, 500)) continue;
            var rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            var items = [];
            // Capture child items (up to 20)
            var children = el.querySelectorAll('a,button,[role="menuitem"],[role="option"],[role="treeitem"],li,div[class*="item"]');
            for (var k = 0; k < Math.min(children.length, 20); k++) {
              var child = children[k];
              var childText = (child.textContent || '').trim().substring(0, 60);
              if (!childText) continue;
              var childInfo = { text: childText };
              if (child.disabled) childInfo.disabled = true;
              if (child.getAttribute('aria-disabled') === 'true') childInfo.disabled = true;
              if (child.tagName) childInfo.tag = child.tagName.toLowerCase();
              if (child.href) childInfo.href = child.href.substring(0, 80);
              items.push(childInfo);
            }
            result.appeared.push({
              tag: el.tagName.toLowerCase(),
              selector: uniqueSelector(el),
              role: el.getAttribute('role'),
              text: (el.textContent || '').trim().substring(0, 100),
              rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
              items: items,
            });
          }
        } catch(e) {}
      }

      // 2. Find elements that changed aria-expanded or disabled state near click
      var nearbyEls = document.elementsFromPoint ? document.elementsFromPoint(cx, cy) : [];
      // Also check elements in a wider area
      var area = document.querySelector('body');
      if (area) {
        var allInteractive = area.querySelectorAll('[aria-expanded],[disabled],[aria-disabled],[aria-selected],[data-state]');
        for (var i = 0; i < allInteractive.length; i++) {
          var el = allInteractive[i];
          if (!isNearClick(el, cx, cy, 400)) continue;
          var info = { tag: el.tagName.toLowerCase(), text: (el.textContent || '').trim().substring(0, 60) };
          if (el.id) info.id = el.id;
          if (el.getAttribute('aria-expanded')) info.ariaExpanded = el.getAttribute('aria-expanded');
          if (el.disabled) info.disabled = true;
          if (el.getAttribute('aria-disabled') === 'true') info.disabled = true;
          if (el.getAttribute('aria-selected')) info.ariaSelected = el.getAttribute('aria-selected');
          if (el.getAttribute('data-state')) info.dataState = el.getAttribute('data-state');
          result.stateChanges.push(info);
        }
      }
    } catch(e) {}
    // Deduplicate appeared by selector
    var seen = {};
    result.appeared = result.appeared.filter(function(item) {
      if (!item.selector) return true;
      if (seen[item.selector]) return false;
      seen[item.selector] = true;
      return true;
    });
    return result;
  }

  document.addEventListener('click', function(e) {
    var cx = e.clientX, cy = e.clientY;
    // Snapshot before (for diff)
    var beforeExpanded = {};
    try {
      var expandedEls = document.querySelectorAll('[aria-expanded]');
      for (var i = 0; i < expandedEls.length; i++) {
        var el = expandedEls[i];
        if (isNearClick(el, cx, cy, 400)) {
          beforeExpanded[el.id || uniqueSelector(el)] = el.getAttribute('aria-expanded');
        }
      }
    } catch(e) {}

    pushAction('click', { element: describe(resolveMeaningful(e)), x: cx, y: cy });

    // After 200ms, capture what changed
    setTimeout(function() {
      try {
        var ctx = captureVisibleContext(cx, cy);
        // Check aria-expanded changes
        try {
          var expandedEls = document.querySelectorAll('[aria-expanded]');
          for (var i = 0; i < expandedEls.length; i++) {
            var el = expandedEls[i];
            var key = el.id || uniqueSelector(el);
            var now = el.getAttribute('aria-expanded');
            if (beforeExpanded[key] !== undefined && beforeExpanded[key] !== now) {
              ctx.stateChanges.push({
                tag: el.tagName.toLowerCase(),
                text: (el.textContent || '').trim().substring(0, 60),
                id: el.id || undefined,
                ariaExpanded: now,
                changed: true,
              });
            }
          }
        } catch(e) {}
        if (ctx.appeared.length > 0 || ctx.stateChanges.length > 0) {
          var lastAction = window.__xb_pending_actions[window.__xb_pending_actions.length - 1];
          if (lastAction && lastAction.type === 'click') {
            lastAction.clickContext = ctx;
          }
        }
      } catch(e) {}
    }, 200);
  }, true);

  document.addEventListener('input', function(e) {
    var target = actualTarget(e);
    pushAction('input', {
      element: describe(target),
      value: (target.value || target.textContent || '').substring(0, 200),
    });
  }, true);

  document.addEventListener('change', function(e) {
    var target = actualTarget(e);
    var tag = target.tagName && target.tagName.toLowerCase();
    if (tag === 'select') {
      pushAction('change', { element: describe(target), value: (target.value || '').substring(0, 100) });
    } else if (tag === 'input' && target.type === 'file') {
      var files = target.files;
      var fileNames = [];
      for (var i = 0; i < files.length; i++) {
        fileNames.push(files[i].name);
      }
      // Read file contents asynchronously, then push action
      var readers = [];
      for (var i = 0; i < files.length; i++) {
        readers.push(new Promise(function(resolve) {
          var reader = new FileReader();
          reader.onload = function() { resolve(reader.result); };
          reader.onerror = function() { resolve(null); };
          reader.readAsDataURL(files[i]);
        }));
      }
      Promise.all(readers).then(function(contents) {
        var fileData = [];
        for (var i = 0; i < files.length; i++) {
          fileData.push({
            name: files[i].name,
            type: files[i].type,
            size: files[i].size,
            dataUrl: contents[i],
          });
        }
        pushAction('filechooser', {
          element: describe(target),
          value: fileNames.join(', '),
          files: {
            names: fileNames,
            count: files.length,
            isMultiple: target.multiple,
            fileData: fileData,
          },
        });
      });
    }
  }, true);

  document.addEventListener('keydown', function(e) {
    // Special keys always recorded
    if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'Escape' || e.key.startsWith('Arrow')) {
      pushAction('keydown', { key: e.key, element: describe(actualTarget(e)) });
      return;
    }
    // Editing keys
    if (e.key === 'Backspace' || e.key === 'Delete') {
      pushAction('keydown', { key: e.key, element: describe(actualTarget(e)) });
      return;
    }
    // Modifier combinations (Ctrl/Cmd/Alt + key)
    if (e.ctrlKey || e.metaKey || e.altKey) {
      var combo = '';
      if (e.ctrlKey) combo += 'Ctrl+';
      if (e.metaKey) combo += 'Meta+';
      if (e.altKey) combo += 'Alt+';
      if (e.shiftKey) combo += 'Shift+';
      combo += e.key;
      pushAction('keydown', { key: combo, element: describe(actualTarget(e)) });
    }
  }, true);

  document.addEventListener('submit', function(e) {
    pushAction('submit', { element: describe(actualTarget(e)) });
  }, true);

  document.addEventListener('scroll', function() {
    if (!window.__xb_last_scroll || Date.now() - window.__xb_last_scroll > 500) {
      window.__xb_last_scroll = Date.now();
      pushAction('scroll', { scrollX: window.scrollX, scrollY: window.scrollY });
    }
  }, true);

  // ── Double click ──
  document.addEventListener('dblclick', function(e) {
    pushAction('dblclick', {
      element: describe(resolveMeaningful(e)),
      x: e.clientX,
      y: e.clientY,
    });
  }, true);

  // ── Right click (context menu) ──
  document.addEventListener('contextmenu', function(e) {
    pushAction('contextmenu', {
      element: describe(resolveMeaningful(e)),
      x: e.clientX,
      y: e.clientY,
    });
  }, true);

  // ── Hover (throttled to 800ms) ──
  var __xb_last_hover = 0;
  document.addEventListener('mouseover', function(e) {
    if (Date.now() - __xb_last_hover < 800) return;
    __xb_last_hover = Date.now();
    var target = resolveMeaningful(e);
    // Only record hover on interactive elements
    var tag = target.tagName && target.tagName.toLowerCase();
    var isInteractive = tag === 'a' || tag === 'button' || tag === 'input'
      || tag === 'select' || tag === 'textarea' || tag === 'summary'
      || target.getAttribute('role') === 'button'
      || target.getAttribute('role') === 'link'
      || target.getAttribute('role') === 'menuitem'
      || target.getAttribute('role') === 'tab'
      || target.getAttribute('role') === 'option'
      || !!target.closest('[role="menu"], [role="menubar"], [role="tablist"], [role="listbox"], [role="tree"], nav, menu');
    if (isInteractive) {
      pushAction('hover', {
        element: describe(target),
        x: e.clientX,
        y: e.clientY,
      });
    }
  }, true);

  // ── Drag & drop ──
  var __xb_drag_source = null;
  var __xb_drag_start_pos = null;
  document.addEventListener('dragstart', function(e) {
    __xb_drag_source = e.target;
    __xb_drag_start_pos = { x: e.clientX, y: e.clientY };
  }, true);
  document.addEventListener('drop', function(e) {
    if (__xb_drag_source && __xb_drag_start_pos) {
      pushAction('drag', {
        x: e.clientX,
        y: e.clientY,
        drag: {
          fromX: __xb_drag_start_pos.x,
          fromY: __xb_drag_start_pos.y,
          toX: e.clientX,
          toY: e.clientY,
          source: describe(__xb_drag_source),
          target: describe(resolveMeaningful(e)),
        },
      });
    }
    __xb_drag_source = null;
    __xb_drag_start_pos = null;
  }, true);
  document.addEventListener('dragend', function() {
    __xb_drag_source = null;
    __xb_drag_start_pos = null;
  }, true);

  // ── Window resize ──
  var __xb_last_resize = 0;
  window.addEventListener('resize', function() {
    if (Date.now() - __xb_last_resize < 1000) return;
    __xb_last_resize = Date.now();
    pushAction('resize', {
      resize: { width: window.innerWidth, height: window.innerHeight },
    });
  }, true);

  // ── Clipboard (copy/paste/cut) ──
  document.addEventListener('copy', function(e) {
    pushAction('clipboard', { clipboard: { operation: 'copy' } });
  }, true);
  document.addEventListener('paste', function(e) {
    var preview = '';
    try {
      preview = (e.clipboardData || window.clipboardData).getData('text').substring(0, 100);
    } catch(ex) {}
    pushAction('clipboard', { clipboard: { operation: 'paste', textPreview: preview } });
  }, true);
  document.addEventListener('cut', function(e) {
    pushAction('clipboard', { clipboard: { operation: 'cut' } });
  }, true);

  // ── Touch events ──
  document.addEventListener('touchstart', function(e) {
    var touches = [];
    for (var i = 0; i < e.touches.length; i++) {
      touches.push({ x: e.touches[i].clientX, y: e.touches[i].clientY });
    }
    pushAction('touch', {
      element: describe(resolveMeaningful(e)),
      touch: { touchType: 'start', touches: touches },
    });
  }, true);
  document.addEventListener('touchend', function(e) {
    var touches = [];
    for (var i = 0; i < e.changedTouches.length; i++) {
      touches.push({ x: e.changedTouches[i].clientX, y: e.changedTouches[i].clientY });
    }
    pushAction('touch', {
      element: describe(resolveMeaningful(e)),
      touch: { touchType: 'end', touches: touches },
    });
  }, true);

  // ── Focus / Blur ──
  document.addEventListener('focusin', function(e) {
    var target = actualTarget(e);
    var tag = target.tagName && target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) {
      pushAction('focus', {
        element: describe(target),
        focus: { focusType: 'focus' },
      });
    }
  }, true);
  document.addEventListener('focusout', function(e) {
    var target = actualTarget(e);
    var tag = target.tagName && target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) {
      pushAction('focus', {
        element: describe(target),
        focus: { focusType: 'blur' },
      });
    }
  }, true);

  // ── Visibility change (tab switch) ──
  document.addEventListener('visibilitychange', function() {
    pushAction('visibility', {
      visibility: { state: document.hidden ? 'hidden' : 'visible' },
    });
  }, true);
})();
`;

/**
 * Checkpoint Visual Overlay — independent from ACTION_SIGNAL_SCRIPT.
 * Not guarded by __xb_action_signal so it can be injected on re-record.
 *
 * Interaction:
 *   1. Hold Option (Alt) → enter marking mode, cursor shows crosshair
 *   2. Mouse move → hovered element highlights with content preview
 *   3. Press 1 → "采集" (capture element content, recording continues)
 *   4. Press 2 → "卡点" (blocker: human intervention needed, recording pauses)
 *   5. Green flash = captured / Red flash = blocker marked
 *   6. Release Option → exit marking mode
 */
const CHECKPOINT_OVERLAY_SCRIPT = `
(function() {
  if (window.__xb_checkpoint_overlay) return;
  window.__xb_checkpoint_overlay = true;

  var __xb_overlay = null;       // main overlay container
  var __xb_highlight = null;     // highlight box around hovered element
  var __xb_preview = null;       // content preview panel
  var __xb_hint = null;          // top hint bar
  var __xb_active = false;       // is marking mode active
  var __xb_hovered_el = null;    // currently hovered element
  var __xb_flash_timer = null;

  // ── helper: get element content for preview ──
  function getElementContent(el) {
    var texts = [];
    // Collect child items (li, option, button, menu items)
    var children = el.querySelectorAll('li, option, button, [role="option"], [role="menuitem"], [class*="item"], [class*="option"], a[href]');
    if (children.length > 0) {
      for (var i = 0; i < Math.min(children.length, 20); i++) {
        var t = children[i].textContent.trim();
        if (t && t.length < 100) texts.push(t);
      }
    }
    if (texts.length > 0) return texts;
    // Fallback: element's own text (truncated)
    var own = el.textContent.trim();
    if (own.length > 0) return [own.substring(0, 300)];
    return [];
  }

  // ── helper: get short selector for element ──
  function shortSelector(el) {
    if (!el || !el.tagName) return '';
    if (el.id) return '#' + el.id;
    if (el.getAttribute('data-testid')) return '[data-testid="' + el.getAttribute('data-testid') + '"]';
    if (el.getAttribute('aria-label')) return '[aria-label="' + el.getAttribute('aria-label').substring(0, 30) + '"]';
    if (el.className && typeof el.className === 'string') {
      var cls = el.className.trim().split(/\\s+/)[0];
      if (cls) return el.tagName.toLowerCase() + '.' + cls;
    }
    return el.tagName.toLowerCase();
  }

  // ── helper: tag label ──
  function tagLabel(el) {
    var tag = el.tagName.toLowerCase();
    var type = el.getAttribute('type');
    var role = el.getAttribute('role');
    var placeholder = el.getAttribute('placeholder');
    var text = (el.textContent || '').trim().substring(0, 40);
    var parts = [tag];
    if (type) parts.push('type=' + type);
    if (role) parts.push('role=' + role);
    if (placeholder) parts.push('"' + placeholder.substring(0, 20) + '"');
    if (text && parts.length < 3) parts.push('"' + text + '"');
    return parts.join(' ');
  }

  // ── create overlay elements ──
  function createOverlay() {
    __xb_overlay = document.createElement('div');
    __xb_overlay.id = '__xb_mark_overlay';
    __xb_overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:999999;';

    // Highlight box
    __xb_highlight = document.createElement('div');
    __xb_highlight.style.cssText = 'position:fixed;border:3px solid #3b82f6;border-radius:4px;pointer-events:none;transition:all 0.1s ease;display:none;box-shadow:0 0 12px rgba(59,130,246,0.5);';
    __xb_overlay.appendChild(__xb_highlight);

    // Content preview panel (shows on hover)
    __xb_preview = document.createElement('div');
    __xb_preview.style.cssText = 'position:fixed;right:16px;top:50px;width:340px;max-height:60vh;overflow-y:auto;background:rgba(15,15,15,0.95);color:#e5e5e5;font:12px/1.5 system-ui,sans-serif;padding:12px;border-radius:8px;pointer-events:none;box-shadow:0 4px 20px rgba(0,0,0,0.5);display:none;';
    __xb_overlay.appendChild(__xb_preview);

    // Top hint bar
    __xb_hint = document.createElement('div');
    __xb_hint.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.88);color:white;font:13px/1.4 system-ui,sans-serif;padding:8px 16px;border-radius:8px;pointer-events:none;white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,0.3);';
    __xb_hint.textContent = '\\u00b7  \\u00b7  \\u00b7';
    __xb_overlay.appendChild(__xb_hint);

    document.body.appendChild(__xb_overlay);
    document.body.style.cursor = 'crosshair';
  }

  // ── destroy overlay ──
  function destroyOverlay() {
    if (__xb_overlay && __xb_overlay.parentNode) {
      __xb_overlay.parentNode.removeChild(__xb_overlay);
    }
    __xb_overlay = null;
    __xb_highlight = null;
    __xb_preview = null;
    __xb_hint = null;
    document.body.style.cursor = '';
    __xb_hovered_el = null;
  }

  // ── update highlight on mouse move ──
  function updateHighlight(e) {
    var el = document.elementFromPoint(e.clientX, e.clientY);
    // Skip overlay elements
    if (!el || (el.id && el.id.indexOf('__xb_') === 0) || (__xb_overlay && __xb_overlay.contains(el))) {
      __xb_highlight.style.display = 'none';
      __xb_preview.style.display = 'none';
      __xb_hovered_el = null;
      __xb_hint.textContent = '\\u5c06 \\u9f20\\u6807 \\u79fb\\u5230\\u60f3\\u6807\\u8bb0\\u7684\\u5143\\u7d20\\u4e0a';
      return;
    }
    __xb_hovered_el = el;
    var rect = el.getBoundingClientRect();

    // Update highlight box
    __xb_highlight.style.display = 'block';
    __xb_highlight.style.left = (rect.left - 3) + 'px';
    __xb_highlight.style.top = (rect.top - 3) + 'px';
    __xb_highlight.style.width = (rect.width + 6) + 'px';
    __xb_highlight.style.height = (rect.height + 6) + 'px';

    // Build content preview
    var content = getElementContent(el);
    var sel = shortSelector(el);
    var tag = tagLabel(el);
    var html = '<div style="color:#888;margin-bottom:6px;font-size:11px;">' + sel + '</div>';
    html += '<div style="color:#fff;font-weight:bold;margin-bottom:8px;">' + tag + '</div>';
    if (content.length > 0) {
      html += '<div style="border-top:1px solid #333;padding-top:8px;">';
      for (var i = 0; i < Math.min(content.length, 15); i++) {
        html += '<div style="padding:2px 0;color:#ccc;">\\u2022 ' + content[i].replace(/</g, '&lt;') + '</div>';
      }
      if (content.length > 15) html += '<div style="color:#666;">... +' + (content.length - 15) + ' more</div>';
      html += '</div>';
    }

    __xb_preview.innerHTML = html;
    __xb_preview.style.display = 'block';

    // Update hint
    __xb_hint.textContent = '\\u2461 \\u91c7\\u96c6\\u6b64\\u5143\\u7d20  \\u2462 \\u5361\\u70b9\\uff08\\u4eba\\u5de5\\u4ecb\\u5165\\uff09  \\u2502 \\u677e\\u5f00 Option \\u9000\\u51fa';
  }

  // ── flash feedback ──
  function flash(color) {
    if (!__xb_highlight) return;
    __xb_highlight.style.borderColor = color;
    __xb_highlight.style.boxShadow = '0 0 24px ' + color + '80';
    clearTimeout(__xb_flash_timer);
    __xb_flash_timer = setTimeout(function() {
      if (__xb_highlight) {
        __xb_highlight.style.borderColor = '#3b82f6';
        __xb_highlight.style.boxShadow = '0 0 12px rgba(59,130,246,0.5)';
      }
    }, 600);
  }

  // ── push checkpoint to pending actions ──
  function pushCheckpoint(mode) {
    if (!__xb_hovered_el) return;
    var el = __xb_hovered_el;
    var content = getElementContent(el);
    var sel = shortSelector(el);
    var rect = el.getBoundingClientRect();

    window.__xb_pending_actions = window.__xb_pending_actions || [];
    window.__xb_pending_actions.push({
      type: 'checkpoint',
      ts: Date.now(),
      url: location.href,
      title: document.title,
      checkpointType: mode === 'collect' ? 'collect' : 'blocker',
      hint: mode === 'collect' ? '\\u91c7\\u96c6: ' + tagLabel(el) : '\\u5361\\u70b9: \\u9700\\u8981\\u4eba\\u5de5\\u4ecb\\u5165',
      selector: sel,
      source: 'manual',
      category: mode,
      content: content.join(' | '),
      elementTag: el.tagName.toLowerCase(),
      elementText: (el.textContent || '').trim().substring(0, 200),
      rect: { x: Math.round(rect.left), y: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) },
    });
  }

  // ── event listeners ──
  document.addEventListener('keydown', function(e) {
    // Option/Alt pressed → enter marking mode
    if (e.key === 'Alt' && !e.repeat && !__xb_active) {
      __xb_active = true;
      createOverlay();
      e.preventDefault();
      return;
    }

    // Only process keys while marking mode is active
    if (!__xb_active) return;

    // Press 1 → collect (capture element)
    if (e.code === 'Digit1' || e.key === '1') {
      pushCheckpoint('collect');
      flash('#22c55e'); // green
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // Press 2 → blocker (human intervention needed)
    if (e.code === 'Digit2' || e.key === '2') {
      pushCheckpoint('blocker');
      flash('#ef4444'); // red
      e.preventDefault();
      e.stopPropagation();
      return;
    }
  }, true);

  document.addEventListener('keyup', function(e) {
    if (e.key === 'Alt') {
      __xb_active = false;
      destroyOverlay();
    }
  }, true);

  // Track mouse move (only when active)
  document.addEventListener('mousemove', function(e) {
    if (!__xb_active) return;
    updateHighlight(e);
  }, true);

  // Prevent click while in marking mode
  document.addEventListener('click', function(e) {
    if (__xb_active) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
})();
`;

// ─── SessionRecorder ─────────────────────────────────────────────

export class SessionRecorder {
  private context: BrowserContext;
  private page: Page;
  private sessionName: string;
  private startUrl = '';
  private startedAt = 0;

  private actions: UserAction[] = [];
  private network: NetworkEntry[] = [];
  private contextChanges: ContextChange[] = [];
  private checkpoints: CheckpointEntry[] = [];

  private actionCounter = 0;
  private networkCounter = 0;
  private contextCounter = 0;
  private checkpointCounter = 0;

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private lastActionTs = 0;
  private activePages = new Set<Page>();
  private lastKnownUrl = '';  // Track URL to detect real navigation changes

  /** Dedup window: after a CDP command action, ignore matching action signals within this window */
  private cdpActionDedup: { type: string; value?: string; selector?: string; until: number } | null = null;

  /** Network dedup: last request key for short-window dedup */
  private _lastRequestKey = '';
  private _lastRequestTs = 0;

  private _isRecording = false;

  constructor(context: BrowserContext, page: Page, sessionName: string) {
    this.context = context;
    this.page = page;
    this.sessionName = sessionName;
  }

  get isRecording(): boolean {
    return this._isRecording;
  }

  get actionCount(): number {
    return this.actions.length;
  }

  /** Record an action triggered by a CDP command (e.g. xbrowser fill/click/goto) */
  recordCommandAction(action: { type: string; selector?: string; value?: string; url?: string; element?: UserAction['element'] }): void {
    // Reverse dedup: if a matching action signal was recently recorded, skip this CDP command
    const normalizedType = action.type === 'cdp-fill' ? 'input' : action.type === 'cdp-click' ? 'click' : action.type;
    const recent = this.actions[this.actions.length - 1];
    if (recent && Date.now() - recent.timestamp < 1500) {
      // Match against either the raw type (cdp-fill/cdp-click) or normalized type (input/click)
      const typeMatch = recent.type === action.type || recent.type === normalizedType;
      const valueMatch = !action.value || recent.value === action.value;
      const selectorMatch = !action.selector || (recent.element?.selector &&
        (recent.element.selector === action.selector ||
         recent.element.selector.endsWith(' ' + action.selector) ||
         action.selector.endsWith(' ' + recent.element.selector)));
      if (typeMatch && valueMatch && selectorMatch) {
        // Skip duplicate CDP command — action signal already captured it
        return;
      }
    }

    this.actionCounter++;
    const ts = Date.now();
    // Use lastKnownUrl if action url is about:blank or empty (page may have navigated)
    const actionUrl = action.url && action.url !== 'about:blank'
      ? action.url
      : (this.lastKnownUrl || this.page.url());
    this.actions.push({
      id: this.actionCounter,
      type: action.type as UserAction['type'],
      timestamp: ts,
      url: actionUrl,
      pageTitle: '',
      element: action.element || (action.selector ? { tag: '', selector: action.selector, text: '' } : undefined),
      value: action.value,
    });
    // Update lastActionTs so flush will skip stale action signals
    this.lastActionTs = ts;
    // Set dedup window: ignore matching action signals for 1.5s
    this.cdpActionDedup = {
      type: normalizedType,
      value: action.value,
      selector: action.selector,
      until: Date.now() + 1500,
    };

    // Update URL tracking for goto/navigation commands
    if (action.url && action.url !== 'about:blank') {
      this.lastKnownUrl = action.url;
    } else if (action.type === 'goto' && action.value && action.value !== 'about:blank') {
      this.lastKnownUrl = action.value;
    }
  }

  get networkCount(): number {
    return this.network.length;
  }

  getLiveData(): RecordingData {
    return this.buildData();
  }

  addManualCheckpoint(type: string, hint: string, selector?: string): CheckpointEntry {
    this.checkpointCounter++;
    const cp: CheckpointEntry = {
      id: this.checkpointCounter,
      type: type as CheckpointType,
      timestamp: Date.now(),
      url: this.page.url(),
      pageTitle: '',
      hint,
      selector,
      source: 'manual',
    };
    this.checkpoints.push(cp);
    return cp;
  }

  /** Directory for this session's recordings. */
  get recordingsDir(): string {
    return SessionRecorder.getRecordingsDir(this.sessionName);
  }

  static getRecordingsDir(sessionName: string): string {
    return join(homedir(), '.xbrowser', 'sessions', sessionName, 'recordings');
  }

  /** Path to the control file (used by record stop to signal this process). */
  get controlFilePath(): string {
    return join(this.recordingsDir, '.control.json');
  }

  /** Path to the stop signal file (written by `record stop`). */
  get stopSignalPath(): string {
    return join(this.recordingsDir, '.stop');
  }

  // ─── Start ──────────────────────────────────────────────────────

  async start(url?: string): Promise<void> {
    if (this._isRecording) throw new Error('Already recording');

    this._isRecording = true;
    this.startedAt = Date.now();
    this.actions = [];
    this.network = [];
    this.contextChanges = [];
    this.checkpoints = [];
    this.checkpointCounter = 0;
    this.lastKnownUrl = this.page.url();  // Initialize URL tracking

    // Register init scripts BEFORE goto so they execute on the freshly loaded page.
    // order matters: selector-utils first, then action signal script (which uses it).
    await this.page.addInitScript(getSelectorGeneratorScript());
    await this.page.addInitScript(ACTION_SIGNAL_SCRIPT);
    await this.page.addInitScript(CHECKPOINT_OVERLAY_SCRIPT);

    // Register event listeners BEFORE goto to capture the initial navigation.
    this.context.on('request', this.handleRequest);
    this.context.on('response', this.handleResponse);
    this.context.on('page', this.handleNewPage);
    for (const p of this.context.pages()) {
      p.on('request', this.handleRequest);
      p.on('response', this.handleResponse);
    }
    this.page.on('framenavigated', this.handleFrameNavigated);
    this.page.on('dialog', this.handleDialog);
    this.page.on('filechooser', this.handleFileChooser);

    // Navigate if URL provided
    if (url) {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      this.startUrl = url;
    } else {
      this.startUrl = this.page.url();
    }

    // Ensure recordings directory exists
    mkdirSync(this.recordingsDir, { recursive: true });

    // Write control file (so record stop can find this process)
    const control: RecordingControlFile = {
      pid: process.pid,
      startedAt: new Date(this.startedAt).toISOString(),
      startUrl: this.startUrl,
      sessionName: this.sessionName,
    };
    writeFileSync(this.controlFilePath, JSON.stringify(control, null, 2), 'utf-8');

    // 1. Inject action signal script (minimal frontend footprint) — also handles already-loaded page
    await this.injectActionScript(this.page);

    // 3. Track new tabs/popups
    this.context.on('page', this.handleNewPage);

    // 4. Poll for frontend action signals
    this.pollTimer = setInterval(() => void this.pollActions(), 200);

    // 5. Periodic flush to disk (so data survives if process crashes)
    this.flushTimer = setInterval(() => this.flushToDisk(), 5000);
  }

  // ─── Stop ───────────────────────────────────────────────────────

  async stop(): Promise<{ data: RecordingData; summary: RecordingSummary }> {
    if (!this._isRecording) throw new Error('Not recording');

    this._isRecording = false;

    // Stop timers
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null; }

    // Remove listeners
    this.context.off('request', this.handleRequest);
    this.context.off('response', this.handleResponse);
    this.context.off('page', this.handleNewPage);
    this.page.off('framenavigated', this.handleFrameNavigated);
    this.page.off('dialog', this.handleDialog);
    for (const p of this.activePages) {
      try { p.off('framenavigated', this.handleFrameNavigated); } catch { /* page may be closed */ }
    }

    // Final flush of pending frontend actions
    await this.flushPendingActions(this.page);
    for (const p of this.activePages) {
      await this.flushPendingActions(p).catch(() => {});
    }

    // Build final data + summary
    const data = this.buildData();
    const summary = this.buildSummary(data);

    // Write final files
    this.writeFinalOutput(data, summary);

    // Generate/update site knowledge base (LLM-readable documentation)
    try {
      const knowledge = updateSiteKnowledge(data);
      const knowledgeDir = join(this.recordingsDir, 'site-knowledge.md');
      const knowledgeJson = join(this.recordingsDir, 'site-knowledge.json');
      const { readFileSync: rf } = require('fs');
      const { getKnowledgePath } = require('./site-knowledge.js');
      const mdPath = getKnowledgePath(knowledge.domain, 'md');
      try {
        const md = rf(mdPath, 'utf-8');
        writeFileSync(knowledgeDir, md, 'utf-8');
      } catch { /* ok */ }
      writeFileSync(knowledgeJson, JSON.stringify(knowledge, null, 2), 'utf-8');
    } catch {
      // non-critical: recording still succeeds
    }

    // Clean up control & signal files
    try { rmSync(this.controlFilePath); } catch { /* ok */ }
    try { rmSync(this.stopSignalPath); } catch { /* ok */ }

    return { data, summary };
  }

  // ─── Cleanup (called on session close) ──────────────────────────

  static cleanup(sessionName: string): void {
    const dir = SessionRecorder.getRecordingsDir(sessionName);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // ─── Wait for stop signal (blocks the process) ──────────────────

  waitForStopSignal(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (existsSync(this.stopSignalPath)) {
          resolve();
        } else {
          setTimeout(check, 300);
        }
      };
      check();
    });
  }

  // ─── Static: send stop signal to a running recorder ─────────────

  static async sendStopSignal(sessionName: string): Promise<RecordingControlFile | null> {
    const dir = SessionRecorder.getRecordingsDir(sessionName);
    const controlPath = join(dir, '.control.json');
    const stopPath = join(dir, '.stop');

    if (!existsSync(controlPath)) return null;

    const control: RecordingControlFile = JSON.parse(readFileSync(controlPath, 'utf-8'));

    // Check if the recorder process is still alive
    let alive = false;
    try { process.kill(control.pid, 0); alive = true; } catch { alive = false; }

    if (!alive) {
      // Recorder process is dead — clean up control file and return
      try { rmSync(controlPath); } catch { /* ok */ }
      return control;
    }

    // Write stop signal
    mkdirSync(dir, { recursive: true });
    writeFileSync(stopPath, JSON.stringify({ stoppedAt: new Date().toISOString() }), 'utf-8');

    // Wait for the recorder to finish (max 10s)
    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 200));
      if (!existsSync(controlPath)) return control; // recorder cleaned up
      // Also check if process died during wait
      try { process.kill(control.pid, 0); } catch {
        try { rmSync(controlPath); } catch { /* ok */ }
        return control;
      }
    }

    // Timeout — force cleanup
    try { rmSync(controlPath); } catch { /* ok */ }
    return control;
  }

  // ─── Static: read recording from disk ───────────────────────────

  static readSummary(sessionName: string): RecordingSummary | null {
    const path = join(SessionRecorder.getRecordingsDir(sessionName), 'summary.json');
    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      return null;
    }
  }

  static readData(sessionName: string): RecordingData | null {
    const path = join(SessionRecorder.getRecordingsDir(sessionName), 'recording.json');
    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      return null;
    }
  }

  // ==================== Private ====================

  private async injectActionScript(page: Page): Promise<void> {
    try {
      // Inject the 13-strategy unique selector generator FIRST so action script can use it
      await page.evaluate(getSelectorGeneratorScript());
      await page.evaluate(ACTION_SIGNAL_SCRIPT);
      // Store script source so pollActions can inject into dynamic iframes
      await page.evaluate(`window.__xb_action_script_src = ${JSON.stringify(ACTION_SIGNAL_SCRIPT)};`);
    } catch {
      // page may not be ready — action script already injected is OK
    }
    try {
      await page.evaluate(CHECKPOINT_OVERLAY_SCRIPT);
    } catch {
      // page may not be ready
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
  }

  // ─── Network capture ────────────────────────────────────────────

  private handleRequest = (request: Request): void => {
    const resourceType = request.resourceType();
    if (['image', 'stylesheet', 'font', 'manifest', 'other'].includes(resourceType)) return;

    const url = request.url();
    if (url.startsWith('data:') || url.startsWith('chrome-extension://') || url.startsWith('blob:')) return;

    // Dedup: skip if same URL+method was seen in last 100ms (forwarded event duplication)
    const dedupKey = request.method() + ' ' + url;
    const now = Date.now();
    if (this._lastRequestKey === dedupKey && now - this._lastRequestTs < 100) return;
    this._lastRequestKey = dedupKey;
    this._lastRequestTs = now;

    this.networkCounter++;
    const entry: NetworkEntry = {
      id: this.networkCounter,
      timestamp: Date.now(),
      method: request.method(),
      url,
      path: new URL(url).pathname,
      status: 0,
      resourceType,
      contentType: '',
      responseSize: 0,
    };

    // Capture request body for mutation methods
    if (['POST', 'PATCH', 'PUT'].includes(request.method())) {
      try {
        const postData = request.postData();
        if (postData) {
          try {
            entry.requestBody = JSON.parse(postData);
          } catch {
            entry.requestBody = postData.substring(0, 500);
          }
        }
      } catch { /* ignore */ }
    }

    this.network.push(entry);
  };

  private handleResponse = async (response: Response): Promise<void> => {
    const url = response.url();
    if (url.startsWith('data:') || url.startsWith('chrome-extension://') || url.startsWith('blob:')) return;

    // Find matching request entry (status still 0)
    const entry = [...this.network].reverse().find(e => e.url === url && e.status === 0);
    if (!entry) return;

    entry.status = response.status();
    entry.contentType = response.headers()['content-type'] || '';

    // Only capture response body for API-like requests
    const resourceType = response.request().resourceType();
    const isApi = ['fetch', 'xhr'].includes(resourceType) ||
      entry.contentType.includes('json') ||
      entry.contentType.includes('text/');

    if (isApi) {
      try {
        const text = await response.text();
        entry.responseSize = text.length;
        if (text.length <= 20480) {
          try {
            entry.responseBody = JSON.parse(text);
          } catch {
            entry.responseBody = text.substring(0, 500);
          }
        }
      } catch { /* unable to read */ }
    } else {
      try {
        entry.responseSize = parseInt(response.headers()['content-length'] || '0', 10);
      } catch { /* ignore */ }
    }
  };

  // ─── Page tracking ──────────────────────────────────────────────

  private handleNewPage = async (page: Page): Promise<void> => {
    this.activePages.add(page);
    this.contextCounter++;
    this.contextChanges.push({
      id: this.contextCounter,
      timestamp: Date.now(),
      type: 'new_tab',
      url: page.url(),
      detail: 'New tab/popup opened',
    });

    // Inject signal script into new page (addInitScript for future navigations)
    await page.addInitScript(ACTION_SIGNAL_SCRIPT);
    await page.addInitScript(CHECKPOINT_OVERLAY_SCRIPT);
    await page.addInitScript(getSelectorGeneratorScript());

    // Also inject selector generator via addInitScript so it's available on every navigation
    // Inject immediately on current page state, and re-inject after any navigation
    const injectAndRetry = async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const url = page.url();
          if (url && url !== 'about:blank' && !url.startsWith('chrome')) {
            await this.injectActionScript(page);
            return;
          }
        } catch { /* page not ready */ }
        await new Promise(r => setTimeout(r, 1000));
      }
    };
    // Fire-and-forget: inject when page is ready
    injectAndRetry();

    page.on('framenavigated', this.handleFrameNavigated);
    page.on('request', this.handleRequest);
    page.on('response', this.handleResponse);
    page.on('filechooser', this.handleFileChooser);
    page.on('dialog', this.handleDialog);
    page.on('close', () => { this.activePages.delete(page); });

    // Wait for page to have a real URL before considering it ready
    // (handles the case where new tab opens with about:blank then navigates)
    page.on('framenavigated', async (frame: Frame) => {
      // Check if this is the main frame navigation by URL comparison
    // (mainFrame() creates a new object each call, so identity check won't work)
    if (frame.isDetached()) return;
      const url = frame.url();
      if (url && url !== 'about:blank' && !url.startsWith('chrome')) {
        try { await this.injectActionScript(page); } catch { /* ignore */ }
      }
    });
  };

  private handleFrameNavigated = (frame: Frame): void => {
    // Check if this is the main frame navigation by URL comparison
    // (mainFrame() creates a new object each call, so identity check won't work)
    if (frame.isDetached()) return;
    const newUrl = frame.url();
    this.contextCounter++;
    this.contextChanges.push({
      id: this.contextCounter,
      timestamp: Date.now(),
      type: 'navigate',
      url: newUrl,
    });

    // Also record a navigation action so replay knows the URL changed
    // Skip if the last action already captured this URL (e.g. cdp-click on a link)
    const lastAction = this.actions[this.actions.length - 1];
    const lastActionUrl = lastAction?.url;
    if (newUrl && newUrl !== 'about:blank' && newUrl !== lastActionUrl) {
      this.actionCounter++;
      this.actions.push({
        id: this.actionCounter,
        type: 'navigation',
        timestamp: Date.now(),
        url: newUrl,
        pageTitle: '',
        element: undefined,
      });
    }

    // Re-inject action signal script after navigation (page.evaluate scripts are lost on navigation)
    const page = frame.page();
    if (newUrl && newUrl !== 'about:blank') {
      // Fire-and-forget: don't block the event handler
      this.injectActionScript(page).catch(() => {});
    }
  };

  private handleDialog = async (dialog: Dialog): Promise<void> => {
    this.checkpointCounter++;
    this.checkpoints.push({
      id: this.checkpointCounter,
      type: 'dialog',
      timestamp: Date.now(),
      url: this.page.url(),
      pageTitle: await this.page.title().catch(() => ''),
      hint: `Dialog [${dialog.type}]: "${dialog.message()}"`,
      source: 'auto',
      context: { dialogType: dialog.type, message: dialog.message() },
    });
    await dialog.dismiss().catch(() => {});
  };

  private handleFileChooser = async (fileChooser: { selector: string; isMultiple: boolean }): Promise<void> => {
    const url = this.page.url();

    // Generate element metadata
    const sel = fileChooser.selector || 'input[type="file"]';
    let element: UserAction['element'] | undefined;
    try {
      element = (await this.page.evaluate(new Function('selector', `
        const el = document.querySelector(selector);
        if (!el) return null;
        return window.__xb_describe(el);
      `), sel)) as UserAction['element'] | null ?? undefined;
    } catch { /* ignore */ }

    // Read file data from the input element (async FileReader)
    let fileData: Array<{ name: string; type: string; size: number; dataUrl: string | null }> = [];
    try {
      fileData = (await this.page.evaluate(new Function('selector', `
        return new Promise(resolve => {
          const input = document.querySelector(selector);
          if (!input || !input.files || input.files.length === 0) { resolve([]); return; }
          const readers = [];
          for (let i = 0; i < input.files.length; i++) {
            readers.push(new Promise(r => {
              const reader = new FileReader();
              reader.onload = () => r({ name: input.files[i].name, type: input.files[i].type, size: input.files[i].size, dataUrl: reader.result });
              reader.onerror = () => r({ name: input.files[i].name, type: input.files[i].type, size: input.files[i].size, dataUrl: null });
              reader.readAsDataURL(input.files[i]);
            }));
          }
          Promise.all(readers).then(resolve);
        });
      `), sel)) as typeof fileData;
    } catch { /* ignore */ }

    const names = fileData.map(f => f.name);

    this.actionCounter++;
    this.actions.push({
      id: this.actionCounter,
      type: 'filechooser',
      timestamp: Date.now(),
      url,
      pageTitle: '',
      element: element || {
        selector: sel,
        strategy: 'css',
        confidence: 'high',
        tag: 'input',
        text: '',
      },
      value: names.join(', ') || undefined,
      files: {
        names,
        count: fileData.length,
        isMultiple: fileChooser.isMultiple,
        fileData: fileData.length > 0 ? fileData : undefined,
      },
    });
  };

  // ─── Action polling ─────────────────────────────────────────────

  private async pollActions(): Promise<void> {
    const pages = [this.page, ...this.activePages];
    for (const page of pages) {
      try {
        if (page.isClosed()) continue;
        await this.flushPendingActions(page);
      } catch {
        // page may have navigated or closed
      }
    }
  }

  private async flushPendingActions(page: Page): Promise<void> {
    interface PendingAction {
      type: string;
      ts: number;
      url: string;
      title: string;
      element?: UserAction['element'];
      value?: string;
      key?: string;
      x?: number;
      y?: number;
      scrollX?: number;
      scrollY?: number;
      files?: UserAction['files'];
    }

    let pending: PendingAction[] = [];
    try {
      pending = await page.evaluate(`(function() {
        var w = window;
        var actions = w.__xb_pending_actions || [];
        w.__xb_pending_actions = [];

        // Recursively flush pending actions from same-origin iframes (including nested)
        function flushIframes(doc) {
          try {
            var iframes = doc.querySelectorAll('iframe');
            for (var i = 0; i < iframes.length; i++) {
              try {
                var iframeWin = iframes[i].contentWindow;
                if (!iframeWin) continue;
                // Ensure action script is injected into iframe
                if (!iframeWin.__xb_action_script_injected) {
                  iframeWin.__xb_action_script_injected = true;
                  try { delete iframeWin.__xb_action_signal; } catch(e) {}
                  try { iframeWin.eval(w.__xb_action_script_src); } catch(e) {}
                }
                var iframeActions = iframeWin.__xb_pending_actions;
                if (Array.isArray(iframeActions) && iframeActions.length > 0) {
                  // Get iframe position to offset coordinates
                  var rect = iframes[i].getBoundingClientRect();
                  for (var j = 0; j < iframeActions.length; j++) {
                    var act = iframeActions[j];
                    // Offset coordinates from iframe-relative to page-relative
                    if (act.x != null) act.x = act.x + rect.left;
                    if (act.y != null) act.y = act.y + rect.top;
                    // Tag the action as originating from an iframe
                    act.iframeSrc = iframes[i].src || '';
                    actions.push(act);
                  }
                  iframeWin.__xb_pending_actions = [];
                }
                // Recurse into nested iframes
                try { flushIframes(iframeWin.document); } catch(e) {}
              } catch(e) {}
            }
          } catch(e) {}
        }

        flushIframes(document);
        return actions;
      })()`) as PendingAction[];
    } catch {
      return;
    }

    // Detect URL changes (fallback for CDP mode where framenavigated may not fire)
    try {
      const currentUrl = page.url();
      // Normalize: strip trailing slash for comparison
      const normalize = (u: string) => u.replace(/\/+$/, '');
      if (currentUrl && currentUrl !== 'about:blank' && normalize(currentUrl) !== normalize(this.lastKnownUrl)) {
        // Check if we already have a recent navigation/goto to this URL
        const hasNav = this.actions.slice(-3).some(a =>
          (a.type === 'navigation' || a.type === 'goto') && normalize(a.url || '') === normalize(currentUrl)
        );
        if (!hasNav) {
          this.actionCounter++;
          this.actions.push({
            id: this.actionCounter,
            type: 'navigation',
            timestamp: Date.now(),
            url: currentUrl,
            pageTitle: '',
            element: undefined,
          });
        }
        this.lastKnownUrl = currentUrl;
      }
    } catch { /* page may have closed */ }

    for (const raw of pending) {
      if (raw.ts <= this.lastActionTs) continue;

      // Dedup: skip action signals that match a recent CDP command action
      if (this.cdpActionDedup && Date.now() < this.cdpActionDedup.until) {
        const dedup = this.cdpActionDedup;
        const typeMatch = raw.type === dedup.type;
        const valueMatch = !dedup.value || raw.value === dedup.value;
        const selectorMatch = !dedup.selector || (raw.element?.selector &&
          (raw.element.selector === dedup.selector ||
           raw.element.selector.endsWith(' ' + dedup.selector) ||
           dedup.selector.endsWith(' ' + raw.element.selector)));
        if (typeMatch && valueMatch && selectorMatch) {
          continue; // Skip duplicate action signal
        }
      }

      this.actionCounter++;

      // For click actions, capture popover/dropdown context after a delay
      let clickContext: ClickContext | undefined;
      if (raw.type === 'click' && raw.x !== undefined && raw.y !== undefined) {
        clickContext = await this.captureClickContext(page, raw.x, raw.y);
      }

      this.actions.push({
        id: this.actionCounter,
        type: raw.type as UserAction['type'],
        timestamp: raw.ts,
        url: raw.url || page.url(),
        pageTitle: raw.title || '',
        element: raw.element,
        value: raw.value,
        key: raw.key,
        x: raw.x,
        y: raw.y,
        scrollX: raw.scrollX,
        scrollY: raw.scrollY,
        clickContext,
        files: raw.files,
      });
      this.lastActionTs = raw.ts;

      if (raw.type === 'click' || raw.type === 'navigate' || raw.type === 'submit') {
        const detected = await this.detectCheckpoints(page);
        for (const cp of detected) {
          cp.relatedActionId = this.actionCounter;
          this.checkpoints.push(cp);
        }
      }
    }
  }

  /**
   * After a click, wait 300ms then scan for popover/dropdown/menu elements
   * near the click position. This runs server-side to avoid race conditions
   * with the client-side poll interval.
   */
  private async captureClickContext(page: Page, cx: number, cy: number): Promise<ClickContext | undefined> {
    // Wait for animations/transitions to settle
    await new Promise(r => setTimeout(r, 300));

    try {
      const ctx = await page.evaluate<ClickContext>(`
        (function() {
          var cx = ${cx}, cy = ${cy};
          var POPOVER_SELECTORS = [
            '[role="menu"]','[role="listbox"]','[role="dialog"]','[role="tooltip"]','[role="popover"]',
            '[role="combobox"]','[role="tree"]','[role="grid"]',
            '.popover','.popup','.dropdown','.menu','.modal','.tooltip','.panel',
            '[class*="popover"]','[class*="popup"]','[class*="dropdown"]','[class*="menu"]',
            '[class*="tooltip"]','[class*="modal"]','[class*="panel"]','[class*="overlay"]','[class*="sheet"]',
            '[data-popup]','[data-dropdown]','[data-menu]','[data-popover"]',
            '.semi-dropdown','.semi-popover','.semi-modal',
            '.ant-dropdown','.ant-popover','.ant-modal',
            '.el-dropdown','.el-popover','.el-dialog',
            '.t-dropdown','.t-popup','.t-dialog'
          ];

          function isNear(el, x, y, range) {
            try {
              var r = el.getBoundingClientRect();
              if (!r || r.width === 0 || r.height === 0) return false;
              return !(r.left > x + range || r.right < x - range || r.top > y + range || r.bottom < y - range);
            } catch(e) { return false; }
          }

          var result = { appeared: [], disappeared: [], stateChanges: [] };
          var seenElements = new Set();

          for (var si = 0; si < POPOVER_SELECTORS.length; si++) {
            try {
              var els = document.querySelectorAll(POPOVER_SELECTORS[si]);
              for (var j = 0; j < els.length; j++) {
                var el = els[j];
                if (seenElements.has(el)) continue;
                if (!isNear(el, cx, cy, 300)) continue;
                var rect = el.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) continue;
                seenElements.add(el);

                var items = [];
                var children = el.querySelectorAll('a,button,[role="menuitem"],[role="option"],[role="treeitem"],li,div[class*="item"]');
                var seenItemTexts = new Set();
                for (var k = 0; k < Math.min(children.length, 30); k++) {
                  var child = children[k];
                  var childText = (child.textContent || '').trim().substring(0, 60);
                  if (!childText || seenItemTexts.has(childText)) continue;
                  seenItemTexts.add(childText);
                  var ci = { text: childText };
                  try { if (child.disabled || child.getAttribute('aria-disabled') === 'true') ci.disabled = true; } catch(e) {}
                  try { if (child.tagName) ci.tag = child.tagName.toLowerCase(); } catch(e) {}
                  try { if (child.href) ci.href = child.href.substring(0, 80); } catch(e) {}
                  items.push(ci);
                }

                result.appeared.push({
                  tag: el.tagName.toLowerCase(),
                  selector: el.id ? '#' + el.id : undefined,
                  role: el.getAttribute('role'),
                  text: (el.textContent || '').trim().substring(0, 100),
                  rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
                  items: items
                });
              }
            } catch(e) { /* skip invalid selectors */ }
          }

          var allInteractive = document.querySelectorAll('[aria-expanded],[disabled],[aria-disabled],[aria-selected],[data-state]');
          for (var i = 0; i < allInteractive.length; i++) {
            var el2 = allInteractive[i];
            if (!isNear(el2, cx, cy, 200)) continue;
            var info = { tag: el2.tagName.toLowerCase(), text: (el2.textContent || '').trim().substring(0, 60) };
            try { if (el2.id) info.id = el2.id; } catch(e) {}
            try { if (el2.getAttribute('aria-expanded')) info.ariaExpanded = el2.getAttribute('aria-expanded'); } catch(e) {}
            try { if (el2.disabled || el2.getAttribute('aria-disabled') === 'true') info.disabled = true; } catch(e) {}
            try { if (el2.getAttribute('aria-selected')) info.ariaSelected = el2.getAttribute('aria-selected'); } catch(e) {}
            try { if (el2.getAttribute('data-state')) info.dataState = el2.getAttribute('data-state'); } catch(e) {}
            result.stateChanges.push(info);
          }

          return result;
        })()
      `) as ClickContext;

      if (ctx.appeared.length > 0 || ctx.stateChanges.length > 0) {
        return ctx;
      }
    } catch {
      // page may have navigated
    }
    return undefined;
  }

  private async detectCheckpoints(page: Page): Promise<CheckpointEntry[]> {
    const CHECKPOINT_RULES: Array<{ type: CheckpointType; selectors: string[] }> = [
      { type: 'captcha', selectors: ['img[src*="captcha"]', 'img[src*="verify"]', '[class*="captcha"]', '[id*="captcha"]', '#captcha', '.captcha'] },
      { type: 'slider', selectors: ['[class*="slider"]', '[class*="drag-verify"]', '[class*="slide-verify"]'] },
      { type: 'login', selectors: ['input[type="password"]'] },
      { type: 'iframe', selectors: ['iframe[src*="captcha"]', 'iframe[src*="verify"]', 'iframe[src*="recaptcha"]', 'iframe[title*="captcha"]'] },
    ];

    try {
      const found = await page.evaluate<Array<{ type: string; selector: string; text: string }>>((rules: Array<{ type: string; selectors: string[] }>) => {
        const results: Array<{ type: string; selector: string; text: string }> = [];
        for (const rule of rules) {
          for (const sel of rule.selectors) {
            try {
              const el = document.querySelector(sel);
              if (el) {
                const rect = el.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                  results.push({
                    type: rule.type,
                    selector: sel,
                    text: (el.textContent || '').substring(0, 60),
                  });
                }
              }
            } catch { /* skip invalid selector */ }
          }
        }
        return results;
      }, CHECKPOINT_RULES);

      const entries: CheckpointEntry[] = [];
      for (const item of found) {
        this.checkpointCounter++;
        const hints: Record<string, string> = {
          captcha: 'Captcha verification detected',
          slider: 'Slider verification detected',
          login: 'Login form detected (password field)',
          iframe: 'Verification iframe detected',
        };
        entries.push({
          id: this.checkpointCounter,
          type: item.type as CheckpointType,
          timestamp: Date.now(),
          url: page.url(),
          pageTitle: await page.title().catch(() => ''),
          hint: hints[item.type] || item.type,
          selector: item.selector,
          source: 'auto',
          context: { matchedSelector: item.selector, elementText: item.text },
        });
      }
      return entries;
    } catch {
      return [];
    }
  }

  // ─── Periodic disk flush ────────────────────────────────────────

  private flushToDisk(): void {
    const data = this.buildData();
    try {
      writeFileSync(
        join(this.recordingsDir, 'recording.json'),
        JSON.stringify(data, null, 2),
        'utf-8',
      );
    } catch { /* best effort */ }
  }

  private writeFinalOutput(data: RecordingData, summary: RecordingSummary): void {
    mkdirSync(this.recordingsDir, { recursive: true });
    writeFileSync(join(this.recordingsDir, 'recording.json'), JSON.stringify(data, null, 2), 'utf-8');
    writeFileSync(join(this.recordingsDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
    writeFileSync(join(this.recordingsDir, 'summary.md'), this.buildMarkdownSummary(data, summary), 'utf-8');
  }

  private buildData(): RecordingData {
    return {
      startUrl: this.startUrl,
      sessionName: this.sessionName,
      startedAt: new Date(this.startedAt).toISOString(),
      actions: [...this.actions],
      network: [...this.network],
      contextChanges: [...this.contextChanges],
      checkpoints: [...this.checkpoints],
    };
  }

  // ─── Summary builder with ref compression + input→network matching ──

  private buildSummary(data: RecordingData): RecordingSummary {
    const POST_WINDOW = 5000;
    const MERGE_WINDOW = 2000;
    const steps: RecordingStep[] = [];

    const selectorToRef = new Map<string, string>();
    const elements: Record<string, ElementRef> = {};
    let refCounter = 0;

    function getRef(action: UserAction): string {
      const sel = action.element?.selector || action.element?.tag || '_none';
      if (selectorToRef.has(sel)) return selectorToRef.get(sel)!;

      refCounter++;
      const ref = 'e' + refCounter;
      selectorToRef.set(sel, ref);

      if (action.element) {
        elements[ref] = {
          selector: action.element.selector || action.element.tag,
          tag: action.element.tag,
          text: action.element.text,
          role: action.element.role,
          type: action.element.type,
          placeholder: action.element.placeholder,
          ariaLabel: action.element.ariaLabel,
          href: action.element.href,
        };
      } else {
        elements[ref] = { selector: '_none', tag: '_', text: '' };
      }
      return ref;
    }

    const isNoiseNetwork = (n: NetworkEntry): boolean => {
      const url = n.url || '';
      const path = n.path || '';
      const rt = n.resourceType || '';
      if (['image', 'stylesheet', 'font', 'manifest', 'other'].includes(rt)) return true;
      if (n.status === 0) return true;
      if (/\/ztbox|\/mwb2\.gif|\/hmslog|\/log\.gif|\/tongji|hm\.baidu|clickstream|\/actionlog|\/collect\?|\/track|\/beacon/i.test(url)) return true;
      if (/\/favicon\.ico|\/robots\.txt/i.test(path)) return true;
      return false;
    };

    const meaningfulNetwork = data.network.filter(n => !isNoiseNetwork(n));

    const filtered = data.actions.filter(a => a.type !== 'scroll');

    type ActionGroup = { actions: UserAction[]; primary: UserAction };
    const groups: ActionGroup[] = [];
    let current: ActionGroup | null = null;

    for (const action of filtered) {
      const sameElement = current
        && current.primary.element?.selector
        && current.primary.element.selector === action.element?.selector
        && action.timestamp - current.primary.timestamp < MERGE_WINDOW;
      const isInputLike = action.type === 'input' || action.type === 'keydown' || action.type === 'change';

      if (current && (sameElement || (isInputLike && current.actions.some(a => a.type === 'input' || a.type === 'click')) && action.timestamp - current.primary.timestamp < MERGE_WINDOW)) {
        current.actions.push(action);
        if (action.type === 'input') current.primary = action;
      } else {
        current = { actions: [action], primary: action };
        groups.push(current);
      }
    }

    for (const group of groups) {
      const primary = group.primary;
      const tsStart = Math.min(...group.actions.map(a => a.timestamp));
      const tsEnd = Math.max(...group.actions.map(a => a.timestamp));
      const inputAction = group.actions.find(a => a.type === 'input');

      const nearbyNetwork = meaningfulNetwork.filter(n =>
        n.timestamp >= tsStart - 500 && n.timestamp <= tsEnd + POST_WINDOW,
      );
      const nearbyContext = data.contextChanges.filter(c =>
        c.timestamp >= tsStart - 500 && c.timestamp <= tsEnd + POST_WINDOW,
      );
      const matchedInputs = inputAction
        ? this.matchActionToNetwork(inputAction, nearbyNetwork)
        : [];
      const clickMatches = primary.type === 'click' && primary.element?.text
        ? this.matchActionToNetwork(primary, nearbyNetwork)
        : [];

      steps.push({
        step: steps.length + 1,
        ref: getRef(primary),
        action: primary,
        network: nearbyNetwork.map(n => ({
          ...n,
          responseBody: n.responseBody && JSON.stringify(n.responseBody).length > 1000
            ? ('[truncated, ' + JSON.stringify(n.responseBody).length + ' bytes]')
            : n.responseBody,
        })),
        contextChanges: nearbyContext,
        matchedInputs: [...matchedInputs, ...clickMatches],
      });
    }

    return {
      startUrl: data.startUrl,
      recordedAt: new Date(this.startedAt).toISOString(),
      durationMs: Date.now() - this.startedAt,
      totalActions: data.actions.length,
      totalNetworkRequests: meaningfulNetwork.length,
      steps,
      elements,
      checkpoints: data.checkpoints,
    };
  }

  private matchActionToNetwork(
    action: UserAction,
    nearbyNetwork: NetworkEntry[],
  ): Array<{ inputValue: string; networkId: number; paramName: string }> {
    const matches: Array<{ inputValue: string; networkId: number; paramName: string }> = [];
    const searchValue = (action.value || action.element?.text || '').trim();
    if (!searchValue || searchValue.length < 2) return matches;

    for (const netEntry of nearbyNetwork) {
      if (netEntry.url.includes(encodeURIComponent(searchValue)) || netEntry.url.includes(searchValue)) {
        matches.push({ inputValue: searchValue, networkId: netEntry.id, paramName: 'url' });
      }
      if (netEntry.requestBody && typeof netEntry.requestBody === 'object') {
        this.searchObjectForValue(
          netEntry.requestBody as Record<string, unknown>,
          searchValue,
          netEntry.id,
          '',
          matches,
        );
      }
    }
    return matches;
  }

  private searchObjectForValue(
    obj: Record<string, unknown>,
    targetValue: string,
    networkId: number,
    prefix: string,
    results: Array<{ inputValue: string; networkId: number; paramName: string }>,
  ): void {
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (typeof value === 'string' && value.includes(targetValue)) {
        results.push({ inputValue: targetValue, networkId, paramName: fullKey });
      } else if (typeof value === 'object' && value !== null) {
        this.searchObjectForValue(value as Record<string, unknown>, targetValue, networkId, fullKey, results);
      }
    }
  }

  private buildMarkdownSummary(_data: RecordingData, summary: RecordingSummary): string {
    const lines: string[] = [];
    const durSec = Math.round(summary.durationMs / 1000);

    lines.push('# Recording Summary');
    lines.push('');
    lines.push(`- **URL**: ${summary.startUrl}`);
    lines.push(`- **Recorded**: ${summary.recordedAt}`);
    lines.push(`- **Duration**: ${durSec}s`);
    lines.push(`- **Steps**: ${summary.totalActions} actions, ${summary.totalNetworkRequests} network requests`);
    if (summary.checkpoints.length > 0) {
      const cpTypes = summary.checkpoints.map(c => c.type);
      lines.push(`- **Checkpoints**: ${summary.checkpoints.length} (${[...new Set(cpTypes)].join(', ')})`);
    } else {
      lines.push('- **Checkpoints**: 0');
    }

    const checkpointSteps = new Map<number, CheckpointEntry>();
    for (const cp of summary.checkpoints) {
      if (cp.relatedActionId != null) {
        for (const step of summary.steps) {
          if (step.action.id === cp.relatedActionId) {
            checkpointSteps.set(step.step, cp);
            break;
          }
        }
      }
    }

    lines.push('');
    lines.push('## Steps');
    lines.push('');

    for (const step of summary.steps) {
      const a = step.action;
      const el = a.element;
      const cp = checkpointSteps.get(step.step);

      if (cp) {
        lines.push(`### Step ${step.step}: ⚠️ CHECKPOINT — ${cp.hint}`);
        lines.push(`- **Type**: ${cp.type} (${cp.source})`);
        lines.push(`- **Hint**: ${cp.hint}`);
        if (cp.selector) lines.push(`- **Selector**: \`${cp.selector}\``);
        lines.push(`- **Action needed**: Human intervention required before continuing`);
      } else {
        const title = describeActionTitle(a);
        lines.push(`### Step ${step.step}: ${title}`);
      }

      if (el) {
        const parts: string[] = [`\`${el.selector || el.tag}\``];
        if (el.text) parts.push(`"${el.text.substring(0, 60)}"`);
        parts.push(`(${el.tag})`);
        if (el.type) parts.push(`type=${el.type}`);
        lines.push(`- **Element**: ${parts.join(' ')}`);
      }

      if (a.value != null && a.type === 'input') {
        lines.push(`- **Value**: "${a.value.substring(0, 100)}"`);
      }

      if (step.network.length > 0) {
        const netDescs = step.network.map(n => {
          let desc = `${n.method} ${n.path}`;
          if (n.status) desc += ` → ${n.status}`;
          if (n.responseSize > 0) desc += ` (${formatBytes(n.responseSize)})`;
          return desc;
        });
        lines.push(`- **Network**: ${netDescs.join(', ')}`);

        for (const n of step.network) {
          if (n.requestBody && typeof n.requestBody === 'object') {
            const bodyStr = JSON.stringify(n.requestBody);
            if (bodyStr.length <= 300) {
              lines.push(`  - \`${n.method} ${n.path}\` body: \`${bodyStr}\``);
            } else {
              lines.push(`  - \`${n.method} ${n.path}\` body: \`${bodyStr.substring(0, 300)}...\` (${bodyStr.length} bytes)`);
            }
          }
        }
      } else {
        lines.push('- **Network**: none');
      }

      if (step.matchedInputs.length > 0) {
        for (const m of step.matchedInputs) {
          lines.push(`- **Input matched**: "${m.inputValue}" → ${m.paramName} (network #${m.networkId})`);
        }
      }

      for (const ctx of step.contextChanges) {
        if (ctx.type === 'navigate') {
          lines.push(`- **Navigate**: → ${ctx.url}`);
        } else if (ctx.type === 'new_tab') {
          lines.push(`- **New tab**: ${ctx.url}`);
        }
      }

      if (a.clickContext) {
        if (a.clickContext.appeared?.length > 0) {
          for (const popup of a.clickContext.appeared) {
            const roleStr = popup.role ? ` [${popup.role}]` : '';
            lines.push(`- **Popup**: <${popup.tag}${roleStr}> "${(popup.text || '').substring(0, 60)}"`);
            if (popup.items?.length > 0) {
              const itemStrs = popup.items.slice(0, 8).map(i => {
                const dis = i.disabled ? ' [disabled]' : '';
                return `"${i.text}"${dis}`;
              });
              let itemLine = `  - Items: ${itemStrs.join(', ')}`;
              if (popup.items.length > 8) itemLine += ` ... +${popup.items.length - 8} more`;
              lines.push(itemLine);
            }
          }
        }
        if (a.clickContext.stateChanges?.length > 0) {
          for (const sc of a.clickContext.stateChanges) {
            const parts: string[] = [];
            if (sc.ariaExpanded !== undefined) parts.push(`expanded=${sc.ariaExpanded}`);
            if (sc.disabled) parts.push('disabled');
            if (sc.ariaSelected !== undefined) parts.push(`selected=${sc.ariaSelected}`);
            if (sc.dataState) parts.push(`state=${sc.dataState}`);
            if (parts.length > 0) {
              lines.push(`- **State**: <${sc.tag}> "${(sc.text || '').substring(0, 30)}" ${parts.join(', ')}`);
            }
          }
        }
      }

      lines.push('');
    }

    const allNetwork = summary.steps.flatMap(s => s.network);
    if (allNetwork.length > 0) {
      lines.push('## Network Timeline');
      lines.push('');
      allNetwork.forEach((n: NetworkEntry, i: number) => {
        let line = `${i + 1}. ${n.method} ${n.path}`;
        if (n.status) line += ` → ${n.status}`;
        if (n.requestBody && typeof n.requestBody === 'object') {
          const bodyStr = JSON.stringify(n.requestBody);
          if (bodyStr.length <= 150) {
            line += ` ${bodyStr}`;
          }
        }
        if (n.responseSize > 0) line += ` (${formatBytes(n.responseSize)})`;
        lines.push(line);
      });
      lines.push('');
    }

    const orphanCheckpoints = summary.checkpoints.filter(
      (cp: CheckpointEntry) => cp.relatedActionId == null || !checkpointSteps.has(
        summary.steps.find((s: RecordingStep) => s.action.id === cp.relatedActionId)?.step ?? -1,
      ),
    );
    if (orphanCheckpoints.length > 0) {
      lines.push('## Unresolved Checkpoints');
      lines.push('');
      for (const cp of orphanCheckpoints) {
        const src = cp.source === 'auto' ? '[auto]' : '[manual]';
        lines.push(`- ${src} **${cp.type}**: ${cp.hint}`);
        if (cp.selector) lines.push(`  - Selector: \`${cp.selector}\``);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  static readMarkdownSummary(sessionName: string): string | null {
    const path = join(SessionRecorder.getRecordingsDir(sessionName), 'summary.md');
    try {
      return readFileSync(path, 'utf-8');
    } catch {
      return null;
    }
  }
}

function describeActionTitle(a: UserAction): string {
  const el = a.element;
  const elText = el?.text ? `"${el.text.substring(0, 40)}"` : '';
  const elTag = el?.tag ? `<${el.tag}>` : '';

  switch (a.type) {
    case 'click':
      return `Click ${elText || elTag} button`.replace(/ +/g, ' ').trim();
    case 'input':
      return `Input "${(a.value || '').substring(0, 50)}" in ${elText || elTag || 'field'}`.replace(/ +/g, ' ').trim();
    case 'change':
      return `Change ${elText || elTag} to "${(a.value || '').substring(0, 30)}"`;
    case 'keydown':
      return `Press ${a.key || 'key'} on ${elText || elTag || 'element'}`;
    case 'submit':
      return `Submit ${elText || elTag || 'form'}`;
    default:
      return `${a.type} ${elText || elTag}`.trim() || a.type;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
