import {
  loadHistory,
  saveHistory,
  type PublishRecord,
  type PublishHistory,
} from './publish-tracker.js';

interface CheckResult {
  alive: boolean;
  statusCode: number;
  checkedAt: string;
}

interface ArticleCheckResult {
  platform: string;
  title: string;
  url: string;
  alive: boolean;
  statusCode: number;
}

interface BatchCheckResult {
  total: number;
  alive: number;
  deleted: number;
  results: ArticleCheckResult[];
}

interface SyncResult {
  updated: number;
  stillAlive: number;
}

const MAX_CONCURRENCY = 3;
const REQUEST_TIMEOUT_MS = 10_000;
const MIN_DELAY_MS = 1_000;
const MAX_DELAY_MS = 3_000;

function randomDelay(): Promise<void> {
  const ms = Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1)) + MIN_DELAY_MS;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function checkUrl(url: string): Promise<CheckResult> {
  const checkedAt = new Date().toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
      },
    });
    clearTimeout(timer);

    const statusCode = resp.status;
    const alive = statusCode >= 200 && statusCode < 400;
    return { alive, statusCode, checkedAt };
  } catch {
    clearTimeout(timer);
    return { alive: false, statusCode: 0, checkedAt };
  }
}

export async function checkAllArticles(): Promise<BatchCheckResult> {
  const history = await loadHistory();
  const published = history.records.filter(
    (r: PublishRecord) => r.status === 'published',
  );

  const results: ArticleCheckResult[] = [];
  const queue = [...published];

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const record = queue.shift();
      if (!record) break;

      const { alive, statusCode } = await checkUrl(record.url);
      results.push({
        platform: record.platform,
        title: record.title,
        url: record.url,
        alive,
        statusCode,
      });

      await randomDelay();
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(MAX_CONCURRENCY, published.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  const alive = results.filter((r) => r.alive).length;
  const deleted = results.filter((r) => !r.alive).length;

  return { total: results.length, alive, deleted, results };
}

export async function syncDeletedStatus(): Promise<SyncResult> {
  const { results } = await checkAllArticles();
  const history: PublishHistory = await loadHistory();

  let updated = 0;
  let stillAlive = 0;

  for (const result of results) {
    const record = history.records.find((r: PublishRecord) => r.url === result.url);
    if (!record) continue;

    if (!result.alive && record.status === 'published') {
      record.status = 'deleted';
      updated += 1;
    } else if (result.alive) {
      stillAlive += 1;
    }
  }

  if (updated > 0) {
    await saveHistory(history);
  }

  return { updated, stillAlive };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function truncateTitle(title: string, maxLen: number): string {
  if (title.length <= maxLen) return title;
  return title.slice(0, maxLen - 3) + '...';
}

async function main(): Promise<void> {
  const now = new Date().toISOString();
  const dateStr = formatDate(now);

  console.log(`\n📊 文章存活巡检报告 (${dateStr})`);
  console.log('━'.repeat(40));

  const history = await loadHistory();
  const published = history.records.filter(
    (r: PublishRecord) => r.status === 'published',
  );

  if (published.length === 0) {
    console.log('没有已发布的文章需要检查。\n');
    return;
  }

  const { results } = await checkAllArticles();

  const grouped = new Map<string, ArticleCheckResult[]>();
  for (const r of results) {
    const list = grouped.get(r.platform) ?? [];
    list.push(r);
    grouped.set(r.platform, list);
  }

  let totalAlive = 0;
  let totalDeleted = 0;

  const platformOrder = [...grouped.keys()].sort();
  for (const platform of platformOrder) {
    const items = grouped.get(platform) ?? [];
    const alive = items.filter((r) => r.alive).length;
    const deleted = items.filter((r) => !r.alive).length;
    totalAlive += alive;
    totalDeleted += deleted;

    console.log(
      `平台: ${platform} | 总计: ${items.length} | 存活: ${alive} | 已删: ${deleted}`,
    );
    for (const item of items) {
      const icon = item.alive ? '✅' : '❌';
      const title = truncateTitle(item.title, 50);
      const code = item.statusCode === 0 ? 'TIMEOUT' : String(item.statusCode);
      console.log(`  ${icon} "${title}" → ${code}`);
    }
    console.log('');
  }

  console.log('━'.repeat(40));
  const total = totalAlive + totalDeleted;
  const pct = (n: number): string => `${Math.round((n / total) * 100)}%`;
  console.log(
    `总计: ${total} | 存活: ${totalAlive} (${pct(totalAlive)}) | 已删: ${totalDeleted} (${pct(totalDeleted)})`,
  );

  const { updated, stillAlive } = await syncDeletedStatus();
  if (updated > 0) {
    console.log(`已同步 publish-history.json 状态 (更新 ${updated} 条)`);
  }
  console.log('');
}

main().catch((err: unknown) => {
  console.error('巡检失败:', err);
  process.exit(1);
});
