/**
 * preprocess — 录制 action 的预处理（去噪 + 合并）。
 *
 * 管线第一步（设计 §2 ①）。输入原始 UserAction[]，输出 CleanAction[]：
 *   1. 去噪：丢掉 scroll/hover/keyup/focus/visibility/resize/touch 等纯噪音 action
 *   2. 合并：相邻 type==='input' 且 element.selector 相同的，合并成一条
 *      （用户连续打字会产生多个 input 事件，合并后只留最终值）
 *
 * 设计原则：去噪要彻底（噪音会干扰切分和意图识别），合并要保守（只合并
 * 完全相邻且同 selector 的，避免把不同字段的输入混在一起）。
 */
import type { CleanAction } from '../types.js';
import type { UserAction } from '../../../src/recorder/session-recorder.js';

/** 纯噪音 action 类型：对意图识别零贡献，直接丢弃。 */
const NOISE_TYPES = new Set<UserAction['type']>([
  'scroll',
  'hover',
  'keyup',
  'focus',
  'visibility',
  'resize',
  'touch',
]);

/**
 * 预处理：去噪 + 合并相邻同 selector 的 input。
 * @param actions 原始录制 action（按 timestamp 升序）
 * @returns 清理后的 action（保持原顺序，长度 ≤ 输入）
 */
export function preprocess(actions: UserAction[]): CleanAction[] {
  // Step 0: 归一化 CDP 命令类型（cdp-fill→input, cdp-click→click, cdp-eval→eval）
  // 录制器对 CDP 命令标 cdp-* 前缀（AGENTS §20.7），但语义上和真实用户操作等价，
  // 归一化后所有匹配器只需认标准类型，无需各自处理 cdp-* 变体。
  const CDP_TYPE_MAP: Record<string, UserAction['type']> = {
    'cdp-fill': 'input',
    'cdp-click': 'click',
    'cdp-eval': 'eval',
  };
  const normalized = actions.map(a => {
    const mapped = CDP_TYPE_MAP[a.type];
    return mapped ? { ...a, type: mapped } : a;
  });

  // Step 1: 去噪
  const kept = normalized.filter(a => !NOISE_TYPES.has(a.type));

  // Step 1.5: 全局脱敏——疑似密码的 input value 替换为 '***'
  // 判断依据（任一即脱敏，宁可误杀不可漏放）：
  //   - element.type === 'password'
  //   - selector 含 password/pwd/pass（CDP 在页面加载失败时拿不到 type，靠 selector 兜底）
  for (const a of kept) {
    if (a.type !== 'input' || !a.value) continue;
    const sel = a.element?.selector?.toLowerCase() ?? '';
    const isPwd = a.element?.type === 'password' || /password|pwd|\bpass\b/.test(sel);
    if (isPwd) a.value = '***';
  }

  // Step 2: 合并相邻同 selector 的 input
  const out: CleanAction[] = [];
  for (const action of kept) {
    const last = out[out.length - 1];
    if (
      last !== undefined &&
      action.type === 'input' &&
      last.type === 'input' &&
      // 两者必须有 element 且 selector 相同才合并
      action.element?.selector !== undefined &&
      last.element?.selector !== undefined &&
      action.element.selector === last.element.selector
    ) {
      // 合并：保留第一条的 id（稳定标识），更新 value/element.text 为最新
      last.value = action.value;
      if (action.element?.text !== undefined && last.element) {
        last.element.text = action.element.text;
      }
    } else {
      out.push(action);
    }
  }
  return out;
}
