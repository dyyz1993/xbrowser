# xbrowser logo

Status: **approved**. Aurora Ecosystem X is the official xbrowser mark and color system. The canonical contract is [`docs/brand/xbrowser.md`](../docs/brand/xbrowser.md).

## Brief

xbrowser is a browser automation CLI for developers and AI agent workflows. The logo should be legible as a small favicon, recognizable in a README, and related to browser control from a command line. The existing `xbrowser` name and blue/indigo product palette are the starting points for these drafts.

## Directions

| Direction | Concept and silhouette | Color logic | Small-size behavior | Main risk |
| --- | --- | --- | --- | --- |
| A · Browser X | Browser frame enclosing a large X | Existing blue/indigo with pale cyan crossing stroke | Window and X remain visible at 32 px | A large X may also read as a close or error symbol |
| B · Prompt Window | Browser frame enclosing a `>_` prompt | Deep indigo supports a bright cyan command glyph | Prompt and frame remain visible at 32 px | Terminal prompt is a familiar category symbol |
| C · Route X | Two connected paths cross to form X | Blue and teal separate the paths | X remains visible at 32 px; nodes simplify | Does not immediately say “browser” |

Recommendation for review: **B**, because browser control through a CLI is the clearest product distinction. Final selection and brand rollout are pending user review. Preview: `output/branding/concept-comparison.png`.

## Simpler directions

| Direction | What remains | Small-size behavior | Main risk |
| --- | --- | --- | --- |
| D · Mono X | Only the name's X | Strongest silhouette at 16 px | Least explicit about browser automation |
| E · Prompt | Only the `>_` command glyph | Clear through 16 px | More terminal than browser |
| F · Tab X | X made from two flat tab-like forms | Clear at 24 px and above | A little more abstract than D |

Recommendation for review: **E · Prompt**. It removes the entire browser chrome while retaining the command-line idea that distinguishes xbrowser. Preview: `output/branding/minimal-concept-comparison.png`.

## Minimal browser cues

| Direction | Browser cue | Why it works |
| --- | --- | --- |
| G · Prompt Chrome | Three window controls and a single divider | Closest to the minimal prompt while adding an unmistakable browser hint |
| H · Tab Prompt | One browser tab outline | More browser-specific, while still using only two symbols |

Recommendation for review: **G · Prompt Chrome**. It adds just one small chrome row above the command mark, so it retains the simple silhouette at favicon sizes. Preview: `output/branding/browser-cue-comparison.png`.

## Half-browser directions

| Direction | Browser element | Why it works |
| --- | --- | --- |
| I · Browser Half | Upper half of a complete browser window | Immediately reads as browser, yet avoids a boxed lower edge |
| J · Browser Crop | Cropped 70% browser window around the prompt | Rejected in review: the frame wraps the prompt and becomes too much like a UI |

Recommendation for review: **I · Browser Half**. The open lower edge keeps it lighter than a full window while the top bar, controls, and rounded corners make its browser relationship obvious. Preview: `output/branding/half-browser-comparison.png`.

## Refined browser cue

**K · Open Chrome Prompt** keeps only a browser's top strip. The chrome establishes the browser connection, then ends before it can enclose the prompt. Preview: `output/branding/open-chrome-prompt.png`.

## Line-first refinement

**L · Line Chrome Prompt** redraws K entirely with rounded outlines: the browser top bar, its controls, the prompt arrow, and cursor are all lines. This is the current recommended draft. Preview: `output/branding/line-chrome-prompt.png`.

## Unified chrome line

**M · Fused Chrome Prompt** turns the three browser controls and divider into one dotted-to-solid rounded path. The compact `···—` rhythm keeps the browser cue while reducing the top element to one line. Its full mark group is optically centered 52 px above its former geometry. Preview: `output/branding/fused-chrome-backgrounds.png`.

## Ecosystem X

**N · Ecosystem X** is the official xbrowser mark. It replaces the terminal `>_` with four independent branches that converge through their own gradients. The browser chrome stays as the category cue. The Aurora palette is canonical; the remaining palettes below are exploratory only. Default preview: `output/branding/ecosystem-x.png`.

