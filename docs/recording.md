# Recording and Playback

Guide to recording and replaying browser actions in xbrowser.

## Overview

The recording system allows you to:

- **Record** user interactions in a browser
- **Save** recordings as YAML files
- **Replay** recordings automatically
- **Convert** recordings to scripts (JS/Python/Bash)
- **Filter** and **extract** from recordings

## Recording

### Start Recording

```bash
xbrowser record start [options]
```

**Options:**
- `--url <url>` - Navigate to URL before recording
- `--name <name>` - Recording name

**Examples:**
```bash
xbrowser record start --url https://example.com
xbrowser record start --url https://example.com --name my-recording
```

### Check Recording Status

```bash
xbrowser record status
```

**Output:**
```json
{
  "recording": true,
  "name": "my-recording",
  "startedAt": "2025-01-01T00:00:00.000Z",
  "events": 42,
  "duration": 15000
}
```

### Stop Recording

```bash
xbrowser record stop --output <file>
```

**Options:**
- `--output <file>` - Output file path (required)

**Examples:**
```bash
xbrowser record stop --output recording.yaml
xbrowser record stop --output ./recordings/session1.yaml
```

## Recording File Format

Recordings are saved as YAML files:

```yaml
id: "abc-123-def-456"
name: "my-recording"
startUrl: "https://example.com"
startTime: "2025-01-01T00:00:00.000Z"
duration: 15000
events:
  - type: navigate
    url: "https://example.com"
    timestamp: 0
    pageState:
      url: "https://example.com"
      title: "Example Domain"

  - type: click
    selector: "#button"
    tagName: "button"
    timestamp: 1000
    pageState:
      url: "https://example.com"
      title: "Example Domain"

  - type: input
    selector: "#search"
    data:
      value: "playwright"
    timestamp: 3000
    pageState:
      url: "https://example.com"
      title: "Example Domain"

  - type: keydown
    selector: "#search"
    data:
      key: "Enter"
    timestamp: 5000
    pageState:
      url: "https://example.com"
      title: "Example Domain"

  - type: scroll
    data:
      x: 0
      y: 500
    timestamp: 7000
    pageState:
      url: "https://example.com"
      title: "Example Domain"

  - type: page_load
    timestamp: 8000
    pageState:
      url: "https://example.com/results"
      title: "Results"
```

## Event Types

### navigate

Page navigation event.

```yaml
type: navigate
url: "https://example.com"
timestamp: 0
```

### click

Click event on element.

```yaml
type: click
selector: "#button"
tagName: "button"
timestamp: 1000
pageState:
  url: "https://example.com"
  title: "Example Domain"
```

### input

Input field value change.

```yaml
type: input
selector: "#search"
data:
  value: "playwright"
timestamp: 3000
```

### keydown

Keyboard key press.

```yaml
type: keydown
selector: "#search"
data:
  key: "Enter"
timestamp: 5000
```

### scroll

Page scroll event.

```yaml
type: scroll
data:
  x: 0
  y: 500
timestamp: 7000
```

### page_load

Page load complete event.

```yaml
type: page_load
timestamp: 8000
pageState:
  url: "https://example.com/results"
  title: "Results"
```

### hover

Mouse hover on an interactive element. Includes the element descriptor and
optionally a `hoverContext` field capturing any popup/dropdown/tooltip that
appeared after the hover.

```yaml
type: hover
element:
  selector: ".sort-trigger"
  text: "新发布"
  strategy: "class"
  confidence: "medium"
x: 311
y: 196
# Optional: only present when a popup appeared after the hover
hoverContext:
  appeared:
    - tag: "div"
      selector: "div:nth-of-type(2) > ..."
      text: "最新 1天内 3天内 7天内 14天内"
      rect: { x: 271, y: 224, w: 120, h: 208 }
      items:
        - { text: "最新",   selector: "..." }
        - { text: "1天内",  selector: "..." }
        - { text: "3天内",  selector: "..." }
        - { text: "7天内",  selector: "..." }
        - { text: "14天内", selector: "..." }
  disappeared: []
  stateChanges: []
```

