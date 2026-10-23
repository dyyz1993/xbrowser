import { describe, it, expect, vi, beforeEach } from 'vitest';
// 回归（ERR-005）：daemon 转发的 [CDP-Guard] 拦截提示必须透传到 CLI 输出。
// 病灶：eval 的 emit 曾把 message 塞进 error 键（outputEnvelope 只认 message 键），
// 导致 error:null / "[FAIL] eval: undefined"，守卫的「替代用法」提示全部丢失。

const forwardExecMock = vi.fn();
const outputEnvelopeMock = vi.fn();
const printChainResultMock = vi.fn();

vi.mock('../../src/client/daemon-client.js', () => ({
  forwardExec: (...args: unknown[]) => forwardExecMock(...(args as [])),
}));
vi.mock('../../src/cli/output.js', () => ({
  outputEnvelope: (...args: unknown[]) => outputEnvelopeMock(...(args as [])),
}));
vi.mock('../../src/cli/chain-output.js', () => ({
  printChainResult: (...args: unknown[]) => printChainResultMock(...(args as [])),
}));

const GUARD_MSG =
  '[CDP-Guard] Event simulation detected: "el.click()". | 替代: Use page.click(selector). [event-simulation]';

describe('eval 守卫提示透传（daemon 转发路径）', () => {
  beforeEach(() => {
    forwardExecMock.mockReset();
    outputEnvelopeMock.mockReset();
    printChainResultMock.mockReset();
  });

  it('json 模式：失败 message 以 message 键进信封（信封再映射为 error 字段展示）', async () => {
    forwardExecMock.mockResolvedValue({ success: false, data: null, message: GUARD_MSG, duration: 0 });
    const { handleEvalScript } = await import('../../src/router/input-modes.js');
    await expect(
      handleEvalScript(['document.querySelector("button")?.click()'], ['--json']),
    ).rejects.toThrow('Command failed');
    expect(outputEnvelopeMock).toHaveBeenCalledTimes(1);
    const arg = outputEnvelopeMock.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.message).toBe(GUARD_MSG); // 关键回归点：message 键（不是 error 键）
    expect(arg.error).toBeUndefined();
    expect(arg.success).toBe(false);
  });

  it('text 模式：合成 chain step 带 message，[FAIL] 行能打印守卫原因', async () => {
    forwardExecMock.mockResolvedValue({ success: false, data: null, message: GUARD_MSG, duration: 0 });
    const { handleEvalScript } = await import('../../src/router/input-modes.js');
    await expect(
      handleEvalScript(['document.querySelector("button")?.click()'], []),
    ).rejects.toThrow('Command failed');
    expect(printChainResultMock).toHaveBeenCalledTimes(1);
    const steps = (printChainResultMock.mock.calls[0][0] as { steps: Array<Record<string, unknown>> }).steps;
    expect(steps[0].message).toBe(GUARD_MSG); // 关键回归点：text 分支 step.message
  });

  it('成功结果不受影响（message 为空）', async () => {
    forwardExecMock.mockResolvedValue({ success: true, data: { result: 2 }, duration: 3 });
    const { handleEvalScript } = await import('../../src/router/input-modes.js');
    await handleEvalScript(['1+1'], ['--json']);
    const arg = outputEnvelopeMock.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.success).toBe(true);
    expect(arg.message).toBeUndefined();
  });
});
