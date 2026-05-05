import type { Core } from '@dyyz1993/xcli-core';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

interface BrowserState {
  browser: Browser | null;
  context: BrowserContext | null;
  page: Page | null;
}

const state: BrowserState = {
  browser: null,
  context: null,
  page: null,
};

export async function ensureBrowser(): Promise<Page> {
  if (state.page) return state.page;

  state.browser = await chromium.launch({ headless: true });
  state.context = await state.browser.newContext();
  state.page = await state.context.newPage();

  return state.page;
}

export async function closeBrowser(): Promise<void> {
  await state.page?.close();
  await state.context?.close();
  await state.browser?.close();

  state.page = null;
  state.context = null;
  state.browser = null;
}

export function loadBrowserPlugin(_app: Core): void {
  // Register browser commands here
  // Example:
  // const site = app.loader.createSite({ name: 'browser', url: '' });
  // site.command('open', { ... });
}
