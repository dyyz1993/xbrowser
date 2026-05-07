import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/commands/command-registry.js', () => ({
  registerCommand: vi.fn((def) => ({
    name: def.name,
    description: def.description,
    scope: def.scope,
    parameters: def.parameters,
    handler: def.handler,
  })),
}));

import { htmlCommand, textCommand, getPropertyCommand } from '../../src/commands/query.js';

describe('query commands', () => {
  const makeCtx = (pageOverrides: Record<string, unknown> = {}) => ({
    page: {
      innerHTML: vi.fn().mockResolvedValue('<div>hello</div>'),
      content: vi.fn().mockResolvedValue('<html><body>full</body></html>'),
      textContent: vi.fn().mockResolvedValue('hello text'),
      evaluate: vi.fn().mockResolvedValue('body text'),
      getAttribute: vi.fn().mockResolvedValue('attr-value'),
      ...pageOverrides,
    },
    browser: {},
    browserContext: {},
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should register html command', () => {
    expect(htmlCommand.name).toBe('html');
    expect(htmlCommand.scope).toBe('page');
  });

  it('should register text command', () => {
    expect(textCommand.name).toBe('text');
    expect(textCommand.scope).toBe('page');
  });

  it('should register getProperty command', () => {
    expect(getPropertyCommand.name).toBe('getProperty');
    expect(getPropertyCommand.scope).toBe('element');
  });

  it('html command should get inner HTML for selector', async () => {
    const ctx = makeCtx();
    const result = await htmlCommand.handler({ selector: '#main' }, ctx as any);
    expect(result.data).toEqual({ html: '<div>hello</div>' });
    expect(result.success).toBe(true);
    expect(ctx.page.innerHTML).toHaveBeenCalledWith('#main');
  });

  it('html command should get full page content when no selector', async () => {
    const ctx = makeCtx();
    const result = await htmlCommand.handler({}, ctx as any);
    expect(result.data).toEqual({ html: '<html><body>full</body></html>' });
    expect(ctx.page.content).toHaveBeenCalled();
  });

  it('text command should get text content for selector', async () => {
    const ctx = makeCtx();
    const result = await textCommand.handler({ selector: '#content' }, ctx as any);
    expect(result.data).toEqual({ text: 'hello text' });
    expect(ctx.page.textContent).toHaveBeenCalledWith('#content');
  });

  it('text command should return empty string when textContent is null', async () => {
    const ctx = makeCtx({ textContent: vi.fn().mockResolvedValue(null) });
    const result = await textCommand.handler({ selector: '#empty' }, ctx as any);
    expect(result.data).toEqual({ text: '' });
  });

  it('text command should get body text when no selector', async () => {
    const ctx = makeCtx();
    const result = await textCommand.handler({}, ctx as any);
    expect(result.data).toEqual({ text: 'body text' });
    expect(ctx.page.evaluate).toHaveBeenCalled();
  });

  it('getProperty command should get attribute value', async () => {
    const ctx = makeCtx();
    const result = await getPropertyCommand.handler(
      { selector: '#link', property: 'href' },
      ctx as any
    );
    expect(result.data).toEqual({ property: 'href', selector: '#link', value: 'attr-value' });
    expect(result.success).toBe(true);
    expect(ctx.page.getAttribute).toHaveBeenCalledWith('#link', 'href');
  });

  it('getProperty command should return null value when attribute not found', async () => {
    const ctx = makeCtx({ getAttribute: vi.fn().mockResolvedValue(null) });
    const result = await getPropertyCommand.handler(
      { selector: '#missing', property: 'data-id' },
      ctx as any
    );
    expect(result.data).toEqual({ property: 'data-id', selector: '#missing', value: null });
  });

  it('html command parameters should accept optional selector', () => {
    expect(htmlCommand.parameters).toBeDefined();
    const schema = htmlCommand.parameters!;
    const result = schema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('getProperty command parameters should require selector and property', () => {
    const schema = getPropertyCommand.parameters!;
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
    const validResult = schema.safeParse({ selector: '#el', property: 'href' });
    expect(validResult.success).toBe(true);
  });
});
