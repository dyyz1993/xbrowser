import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock site-knowledge module
vi.mock('../../src/recorder/site-knowledge.js', () => ({
  listSiteKnowledge: vi.fn(),
  readSiteKnowledgeMarkdown: vi.fn(),
  readSiteKnowledge: vi.fn(),
  addKnownIssue: vi.fn(),
  getKnowledgePath: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, existsSync: vi.fn(() => true) };
});

import { knowledgeBuiltin } from '../../src/builtins/knowledge.js';
import {
  listSiteKnowledge,
  readSiteKnowledgeMarkdown,
  readSiteKnowledge,
  addKnownIssue,
  getKnowledgePath,
} from '../../src/recorder/site-knowledge.js';

const mockListSiteKnowledge = listSiteKnowledge as unknown as ReturnType<typeof vi.fn>;
const mockReadMd = readSiteKnowledgeMarkdown as unknown as ReturnType<typeof vi.fn>;
const mockReadKb = readSiteKnowledge as unknown as ReturnType<typeof vi.fn>;
const mockAddIssue = addKnownIssue as unknown as ReturnType<typeof vi.fn>;
const mockGetPath = getKnowledgePath as unknown as ReturnType<typeof vi.fn>;

// Mock knowledge data matching the actual SiteKnowledge shape
const mockKnowledge = {
  domain: 'example.com',
  recordingCount: 3,
  pages: {
    '/post': {
      selectors: [
        { selector: '#title', tag: 'input', actionType: 'fill', confidence: 'high', timesSeen: 3, status: 'active', description: 'Title input' },
      ],
    },
  },
  apiEndpoints: {
    '/api/publish': { method: 'POST', path: '/api/publish', params: ['title', 'content'], responseFields: ['id'], timesSeen: 2 },
  },
};

describe('knowledge builtin', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`EXIT_${code}`);
    }) as never);
  });

  it('should list domains', async () => {
    mockListSiteKnowledge.mockReturnValue(['example.com']);
    mockReadKb.mockReturnValue(mockKnowledge);
    await knowledgeBuiltin.execute(['list'], {}, {} as never);
    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('example.com');
  });

  it('should show message when no domains exist', async () => {
    mockListSiteKnowledge.mockReturnValue([]);
    await knowledgeBuiltin.execute(['list'], {}, {} as never);
    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('No site knowledge');
  });

  it('should default to list when no subcommand', async () => {
    mockListSiteKnowledge.mockReturnValue(['example.com']);
    mockReadKb.mockReturnValue(mockKnowledge);
    await knowledgeBuiltin.execute([], {}, {} as never);
    expect(mockListSiteKnowledge).toHaveBeenCalled();
  });

  it('should show markdown for a domain', async () => {
    mockReadMd.mockReturnValue('# Example Knowledge');
    await knowledgeBuiltin.execute(['show', 'example.com'], {}, {} as never);
    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('Example Knowledge');
  });

  it('should exit when show domain has no knowledge', async () => {
    mockReadMd.mockReturnValue('');
    await expect(knowledgeBuiltin.execute(['show', 'unknown.com'], {}, {} as never))
      .rejects.toThrow('EXIT_1');
  });

  it('should list selectors for a domain', async () => {
    mockReadKb.mockReturnValue(mockKnowledge);
    await knowledgeBuiltin.execute(['selectors', 'example.com'], {}, {} as never);
    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('#title');
  });

  it('should list API endpoints for a domain', async () => {
    mockReadKb.mockReturnValue(mockKnowledge);
    await knowledgeBuiltin.execute(['api', 'example.com'], {}, {} as never);
    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('/api/publish');
  });

  it('should add a known issue', async () => {
    mockReadKb.mockReturnValue(mockKnowledge);
    mockAddIssue.mockReturnValue(true);
    await knowledgeBuiltin.execute(['issue', 'example.com', 'Title', 'selector', 'changed'], {}, {} as never);
    expect(mockAddIssue).toHaveBeenCalled();
  });

  it('should show path for a domain', async () => {
    mockGetPath.mockReturnValue('/home/.xbrowser/knowledge/example.com.md');
    await knowledgeBuiltin.execute(['path', 'example.com'], {}, {} as never);
    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('knowledge/example.com.md');
  });

  it('should exit when show has no domain arg', async () => {
    await expect(knowledgeBuiltin.execute(['show'], {}, {} as never))
      .rejects.toThrow('EXIT_1');
  });
});