**How hover popups are captured**:

1. When `mouseover` fires on an interactive element (link, button, or `<span>`
   with `cursor:pointer` / `class*="select|trigger|tab|menu"`), the recorder
   pushes a `hover` action.
2. Over the next 1200ms, it samples the page at 200ms / 500ms / 1000ms for
   `POPOVER_SELECTORS` matches (`[role=menu]`, `[class*="dropdown"]`,
   `[class*="items-container"]`, etc.) near the hover coordinates.
3. A short-lived `MutationObserver` (1.2s) catches popups that appear on their
   own schedule (CSS transitions, async JS rendering).
4. Any popup found is attached to the hover action as `hoverContext.appeared`,
   with each menu item's `text` + `selector` recorded for replay targeting.

**Replay**: `xbrowser replay` performs `page.hover(selector)` then waits up to
1s for the first popup in `hoverContext.appeared` to become visible, so that
a subsequent click on a popup item resolves reliably.

**Clean mode filtering**: In `clean` stream mode (default), hover actions
without a `hoverContext` are dropped as ambient noise. Hover actions **with**
a `hoverContext` are always kept — they are semantically meaningful (the user
intentionally opened a popup).

## Proactive Sensing (主动感知)

In addition to capturing user actions, the recorder proactively scans the
page to discover interactive regions **even if the user never touches them**.
This lets AI/automation answer "what can I do on this page?" without requiring
the user to demo every option.

### `RecordingData.discoveredFilters`

A list of filter/sort/tab/menu/navigation regions found on the page. Each
entry describes one container and the triggers inside it.

```yaml
discoveredFilters:
  - containerSelector: ".search-filter-select-container"
    category: "filter"
    containerText: "综合 新发布 价格 ..."
    triggers:
      - text: "综合"
        selector: ".trigger-zonghe"
        category: "filter"
        hasPopup: false         # updated when a popup is observed for this trigger
        userInteracted: false   # set true when user actually clicks/hovers it
        explored: false         # set true when mouse lingers on it
      - text: "新发布"
        ...
      - text: "价格"
        ...
  - containerSelector: ".search-filter-checkbox-container"
    category: "filter"
    triggers:
      - text: "包邮"
      - text: "全新"
      ...
```

**Key fields**:
- `category` — sort / filter / tab / menu / navigation / unknown
- `triggers[].userInteracted` — true if user actually clicked or hovered this trigger
- `triggers[].hasPopup` — true if a popup was observed appearing from this trigger
- `triggers[].explored` — true if mouse lingered >800ms without clicking

**Why only triggers (not options) are recorded**: Triggers are stable anchors.
Options are recorded separately when a popup actually appears (see below) —
this avoids capturing template/placeholder text from hidden DOM.

### `popup_appear` action

When any popover/dropdown/menu becomes visible (via user hover, click, or
auto-shown), a `popup_appear` action is pushed to the actions stream. This
preserves temporal ordering with user actions so AI can correlate "this click
caused this popup" or "this popup appeared automatically".

```yaml
type: popup_appear
popupAppear:
  trigger:
    selector: ".sort-trigger-xinfabu"
    text: "新发布"
  popup:
    selector: ".sort-dropdown"
    text: "最新 1天内 3天内 7天内 14天内"
    rect: { x: 271, y: 224, w: 120, h: 208 }
    items:
      - { text: "最新", selector: ".item-latest" }
      - { text: "1天内", selector: ".item-1d" }
      - ...
  cause: "user-hover"    # user-hover / user-click / auto / script
  userTriggered: true    # false for auto-shown popups
```

**Replay behavior**: `popup_appear` is an observation, not a user action —
`xbrowser replay` skips these by default. Use them for AI analysis only.

### Three-layer sensing architecture

1. **Baseline scan** (`__xb_scanFilters`) — runs on start and after every
   navigation. Finds all `[role="tablist"]`, `[class*="filter"]`,
   `[class*="sort"]`, etc. and records their triggers.
