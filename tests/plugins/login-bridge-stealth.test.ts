import { describe, it, expect } from 'vitest';
// UMD 模块：ESM interop 直接 default 导入（vite 预打包 cjs）
import StealthCommon from '../../.xcli/plugins/login-bridge/extension/stealth-common.cjs';

describe('stealth-common（S164 桥任务 tab 反检测纯逻辑）', () => {
  describe('VISIBILITY_STEALTH_SOURCE（L1 可见性一致性）', () => {
    const src = StealthCommon.VISIBILITY_STEALTH_SOURCE;

    it('should be a non-empty IIFE source string', () => {
      expect(typeof src).toBe('string');
      expect(src.length).toBeGreaterThan(200);
      expect(src.trim().startsWith('(function()')).toBe(true);
    });

    it('should override visibilityState and webkit variant to visible', () => {
      expect(src).toContain('"visibilityState"');
      expect(src).toContain('"webkitVisibilityState"');
      expect(src).toContain('return "visible"');
    });

    it('should override hidden and webkitHidden to false', () => {
      expect(src).toContain('"hidden"');
      expect(src).toContain('"webkitHidden"');
      expect(src).toContain('return false');
    });

    it('should make hasFocus return true', () => {
      expect(src).toContain('document.hasFocus = function () { return true; }');
    });

    it('should re-assert on visibilitychange (coherence guard)', () => {
      expect(src).toContain('"visibilitychange"');
      expect(src).toContain('assert()');
    });

    it('should shim requestAnimationFrame (hidden-tab silence)', () => {
      expect(src).toContain('window.requestAnimationFrame =');
      expect(src).toContain('performance.now()');
    });

    it('should be idempotent (guard flag)', () => {
      expect(src).toContain('__xbVisStealth');
    });

    it('should patch Document.prototype (S169: prototype escape)', () => {
      // 实例覆写可被 getOwnPropertyDescriptor(Document.prototype,...).get.call(document) 逃逸
      expect(src).toContain('patch(Document.prototype)');
      expect(src).toContain('patch(document)');
    });

    it('should disguise getter toString as native (S169)', () => {
      expect(src).toContain('[native code]');
      expect(src).toContain('nativeize');
    });

    it('should be syntactically valid JS', () => {
      expect(() => {
        new Function(src);
      }).not.toThrow();
    });
  });

  describe('generateMousePath（L2 轨迹生成）', () => {
    it('should return steps+5 points (overshoot correction tail)', () => {
      const pts = StealthCommon.generateMousePath({ fromX: 0, fromY: 0, toX: 400, toY: 200, steps: 30 });
      expect(pts).toHaveLength(35); // 30 + 5 修回步
    });

    it('should land exactly on target (overshoot corrected)', () => {
      const pts = StealthCommon.generateMousePath({ fromX: 100, fromY: 100, toX: 500, toY: 300 });
      const last = pts[pts.length - 1];
      expect(last).toEqual({ x: 500, y: 300 });
    });

    it('should stay finite and integer', () => {
      const pts = StealthGenerate(10, 10, 900, 600, 48);
      for (const p of pts) {
        expect(Number.isInteger(p.x)).toBe(true);
        expect(Number.isInteger(p.y)).toBe(true);
      }
      function StealthGenerate(fx: number, fy: number, tx: number, ty: number, steps: number) {
        return StealthCommon.generateMousePath({ fromX: fx, fromY: fy, toX: tx, toY: ty, steps });
      }
    });

    it('should show overshoot beyond target before correction', () => {
      const pts = StealthCommon.generateMousePath({ fromX: 0, fromY: 0, toX: 600, toY: 0, steps: 50, overshoot: 0.06 });
      const max = Math.max(...pts.map((p: { x: number }) => p.x));
      expect(max).toBeGreaterThan(600); // 过冲段越过目标
      expect(max).toBeLessThan(660); // 但不至于离谱
    });

    it('should jitter nearby points (bursty, not uniform)', () => {
      const pts = StealthCommon.generateMousePath({ fromX: 0, fromY: 0, toX: 800, toY: 400, steps: 60 });
      // 相邻点距离不全等 —— 匀速直线是机器人签名
      const deltas: number[] = [];
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i].x - pts[i - 1].x;
        const dy = pts[i].y - pts[i - 1].y;
        deltas.push(Math.sqrt(dx * dx + dy * dy));
      }
      const uniq = new Set(deltas.map((d) => Math.round(d * 10)));
      expect(uniq.size).toBeGreaterThan(5);
    });

    it('should handle zero-distance (degenerate)', () => {
      const pts = StealthCommon.generateMousePath({ fromX: 50, fromY: 50, toX: 50, toY: 50, steps: 10 });
      expect(pts.length).toBeGreaterThan(0);
      expect(pts.every((p: { x: number; y: number }) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    });
  });

  describe('planWarmup（L2 预热序列）', () => {
    it('should produce move/pause/wheel actions', () => {
      const acts = StealthCommon.planWarmup({ w: 1280, h: 720, ms: 3000 });
      const types = new Set(acts.map((a: { type: string }) => a.type));
      expect(types.has('move')).toBe(true);
      expect(types.has('pause')).toBe(true);
      expect(types.has('wheel')).toBe(true);
    });

    it('should keep all moves inside viewport', () => {
      const acts = StealthCommon.planWarmup({ w: 1280, h: 720, ms: 2500 });
      const moves = acts.filter((a: { type: string }) => a.type === 'move');
      expect(moves.length).toBeGreaterThan(50);
      for (const m of moves) {
        expect(m.x).toBeGreaterThanOrEqual(0);
        expect(m.x).toBeLessThanOrEqual(1280);
        expect(m.y).toBeGreaterThanOrEqual(0);
        expect(m.y).toBeLessThanOrEqual(720);
      }
    });

    it('should end with a wheel (reading feel)', () => {
      const acts = StealthCommon.planWarmup({ w: 1280, h: 720, ms: 3000 });
      const lastNonPause = [...acts].reverse().find((a: { type: string }) => a.type !== 'pause');
      expect(lastNonPause.type).toBe('wheel');
    });

    it('should scale move count with budget', () => {
      const short = StealthCommon.planWarmup({ w: 1280, h: 720, ms: 600 });
      const long = StealthCommon.planWarmup({ w: 1280, h: 720, ms: 5000 });
      const movesOf = (a: unknown[]) => a.filter((x) => x.type === 'move').length;
      expect(movesOf(long)).toBeGreaterThan(movesOf(short));
    });

    it('should use positive delays everywhere', () => {
      const acts = StealthCommon.planWarmup({ w: 1280, h: 720, ms: 2000 });
      for (const a of acts) {
        expect(a.delay).toBeGreaterThan(0);
      }
    });
  });
});
