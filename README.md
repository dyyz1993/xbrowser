# xbrowser

A browser automation CLI built with @dyyz1993/xcli-core

## Install

```bash
npm install
```

## Build

```bash
npm run build
```

## Usage

```bash
node dist/bin/cli.js <command>
```

## Browser Automation

This project includes Playwright for browser automation. The browser commands are registered through the plugin system.

### Example

```typescript
import { ensureBrowser, closeBrowser } from './commands/browser.js';

const page = await ensureBrowser();
await page.goto('https://example.com');
console.log(await page.title());
await closeBrowser();
```

## Development

```bash
npm run dev
```
