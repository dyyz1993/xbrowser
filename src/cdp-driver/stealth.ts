/**
 * stealth.ts — Behavioral stealth layer for CDP driver
 *
 * Enhances mouse/keyboard with human-like patterns:
 *   • Bezier trajectory with cosine easing + noise + overshoot correction
 *   • Landing offset from element center (no dead-center clicks)
 *   • Press/release drift (finger micro-movement)
 *   • Three-tier typing rhythm with random pauses
 *   • Typo + backspace correction
 *   • Wheel exponential decay (momentum)
 *
 * Also provides init script for page-level stealth hooks:
 *   • AEL event proxy (sourceCapabilities / isTrusted / coordinate floatification)
 *   • onclick prototype hijack (dual-stream consistency)
 *   • Screen/hasFocus override + toString disguise
 *
 * 124 rounds of attack-defense validated (output/cdp-duel-s5/)
 */

import type { CDPConnection } from './connection.js';

// ============================================================
// Types
// ============================================================

export interface StealthConfig {
  /** Bezier curvature range [min, max] as fraction of distance */
  bezierCurvature: [number, number];
  /** Trajectory noise amplitude ±px */
  noiseAmplitude: number;
  /** Overshoot distance range [min, max] px */
  overshootRange: [number, number];
  /** Aim pause before click [min, max] ms */
  aimPause: [number, number];
  /** Press duration [min, max] ms */
  pressDuration: [number, number];
  /** Release coordinate drift [min, max] px */
  releaseDrift: [number, number];
  /** Landing offset for small elements [min, max] px */
  landingOffsetSmall: [number, number];
  /** Landing offset for large elements [min, max] px */
  landingOffsetLarge: [number, number];
  /** Elements smaller than this (px) use small offset */
  smallElementThreshold: number;
  /** Typing rhythm probabilities */
  typingRhythm: {
    fastProb: number; fastRange: [number, number];
    normalRange: [number, number];
    pauseProb: number; pauseRange: [number, number];
  };
  /** Key press duration [min, max] ms */
  keyPressDuration: [number, number];
  /** Typo probability per field (0-1) */
  typoProbability: number;
  /** Wheel peak delta */
  wheelPeak: number;
  /** Wheel decay rate */
  wheelDecayRate: number;
}

export const DEFAULT_STEALTH_CONFIG: StealthConfig = {
  bezierCurvature: [0.35, 0.6],
  noiseAmplitude: 5.5,
  overshootRange: [6, 14],
  aimPause: [150, 400],
  pressDuration: [60, 140],
  releaseDrift: [0.8, 2.5],
  landingOffsetSmall: [0.3, 2.5],
  landingOffsetLarge: [1.5, 7],
  smallElementThreshold: 30,
  typingRhythm: {
    fastProb: 0.22, fastRange: [25, 60],
    normalRange: [50, 350],
    pauseProb: 0.18, pauseRange: [400, 1200],
  },
  keyPressDuration: [50, 110],
  typoProbability: 0.06,
  wheelPeak: 180,
  wheelDecayRate: 0.4,
};

// ============================================================
// Utility functions
// ============================================================

export function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Cosine easing for non-uniform parameter sampling */
export function cosineEase(t: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * t);
}

/**
 * Generate a bezier trajectory point list from (x0,y0) to (x1,y1)
 * Uses cubic bezier with random control points + noise + overshoot correction
 */
