import * as fs from 'node:fs';
import * as path from 'node:path';

const HISTORY_FILE = '.opencode/ui-automator/publish-history.json';

const MIN_INTERVAL_MS = 8 * 60 * 60 * 1000;

export interface PublishRecord {
  platform: string;
  title: string;
  url: string;
  publishedAt: string;
  status: 'published' | 'deleted' | 'draft';
}

export interface PublishHistory {
  records: PublishRecord[];
  lastPublish: Record<string, string>;
}

function resolveHistoryPath(): string {
  return path.resolve(process.cwd(), HISTORY_FILE);
}

function createEmptyHistory(): PublishHistory {
  return { records: [], lastPublish: {} };
}

export async function loadHistory(): Promise<PublishHistory> {
  const filePath = resolveHistoryPath();
  try {
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as PublishHistory;
  } catch {
    const empty = createEmptyHistory();
    await saveHistory(empty);
    return empty;
  }
}

export async function saveHistory(history: PublishHistory): Promise<void> {
  const filePath = resolveHistoryPath();
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(filePath, JSON.stringify(history, null, 2), 'utf-8');
}

export async function canPublish(
  platform: string,
): Promise<{ allowed: boolean; reason: string; nextAvailableAt?: string }> {
  const history = await loadHistory();
  const lastTs = history.lastPublish[platform];

  if (!lastTs) {
    return { allowed: true, reason: `${platform} 尚无发布记录，可以发布` };
  }

  const lastTime = new Date(lastTs).getTime();
  const now = Date.now();
  const elapsed = now - lastTime;

  // 距上次发布不足 8 小时
  if (elapsed < MIN_INTERVAL_MS) {
    const nextAvailable = new Date(lastTime + MIN_INTERVAL_MS);
    return {
      allowed: false,
      reason: `${platform} 距上次发布仅 ${Math.round(elapsed / 3600000)} 小时，需间隔至少 8 小时`,
      nextAvailableAt: nextAvailable.toISOString(),
    };
  }

  // 今天是否已发过
  const lastDate = new Date(lastTime);
  const today = new Date(now);
  if (
    lastDate.getFullYear() === today.getFullYear() &&
    lastDate.getMonth() === today.getMonth() &&
    lastDate.getDate() === today.getDate()
  ) {
    const tomorrowStart = new Date(today);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    tomorrowStart.setHours(0, 0, 0, 0);
    return {
      allowed: false,
      reason: `${platform} 今天已发布 1 篇，每天最多 1 篇`,
      nextAvailableAt: tomorrowStart.toISOString(),
    };
  }

  return { allowed: true, reason: `${platform} 可以发布` };
}

export async function recordPublish(
  platform: string,
  title: string,
  url: string,
): Promise<void> {
  const history = await loadHistory();
  const record: PublishRecord = {
    platform,
    title,
    url,
    publishedAt: new Date().toISOString(),
    status: 'published',
  };
  history.records.push(record);
  history.lastPublish[platform] = record.publishedAt;
  await saveHistory(history);
}

export async function updateStatus(
  url: string,
  status: PublishRecord['status'],
): Promise<void> {
  const history = await loadHistory();
  const target = history.records.find((r) => r.url === url);
  if (!target) {
    throw new Error(`未找到 URL 对应的记录: ${url}`);
  }
  target.status = status;
  await saveHistory(history);
}

export async function getPlatformRecords(
  platform: string,
): Promise<PublishRecord[]> {
  const history = await loadHistory();
  return history.records.filter((r) => r.platform === platform);
}

export async function getSurvivalStats(): Promise<
  Record<string, { total: number; alive: number; deleted: number }>
> {
  const history = await loadHistory();
  const stats: Record<string, { total: number; alive: number; deleted: number }> = {};

  for (const record of history.records) {
    if (!stats[record.platform]) {
      stats[record.platform] = { total: 0, alive: 0, deleted: 0 };
    }
    stats[record.platform].total += 1;
    if (record.status === 'published') {
      stats[record.platform].alive += 1;
    } else if (record.status === 'deleted') {
      stats[record.platform].deleted += 1;
    }
  }

  return stats;
}