2. **Long-lived MutationObserver** — runs for the whole recording session.
   Watches all `POPOVER_SELECTORS` containers for `hidden → visible`
   transitions and pushes a `popup_appear` action on each.
3. **mousemove throttled diff** — 300ms throttle + 800ms "stop" detection.
   When the mouse lingers near a trigger, marks it as `explored` and scans
   for nearby popups.

### Limitations

- **No options for un-interacted triggers** — by design, only triggers are
  recorded from the baseline scan. Full option lists require the popup to
  actually appear (layer 2/3 or user action).
- **Dedup is heuristic** — overlapping containers may still produce some
  duplicate triggers in rare cases. Server-side flush merges by container
  selector to mitigate.
- **Performance** — long-lived MutationObserver + mousemove listener add
  overhead. For heavy SPAs with frequent DOM churn, consider `stream: 'raw'`
  mode (which keeps ambient noise but bypasses some filtering).

## Other action types

The recorder also captures (mostly informational, see `src/recorder/recording-types.ts`
for the full list):

- `change`, `submit` — form events
- `dblclick`, `contextmenu` — alternative mouse events
- `drag` — drag-and-drop with from/to coordinates
- `resize`, `visibility` — viewport / tab visibility changes
- `clipboard` — copy / paste / cut
- `touch`, `focus` — mobile / focus events
- `goto`, `cdp-fill`, `cdp-click`, `cdp-eval` — actions injected by xbrowser
  CDP commands (when running automation while recording)
- `filechooser` — file input dialog

## Playback

### Basic Playback

```bash
xbrowser replay <file>
```

**Examples:**
```bash
xbrowser replay recording.yaml
xbrowser replay ./recordings/session1.yaml
```

### Playback Options

```bash
xbrowser replay <file> [options]
```

**Options:**
- `--slow-mo <ms>` - Delay between commands (default: 0)
- `--stop-on-error` - Stop on first error (default: false)

**Examples:**
```bash
xbrowser replay recording.yaml --slow-mo 100
xbrowser replay recording.yaml --slow-mo 500 --stop-on-error
```

### Playback Result

```json
{
  "success": true,
  "eventsPlayed": 42,
  "duration": 15234,
  "errors": []
}
```

## Conversion

Convert recordings to executable scripts.

### Convert to JavaScript

```bash
xbrowser convert <recording> <output.js>
```

**Output:**
```javascript
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto('https://example.com');
  await page.click('#button');
  await page.fill('#search', 'playwright');
  await page.press('#search', 'Enter');
  await page.evaluate(() => window.scrollTo(0, 500));

  await browser.close();
})();
```

### Convert to Python

```bash
xbrowser convert <recording> <output.py>
```

**Output:**
```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False)
    page = browser.new_page()

    page.goto('https://example.com')
    page.click('#button')
    page.fill('#search', 'playwright')
    page.press('#search', 'Enter')
    page.evaluate('() => window.scrollTo(0, 500)')

    browser.close()
```

### Convert to Bash

```bash
xbrowser convert <recording> <output.sh>
```

**Output:**
```bash
#!/bin/bash
xbrowser goto https://example.com
xbrowser click "#button"
xbrowser fill "#search" "playwright"
xbrowser press "#search" Enter
xbrowser eval "window.scrollTo(0, 500)"
```

## Analysis

### Extract Summary

```bash
xbrowser extract <recording>
```

**Output:**
```
Recording Summary:
  ID: abc-123-def-456
  Name: my-recording
  Start URL: https://example.com
  Duration: 15.0s
  Total Events: 42

Event Type Stats:
  navigate: 1
  click: 15
  input: 8
  keydown: 10
  scroll: 5
  page_load: 3

Key Operations:
  1. Navigate to https://example.com
  2. Click #button
  3. Fill #search with "playwright"
  4. Press Enter
  5. Scroll down

Unique Elements:
  #button: 5 clicks
  #search: 3 fills, 2 keydowns
  .item: 10 clicks

Navigation Pattern:
  example.com → example.com/results → example.com/detail
```