export function bezierTrajectory(
  x0: number, y0: number, x1: number, y1: number,
  config: StealthConfig = DEFAULT_STEALTH_CONFIG,
): Array<{ x: number; y: number; delay: number }> {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(10, Math.min(28, Math.round(dist / 15)));

  // Random arc direction and curvature
  const curvature = Math.max(dist * rand(...config.bezierCurvature), rand(18, 35));
  const dir = Math.random() < 0.5 ? 1 : -1;
  const d = dist || 1;
  const dx = x1 - x0, dy = y1 - y0;

  // Control points perpendicular to the line
  const c1x = x0 + dx * 0.3 - (dy / d) * curvature * 0.5 * dir;
  const c1y = y0 + dy * 0.3 + (dx / d) * curvature * 0.5 * dir;
  const c2x = x0 + dx * 0.7 - (dy / d) * curvature * 0.8 * dir;
  const c2y = y0 + dy * 0.7 + (dx / d) * curvature * 0.8 * dir;

  const points: Array<{ x: number; y: number; delay: number }> = [];

  for (let i = 1; i <= n; i++) {
    // Cosine easing for non-uniform parameter sampling (breaks spatial equidistance)
    const t = cosineEase(i / n);
    const mt = 1 - t;

    let px = mt ** 3 * x0 + 3 * mt * 2 * t * c1x + 3 * mt * t ** 2 * c2x + t ** 3 * x1;
    let py = mt ** 3 * y0 + 3 * mt * 2 * t * c1y + 3 * mt * t ** 2 * c2y + t ** 3 * y1;

    // Add noise
    px += rand(-config.noiseAmplitude, config.noiseAmplitude);
    py += rand(-config.noiseAmplitude, config.noiseAmplitude);

    points.push({ x: px, y: py, delay: rand(9, 16) });
  }

  // Overshoot + correction (overshoot-correction pattern)
  const over = rand(...config.overshootRange);
  const ox = x1 + (dx / d) * over + rand(-2, 2);
  const oy = y1 + (dy / d) * over + rand(-2, 2);
  points.push({ x: ox, y: oy, delay: rand(14, 30) });
  points.push({
    x: x1 + (dx / d) * over * 0.4,
    y: y1 + (dy / d) * over * 0.4,
    delay: rand(14, 30),
  });
  points.push({ x: x1 + rand(-1, 1), y: y1 + rand(-1, 1), delay: rand(14, 30) });

  return points;
}

/**
 * Get a random landing point offset from element center
 * Small elements get narrow offsets, large elements get wide offsets
 */
export function landingOffset(
  width: number, height: number,
  config: StealthConfig = DEFAULT_STEALTH_CONFIG,
): { dx: number; dy: number } {
  const isSmall = Math.min(width, height) < config.smallElementThreshold;
  const range = isSmall ? config.landingOffsetSmall : config.landingOffsetLarge;
  const dx = rand(...range) * (Math.random() < 0.5 ? -1 : 1);
  const dy = rand(...range) * (Math.random() < 0.5 ? -1 : 1);
  return { dx, dy };
}

/**
 * Get a typing delay based on three-tier rhythm distribution
 */
export function typingDelay(
  config: StealthConfig = DEFAULT_STEALTH_CONFIG,
): number {
  const roll = Math.random();
  const r = config.typingRhythm;
  if (roll < r.pauseProb) return rand(...r.pauseRange);
  if (roll < r.pauseProb + r.fastProb) return rand(...r.fastRange);
  return rand(...r.normalRange);
}

/**
 * Calculate wheel delta with exponential decay
 */
export function wheelDelta(
  step: number,
  config: StealthConfig = DEFAULT_STEALTH_CONFIG,
): number {
  return Math.round(
    config.wheelPeak *
    Math.exp(-step * config.wheelDecayRate) *
    rand(0.85, 1.15)
  );
}

// ============================================================
// Key metadata lookup
// ============================================================

const KEY_MAP: Record<string, { key: string; code: string; vk: number; shift?: boolean }> = {};

// Letters
for (let i = 97; i <= 122; i++) {
  const ch = String.fromCharCode(i);
  KEY_MAP[ch] = { key: ch, code: 'Key' + ch.toUpperCase(), vk: i - 32 };
}
// Uppercase letters
for (let i = 65; i <= 90; i++) {
  const ch = String.fromCharCode(i);
  KEY_MAP[ch] = { key: ch, code: 'Key' + ch, vk: i, shift: true };
}
// Digits
for (let i = 48; i <= 57; i++) {
  const ch = String.fromCharCode(i);
  KEY_MAP[ch] = { key: ch, code: 'Digit' + ch, vk: i };
}
// Special characters
Object.assign(KEY_MAP, {
  ' ': { key: ' ', code: 'Space', vk: 32 },
  '.': { key: '.', code: 'Period', vk: 190 },
  '-': { key: '-', code: 'Minus', vk: 189 },
  '@': { key: '@', code: 'Digit2', vk: 50, shift: true },
  '_': { key: '_', code: 'Minus', vk: 189, shift: true },
});

export function lookupKey(ch: string): { key: string; code: string; vk: number; shift?: boolean } | undefined {
  return KEY_MAP[ch];
}

// ============================================================
// Stealth init script (injected before page scripts via addScriptToEvaluateOnNewDocument)
// ============================================================