| Branch | Meaning | Color |
| --- | --- | --- |
| Upper left | Browser core and browser control | `#F8FAFC` |
| Upper right | Fast execution and forward momentum | `#67E8F9` |
| Lower left | Plugin extensibility | `#C4B5FD` |
| Lower right | Plugin marketplace and discovery | `#93C5FD` |

The X is one masked shape filled by a continuous four-source color field. Each branch remains its own solid color through the outer arm; only its final approach to the crossing blends into the shared `#AFCFF4` center color (about the final 16 px on the branch centerline). The meeting has no branch boundaries and no separate center node. These meanings remain part of the brand story rather than labels inside the mark.

### Palette explorations

The four colors always follow the same reading order: upper left, upper right, lower left, lower right. These are candidate palettes for the selected mark; preview: `output/branding/ecosystem-x-colorways.png`.

| Palette | Background | Upper-left / upper-right / lower-left / lower-right |
| --- | --- | --- |
| Aurora (default) | `#172554` → `#4338CA` | `#F8FAFC` / `#67E8F9` / `#C4B5FD` / `#93C5FD` |
| Solar | `#3B0A19` → `#C0264A` | `#FFE4A3` / `#FF965A` / `#C98BFF` / `#FF65A5` |
| Neon | `#071B19` → `#0F766E` | `#E5FF70` / `#63F5D0` / `#8D7CFF` / `#FF6BD6` |
| Ember | `#281508` → `#9A3412` | `#FFF0C2` / `#FFB454` / `#FF7A6A` / `#E879F9` |
| Ocean | `#031B3B` → `#075985` | `#D9F5FF` / `#38BDF8` / `#2DD4BF` / `#A7F3D0` |
| Graphite | `#17171A` → `#393543` | `#F9FAFB` / `#FFBE55` / `#8B9BFF` / `#E987FF` |

The Aurora mark combines a compact browser chrome line with an X of four product capabilities. Use the canonical files and rules in [`docs/brand/xbrowser.md`](../docs/brand/xbrowser.md) for all product-facing work.

| Asset | Use |
| --- | --- |
| `mark.svg` | Square app icon and favicon source |
| `mark-16.png`, `mark-32.png` | Favicon sizes |
| `mark-192.png`, `mark-512.png` | Raster app icons |
| `logo-light.svg` | Wordmark on light backgrounds |
| `logo-dark.svg` | Wordmark on dark backgrounds |
| `concepts/prompt-window.svg` | Draft direction B: browser plus CLI prompt |
| `concepts/route-x.svg` | Draft direction C: crossed automation paths |
| `concepts/mono-x.svg` | Draft direction D: minimal name mark |
| `concepts/prompt.svg` | Draft direction E: minimal command mark |
| `concepts/x-tab.svg` | Draft direction F: abstract tab mark |
| `concepts/prompt-chrome.svg` | Draft direction G: prompt with minimal browser chrome |
| `concepts/tab-prompt.svg` | Draft direction H: tab plus prompt |
| `concepts/browser-half-prompt.svg` | Draft direction I: upper half browser plus prompt |
| `concepts/browser-crop-prompt.svg` | Draft direction J: cropped browser plus prompt |
| `concepts/open-chrome-prompt.svg` | Draft direction K: open browser chrome plus prompt |
| `concepts/line-chrome-prompt.svg` | Draft direction L: line-first browser chrome plus prompt |
| `concepts/fused-chrome-prompt.svg` | Draft direction M: unified dotted browser chrome plus prompt |
| `concepts/ecosystem-x.svg` | Draft direction N: browser chrome plus modular ecosystem X |

Colors: Aurora background `#172554` to `#4338CA`, branches `#F8FAFC`, `#67E8F9`, `#C4B5FD`, and `#93C5FD`, light wordmark `#111827`, dark wordmark `#F8FAFC`.

Keep clear space around the mark equal to at least one eighth of its width. Use the wordmark variant that contrasts with its background.
