import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { XBMouseImpl } from '../../src/cdp-driver/mouse.js';
import { RuntimeEvaluationService } from '../../src/cdp-driver/page-runtime.js';
import { FrameInputService } from '../../src/cdp-driver/page-frame-input.js';

interface CapturedSend {
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
}

/** 捕获所有出站 CDP 命令的 mock 连接；handlers 按方法名返回预设响应 */
function createMockConn(handlers: Record<string, unknown> = {}) {
  const sends: CapturedSend[] = [];
  const conn = {
    send: vi.fn(async (method: string, params?: Record<string, unknown>, sessionId?: string) => {
      sends.push({ method, params: params ?? {}, sessionId });
      const h = handlers[method];
      if (typeof h === 'function') return h(params ?? {}, sessionId);
      if (h !== undefined) return h;
      return {};
    }),
    on: vi.fn(),
    off: vi.fn(),
  };
  return { conn, sends };
}

function createRuntimeService(conn: unknown) {
  return new RuntimeEvaluationService({
    conn: conn as never,
    sessionId: 'page-session',
    isClosed: () => false,
    url: () => 'https://example.com',
  });
}

describe('OOPIF frame input (buttons bitmask)', () => {
  const prevStealth = process.env.XBROWSER_STEALTH;

  beforeEach(() => {
    process.env.XBROWSER_STEALTH = 'off'; // 跳过拟人 sleep，序列形状保持确定
  });
  afterEach(() => {
    if (prevStealth === undefined) delete process.env.XBROWSER_STEALTH;
    else process.env.XBROWSER_STEALTH = prevStealth;
  });

  it('drag 期间每条 mouseMoved 都带 buttons:1（OOPIF 滑块命门）', async () => {
    const { conn, sends } = createMockConn();
    const mouse = new XBMouseImpl(conn as never);
    await mouse.move(10, 10);
    await mouse.drag(100, 10, { steps: 3 });

    const press = sends.find((s) => s.params.type === 'mousePressed');
    expect(press?.params.buttons).toBe(1);

    const moves = sends.filter((s) => s.params.type === 'mouseMoved');
    // drag 内部的 3 步 move（x: 40/70/100）全部带 buttons:1
    const dragMoves = moves.filter((s) => (s.params.x as number) > 10);
    expect(dragMoves.length).toBe(3);
    for (const m of dragMoves) expect(m.params.buttons).toBe(1);

    const release = sends.find((s) => s.params.type === 'mouseReleased');
    expect(release?.params.buttons).toBe(1);
  });

  it('up 之后 move 恢复 buttons:0（位掩码正确清位）', async () => {
    const { conn, sends } = createMockConn();
    const mouse = new XBMouseImpl(conn as never);
    await mouse.move(5, 5);
    await mouse.down({ button: 'left' });
    await mouse.move(20, 5);
    await mouse.up({ button: 'left' });
    await mouse.move(30, 5);

    const downEvents = sends.filter((s) => s.params.type === 'mousePressed');
    expect(downEvents[downEvents.length - 1].params.buttons).toBe(1);
    const heldMove = sends.filter((s) => s.params.type === 'mouseMoved' && s.params.x === 20);
    expect(heldMove[0].params.buttons).toBe(1);
    const afterUp = sends.filter((s) => s.params.type === 'mouseMoved' && s.params.x === 30);
    expect(afterUp[0].params.buttons).toBe(0);
  });
});

