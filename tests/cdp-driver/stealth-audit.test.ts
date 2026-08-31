/**
 * stealth 覆写点自动审计（S172 方法论产品化）
 *
 * 背景：S169 发现实例层覆写可被 `X.prototype.p.call()` 一行逃逸；
 * S172 全面修复时靠人工枚举——人工枚举会漏（Notification.requestPermission
 * 就是本次审计抓到的漏网实例覆写）。本测试把审计规则化：
 *
 *  R1 原型层规则：对单例对象的实例覆写（obj.p = fn），必须存在
 *     对应接口原型层的同步覆写（Interface.prototype.p = ...）。
 *  R2 伪装名单规则：被覆写的属性名必须出现在 Function.prototype.toString
 *     的伪装名单里（覆写函数自己不能露馅）。
 *
 * allowlist：天然免疫原型逃逸的覆写（静态方法/单例对象污染效应），
 * 每条必须写明理由——豁免没有理由就是隐患。
 */
import { describe, it, expect } from 'vitest';
import { buildStealthInitScript } from '../../src/cdp-driver/stealth.js';

describe('stealth 覆写点自动审计（S172）', () => {
  const script = buildStealthInitScript();

  // 已知单例对象 → 接口原型映射（实例覆写必须有原型层同步）
  const SINGLETON_INTERFACE: Array<[string, string]> = [
    ['document', 'Document'],
    ['navigator', 'Navigator'],
    ['performance', 'Performance'],
    ['speechSynthesis', 'SpeechSynthesis'],
    ['screen', 'Screen'],
  ];

  // 覆写点正则：`obj.prop = function` 形式的实例赋值（排除原型赋值/局部变量）
  const OBJ_PROPS = [
    'document', 'navigator', 'performance', 'speechSynthesis', 'screen', 'Notification',
  ];

  function instanceOverrides(): Array<{ obj: string; prop: string }> {
    const out: Array<{ obj: string; prop: string }> = [];
    const re = /(?:^|[^.\w])(document|navigator|performance|speechSynthesis|screen|Notification)\.([A-Za-z_$][\w$]*)\s*=\s*function/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(script)) !== null) {
      out.push({ obj: m[1], prop: m[2] });
    }
    return out;
  }

  // 豁免清单：静态方法（无原型逃逸面）与单例返回对象（污染效应全局生效）
  const ALLOWED: Array<{ obj: string; prop: string; reason: string }> = [
    // Notification.requestPermission 是构造器静态方法——没有原型逃逸面
    { obj: 'Notification', prop: 'requestPermission', reason: '静态方法' },
    // getBattery 返回单例 BatteryManager——defineProperty 污染全局生效
    { obj: 'navigator', prop: 'getBattery', reason: '单例对象污染效应' },
  ];

  it('脚本可解析（前置）', () => {
    expect(() => new Function(script)).not.toThrow();
  });

  it('枚举到足量覆写点（防正则失效静默通过）', () => {
    const overrides = instanceOverrides();
    // 当前已知实例覆写：getBattery（豁免）+ requestPermission（静态豁免）
    // hasFocus/now/getVoices 已在 S172 原型化——若回归实例赋值，R1 会抓到
    expect(overrides.length).toBeGreaterThanOrEqual(2);
  });

  it('R1: 每个实例覆写必须有原型层同步（或豁免）', () => {
    const problems: string[] = [];
    for (const { obj, prop } of instanceOverrides()) {
      const allowed = ALLOWED.find((a) => a.obj === obj && a.prop === prop);
      if (allowed) continue;
      const iface = SINGLETON_INTERFACE.find(([o]) => o === obj)?.[1];
      if (!iface) { problems.push(`${obj}.${prop}: 无接口映射`); continue; }
      const protoPattern = `${iface}.prototype.${prop}`;
      if (!script.includes(protoPattern)) {
        problems.push(`${obj}.${prop}: 缺原型层覆写（${protoPattern}）——可被 ${iface}.prototype.${prop}.call() 逃逸`);
      }
    }
    expect(problems, `原型逃逸风险:\n${problems.join('\n')}`).toEqual([]);
  });

  it('R2: toString 伪装名单覆盖关键覆写（抽样）', () => {
    const mustAppear = ['hasFocus()', 'now()', 'getVoices()', 'fillText()', 'getCoalescedEvents()'];
    const missing = mustAppear.filter((n) => !script.includes(`"function ${n} { [native code] }"`));
    expect(missing, `toString 伪装名单缺失: ${missing.join(', ')}`).toEqual([]);
  });

  it('allowlist 每条必须带理由（豁免无理由即隐患）', () => {
    for (const a of ALLOWED) {
      expect(a.reason.length).toBeGreaterThan(3);
    }
  });
});
