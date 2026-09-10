# What I Learned Building a Stealth Layer on Top of Chrome DevTools Protocol

> Published on {{DATE}} · xbrowser v{{VERSION}}

Automated browsers get detected in three ways: your *events* are synthetic, your *environment* has seams, and your *workflow* gets interrupted by things a human would click through. Most stealth guides cover the second. This post covers all three, from months of running an automated attack-defense arena against production-grade detection — as implemented in [xbrowser]({{GITHUB_URL}})'s stealth layer.

## 1. Synthetic events: `isTrusted` is the first gate

Production sites don't just listen for clicks — they check `event.isTrusted`. Anything dispatched from JS (`el.click()`, `dispatchEvent`) fails that check, and we've watched pages respond by navigating to `about:blank`, silently dropping the action, or flashing a "CDP Firewall: event simulation detected" warning.

The rule that falls out: **interact through real input pipelines only.** Compute coordinates from `getBoundingClientRect`, then dispatch through `Input.dispatchMouseEvent` — real trusted events, same as a human's mouse. The same philosophy generalizes:

- **File uploads**: never click the `input[type=file]` (it opens an OS dialog and trips detection). Inject a constructed `File` into a `DataTransfer` and dispatch the `change` event — or go one level up and stub the File System Access API's `showOpenFilePicker` to return a synthetic handle, so drag-and-drop uploaders (Dropzone/Uppy) work with zero OS dialogs.
- **Native controls that steal focus**: `input[type=color]` opens a color picker and keyboard input is rejected; the fix is value injection + a bubbling `input`/`change` event pair. Same treatment unified for `date`, `time`, `month`, `week`, `datetime-local`.

The pattern has a name in our codebase: *bypass the native UI, enter the editing pipeline directly.*

## 2. Environment seams: UA-CH and the prototype escape

Two findings shaped our environment layer.

**UA-CH drift is a silent killer.** Spoofing `navigator.userAgent` without matching `userAgentData` (brands order, GREASE entries, versions) is itself a fingerprint — and when Chrome auto-upgrades under you, your frozen UA desyncs from the real binary. The fix: derive the UA-CH profile *from the running binary at launch* (`Browser.getVersion`), so versions can't drift.

**Prototype escapes get you caught.** If a detector walks `Object.getPrototypeOf(navigator)` and compares descriptors against a pristine iframe's navigator, property *deletions* and *naive defineProperty patches* both show up. The auditable fix is a seal: rebuild the descriptor surface so prototype-level comparison matches a clean browser, then verify with the same probes a detector would run (28 assertions, runnable as a self-check).

One red line we hold: **never touch `navigator.webdriver`**. It's the single most cross-checked signal; tampering with it correlates with fraud tooling more than with testing. Honest automation declares itself or stays home.

## 3. Interruption suppression: the unglamorous 90%

Headful agents die from a thousand papercuts: a `beforeunload` dialog, an HTTP Basic auth modal, a right-click context menu, a `PaymentRequest` sheet, a serial-port permission prompt, an SSL interstitial, the OS falling asleep mid-replay. Each one blocks the pipeline with a modal no CSS can hide.

So xbrowser ships a **suppression matrix** — 19 layers, each with a red-test-then-green-lock workflow:

- JS dialogs (`alert`/`confirm`/`prompt`) auto-dismissed with recorded semantics;
- permissions granted in one full-set call (the cross-engine gotcha: `grantPermissions` *replaces*, it doesn't merge);
- HTTP auth handled at the Fetch layer with credentials, non-credential requests bypassed untouched;
- serial/USB/HID/Bluetooth/IdleDetector/wake-lock surface complete, deterministic stubs so agents get `NotFoundError` instead of a hung native picker;
- SSL interstitials skipped via `Security.setIgnoreCertificateErrors` (finally wired to its option after living as a dead flag);
- replay holds a `caffeinate -i` child so macOS never sleeps mid-run.

Every layer was added because a real scenario hit it. None is speculative.

## Where this gets uncomfortable — and where we stop

Anti-detection sits on a spectrum. Test automation on your own app, scraping public pages at polite rates, and keeping long personal workflows alive are legitimate. Evading fraud controls at scale is not. Practical rules we operate by: no real accounts on high-ban-risk platforms for automation experiments; rate limits respected; login states only ever reused for the account that created them. A stealth layer is a tool; the operator picks the ethics.

## Try it

```bash
{{INSTALL_CMD}}
xbrowser stealth:check   # 28-assertion environment self-audit
```

MIT licensed: [{{GITHUB_URL}}]({{GITHUB_URL}}) · npm: [{{NPM_URL}}]({{NPM_URL}})

*Drafted, cover-rendered, and published through xbrowser's own content pipeline.*
