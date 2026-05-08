import type { Recording, RecordingEvent } from './definitions.js';

function escapeString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Generate a Node.js replay script from a recording.
 *
 * @param recording - The recording session to convert.
 * @returns A self-contained JavaScript script string.
 */
export function generateJSScript(recording: Recording): string {
  const events = aggregateEvents(recording.events || []);

  let script = `#!/usr/bin/env node
// Auto-generated replay script from xbrowser
// Start URL: ${recording.startUrl}
// Events: ${events.length}

import { chromium } from 'playwright';

const START_URL = '${escapeString(recording.startUrl)}';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Navigating to', START_URL);
  await page.goto(START_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
`;

  for (const event of events) {
    script += generateJSEvent(event);
  }

  script += `
  console.log('Replay completed!');
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
`;

  return script;
}

function generateJSEvent(event: RecordingEvent): string {
  switch (event.type) {
    case 'click':
      return `
  // Click: ${event.selector}
  await page.click('${escapeString(event.selector || 'body')}');
  await page.waitForTimeout(100);
`;

    case 'type':
    case 'input':
      return `
  // Input: ${event.selector}
  await page.fill('${escapeString(event.selector || 'input')}', '${escapeString(event.data?.value || '')}');
  await page.waitForTimeout(100);
`;

    case 'keydown':
    case 'keypress':
      if (event.data?.key === 'Enter') {
        return `
  // Press Enter
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
`;
      }
      return '';

    case 'scroll':
      return `
  // Scroll
  await page.evaluate(() => window.scrollTo(${event.data?.x || 0}, ${event.data?.y || 0}));
  await page.waitForTimeout(50);
`;

    case 'navigate':
    case 'page_load':
      return '';

    default:
      return '';
  }
}

/**
 * Generate a Python replay script from a recording.
 *
 * @param recording - The recording session to convert.
 * @returns A self-contained Python script string using Playwright async API.
 */
export function generatePythonScript(recording: Recording): string {
  const events = recording.events || [];

  let script = `#!/usr/bin/env python3
# Auto-generated replay script from xbrowser
# Start URL: ${recording.startUrl}

import asyncio
from playwright.async_api import async_playwright

START_URL = "${recording.startUrl}"

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()

        print(f"Navigating to {START_URL}")
        await page.goto(START_URL)
        await asyncio.sleep(1)
`;

  for (const event of events) {
    script += generatePythonEvent(event);
  }

  script += `
        print("Replay completed!")
        await browser.close()

asyncio.run(main())
`;

  return script;
}

function generatePythonEvent(event: RecordingEvent): string {
  switch (event.type) {
    case 'click':
      return `        # Click: ${event.selector}
        await page.click('${escapeString(event.selector || 'body')}')
        await asyncio.sleep(0.1)
`;

    case 'type':
    case 'input':
      return `        # Input: ${event.selector}
        await page.fill('${escapeString(event.selector || 'input')}', '${escapeString(event.data?.value || '')}')
        await asyncio.sleep(0.1)
`;

    case 'keydown':
    case 'keypress':
      if (event.data?.key === 'Enter') {
        return `        # Press Enter
        await page.keyboard.press('Enter')
        await asyncio.sleep(0.1)
`;
      }
      return '';

    default:
      return '';
  }
}

/**
 * Generate a Bash replay script from a recording using CDP HTTP endpoints.
 *
 * @param recording - The recording session to convert.
 * @returns A self-contained Bash script string.
 */
export function generateBashScript(recording: Recording): string {
  const events = recording.events || [];

  let script = `#!/bin/bash
# Auto-generated replay script from xbrowser
# Start URL: ${recording.startUrl}

CDP_URL="\${CDP_URL:-http://localhost:9222}"

echo "Navigating to ${recording.startUrl}..."
curl -s "$CDP_URL/json/new?${encodeURIComponent(recording.startUrl)}" > /dev/null
sleep 2
`;

  for (const event of events) {
    script += generateBashEvent(event);
  }

  script += `
echo "Replay completed!"
`;

  return script;
}

function generateBashEvent(event: RecordingEvent): string {
  switch (event.type) {
    case 'click':
      return `# Click: ${event.selector}
curl -s "$CDP_URL/json/execute" -d '{
  "method": "Runtime.evaluate",
  "params": { "expression": "document.querySelector('${escapeString(event.selector || 'body')}').click()" }
}' > /dev/null
sleep 0.1
`;

    case 'type':
    case 'input':
      return `# Input: ${event.selector}
curl -s "$CDP_URL/json/execute" -d '{
  "method": "Runtime.evaluate",
  "params": { "expression": "document.querySelector('${escapeString(event.selector || 'input')}').value = '${escapeString(event.data?.value || '')}'" }
}' > /dev/null
sleep 0.1
`;

    default:
      return '';
  }
}

function aggregateEvents(events: RecordingEvent[]): RecordingEvent[] {
  const aggregated: RecordingEvent[] = [];
  let lastInput: RecordingEvent | null = null;

  for (const event of events) {
    if (event.type === 'input' || event.type === 'type') {
      lastInput = event;
    } else if (event.type === 'keydown' || event.type === 'keypress') {
      if (lastInput) {
        aggregated.push(lastInput);
        lastInput = null;
      }
      aggregated.push(event);
    } else {
      if (lastInput) {
        aggregated.push(lastInput);
        lastInput = null;
      }
      aggregated.push(event);
    }
  }

  if (lastInput) {
    aggregated.push(lastInput);
  }

  return aggregated;
}
