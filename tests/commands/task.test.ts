import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  creds: vi.fn(() => ({ apiKey: 'test-key', baseURL: 'https://mock.vlm', model: 'test-model' })),
  vlm: vi.fn(),
  observe: vi.fn(),
  act: vi.fn(),
}));

vi.mock('../../src/commands/vision-task.js', () => ({
  loadVLMCredentials: mocks.creds,
  vlmAsk: mocks.vlm,
  vlmAskRetry: mocks.vlm,
}));

vi.mock('../../src/runtime/agent-runtime.js', () => ({
  observePage: mocks.observe,
  actOnPage: mocks.act,
  waitForPage: vi.fn(),
  buildSelectorMap: vi.fn(),
  formatObservationCompact: vi.fn(),
}));

import { taskCommand as plugin } from '../../src/commands/task.js';

type TaskHandlerResult = {
  success?: boolean;
  error?: string;
  data: { status?: string; summary?: string; steps?: Array<{ error?: string }>; usage?: { llmCalls: number } };
};
const cmd = plugin as unknown as {
  name: string;
  parameters: { shape: Record<string, unknown> };
  handler: (p: Record<string, unknown>, ctx: unknown) => Promise<TaskHandlerResult>;
};

function makeTarget(i: number) {
  return { ref: `e${i}`, tag: 'button', name: `target ${i}`, actions: ['click'] };
}
function mockObservation(screenHash = 'h1', n = 3) {
  return {
    targets: Array.from({ length: n }, (_, i) => makeTarget(i + 1)),
    screenHash,
    url: 'file:///target.html',
  };
}
const ctx = { page: { url: () => 'file:///target.html' }, sessionId: 's1' };

describe('task command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.creds.mockReturnValue({ apiKey: 'test-key', baseURL: 'https://mock.vlm', model: 'test-model' });
    mocks.observe.mockResolvedValue(mockObservation());
    mocks.act.mockResolvedValue({ success: true, action: 'click', selector: '#x', ref: 'e1' });
  });

  it('registers with name task and goal/maxSteps params', () => {
    expect(cmd.name).toBe('task');
    expect(Object.keys(cmd.parameters.shape)).toContain('goal');
    expect(Object.keys(cmd.parameters.shape)).toContain('maxSteps');
  });

  it('returns done when LLM immediately judges done', async () => {
    mocks.vlm.mockResolvedValue('{"action":"done","value":"already complete"}');
    const r = await cmd.handler({ goal: 'g', maxSteps: 5 }, ctx);
    expect(r.data.status).toBe('done');
    expect(r.data.summary).toBe('already complete');
    expect((r.data.usage as { llmCalls: number }).llmCalls).toBe(1);
    expect(mocks.act).not.toHaveBeenCalled();
  });

  it('executes fill then done across turns', async () => {
    mocks.vlm
      .mockResolvedValueOnce('{"action":"fill","ref":"@e1","value":"v1","thought":"fill it"}')
      .mockResolvedValueOnce('{"action":"done","value":"ok"}');
    const r = await cmd.handler({ goal: 'g', maxSteps: 5 }, ctx);
    expect(r.data.status).toBe('done');
    expect(mocks.act).toHaveBeenCalledWith(expect.anything(), 's1', expect.objectContaining({ action: 'fill', ref: '@e1', value: 'v1' }));
  });

  it('marks blocked on dead loop: identical action repeated 3 times', async () => {
    mocks.vlm.mockResolvedValue('{"action":"click","ref":"@e1","thought":"try"}');
    const r = await cmd.handler({ goal: 'g', maxSteps: 10 }, ctx);
    expect(r.data.status).toBe('blocked');
    expect((r.data.summary ?? '').includes('dead loop')).toBe(true);
    expect(mocks.act).toHaveBeenCalledTimes(3);
  });

  it('rejects refs outside current observation without executing', async () => {
    mocks.vlm.mockResolvedValue('{"action":"click","ref":"@e99","thought":"guess"}');
    const r = await cmd.handler({ goal: 'g', maxSteps: 2 }, ctx);
    expect(mocks.act).not.toHaveBeenCalled();
    expect(r.data.steps?.[0]?.error).toContain('not in current list');
  });

  it('marks blocked when LLM output is unparsable', async () => {
    mocks.vlm.mockResolvedValue('sorry I cannot');
    const r = await cmd.handler({ goal: 'g', maxSteps: 5 }, ctx);
    expect(r.data.status).toBe('blocked');
    expect((r.data.summary ?? '').includes('unparsable')).toBe(true);
  });

  it('fails fast without model credentials', async () => {
    mocks.creds.mockReturnValueOnce(null as unknown as { apiKey: string; baseURL: string; model: string });
    const r = await cmd.handler({ goal: 'g', maxSteps: 5 }, ctx);
    expect(r.success).toBe(false);
  });
});
