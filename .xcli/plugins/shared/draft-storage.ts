import { homedir } from 'os';
import { join } from 'path';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';

export function getDraftsDir(platform: string): string {
  return join(homedir(), '.xbrowser', 'storage', platform, 'drafts');
}

export function saveDraft(platform: string, text: string, title?: string): { id: string; path: string } {
  const dir = getDraftsDir(platform);
  mkdirSync(dir, { recursive: true });
  const id = String(Date.now());
  const draft = { id, platform, title: title || '', text, savedAt: new Date().toISOString() };
  const path = join(dir, `${id}.json`);
  writeFileSync(path, JSON.stringify(draft, null, 2), 'utf-8');
  return { id, path };
}

export function listDrafts(platform: string): Array<{ id: string; title: string; textPreview: string; savedAt: string }> {
  const dir = getDraftsDir(platform);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse();
  return files.map(f => {
    try {
      const d = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
      return { id: d.id, title: d.title || '(无标题)', textPreview: (d.text || '').substring(0, 100), savedAt: d.savedAt };
    } catch { return null; }
  }).filter(Boolean) as Array<{ id: string; title: string; textPreview: string; savedAt: string }>;
}

export function loadDraft(platform: string, id: string): { id: string; title?: string; text: string; savedAt: string } | null {
  const path = join(getDraftsDir(platform), `${id}.json`);
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return null; }
}
