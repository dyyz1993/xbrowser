# xbrowser brand contract

> Status: approved for repository logo assets  
> Owner: xbrowser project maintainers  
> Last verified: 2026-10-23
> Canonical for: product naming, copy, domains, store identity, logo, and promotion

## Product Identity

- **Public name:** xbrowser
- **Pronunciation:** ex-browser
- **Syllable count:** two
- **Chinese name:** none
- **Chinese naming policy:** English-only official name; Chinese copy may describe it as a 浏览器自动化命令行工具.
- **Product type:** browser automation CLI
- **Company / publisher:** dyyz1993
- **Related SDK or open-source identity:** the `@xbrowser/cli` package and xbrowser repository share this product identity.
- **Identity boundary:** package name, repository name, command name, APIs, and plugin contracts retain their existing names.

## Positioning

- **Audience:** developers and AI agent workflows that automate browser tasks.
- **Problem:** browser automation should be accessible from a composable command line without a bespoke script for every task.
- **Promise:** direct, inspectable browser automation through xbrowser commands and plugins.
- **Category:** browser automation CLI.
- **One-sentence positioning:** xbrowser is a browser automation CLI for web work, developer workflows, and AI agents.
- **Not positioned as:** a browser engine, a general-purpose web browser, or a marketplace logo.

## Naming Decision

The existing public name, package name, repository, and command are retained. This logo decision does not rename any identifier.

## Slogan and Copy

- **Primary slogan:** Browser automation, composable.
- **Supporting line:** A command-line browser automation tool for developers and AI agent workflows.
- **Short description:** Automate web tasks with xbrowser commands and plugins.
- **Attribution:** xbrowser by dyyz1993.

## Logo and Visual Identity

### Concept

Aurora Ecosystem X combines a compact dotted-to-solid browser chrome line with four colored paths that form an X. The paths represent browser control, fast execution, plugin extensibility, and marketplace discovery. Each arm stays solid through its outer section and blends only during the final approach to a seamless center; there is no center node or branch boundary.

### Palette

| Token | Value | Usage |
| --- | --- | --- |
| Background start | `#172554` | Upper-left icon canvas |
| Background end | `#4338CA` | Lower-right icon canvas |
| Browser core | `#F8FAFC` | Upper-left X arm |
| Fast execution | `#67E8F9` | Upper-right X arm |
| Plugin extensibility | `#C4B5FD` | Lower-left X arm |
| Marketplace discovery | `#93C5FD` | Lower-right X arm |
| Center blend | `#AFCFF4` | Continuous X intersection |
| Browser chrome | `#C7D2FE` | Top `···—` line |

### Construction and usage

- Clear space: at least 12.5% of the mark width on every side.
- Minimum digital size: 16 px for the square mark; 128 px wide for the wordmark.
- Approved backgrounds: the Aurora blue-to-indigo canvas for the mark; light backgrounds with `logo-light.svg`; dark backgrounds with `logo-dark.svg`.
- Small-size behavior: use `mark-16.png` or `mark-32.png`; preserve the four-arm silhouette and do not add labels.
- Wordmark typography: lowercase `xbrowser`, Inter or Arial fallback, 750 weight, tight tracking.
- Prohibited uses: do not stretch, rotate, crop, recolor, split the center, add a center node, add a browser frame, or use it as a functional UI icon.

### Required variants

- Primary: `branding/mark.svg`
- Reverse / dark-background: `branding/logo-dark.svg`
- Light-background: `branding/logo-light.svg`
- Monochrome: not yet produced; create a reviewed derivative before a monochrome-only placement.
- Small-size mark: `branding/mark-16.png` and `branding/mark-32.png`
- App icon and social avatar: `branding/mark-512.png`

## Asset Map

| Asset | Path | Role | Status |
| --- | --- | --- | --- |
| Master artwork | `branding/mark.svg` | Canonical source | approved |
| Concept master | `branding/concepts/ecosystem-x.svg` | Construction reference | approved |
| App icon raster | `branding/mark-512.png` | 512 px app icon / social avatar | approved derivative |
| Small app icons | `branding/mark-192.png`, `branding/mark-32.png`, `branding/mark-16.png` | Product and favicon derivatives | approved derivative |
| Light wordmark | `branding/logo-light.svg` | Light-background wordmark | approved |
| Dark wordmark | `branding/logo-dark.svg` | Dark-background wordmark | approved |
| Marketplace web identity | `xbrowser-marketplace/public` | Deployed site favicon, icon, manifest, theme color, and OG artwork | approved deployment derivative |
| Documentation web identity | `xbrowser-docs/public/logo.svg` | Deployed docs favicon | approved deployment derivative |
| Color exploration | `output/branding/ecosystem-x-colorways.png` | Review reference | draft, do not publish |
| Social share image | not yet produced | Promotion | pending |

## Domain and Store Screening

No domain, marketplace, App Store, trademark, or web availability screening was performed for this logo-only decision. The existing name and package identity are therefore **unverified** for a new launch or legal clearance.

### Remaining human or legal checks

- Run live domain, package, App Store, trademark, and web screening before a public rename, registration, or product launch.

No entry in this document is legal advice or a guarantee of global uniqueness.

## Promotion

| Deliverable | Path / URL | Status | Notes |
| --- | --- | --- | --- |
| Product website | `https://xbrowser.dev` | approved deployment derivative | Marketplace identity uses the approved mark. |
| Documentation site | `https://docs.xbrowser.dev` | approved deployment derivative | Documentation identity uses the approved mark. |
| Support page | GitHub repository README | existing | Use canonical assets for future logo placements. |
| Screenshot set | not produced | pending | Capture only from shipped product UI. |
| Social assets | `branding/mark-512.png` | approved derivative | A share card remains pending. |

## Usage Rules

### Always

- Use the approved lowercase public name, `xbrowser`.
- Use canonical assets from the Asset Map.
- Keep the four arm meanings and the center-only blending rule intact.
- Re-run live availability checks before registration, reservation, or launch.

### Never

- Claim trademark safety or global uniqueness without qualified evidence.
- Treat DNS failure or a public store zero-result search as proof of availability.
- Stretch, recolor, decorate, crop, or repurpose the logo as a functional icon.

## Change Control

Before changing the name, slogan, domains, store identity, logo, or canonical asset paths:

1. Update this document and its verification date.
2. Re-run the relevant live screening.
3. Classify effects on display names, internal identifiers, bundle/package IDs, domains, schemes, APIs, legal names, attribution, and compatibility aliases.
4. Update the project `AGENTS.md` reference if this file moves.
5. Validate the contract and record any external mutation with read-back evidence.