describe('OOPIF frame session resolution', () => {
  it('resolveFrameSession 走路径 A：Target.getTargets → attachToTarget（浏览器级，无 sessionId）', async () => {
    const { conn, sends } = createMockConn({
      'Target.getTargets': {
        targetInfos: [
          { targetId: 'T-page', type: 'page', url: 'https://wx.mail.qq.com/' },
          { targetId: 'T-captcha', type: 'iframe', url: 'https://captcha.gtimg.com/static/template/drag_ele.html' },
        ],
      },
      'Target.attachToTarget': { sessionId: 'frame-sess-1' },
      // href 验证探针：返回候选 target 自己的 URL（证明是活目标）
      'Runtime.evaluate': (_params: Record<string, unknown>) => ({
        result: { value: 'https://captcha.gtimg.com/static/template/drag_ele.html' },
      }),
    });
    const svc = createRuntimeService(conn);
    const sessionId = await svc.resolveFrameSession('captcha.gtimg.com');
    expect(sessionId).toBe('frame-sess-1');

    const attach = sends.find((s) => s.method === 'Target.attachToTarget');
    expect(attach?.params).toEqual({ targetId: 'T-captcha', flatten: true });
    expect(attach?.sessionId).toBeUndefined(); // 浏览器级命令，不带 page session
  });

  it('resolveFrameSession 对同进程 frame 给出明确指引（普通 click/fill 即可）', async () => {
    const { conn } = createMockConn({
      'Target.getTargets': { targetInfos: [] },
      'Page.getFrameTree': {
        frameTree: {
          frame: { id: 'F-main', url: 'https://example.com/' },
          childFrames: [{ frame: { id: 'F-child', url: 'https://example.com/embed' } }],
        },
      },
    });
    const svc = createRuntimeService(conn);
    await expect(svc.resolveFrameSession('example.com/embed')).rejects.toThrow(/同进程/);
  });

  it('resolveFrameSession 找不到任何 frame 时指向 frames 命令', async () => {
    const { conn } = createMockConn({
      'Target.getTargets': { targetInfos: [] },
      'Page.getFrameTree': { frameTree: { frame: { id: 'F-main', url: 'https://example.com/' } } },
    });
    const svc = createRuntimeService(conn);
    await expect(svc.resolveFrameSession('nowhere.example')).rejects.toThrow(/xbrowser frames/);
  });

  it('listFrameTargets 只返回 type=iframe 的 target', async () => {
    const { conn } = createMockConn({
      'Target.getTargets': {
        targetInfos: [
          { targetId: 'T-page', type: 'page', url: 'https://a.com/' },
          { targetId: 'T-1', type: 'iframe', url: 'https://captcha.gtimg.com/x.html' },
          { targetId: 'T-2', type: 'iframe', url: 'https://pay.example.com/y' },
        ],
      },
    });
    const svc = createRuntimeService(conn);
    const targets = await svc.listFrameTargets();
    expect(targets).toHaveLength(2);
    expect(targets[0]).toEqual({ url: 'https://captcha.gtimg.com/x.html', targetId: 'T-1' });
  });

  it('evaluateInFrame 路径 A 命中后评估并 detach（不泄漏 session）', async () => {
    const { conn, sends } = createMockConn({
      'Target.getTargets': { targetInfos: [{ targetId: 'T-1', type: 'iframe', url: 'https://cdn.example.com/w' }] },
      'Target.attachToTarget': { sessionId: 'frame-sess-9' },
      'Runtime.evaluate': (params: Record<string, unknown>) => ({
        // href 探针返回 target URL；业务表达式返回原定值
        result: { value: params.expression === 'location.href' ? 'https://cdn.example.com/w' : 'ok-in-frame' },
      }),
    });
    const svc = createRuntimeService(conn);
    const value = await svc.evaluateInFrame('cdn.example.com', 'document.title');
    expect(value).toBe('ok-in-frame');

    const evals = sends.filter((s) => s.method === 'Runtime.evaluate');
    expect(evals[evals.length - 1].sessionId).toBe('frame-sess-9');
    const detach = sends.find((s) => s.method === 'Target.detachFromTarget');
    expect(detach?.params).toEqual({ sessionId: 'frame-sess-9' });
  });
});

describe('FrameInputService (frameMouse cache + liveness re-attach)', () => {
  function createService() {
    const resolveFrameSession = vi.fn()
      .mockResolvedValueOnce('frame-sess-A')
      .mockResolvedValueOnce('frame-sess-B');
    const probes: Array<{ ok: boolean }> = [];
    const conn = {
      send: vi.fn(async (method: string, params?: Record<string, unknown>, sessionId?: string) => {
        if (method === 'Runtime.evaluate' && sessionId?.startsWith('frame-sess')) {
          const probe = probes[probes.length - 1];
          if (probe && !probe.ok) throw new Error('Session with given id not found');
          return { result: { value: 1 } };
        }
        if (method === 'Input.insertText') return {};
        return {};
      }),
      on: vi.fn(),
      off: vi.fn(),
    };
    const evaluateInFrame = vi.fn().mockResolvedValue(null);
    const svc = new FrameInputService({
      conn: conn as never,
      resolveFrameSession,
      evaluateInFrame: evaluateInFrame as never,
      evaluateMain: vi.fn().mockResolvedValue(null),
      pageMouse: { click: vi.fn().mockResolvedValue(undefined) } as never,
      pageKeyboard: { type: vi.fn().mockResolvedValue(undefined) } as never,
      frameTreeNodes: vi.fn().mockResolvedValue({ frame: { id: 'F0', url: 'about:blank' } }),
    });
    return { svc, resolveFrameSession, conn, probes, evaluateInFrame };
  }

  it('reuses the cached frame mouse while its session stays alive', async () => {
    const { svc, resolveFrameSession, probes } = createService();
    probes.push({ ok: true }, { ok: true });
    const m1 = await svc.frameMouse('captcha.gtimg.com');
    const m2 = await svc.frameMouse('captcha.gtimg.com');
    expect(m1).toBe(m2); // 同一实例 → 鼠标位置跨命令保持
    expect(resolveFrameSession).toHaveBeenCalledTimes(1);
  });

  it('re-attaches a fresh session after the cached one dies (iframe rebuilt)', async () => {
    const { svc, resolveFrameSession, probes } = createService();
    probes.push({ ok: true });
    await svc.frameMouse('captcha.gtimg.com');
    probes.push({ ok: false }); // session 探测失败
    await svc.frameMouse('captcha.gtimg.com');
    expect(resolveFrameSession).toHaveBeenCalledTimes(2);
  });

  it('fillInFrame inserts text on the frame session and reads back the value', async () => {
    const { svc, evaluateInFrame } = createService();
    evaluateInFrame.mockImplementation(async (_url: string, expr: string) => {
      if (expr.includes('querySelector')) {
        return expr.includes('.value') ? '403357' : { x: 10, y: 20, width: 100, height: 30 };
      }
      return null;
    });
    const result = await svc.fillInFrame('captcha.gtimg.com', '#sms', '403357', { timeoutMs: 300 });
    expect(result).toEqual({ value: '403357' });
  });
});