export function buildStealthInitScript(): string {
  return [
    '(function(){',
    // 1. AEL event proxy
    '  var o=EventTarget.prototype.addEventListener;',
    '  var fc=new InputDeviceCapabilities({firesTouchEvents:false});',
    '  var _ael=function(t,f){',
    '    var op=arguments[2];',
    '    if(typeof f!=="function")return o.call(this,t,f,op);',
    '    var w=function(e){',
    '      if(!e||e.constructor===FocusEvent||e.constructor===KeyboardEvent)return f.call(this,e);',
    '      return f.call(this,new Proxy(e,{get:function(k,p){',
    '        if(p==="sourceCapabilities")return fc;',
    '        if(p==="isTrusted")return true;',
    '        if((p==="clientX"||p==="clientY")&&k.type==="click"&&Number.isFinite(k[p])){',
    '          var _f=((k.timeStamp||Date.now())%89)/89*0.7+0.15;',
    '          return k[p]+_f;',
    '        }',
    '        var v=Reflect.get(k,p);return typeof v==="function"?v.bind(k):v;',
    '      }}));',
    '    };',
    '    return o.call(this,t,w,op);',
    '  };',
    '  EventTarget.prototype.addEventListener=_ael;',
    // 2. Screen override (prototype-level, not instance-level)
    '  var _gw=function(){return 1728};',
    '  var _gh=function(){return 1117};',
    '  var _gah=function(){return 1092};',
    '  Object.defineProperty(Screen.prototype,"width",{get:_gw,configurable:true});',
    '  Object.defineProperty(Screen.prototype,"height",{get:_gh,configurable:true});',
    '  Object.defineProperty(Screen.prototype,"availWidth",{get:_gw,configurable:true});',
    '  Object.defineProperty(Screen.prototype,"availHeight",{get:_gah,configurable:true});',
    '  document.hasFocus=function(){return true};',
    // 3. toString disguise (name-list based)
    '  var _ts=Function.prototype.toString;',
    '  var _hf=document.hasFocus;',
    '  Function.prototype.toString=function(){',
    '    if(this===_ael)return"function addEventListener(type, callback) { [native code] }";',
    '    if(this===_hf)return"function hasFocus() { [native code] }";',
    '    if(this===_gw)return"function get width() { [native code] }";',
    '    if(this===_gh)return"function get height() { [native code] }";',
    '    if(this===_gah)return"function get availHeight() { [native code] }";',
    '    return _ts.call(this);',
    '  };',
    // 4. onclick prototype hijack (dual-stream consistency)
    '  var _ba=function(k,p){',
    '    if(p==="isTrusted")return true;',
    '    if((p==="clientX"||p==="clientY")&&k.type==="click"&&Number.isFinite(k[p])){',
    '      var _f=((k.timeStamp||Date.now())%89)/89*0.7+0.15;return k[p]+_f;',
    '    }',
    '    var v=Reflect.get(k,p);return typeof v==="function"?v.bind(k):v;',
    '  };',
    '  Object.defineProperty(Document.prototype,"onclick",{',
    '    configurable:true,',
    '    get:function(){var raw=this.__ocRaw||null;if(!raw)return null;var self=this;',
    '      return function(e){return raw.call(self,new Proxy(e,{get:function(k,p){return _ba(k,p)}}))}},',
    '    set:function(fn){this.__ocRaw=fn}',
    '  });',
    '})()',
  ].join('\n');
}

// ============================================================
// Stealth injector (manages init script lifecycle)
// ============================================================

export class StealthInjector {
  private conn: CDPConnection;
  private sessionId: string | undefined;
  private scriptIdentifier: string | undefined;
  private _enabled = false;

  constructor(conn: CDPConnection, sessionId?: string) {
    this.conn = conn;
    this.sessionId = sessionId;
  }

  get enabled(): boolean {
    return this._enabled;
  }

  /** Inject stealth hooks (call BEFORE Page.navigate) */
  async inject(): Promise<void> {
    if (this._enabled) return;
    const result = await this.conn.send(
      'Page.addScriptToEvaluateOnNewDocument',
      { source: buildStealthInitScript() },
      this.sessionId,
    ) as { identifier: string };
    this.scriptIdentifier = result.identifier;
    this._enabled = true;
  }

  /** Remove stealth hooks */
  async remove(): Promise<void> {
    if (!this._enabled || !this.scriptIdentifier) return;
    await this.conn.send(
      'Page.removeScriptToEvaluateOnNewDocument',
      { identifier: this.scriptIdentifier },
      this.sessionId,
    ).catch(() => {
      // Ignore errors when removing (page may have navigated)
    });
    this.scriptIdentifier = undefined;
    this._enabled = false;
  }
}
