import type { AgentTarget } from './types.js';

interface RefSession {
  screenHash: string;
  targets: Map<string, AgentTarget>;
}

const sessions = new Map<string, RefSession>();

export function normalizeAgentRef(ref: string): string {
  return ref.startsWith('@') ? ref.slice(1) : ref;
}

export function replaceRefs(sessionKey: string, screenHash: string, targets: AgentTarget[]): void {
  sessions.set(sessionKey, {
    screenHash,
    targets: new Map(targets.map((target) => [target.ref, target])),
  });
}

export function getRefTarget(sessionKey: string, ref: string): { screenHash: string; target: AgentTarget } | null {
  const session = sessions.get(sessionKey);
  const target = session?.targets.get(normalizeAgentRef(ref));
  if (!session || !target) return null;
  return { screenHash: session.screenHash, target };
}

export function clearRefs(sessionKey: string): void {
  sessions.delete(sessionKey);
}

export function clearAllRefs(): void {
  sessions.clear();
}

/**
 * 稳定 ref 继承（学习 jev-ultrafast 的稳定元素 ID）：selector 在 observe 生成时
 * 保证唯一（isUnique 校验 + nth-of-type 兜底），是天然的元素指纹。新一轮 observe
 * 的元素若能在上一轮里找到相同 selector，就继承旧 ref —— 页面局部变化（插入/删除
 * 其他元素）不再导致 ref 全体漂移；新元素从最大已有编号之后续配。
 */
export function inheritStableRefs(
  key: string,
  rawTargets: Array<Omit<AgentTarget, 'ref'>>,
): AgentTarget[] {
  const prev = sessions.get(key);
  if (!prev || prev.targets.size === 0) {
    return rawTargets.map((target, index) => ({ ...target, ref: `e${index + 1}` }));
  }
  const bySelector = new Map<string, string>();
  let maxId = 0;
  for (const [ref, target] of prev.targets) {
    bySelector.set(target.selector, ref);
    const id = Number(ref.slice(1));
    if (Number.isFinite(id) && id > maxId) maxId = id;
  }
  let next = maxId + 1;
  return rawTargets.map((target) => {
    const inherited = bySelector.get(target.selector);
    if (inherited) return { ...target, ref: inherited };
    return { ...target, ref: `e${next++}` };
  });
}
