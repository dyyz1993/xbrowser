# Your Browser Automation Breaks When the Site Changes. Mine Heals Itself.

> Published on {{DATE}} · xbrowser v{{VERSION}}

Every team that records browser automation hits the same wall three weeks later: the site ships a redesign, a class name changes from `.cta-primary` to `Button_variant__3xkQ`, and every recorded script that touched that button dies at step 4. You re-record, patch selectors, and repeat next sprint.

We spent 30+ seasons of an automated attack-defense arena making recorded scripts survive exactly this. This post is the design walkthrough of the self-healing replay engine that ships in [xbrowser]({{GITHUB_URL}}) — a browser automation CLI where `replay` doesn't just fail, it *recovers*.

## The problem with selectors

A recorded click is really a bet: "this CSS selector will still identify the same interactive element tomorrow." Every strategy is a different bet with a different failure mode:

- **Class selectors** break on CSS-module hashing and utility-framework refactors.
- **Text selectors** break on copy changes ("Log in" → "Sign in").
- **Positional selectors** (`nth-child`) break on any layout reorder.
- **Coordinates** break on viewport changes and lazy-loaded spacers.

No single strategy survives all of this. So instead of picking one, xbrowser's replay resolution is a **cascade** — and the cascade is where all the interesting engineering lives.

## The healing cascade

When the recorded primary selector resolves to zero (or to the wrong thing), the replayer walks this chain:

```
primary selector
  → recorded text fallback
  → semantic candidates
      partial (id / name / placeholder / class)
      meta    (type / placeholder / aria-label)
      text-anchor (xpath on button/link copy)
      label-anchor (label[for] / wrapping label)
      unique tag / structural ordinal
  → coordinate recovery (recorded x/y + elementFromPoint path re-derivation)
  → blind positional (last resort)
  → give up (never click the wrong thing)
```

Three design decisions matter more than the list itself.

### 1. Fingerprints decide, not just match

Every candidate that survives name matching must pass a **fingerprint check** against what was recorded about the original element: `type`, `placeholder`, text, size. We grade mismatches:

- `type` or `placeholder` contradiction → **hard reject**. A recorded password field can never be allowed to heal into a text input.
- text-only contradiction → **soft accept**. Copy changes are the *most common* mutation in practice, so hard-rejecting on text would kill the healer exactly where it's needed most. Soft hits are marked `~soft` in the output so you can audit them.

This one grading decision took our decoy tests (a spy button with the same copy, bigger size) from 0/2 to 2/2 — without breaking the copy-change scenarios.

### 2. Occlusion awareness, not just presence

An element can exist, match the fingerprint, and still be under a modal overlay. The probing layer runs the same hit-test your click would run — including walking up through **shadow roots** via `getRootNode().host` — and skips candidates that would be intercepted. A healed click that lands on a cookie banner is worse than a failure, because it's silent.

### 3. The healer has a memory

When a heal succeeds, the mapping (broken selector → working strategy) is written back to a per-domain knowledge file, TTL-pruned after 30 days. The next replay of the same script hits `known-heal` immediately: zero probing cost. If the knowledge goes stale, it's forgotten and the full cascade runs again. Healing gets *cheaper with use*.

## But does it work?

We test this the way you should test anything that claims robustness: an **arena**. Scripted mutations — class renames (both suffix decoration and full replacement), copy rewrites, form row shuffles, iframe re-parenting, decoy elements, overlay traps, virtual-list rebuilds — are fired against recorded flows, and the replayer must land the *semantically correct* target, judged by observable page state, not by which element it clicked.

Across 30+ scenarios in the current suite, the cascade holds 100% semantic accuracy — including the ones that taught us the most:

- **The tag-fallback trap**: a bare `input`/`button` tag always "resolves", so it used to short-circuit the heal chain and click the wrong element. The fix — bare tags only qualify for naturally-unique tags like `textarea` — is a rule we now apply everywhere: *a candidate that always succeeds is a candidate that never verifies*.
- **Layout shifts are coordinate blind spots**: insert one spacer div and every recorded coordinate misses, while structural ordinals still land. Coordinates are now ranked *below* semantic candidates for this reason.

## Try it

```bash
{{INSTALL_CMD}}

# record a flow
xbrowser record start --url https://example.com/form
# ... do the thing ...
xbrowser record stop --output flow.yaml

# replay it after the site changes
xbrowser replay flow.yaml
# ✓ step 3  .old-cta → healed via text-anchor (button "Get started")
```

Replay prints every self-healed step with the strategy that won, so failures are diagnosable and heal rates are measurable. The whole engine is deterministic — no LLM in the loop, no per-action token cost, millisecond-scale recovery.

xbrowser is MIT-licensed on GitHub: [{{GITHUB_URL}}]({{GITHUB_URL}}) · npm: [{{NPM_URL}}]({{NPM_URL}})

*Yes, this post was drafted, cover-rendered, and published through xbrowser's own content pipeline. It eats its own dog food.*