## Filtering

### Filter Events

```bash
xbrowser filter <input> <output> [options]
```

**Options:**
- `--exclude <types>` - Exclude event types (comma-separated)

**Examples:**
```bash
# Exclude scroll events
xbrowser filter raw.yaml clean.yaml --exclude scroll

# Exclude multiple types
xbrowser filter raw.yaml clean.yaml --exclude scroll,navigate,page_load
```

### Filter by Selector

```bash
# Edit YAML to remove specific selectors
xbrowser filter raw.yaml clean.yaml
# Then edit clean.yaml manually
```

## Advanced Usage

### Recording with Custom Timeout

```bash
xbrowser goto https://example.com
xbrowser record start
# ... perform actions ...
xbrowser record stop --output custom.yaml
```

### Playback with Headless Mode

```bash
export XBROWSER_HEADLESS=true
xbrowser replay recording.yaml
```

### Playback with Custom Browser

```bash
export XBROWSER_CHROMIUM_PATH=/path/to/chromium
xbrowser replay recording.yaml
```

### Automated Testing

```bash
# Record test case
xbrowser record start --url https://example.com/test
# ... perform test actions ...
xbrowser record stop --output test.yaml

# Replay test
xbrowser replay test.yaml --stop-on-error

# Check result
if [ $? -eq 0 ]; then
  echo "Test passed"
else
  echo "Test failed"
fi
```

### Batch Playback

```bash
for recording in ./recordings/*.yaml; do
  echo "Playing: $recording"
  xbrowser replay "$recording" --stop-on-error
  if [ $? -ne 0 ]; then
    echo "Failed: $recording"
  fi
done
```

## Best Practices

### 1. Record Clean Sessions

```bash
# Bad - recording in messy environment
# (with other tabs, extensions, etc.)

# Good - clean recording session
xbrowser session open https://example.com
xbrowser record start
# ... perform actions ...
xbrowser record stop --output clean.yaml
```

### 2. Use Meaningful Names

```bash
# Good - descriptive name
xbrowser record stop --output login-flow.yaml

# Good - include date
xbrowser record stop --output recording-2025-01-01.yaml
```

### 3. Minimize Unnecessary Events

```bash
# Bad - includes all mouse movements
# Good - filter out scroll events
xbrowser filter raw.yaml clean.yaml --exclude scroll
```

### 4. Test Recordings

```bash
# Always test before using in automation
xbrowser replay test.yaml --stop-on-error
```

### 5. Version Control Recordings

```bash
# Add to git
git add recordings/
git commit -m "Add test recordings"

# But exclude sensitive data
echo "sensitive-data.yaml" >> .gitignore
```

## Troubleshooting

### Recording Not Starting

```bash
# Check if session is open
xbrowser session list

# If not, open session first
xbrowser session open https://example.com
xbrowser record start
```

### Playback Fails

```bash
# Check recording syntax
xbrowser extract recording.yaml

# Try slow playback
xbrowser replay recording.yaml --slow-mo 100

# Check specific events
xbrowser replay recording.yaml --stop-on-error
```

### Conversion Fails

```bash
# Check recording is valid YAML
cat recording.yaml | yq eval '.'

# Manually inspect for errors
less recording.yaml
```

## API Reference

### record start

Start recording.

```bash
xbrowser record start [options]
```

### record status

Get recording status.

```bash
xbrowser record status
```

### record stop

Stop and save recording.

```bash
xbrowser record stop --output <file>
```

### replay

Replay recording.

```bash
xbrowser replay <file> [options]
```

### convert

Convert to script.

```bash
xbrowser convert <recording> <output>
```

### extract

Extract summary.

```bash
xbrowser extract <recording>
```

### filter

Filter events.

```bash
xbrowser filter <input> <output> [options]
```

## See Also

- [Commands Reference](./commands.md) — All available commands
- [Quick Start](./quickstart.md) — Getting started guide
- [Architecture](./architecture.md) — How recording works
