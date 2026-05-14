import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/twitter/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

describe('twitter plugin', () => {
  beforeEach(() => { vi.clearAllMocks(); plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]); });

  it('should create site with correct config', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'twitter', url: 'https://x.com' }));
  });

  it('should register 5 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(5);
  });

  it('should register expected commands', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(['search', 'profile', 'timeline', 'replies', 'liked']);
  });

  it.each([
    ['search', '搜索'],
    ['profile', '用户资料'],
    ['timeline', '最新推文'],
    ['replies', '回复'],
    ['liked', '点赞'],
  ])('%s should have description', (name, keyword) => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
    expect(cmd[1].description).toContain(keyword);
  });

  it('timeline should have views/bookmarks description', () => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'timeline');
    expect(cmd[1].description).toContain('views');
  });

  it('should have login and logout', () => {
    expect(mockSite.login).toHaveBeenCalled();
    expect(mockSite.logout).toHaveBeenCalled();
  });
});
