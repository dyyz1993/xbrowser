
export const ACTION_SIGNAL_SCRIPT = `
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

    // For low-confidence selectors (nth-of-type) OR selectors from dynamic
    // attributes (which may not survive page reload), generate a text-based
    // fallback when the element has short, unique text (e.g. menu items
    // "删除", "确认", "最新"). This lets replay fall back to text matching
    // when the primary selector can't be found.
    var textFallback;
    var popupContext;

    // Check if element is inside a popup/menu first (needed for scoped text uniqueness)
    var popupEl;
    try {
      popupEl = el.closest('[role="menu"], [role="listbox"], [role="dialog"], [role="tooltip"], [role="list"], [class*="popover"], [class*="popup"], [class*="dropdown"], [class*="menu"], [class*="modal"], [id*="menu"], [id*="dropdown"], [id*="popup"], [id*="modal"]');
    } catch(e) {}

    // Determine if primary selector is "fragile" — won't survive page reload
    // because it comes from a dynamic attribute (e.g. data-spm-anchor-id).
    var selectorIsFragile = false;
    if (selector && confidence === 'high' && strategy === 'data-attr') {
      // Fragile if the selector references a known dynamic attribute
      selectorIsFragile = selector.indexOf('[data-spm-anchor-id') !== -1
        || selector.indexOf('[data-reactid') !== -1
        || selector.indexOf('[data-track') !== -1
        || selector.indexOf('[data-log') !== -1;
    }

    if (confidence === 'low' || selectorIsFragile) {
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

    // Ordinal address (r6): ancestor form's ordinal among sibling forms + element's
    // ordinal among same-tag direct children of that form. Direct children only —
    // nested elements have no stable single-level address.
    var ordinal = null;
    try {
      var ordForm = el.closest ? el.closest('form') : null;
      if (ordForm && el.parentElement === ordForm) {
        var ordParent = ordForm.parentElement;
        var formSibs = ordParent
          ? Array.prototype.filter.call(ordParent.children, function(c) { return c.tagName === 'FORM'; })
          : [ordForm];
        var tagSibs = Array.prototype.filter.call(ordForm.children, function(c) { return c.tagName === el.tagName; });
        ordinal = {
          formNth: formSibs.indexOf(ordForm) + 1,
          tagNth: tagSibs.indexOf(el) + 1,
        };
      }
    } catch(e) { /* skip */ }

    // Label text (r16): the <label> associated with the element (for= association or ancestor wrapper). In virtual list /
    // form-row reordering scenarios, structural ordinals fail, but the label text moves in the same line as the
    // control—content moves, and the anchor follows the content.
    var labelText = '';
    try {
      var lbl = null;
      if (el.id) lbl = el.ownerDocument.querySelector('label[for="' + el.id + '"]');
      if (!lbl && el.closest) lbl = el.closest('label');
      if (lbl) labelText = (lbl.textContent || '').trim().substring(0, 40);
    } catch(e) { /* skip */ }

    // Element size (r25): rounded rect at record time — scoring signal for
    // fingerprint disambiguation between same-fingerprint decoys.
    var size = null;
    try {
      var szR = el.getBoundingClientRect();
      if (szR.width > 0 || szR.height > 0) {
        size = { w: Math.round(szR.width), h: Math.round(szR.height) };
      }
    } catch(e) { /* skip */ }

    // Row text (r27): textContent of the closest table/list row. In virtual
    // lists and sortable tables the row re-indexes — the row TEXT travels
    // with the content, giving inputs a content anchor that survives reorder.
    var rowText = '';
    try {
      var row = el.closest ? el.closest('tr,li') : null;
      if (row) rowText = (row.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 40);
    } catch(e) { /* skip */ }

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
      ordinal: ordinal || undefined,
      labelText: labelText || undefined,
      size: size || undefined,
      rowText: rowText || undefined,
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
    // Modern SPA conventions: many libraries expose the open menu via class
    // fragments like "items-container", "options", "list", "select-popup".
    '[class*="items-container"]','[class*="options"]','[class*="select-popup"]',
    '[class*="select-items"]','[class*="menu-items"]','[class*="list-box"]',
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
              // Attach a selector so replay / AI can target this item precisely.
              try {
                var childSel = uniqueSelector(child);
                if (childSel) childInfo.selector = childSel;
              } catch(e) {}
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

    // Mark this element as user-interacted in discovered_filters (proactive sensing)
    try { __xb_markTriggerInteracted(e.target); } catch(_) {}

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
  // After a hover we asynchronously sample for popups/dropdowns that appear
  // (200/500/1000ms) and run a short-lived MutationObserver. Any popup that
  // surfaces is recorded on the hover action as hoverContext, mirroring the
  // clickContext flow used after clicks.
  var __xb_last_hover = 0;
  var __xb_hover_observer = null;         // current hover's MutationObserver
  var __xb_hover_observer_timer = null;   // auto-disconnect timer
  var __xb_hover_action_ref = null;       // ref to the hover action being enriched
  var __xb_hover_seen_popups = {};        // dedup popup selectors for current hover
  var __xb_hover_cx = 0, __xb_hover_cy = 0;

  function __xb_merge_hover_context(ctx) {
    if (!__xb_hover_action_ref || !ctx) return;
    if (ctx.appeared.length === 0 && ctx.stateChanges.length === 0) return;
    if (!__xb_hover_action_ref.hoverContext) {
      __xb_hover_action_ref.hoverContext = { appeared: [], disappeared: [], stateChanges: [] };
    }
    var hc = __xb_hover_action_ref.hoverContext;
    ctx.appeared.forEach(function(p) {
      var key = p.selector || p.text;
      if (!key || __xb_hover_seen_popups[key]) return;
      __xb_hover_seen_popups[key] = true;
      hc.appeared.push(p);
    });
    ctx.stateChanges.forEach(function(s) {
      hc.stateChanges.push(s);
    });
  }

  function __xb_capture_hover_popups() {
    if (!__xb_hover_action_ref) return;
    try {
      var ctx = captureVisibleContext(__xb_hover_cx, __xb_hover_cy);
      __xb_merge_hover_context(ctx);
    } catch(e) {}
  }
  // Expose for flush-time sweep (server-side flushPendingActions calls this
  // before draining the pending queue so any in-flight hover enrichment lands).
  window.__xb_capture_hover_popups = __xb_capture_hover_popups;

  function __xb_start_hover_observer() {
    if (!('MutationObserver' in window)) return;
    if (__xb_hover_observer) {
      __xb_hover_observer.disconnect();
      __xb_hover_observer = null;
    }
    if (__xb_hover_observer_timer) {
      clearTimeout(__xb_hover_observer_timer);
      __xb_hover_observer_timer = null;
    }
    __xb_hover_observer = new MutationObserver(function(mutations) {
      if (!__xb_hover_action_ref) return;
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType !== 1) continue;
          var matches = false;
          // Is the added node itself a popover?
          for (var k = 0; k < POPOVER_SELECTORS.length; k++) {
            try { if (node.matches && node.matches(POPOVER_SELECTORS[k])) { matches = true; break; } } catch(e) {}
          }
          // Or does it contain a popover?
          if (!matches && node.querySelector) {
            for (var k2 = 0; k2 < POPOVER_SELECTORS.length; k2++) {
              try { if (node.querySelector(POPOVER_SELECTORS[k2])) { matches = true; break; } } catch(e) {}
            }
          }
          if (matches) {
            __xb_capture_hover_popups();
            break;
          }
        }
      }
    });
    try {
      __xb_hover_observer.observe(document.body, { childList: true, subtree: true });
    } catch(e) {}
    // Auto-disconnect after 1.2s — hover popups rarely appear later than this.
    __xb_hover_observer_timer = setTimeout(function() {
      if (__xb_hover_observer) {
        __xb_hover_observer.disconnect();
        __xb_hover_observer = null;
      }
      __xb_hover_observer_timer = null;
    }, 1200);
  }

  document.addEventListener('mouseover', function(e) {
    if (Date.now() - __xb_last_hover < 800) return;
    var target = resolveMeaningful(e);
    // Only record hover on interactive elements. Modern SPAs often implement
    // clickable items as <span>/<div> with onClick handlers and no semantic
    // role, so we also accept elements whose computed style suggests they are
    // meant to be interacted with (pointer cursor, or a class name that looks
    // like a UI control).
    var tag = target.tagName && target.tagName.toLowerCase();
    var isInteractive = tag === 'a' || tag === 'button' || tag === 'input'
      || tag === 'select' || tag === 'textarea' || tag === 'summary'
      || target.getAttribute('role') === 'button'
      || target.getAttribute('role') === 'link'
      || target.getAttribute('role') === 'menuitem'
      || target.getAttribute('role') === 'tab'
      || target.getAttribute('role') === 'option'
      || !!target.closest('[role="menu"], [role="menubar"], [role="tablist"], [role="listbox"], [role="tree"], nav, menu');
    // Heuristic fallback for span/div/li that look interactive (onClick,
    // pointer cursor, or class names hinting at a UI control like
    // "select", "trigger", "tab", "sort", "menu", "item").
    if (!isInteractive && (tag === 'span' || tag === 'div' || tag === 'li')) {
      try {
        if (target.onclick) isInteractive = true;
      } catch(e2) {}
      if (!isInteractive) {
        try {
          var cs = window.getComputedStyle(target);
          if (cs.cursor === 'pointer') isInteractive = true;
        } catch(e3) {}
      }
      if (!isInteractive) {
        try {
          var cls = (target.className && typeof target.className === 'string')
            ? target.className.toLowerCase() : '';
          if (/(?:^|[-_])(select|trigger|tab|sort|menu|item|dropdown|popover|title|toggle|action|btn)(?:[-_]|$)/.test(cls)) {
            // But only if an ancestor looks like a toolbar/menu/sort bar —
            // otherwise this would match almost every list item on the web.
            if (target.closest('[class*="select"], [class*="sort"], [class*="tab"], [class*="menu"], [class*="toolbar"], [class*="filter"], [class*="dropdown"]')) {
              isInteractive = true;
            }
          }
        } catch(e4) {}
      }
    }
    if (isInteractive) {
      // Reset state for the new hover target
      if (__xb_hover_observer) {
        __xb_hover_observer.disconnect();
        __xb_hover_observer = null;
      }
      if (__xb_hover_observer_timer) {
        clearTimeout(__xb_hover_observer_timer);
        __xb_hover_observer_timer = null;
      }
      __xb_hover_seen_popups = {};

      var cx = e.clientX, cy = e.clientY;
      __xb_hover_cx = cx;
      __xb_hover_cy = cy;

      pushAction('hover', {
        element: describe(target),
        x: cx,
        y: cy,
      });
      // Mark this element as user-interacted in discovered_filters
      try { __xb_markTriggerInteracted(target); } catch(_) {}
      __xb_last_hover = Date.now();

      // Grab a reference to the just-pushed action so we can enrich it async.
      var pending = window.__xb_pending_actions;
      __xb_hover_action_ref = pending.length > 0 ? pending[pending.length - 1] : null;

      // 1. Async sampling: 200/500/1000ms covers CSS transitions + JS render delays.
      setTimeout(__xb_capture_hover_popups, 200);
      setTimeout(__xb_capture_hover_popups, 500);
      setTimeout(__xb_capture_hover_popups, 1000);

      // 2. Short-lived MutationObserver for popups that appear on their own schedule.
      __xb_start_hover_observer();
    }
  }, true);

  // ── Pointer-based drag (modern sliders, sortable lists) ──
  // HTML5 dragstart/drop never fires for pointer-driven drags — capture via
  // pointerdown/pointerup with a movement threshold instead (rec-duel d08).
  var __xb_ptr_down = null;
  document.addEventListener('pointerdown', function(e) {
    var t = actualTarget(e);
    __xb_ptr_down = { x: e.clientX, y: e.clientY, element: describe(t), ts: Date.now() };
  }, true);
  document.addEventListener('pointerup', function(e) {
    if (!__xb_ptr_down) return;
    var start = __xb_ptr_down;
    __xb_ptr_down = null;
    var dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (Math.abs(dx) < 15 && Math.abs(dy) < 15) return; // tap/click, not a drag
    pushAction('drag', {
      x: e.clientX,
      y: e.clientY,
      element: start.element,
      drag: {
        fromX: start.x,
        fromY: start.y,
        toX: e.clientX,
        toY: e.clientY,
      },
    });
  }, true);

  // ── Drag & drop ──
  var __xb_drag_source = null;
  var __xb_drag_start_pos = null;
  document.addEventListener('dragstart', function(e) {
    __xb_drag_source = e.target;
    __xb_drag_start_pos = { x: e.clientX, y: e.clientY };
  }, true);
  document.addEventListener('drop', function(e) {
    // sup-s5: OS 文件拖入捕获——Dropzone/Uppy 类上传区无 input[type=file]，
    // change 捕获够不着；dataTransfer.files 经 FileReader 内联（与
    // filechooser 同构），回放端 'drop' 动作经 dropFiles 重放。
    try {
      var dropped = (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0)
        ? Array.prototype.slice.call(e.dataTransfer.files)
        : [];
      if (dropped.length > 0) {
        var zone = describe(resolveMeaningful(e));
        var names = dropped.map(function(f) { return f.name; });
        var readers = [];
        for (var i = 0; i < dropped.length; i++) {
          readers.push(new Promise(function(resolve) {
            var reader = new FileReader();
            reader.onload = function() { resolve(reader.result); };
            reader.onerror = function() { resolve(null); };
            reader.readAsDataURL(dropped[i]);
          }));
        }
        Promise.all(readers).then(function(contents) {
          var fileData = [];
          for (var j = 0; j < dropped.length; j++) {
            fileData.push({
              name: dropped[j].name,
              type: dropped[j].type,
              size: dropped[j].size,
              dataUrl: contents[j],
            });
          }
          pushAction('drop', {
            x: e.clientX,
            y: e.clientY,
            element: zone,
            value: names.join(', '),
            files: {
              names: names,
              count: dropped.length,
              isMultiple: dropped.length > 1,
              fileData: fileData,
            },
          });
        });
      }
    } catch(_) { /* capture must not break the drag path */ }
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

  // ─────────────────────────────────────────────────────────────────────────
  // PROACTIVE SENSING — discover interactive regions without user action.
  //
  // Three layers:
  //   1. __xb_scanFilters() — baseline scan, called on start/navigation
  //   2. Long-lived MutationObserver — watches popover visible transitions
  //   3. mousemove throttled diff — senses triggers near the cursor
  //
  // Results:
  //   - 'discovered_filters' action → merged into RecordingData.discoveredFilters
  //   - 'popup_appear' action → added to actions stream (with cause tag)
  // ─────────────────────────────────────────────────────────────────────────

  var FILTER_CONTAINER_SELECTORS = [
    '[role="tablist"]', '[role="menu"]', '[role="menubar"]', '[role="toolbar"]',
    '[role="navigation"]', '[role="listbox"]',
    '[class*="filter"]', '[class*="sort"]', '[class*="toolbar"]',
    '[class*="select-bar"]', '[class*="tabs"]', '[class*="nav-bar"]',
    '[class*="sidebar"]', '[class*="menu-bar"]', '[class*="select-container"]',
    'fieldset',
  ];

  var TRIGGER_SELECTORS = [
    '[role="tab"]', '[role="menuitem"]', '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]', '[role="option"]', '[role="button"]',
    '[role="link"]', '[role="switch"]', '[role="checkbox"]',
    'button', 'a', 'select',
    // Modern SPA span/div triggers (cursor:pointer is a strong signal)
    'span[class*="title"]', 'div[class*="title"]',
    'div[class*="trigger"]', 'span[class*="trigger"]',
    'div[class*="item"]', 'li',
  ];

  /** Categorize a container/trigger by class name + role heuristics. */
  function categorizeElement(el) {
    try {
      var cls = ((el.className && typeof el.className === 'string') ? el.className : '').toLowerCase();
      var role = (el.getAttribute && el.getAttribute('role')) || '';
      if (role === 'tab' || /(^|[-_])tab(s|list)?([-_]|$)/.test(cls)) return 'tab';
      if (role === 'menuitem' || role === 'menu' || /menu/.test(cls)) return 'menu';
      if (/sort/.test(cls)) return 'sort';
      if (/filter/.test(cls)) return 'filter';
      if (role === 'navigation' || /nav([-_]|$)/.test(cls)) return 'navigation';
      // Common compound patterns
      if (/search-filter|search-select|filter-up|filter-select|filter-checkbox/.test(cls)) return 'filter';
      if (/sort-bar|sort-container|sort-trigger/.test(cls)) return 'sort';
      if (/checkbox-group|radio-group/.test(cls)) return 'filter';
      if (/sidebar/.test(cls)) return 'navigation';
    } catch(e) {}
    return 'unknown';
  }

  /** Build a DiscoveredTrigger from an element. */
  function buildTrigger(el) {
    var text = (el.textContent || '').trim();
    var trigger = {
      selector: uniqueSelector(el),
      text: text.substring(0, 40),
      role: el.getAttribute ? (el.getAttribute('role') || undefined) : undefined,
      category: categorizeElement(el),
      hasPopup: false,
      userInteracted: false,
      explored: false,
    };
    return trigger;
  }

  /** All DiscoveredFilters found so far. Keyed by containerSelector for dedup. */
  var __xb_discovered_filters = {};
  /** True if a 'discovered_filters' push is pending (debounced). */
  var __xb_scan_scheduled = false;
  /** Track which DOM nodes we've already scanned (by identity, not selector). */
  var __xb_scanned_nodes = (typeof WeakSet !== 'undefined') ? new WeakSet() : null;

  /** Scan the page for filter/sort/tab/menu containers + their triggers.
   * Dedup by DOM node identity (WeakSet) so the same element reached via
   * different selectors is recorded once. Nested containers are skipped —
   * the outermost container wins. */
  function __xb_scanFilters() {
    try {
      // First pass: collect all candidate container nodes (dedup by identity)
      var candidates = [];
      var seenNodes = new Set();  // fallback if WeakSet unavailable
      for (var ci = 0; ci < FILTER_CONTAINER_SELECTORS.length; ci++) {
        var containers;
        try { containers = document.querySelectorAll(FILTER_CONTAINER_SELECTORS[ci]); } catch(e) { continue; }
        for (var cj = 0; cj < containers.length; cj++) {
          var c = containers[cj];
          // Dedup by identity
          if (__xb_scanned_nodes) {
            if (__xb_scanned_nodes.has(c)) continue;
          } else {
            if (seenNodes.has(c)) continue;
            seenNodes.add(c);
          }
          // Skip non-visible containers
          if (!c.offsetParent && c.tagName.toLowerCase() !== 'body') continue;
          // Skip if an ancestor is already a candidate (avoid nested dup)
          var isNested = false;
          for (var ck = 0; ck < candidates.length; ck++) {
            if (candidates[ck].contains(c)) { isNested = true; break; }
          }
          if (isNested) continue;
          // If this candidate contains existing ones, remove them
          candidates = candidates.filter(function(p) { return !c.contains(p); });
          candidates.push(c);
        }
      }

      // Second pass: for each candidate, mark as scanned + extract triggers
      for (var ck2 = 0; ck2 < candidates.length; ck2++) {
        var c2 = candidates[ck2];
        if (__xb_scanned_nodes) __xb_scanned_nodes.add(c2);

        var containerSel = uniqueSelector(c2);
        // If we already have this in discovered map (by selector), skip
        if (__xb_discovered_filters[containerSel]) continue;

        // Extract triggers: prefer leaf-ish elements with short text
        var triggers = [];
        var seenTrigSels = {};
        // Use a single querySelectorAll with comma-joined selectors for speed
        var allCandidates = c2.querySelectorAll(TRIGGER_SELECTORS.join(', '));
        for (var ti = 0; ti < allCandidates.length; ti++) {
          var el = allCandidates[ti];
          if (!el.offsetParent) continue;
          // Skip elements whose nearest ancestor in the container is also a
          // candidate (would create nested triggers).
          var skip = false;
          var p = el.parentElement;
          while (p && p !== c2) {
            if (seenTrigSels[uniqueSelector(p)]) { skip = true; break; }
            p = p.parentElement;
          }
          if (skip) continue;
          var txt = (el.textContent || '').trim();
          if (!txt || txt.length === 0 || txt.length > 40) continue;
          // Skip if this looks like a full item card (long combined text)
          if (el.children.length > 3) continue;
          var sel = uniqueSelector(el);
          if (seenTrigSels[sel]) continue;
          seenTrigSels[sel] = true;
          triggers.push(buildTrigger(el));
          if (triggers.length >= 30) break;
        }
        if (triggers.length === 0) continue;

        __xb_discovered_filters[containerSel] = {
          containerSelector: containerSel,
          category: categorizeElement(c2),
          containerText: (c2.textContent || '').trim().substring(0, 60),
          triggers: triggers,
        };
      }
      // Third pass: dedup containers whose trigger set is a subset of another.
      // This handles the case where two overlapping containers (e.g. outer
      // ".filter-up-container" and inner ".filter-select-container") share
      // triggers — keep the larger one, drop the redundant subset.
      var newFilters = [];
      var addedKeys = [];
      for (var key in __xb_discovered_filters) {
        var f = __xb_discovered_filters[key];
        var isSubset = false;
        for (var otherKey in __xb_discovered_filters) {
          if (otherKey === key) continue;
          var other = __xb_discovered_filters[otherKey];
          if (f.triggers.length > other.triggers.length) continue;
          // Check if every trigger in f is also in other (by selector)
          var allInOther = true;
          for (var ti2 = 0; ti2 < f.triggers.length; ti2++) {
            var found = false;
            for (var to2 = 0; to2 < other.triggers.length; to2++) {
              if (other.triggers[to2].selector === f.triggers[ti2].selector) { found = true; break; }
            }
            if (!found) { allInOther = false; break; }
          }
          if (allInOther && f.triggers.length < other.triggers.length) {
            isSubset = true;
            break;
          }
          // Same size + same triggers — keep the one with a more "container-y" selector
          if (allInOther && f.triggers.length === other.triggers.length && key > otherKey) {
            isSubset = true;
            break;
          }
        }
        if (!isSubset) {
          newFilters.push(f);
          addedKeys.push(key);
        }
      }
      // Rebuild the discovered map with deduped entries
      __xb_discovered_filters = {};
      for (var ni = 0; ni < newFilters.length; ni++) {
        __xb_discovered_filters[addedKeys[ni]] = newFilters[ni];
      }

      // Push a discovered_filters action so the server picks it up.
      __xb_pushDiscovered();
    } catch(e) { /* scan failed, don't crash recorder */ }
  }

  /** Push current discovered_filters snapshot to pending actions (debounced). */
  function __xb_pushDiscovered() {
    if (__xb_scan_scheduled) return;
    __xb_scan_scheduled = true;
    setTimeout(function() {
      __xb_scan_scheduled = false;
      var list = Object.keys(__xb_discovered_filters).map(function(k) {
        return __xb_discovered_filters[k];
      });
      window.__xb_pending_actions.push({
        type: 'discovered_filters',
        ts: Date.now(),
        url: location.href,
        title: document.title,
        discoveredFilters: list,
      });
    }, 200);
  }

  /** Mark a trigger as user-interacted (called from click/hover handlers). */
  function __xb_markTriggerInteracted(target) {
    try {
      var sel = uniqueSelector(target);
      for (var k in __xb_discovered_filters) {
        var f = __xb_discovered_filters[k];
        for (var i = 0; i < f.triggers.length; i++) {
          if (f.triggers[i].selector === sel) {
            f.triggers[i].userInteracted = true;
            // Schedule a push so server gets the updated state
            __xb_pushDiscovered();
            return;
          }
          // Also accept ancestor match (target may be a child of the trigger)
          var triggerEl = document.querySelector(f.triggers[i].selector);
          if (triggerEl && triggerEl.contains(target)) {
            f.triggers[i].userInteracted = true;
            __xb_pushDiscovered();
            return;
          }
        }
      }
    } catch(e) {}
  }

  /** Expose scan + capture for server-side triggers (post-navigation, flush-time). */
  window.__xb_scanFilters = __xb_scanFilters;
  window.__xb_capture_discovered_filters = function() {
    return Object.keys(__xb_discovered_filters).map(function(k) {
      return __xb_discovered_filters[k];
    });
  };

  /** Find the nearest trigger element for a popup (looking up the DOM). */
  function findTriggerForPopup(popupEl) {
    try {
      // Walk up looking for known container types, then pick the trigger
      // nearest to the popup's top.
      var popupRect = popupEl.getBoundingClientRect();
      var ancestor = popupEl;
      for (var depth = 0; depth < 8 && ancestor; depth++) {
        ancestor = ancestor.parentElement;
        if (!ancestor) break;
        var triggersInAncestor = ancestor.querySelectorAll(
          '[role="tab"], [role="menuitem"], [role="option"], [role="button"], button, a, [class*="title"]'
        );
        // Pick the trigger whose x-center is closest to the popup's x-center
        // and is above the popup.
        var best = null, bestDist = Infinity;
        for (var i = 0; i < triggersInAncestor.length; i++) {
          var t = triggersInAncestor[i];
          if (!t.offsetParent) continue;
          var r = t.getBoundingClientRect();
          if (r.y + r.height > popupRect.y + 5) continue;  // must be above popup
          var dist = Math.abs((r.x + r.width / 2) - (popupRect.x + popupRect.width / 2));
          if (dist < bestDist) {
            bestDist = dist;
            best = t;
          }
        }
        if (best) {
          // Mark the trigger as hasPopup in our discovered map
          var bestSel = uniqueSelector(best);
          for (var k in __xb_discovered_filters) {
            var f = __xb_discovered_filters[k];
            for (var j = 0; j < f.triggers.length; j++) {
              if (f.triggers[j].selector === bestSel) {
                f.triggers[j].hasPopup = true;
              }
            }
          }
          return {
            selector: bestSel,
            text: (best.textContent || '').trim().substring(0, 40),
          };
        }
      }
    } catch(e) {}
    return undefined;
  }

  /** Extract popup items (reuses the same item-extraction logic as captureVisibleContext). */
  function extractPopupItems(popupEl) {
    var items = [];
    try {
      var children = popupEl.querySelectorAll(
        'a,button,[role="menuitem"],[role="option"],[role="treeitem"],li,div[class*="item"],span[class*="item"]'
      );
      for (var k = 0; k < Math.min(children.length, 20); k++) {
        var child = children[k];
        var childText = (child.textContent || '').trim();
        if (!childText || childText.length > 60) continue;
        var info = { text: childText.substring(0, 60) };
        if (child.disabled) info.disabled = true;
        try { info.selector = uniqueSelector(child); } catch(e) {}
        items.push(info);
      }
    } catch(e) {}
    return items;
  }

  /** Check whether an element is currently visible (has layout box). */
  function isVisibleEl(el) {
    try {
      var r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      var cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
      return true;
    } catch(e) { return false; }
  }

  /** Push a 'popup_appear' sensing action. */
  function __xb_pushPopupAppear(popupEl, cause) {
    try {
      if (!popupEl || !isVisibleEl(popupEl)) return;
      var r = popupEl.getBoundingClientRect();
      // Heuristic: a real popup/menu should be relatively small (not a full
      // page banner) and have menu-like children. Page banners / hero sections
      // often match [class*="popup"] / [class*="modal"] but aren't real menus.
      var MAX_POPUP_AREA = 600 * 600;  // 360,000 px²
      if (r.width * r.height > MAX_POPUP_AREA) return;
      // Must have at least 1 child that looks like an item (link/button/li/div with class*="item")
      var itemChildren = popupEl.querySelectorAll(
        'a, button, [role="menuitem"], [role="option"], li, [class*="item"]'
      );
      if (itemChildren.length === 0) return;
      // Dedup against recent popup_appear actions (same selector within 3s)
      var popupSel = uniqueSelector(popupEl);
      var now = Date.now();
      var recent = window.__xb_pending_actions.filter(function(a) {
        return a.type === 'popup_appear' && (now - a.ts) < 3000;
      });
      for (var i = 0; i < recent.length; i++) {
        if (recent[i].popupAppear && recent[i].popupAppear.popup.selector === popupSel) return;
      }

      var triggerInfo = findTriggerForPopup(popupEl);
      window.__xb_pending_actions.push({
        type: 'popup_appear',
        ts: now,
        url: location.href,
        title: document.title,
        popupAppear: {
          trigger: triggerInfo,
          popup: {
            selector: popupSel,
            text: (popupEl.textContent || '').trim().substring(0, 100),
            rect: {
              x: Math.round(r.x), y: Math.round(r.y),
              w: Math.round(r.width), h: Math.round(r.height),
            },
            items: extractPopupItems(popupEl),
          },
          cause: cause || 'auto',
          userTriggered: cause === 'user-hover' || cause === 'user-click',
        },
      });
      // Also schedule a discovered_filters push (hasPopup flags may have updated)
      __xb_pushDiscovered();
    } catch(e) {}
  }

  // Expose for the hover handler to call when it observes a popup (avoid double-record)
  window.__xb_pushPopupAppear = __xb_pushPopupAppear;

  // ── Layer 2: long-lived MutationObserver for popover visible transitions ──
  var __xb_long_observer = null;
  var __xb_observer_debounce = null;
  // Set of selectors we've already recorded as popups (avoid re-pushing)
  var __xb_seen_popups = {};

  function __xb_startLongObserver() {
    if (!('MutationObserver' in window)) return;
    if (__xb_long_observer) __xb_long_observer.disconnect();

    __xb_long_observer = new MutationObserver(function(mutations) {
      // Debounce — collect then process once
      if (__xb_observer_debounce) clearTimeout(__xb_observer_debounce);
      __xb_observer_debounce = setTimeout(function() {
        __xb_observer_debounce = null;
        // Scan all known popover containers; any newly visible one → push
        for (var i = 0; i < POPOVER_SELECTORS.length; i++) {
          var els;
          try { els = document.querySelectorAll(POPOVER_SELECTORS[i]); } catch(e) { continue; }
          for (var j = 0; j < els.length; j++) {
            var el = els[j];
            var sel = uniqueSelector(el);
            if (__xb_seen_popups[sel]) continue;
            if (!isVisibleEl(el)) continue;
            __xb_seen_popups[sel] = Date.now();
            __xb_pushPopupAppear(el, 'auto');
          }
        }
      }, 100);
    });
    try {
      __xb_long_observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden'],
      });
    } catch(e) {}
  }

  // Auto-cleanup seen_popups every 10s so transient popups can re-trigger
  setInterval(function() {
    var now = Date.now();
    for (var k in __xb_seen_popups) {
      if (now - __xb_seen_popups[k] > 10000) delete __xb_seen_popups[k];
    }
  }, 10000);

  // ── Layer 3: mousemove throttled diff (senses triggers near cursor) ──
  var __xb_last_scan_move = 0;
  var __xb_move_stop_timer = null;
  var __xb_last_pos = { x: 0, y: 0 };

  document.addEventListener('mousemove', function(e) {
    __xb_last_pos = { x: e.clientX, y: e.clientY };
    var now = Date.now();
    if (now - __xb_last_scan_move < 300) return;
    __xb_last_scan_move = now;

    // Reset the "stop" timer — when mouse stops moving for 800ms, we scan
    if (__xb_move_stop_timer) clearTimeout(__xb_move_stop_timer);
    __xb_move_stop_timer = setTimeout(function() {
      __xb_move_stop_timer = null;
      __xb_scanNearCursor(__xb_last_pos.x, __xb_last_pos.y, 'user-hover');
    }, 800);
  }, true);

  /** Scan popups near the cursor; mark nearby triggers as explored. */
  function __xb_scanNearCursor(cx, cy, cause) {
    try {
      // 1. Check for any visible popover near cursor
      for (var i = 0; i < POPOVER_SELECTORS.length; i++) {
        var els;
        try { els = document.querySelectorAll(POPOVER_SELECTORS[i]); } catch(e) { continue; }
        for (var j = 0; j < els.length; j++) {
          var el = els[j];
          if (!isVisibleEl(el)) continue;
          var r = el.getBoundingClientRect();
          // Near = within 400px of cursor
          if (Math.abs((r.x + r.width / 2) - cx) > 400) continue;
          if (Math.abs((r.y + r.height / 2) - cy) > 400) continue;
          var sel = uniqueSelector(el);
          var now = Date.now();
          if (__xb_seen_popups[sel] && now - __xb_seen_popups[sel] < 2000) continue;
          __xb_seen_popups[sel] = now;
          __xb_pushPopupAppear(el, cause);
        }
      }

      // 2. Mark nearby triggers as explored (mouse lingered without click)
      var near = document.elementsFromPoint(cx, cy);
      for (var k = 0; k < near.length && k < 5; k++) {
        var t = near[k];
        var tSel = uniqueSelector(t);
        for (var fk in __xb_discovered_filters) {
          var f = __xb_discovered_filters[fk];
          for (var ti = 0; ti < f.triggers.length; ti++) {
            if (f.triggers[ti].selector === tSel) {
              f.triggers[ti].explored = true;
            }
          }
        }
      }
      __xb_pushDiscovered();
    } catch(e) {}
  }

  // ── Trigger initial baseline scan (after DOM is ready) ──
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(__xb_scanFilters, 500);
    setTimeout(__xb_startLongObserver, 800);
  } else {
    window.addEventListener('DOMContentLoaded', function() {
      setTimeout(__xb_scanFilters, 500);
      setTimeout(__xb_startLongObserver, 800);
    });
  }
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
export const CHECKPOINT_OVERLAY_SCRIPT = `
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
