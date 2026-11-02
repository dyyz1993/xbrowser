// 猎聘（liepin.com）求职助手：登录态检查、投递记录、职位沟通投递、简历中心入口。
// 全部命令走 chrome-bridge 通道（用户浏览器 + 已有登录态），不起独立浏览器。
import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

const BRIDGE_HTTP = 'http://127.0.0.1:9347';
const TASK = 'liepin';
const RESUME_CENTER = 'https://c.liepin.com/resume/edit';
const APPLY_RECORD = 'https://c.liepin.com/job/record/apply';
const HOME = 'https://c.liepin.com/';

interface BridgeResp {
  ok?: boolean;
  data?: { value?: unknown; tabId?: number; closed?: number; error?: unknown };
  error?: string;
}

async function bridgeCall(cmd: string, args?: Record<string, unknown>): Promise<BridgeResp | null> {
  return fetch(`${BRIDGE_HTTP}/exec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd, args, task: TASK }),
  }).then(r => r.json()).catch(() => null);
}

async function bridgeReady(): Promise<boolean> {
  const r = await fetch(`${BRIDGE_HTTP}/status`).then(r => r.json()).catch(() => null) as { clients?: unknown[] } | null;
  return Boolean(r && Array.isArray(r.clients) && r.clients.length > 0);
}

async function nav(url: string): Promise<{ tabId?: number } | null> {
  const r = await bridgeCall('navigate', { url });
  if (!r || r.ok !== true) return null;
  return { tabId: r.data?.tabId };
}

async function evalJs(expression: string): Promise<{ ok: boolean; value?: unknown; error?: string }> {
  const r = await bridgeCall('evaluate', { expression });
  if (!r) return { ok: false, error: 'bridge 无响应（先跑 xbrowser chrome-bridge serve）' };
  if (r.ok !== true) {
    const msg = typeof r.error === 'string' ? r.error : JSON.stringify(r.error);
    return { ok: false, error: msg };
  }
  return { ok: true, value: r.data?.value };
}

/** 等 URL 就绪后读取 JSON 化的页面数据 */
async function readPage(expression: string, waitMs = 3500): Promise<{ ok: boolean; value?: unknown; error?: string }> {
  await new Promise(r => setTimeout(r, waitMs));
  return evalJs(expression);
}

/** 轮询等待页面就绪（readyExpr 为浏览器端布尔表达式）后读取数据——列表页是异步渲染，固定等待不可靠 */
async function readPageUntil(expression: string, readyExpr: string, maxMs = 14000): Promise<{ ok: boolean; value?: unknown; error?: string }> {
  const start = Date.now();
  for (;;) {
    const ready = await evalJs(`!!(${readyExpr})`);
    if (ready.ok && ready.value === true) break;
    if (Date.now() - start > maxMs) break;
    await new Promise(r => setTimeout(r, 2000));
  }
  return evalJs(expression);
}

const loginSchema = z.object({
  user: z.string().nullable(),
  applyCount: z.string().nullable(),
  viewedCount: z.string().nullable(),
  homeUrl: z.string(),
});

const applyItemSchema = z.object({
  job: z.string(),
  salary: z.string().nullable(),
  company: z.string().nullable(),
  status: z.string().nullable(),
  time: z.string().nullable(),
  url: z.string().nullable(),
});

const applyListSchema = z.object({
  url: z.string(),
  total: z.number(),
  items: z.array(applyItemSchema),
});

const deliverCheckSchema = z.object({
  url: z.string(),
  pageTitle: z.string(),
  salary: z.string().nullable(),
  action: z.enum(['chat-new', 'chat-ongoing', 'unknown']),
  buttonText: z.string().nullable(),
  note: z.string(),
});

const openResultSchema = z.object({
  url: z.string(),
  tabId: z.number().optional(),
  pageText: z.string(),
});

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'liepin',
    url: 'https://www.liepin.com/',
    description: '猎聘求职助手：登录态检查、投递记录、职位沟通投递、简历中心（走 chrome-bridge 用户浏览器通道）',
    requiresLogin: false,
  });

  site.command('status', {
    description: '检查猎聘登录态与账号概览（用户名/投递数/被查看数）',
    scope: 'project',
    result: loginSchema,
    parameters: z.object({}),
    examples: [{ cmd: 'xbrowser liepin status', description: '检查登录态' }],
    handler: async () => {
      if (!await bridgeReady()) return fail('chrome-bridge 未连接扩展', ['先跑 xbrowser chrome-bridge serve']);
      const navRes = await nav(HOME);
      if (!navRes) return fail('导航失败（bridge 无响应）');
      const page = await readPage(`JSON.stringify({
        user: (document.body.innerText.match(/你好，\\s*([^\\n|]+)/) || [])[1] || null,
        applyCount: ([...document.querySelectorAll('a')].find(a => /我的投递/.test(a.innerText)) || {innerText: ''}).innerText.replace(/[^0-9]/g, '') || null,
        viewedCount: ([...document.querySelectorAll('a')].find(a => /谁看过我/.test(a.innerText)) || {innerText: ''}).innerText.replace(/[^0-9]/g, '') || null,
        homeUrl: location.href
      })`, 4500);
      if (!page.ok) return fail(`读取失败：${page.error}`);
      const d = loginSchema.parse(JSON.parse(String(page.value)));
      if (!d.user) return fail('猎聘未登录（主页面无用户名）', ['先在用户浏览器登录猎聘']);
      return ok(d, [`登录态正常：${d.user}`]);
    },
  });

  site.command('apply-list', {
    description: '列出投递记录（职位/薪资/公司/状态/时间/链接）',
    scope: 'project',
    result: applyListSchema,
    parameters: z.object({}),
    examples: [{ cmd: 'xbrowser liepin apply-list', description: '查看全部投递记录' }],
    handler: async () => {
      if (!await bridgeReady()) return fail('chrome-bridge 未连接扩展', ['先跑 xbrowser chrome-bridge serve']);
      const navRes = await nav(APPLY_RECORD);
      if (!navRes) return fail('导航失败（bridge 无响应）');
      const page = await readPageUntil(`JSON.stringify({
        url: location.href,
        items: [...document.querySelectorAll('a')].filter(a => /\\/job\\/\\d+\\.shtml/.test(a.href)).slice(0, 30).map(a => {
          const card = a.closest('[class*=card],[class*=item],li') || a.parentElement;
          const txt = card ? card.innerText : '';
          const lines = txt.split('\\n').map(s => s.trim()).filter(Boolean);
          const salary = (txt.match(/\\d+-?\\d*[kmk·\\d]*薪?/i) || [''])[0];
          return {
            job: (a.innerText || '').split('\\n')[0].trim().slice(0, 50),
            salary: salary || null,
            company: lines.find(l => /公司|集团|科技|有限/.test(l)) || null,
            status: lines.find(l => /已投递|已查看|面试邀约|不合适|待回复/.test(l)) || null,
            time: (txt.match(/\\d{4}-\\d{2}-\\d{2}[ \\d:]*/) || [''])[0].trim() || null,
            url: a.href.split('?')[0]
          };
        })
      })`, 'document.body.innerText.length > 800');
      if (!page.ok) return fail(`读取失败：${page.error}`);
      const rawText = String(page.value);
      if (!rawText || rawText === 'undefined') return fail(`evaluate 无返回（页面可能被重定向）`, [`实际 URL 请跑 xbrowser liepin status 检查`]);
      const raw = JSON.parse(rawText) as { url: string; items: Array<Record<string, unknown>> };
      const seen = new Set<string>();
      const items = raw.items.filter(it => { const u = String(it.url ?? ''); if (seen.has(u)) return false; seen.add(u); return true; });
      return ok(applyListSchema.parse({ url: raw.url, total: items.length, items }), [`共 ${items.length} 条投递记录`]);
    },
  });

  site.command('deliver', {
    description: '打开职位页并检查沟通状态（聊一聊=可新投递 / 继续聊=已沟通过）',
    scope: 'project',
    result: deliverCheckSchema,
    parameters: z.object({
      url: z.string().describe('职位详情页 URL（www.liepin.com/job/<id>.shtml）'),
    }),
    examples: [{ cmd: 'xbrowser liepin deliver --url "https://www.liepin.com/job/xxx.shtml"', description: '检查职位沟通状态' }],
    handler: async (params) => {
      if (!await bridgeReady()) return fail('chrome-bridge 未连接扩展', ['先跑 xbrowser chrome-bridge serve']);
      if (!/^https:\/\/www\.liepin\.com\/job\/\d+/.test(params.url)) {
        return fail('URL 不像职位详情页', ['格式：https://www.liepin.com/job/<id>.shtml']);
      }
      const navRes = await nav(params.url);
      if (!navRes) return fail('导航失败（bridge 无响应）');
      const page = await readPageUntil(`JSON.stringify({
        url: location.href.split('?')[0],
        pageTitle: document.title.slice(0, 80),
        salary: (document.querySelector('[class*=salary]') || {innerText: ''}).innerText.slice(0, 20) || null,
        action: document.body.innerText.includes('继续聊') ? 'chat-ongoing' : (document.body.innerText.includes('聊一聊') ? 'chat-new' : 'unknown'),
        buttonText: ([...document.querySelectorAll('button,div[class*=btn],span[class*=btn]')].map(el => (el.innerText || '').trim()).find(t => /继续聊|聊一聊|投递/.test(t)) || null)
      })`, 'document.body.innerText.length > 300', 8000);
      if (!page.ok) return fail(`读取失败：${page.error}`);
      const raw = JSON.parse(String(page.value)) as { url: string; pageTitle: string; salary: string | null; action: 'chat-new' | 'chat-ongoing' | 'unknown'; buttonText: string | null };
      const note = raw.action === 'chat-ongoing'
        ? '已沟通过（继续聊）——再次发送会在 IM 里追加消息'
        : raw.action === 'chat-new'
          ? '可投递：发起沟通会自动附上你的在线简历（外向动作，HR 可见）'
          : '未找到沟通按钮（职位可能已下线或需登录）';
      const d = deliverCheckSchema.parse({ ...raw, note });
      const tips = [note];
      if (d.action === 'chat-new') tips.push('确认后点「聊一聊」按钮即可投递（我用 UI 自动化点，或你手动点）');
      return ok(d, tips);
    },
  });

  site.command('resume-open', {
    description: '打开简历中心（中文/英文简历、附件简历上传、刷新简历、预览下载）',
    scope: 'project',
    result: openResultSchema,
    parameters: z.object({}),
    examples: [{ cmd: 'xbrowser liepin resume-open', description: '打开简历中心' }],
    handler: async () => {
      if (!await bridgeReady()) return fail('chrome-bridge 未连接扩展', ['先跑 xbrowser chrome-bridge serve']);
      const navRes = await nav(RESUME_CENTER);
      if (!navRes) return fail('导航失败（bridge 无响应）');
      const page = await readPage(`JSON.stringify({
        url: location.href,
        tabId: undefined,
        pageText: document.body.innerText.slice(0, 200).replace(/\\n/g, ' | ')
      })`, 4000);
      if (!page.ok) return fail(`读取失败：${page.error}`);
      const d = JSON.parse(String(page.value)) as { url: string; pageText: string };
      return ok(openResultSchema.parse({ ...d, tabId: navRes.tabId }), [
        '附件简历：简历中心页「上传附件简历」卡片 → 去上传',
        '刷新简历可提升曝光（建议每天一次）',
      ]);
    },
  });
}
