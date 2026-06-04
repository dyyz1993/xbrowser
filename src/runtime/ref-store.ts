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
