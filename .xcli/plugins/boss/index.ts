import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { Page } from '../types.js';

const jobResult = z.array(z.object({
  rank: z.number(),
  jobId: z.string(),
  title: z.string(),
  salary: z.string(),
  company: z.string(),
  location: z.string(),
  experience: z.string(),
  education: z.string(),
  tags: z.string(),
  salaryNote: z.string().optional(),
  url: z.string(),
})).describe('Job search results');

const companyResult = z.array(z.object({
  rank: z.number(),
  name: z.string(),
  industry: z.string(),
  funding: z.string(),
  size: z.string(),
  hotJob: z.string(),
  url: z.string(),
})).describe('Company search results');

const recommendResult = z.object({
  whoViewedMe: z.array(z.object({
    name: z.string(),
    company: z.string(),
    title: z.string(),
    salary: z.string(),
  })),
  profile: z.object({
    name: z.string(),
    experience: z.string(),
    status: z.string(),
    expectation: z.string(),
  }),
});

const chatResult = z.array(z.object({
  sender: z.string(),
  company: z.string(),
  role: z.string(),
  time: z.string(),
  preview: z.string(),
})).describe('Chat message list');

const resumeResult = z.object({
  name: z.string(),
  experience: z.string(),
  education: z.string(),
  phone: z.string(),
  email: z.string(),
  advantage: z.string(),
  status: z.string(),
});

const chatReplyResult = z.object({
  sent: z.boolean(),
  to: z.string().optional(),
});

type BridgeResponse = { ok?: boolean; data?: Record<string, unknown>; error?: string };

async function bridgeRunning(): Promise<boolean> {
  const status = await fetch('http://127.0.0.1:9347/status')
    .then(response => response.json() as Promise<{ running?: boolean }>)
    .catch(() => null);
  return status?.running === true;
}

async function bridgeExec(cmd: string, args: Record<string, unknown>): Promise<BridgeResponse> {
  return await fetch('http://127.0.0.1:9347/exec?client=0', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd, args }),
  }).then(response => response.json() as Promise<BridgeResponse>)
    .catch(() => ({ ok: false, error: 'bridge unavailable' }));
}

function bridgeData(response: BridgeResponse): Record<string, unknown> {
  return response.data ?? {};
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'boss',
    url: 'https://www.zhipin.com',
    description: 'Boss直聘 - 职位搜索、公司信息',
    // requiresLogin 由各命令分别声明；chat-reply 走 chrome-bridge 时依赖
    // 用户 Chrome 登录态，不能使用本地 Chromium session 判断。
    requiresLogin: false,
  });

  site.command('search', {
    description: '搜索 Boss直聘 职位',
    scope: 'page',
    loginRequired: 'required',
    result: jobResult,
    parameters: z.object({
      query: z.string().describe('职位关键词，如 "前端"'),
      city: z.string().optional().describe('城市代码，如 101010100（北京）'),
      limit: z.coerce.number().optional().default(10).describe('返回数量'),
    }),
    examples: [
      { cmd: 'xbrowser boss search --query "前端" --city 101010100', description: '搜索北京前端岗位' },
    ],
    handler: async (params, ctx) => {
      const page = ctx.page as Page | undefined;
      if (!page) return fail('需要浏览器页面');

      const url = `https://www.zhipin.com/web/geek/job?query=${encodeURIComponent(params.query)}&city=${params.city ?? ''}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(3000);

      const raw = await page.evaluate(`
        (() => {
          var cards = [...document.querySelectorAll(".job-card-box")].slice(0, ${params.limit ?? 10});
          return cards.map(function(card, i) {
            var link = card.querySelector("a[href*=job_detail]");
            var title = card.querySelector(".job-name");
            var salary = card.querySelector(".job-salary");
            var company = card.querySelector(".boss-name");
            var location = card.querySelector(".company-location");
            var tags = card.querySelectorAll(".tag-list li");
            var href = link ? link.getAttribute("href") : "";
            var idMatch = href.match(/job_detail.([a-f0-9]+)/);
            return {
              rank: i + 1,
              jobId: idMatch ? idMatch[1] : "",
              title: title ? title.textContent.trim() : "",
              salary: salary ? salary.textContent.trim() : "",
              company: company ? company.textContent.trim() : "",
              location: location ? location.textContent.trim() : "",
              experience: tags.length > 0 ? tags[0].textContent.trim() : "",
              education: tags.length > 1 ? tags[1].textContent.trim() : "",
              tags: [].map.call(tags, function(t) { return t.textContent.trim() }).join(", "),
              href: href,
            };
          });
        })()
      `) as Array<Record<string, unknown>>;

      if (!raw.length) return fail(`未找到匹配 "${params.query}" 的职位，请确认已登录`);
      return ok(raw.map((item) => ({
        rank: Number(item.rank ?? 0),
        jobId: String(item.jobId ?? ''),
        title: String(item.title ?? ''),
        salary: String(item.salary ?? ''),
        company: String(item.company ?? ''),
        location: String(item.location ?? ''),
        experience: String(item.experience ?? ''),
        education: String(item.education ?? ''),
        tags: String(item.tags ?? ''),
        salaryNote: 'BOSS直聘列表页薪资为字体渲染反爬，真实薪资请通过 detail 命令查看',
        url: `https://www.zhipin.com${item.href ?? ''}`,
      })));
    },
  });

  site.command('detail', {
    description: '打开 Boss直聘 职位详情页',
    scope: 'page',
    loginRequired: 'required',
    result: z.object({
      jobId: z.string(),
      url: z.string(),
      pageTitle: z.string(),
    }),
    parameters: z.object({
      jobId: z.string().describe('职位 ID'),
    }),
    handler: async (params, ctx) => {
      const page = ctx.page as Page | undefined;
      if (!page) return fail('需要浏览器页面');
      const url = `https://www.zhipin.com/job_detail/${params.jobId}.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(1500);
      const pageTitle = await page.evaluate('document.title') as string;
      return ok({ jobId: params.jobId, url, pageTitle });
    },
  });

  site.command('companies', {
    description: '搜索 Boss直聘 公司',
    scope: 'page',
    loginRequired: 'required',
    result: companyResult,
    parameters: z.object({
      query: z.string().optional().describe('公司关键词'),
      city: z.string().optional().describe('城市拼音，如 guangzhou、beijing'),
      limit: z.coerce.number().optional().default(10).describe('返回数量'),
    }),
    examples: [{ cmd: 'xbrowser boss companies', description: '搜索公司列表' }],
    handler: async (params, ctx) => {
      const page = ctx.page as Page | undefined;
      if (!page) return fail('需要浏览器页面');
      const city = params.city ?? 'guangzhou';
      const query = params.query ? `?query=${encodeURIComponent(params.query)}` : '';
      await page.goto(`https://www.zhipin.com/${city}/gongsi/${query}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(3000);

      const raw = await page.evaluate(`
        (() => {
          var items = [...document.querySelectorAll(".company-info, [class*=company-card]")].slice(0, ${params.limit ?? 10});
          return items.map(function(e, i) {
            var link = e.querySelector("a[href*=gongsi]");
            var name = e.querySelector(".company-name, [class*=company-name]");
            var text = e.innerText.replace(/\\n/g, "|");
            var parts = text.split("|").map(function(s) { return s.trim() }).filter(Boolean);
            return {
              rank: i + 1,
              name: name ? name.textContent.trim() : (parts[0] || ""),
              industry: parts.find(function(p) { return p.includes("融资") || p.includes("互联网") || p.includes("科技") }) || "",
              funding: parts.find(function(p) { return p.includes("融资") }) || "",
              size: parts.find(function(p) { return p.includes("人") }) || "",
              hotJob: parts.find(function(p) { return p.includes("K") || p.includes("薪") }) || "",
              href: link ? link.getAttribute("href") : "",
            };
          });
        })()
      `) as Array<Record<string, unknown>>;

      if (!raw.length) return fail('未找到公司数据，请确认已登录');
      return ok(raw.map((item) => ({
        rank: Number(item.rank ?? 0),
        name: String(item.name ?? ''),
        industry: String(item.industry ?? ''),
        funding: String(item.funding ?? ''),
        size: String(item.size ?? ''),
        hotJob: String(item.hotJob ?? ''),
        url: String(item.href ?? '').startsWith('http') ? String(item.href) : `https://www.zhipin.com${item.href ?? ''}`,
      })));
    },
  });

  site.command('recommend', {
    description: '获取推荐职位和谁看过我',
    scope: 'page',
    loginRequired: 'required',
    result: recommendResult,
    parameters: z.object({}),
    handler: async (_params, ctx) => {
      const page = ctx.page as Page | undefined;
      if (!page) return fail('需要浏览器页面');
      await page.goto('https://www.zhipin.com/web/geek/recommend', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(3000);

      const data = await page.evaluate(`
        (() => {
          var items = [...document.querySelectorAll(".item-recommend")].slice(0, 10);
          var viewers = items.map(function(e, i) {
            var lines = e.innerText.replace(/\\n/g, "|").split("|").map(function(s) { return s.trim() }).filter(Boolean);
            var link = e.closest("a") || e.querySelector("a");
            return lines.length >= 4 ? {
              name: lines[0], company: lines[1], title: lines[2], salary: lines[3],
              href: link ? link.getAttribute("href") : ""
            } : null;
          }).filter(Boolean);
          var text = document.body.innerText;
          var profileEl = document.querySelector(".name");
          var expMatch = text.match(/(\\d+年经验\\S+-随时到岗|\\d+年经验\\S+在职-\\S+)/);
          return {
            viewers: viewers,
            profile: profileEl ? {
              name: profileEl.textContent.trim(),
              experience: expMatch ? expMatch[1] : "",
              status: "",
              expectation: "",
            } : null,
          };
        })()
      `) as { viewers: Array<Record<string, unknown>>; profile: Record<string, unknown> | null };

      if (!data.viewers.length && !data.profile) return fail('未获取到推荐数据');
      return ok({
        whoViewedMe: data.viewers.map((v) => ({
          name: String(v.name ?? ''),
          company: String(v.company ?? ''),
          title: String(v.title ?? ''),
          salary: String(v.salary ?? ''),
        })),
        profile: {
          name: String(data.profile?.name ?? ''),
          experience: String(data.profile?.experience ?? ''),
          status: String(data.profile?.status ?? ''),
          expectation: String(data.profile?.expectation ?? ''),
        },
      });
    },
  });

  site.command('chat', {
    description: '获取沟通消息列表',
    scope: 'page',
    loginRequired: 'required',
    result: chatResult,
    parameters: z.object({
      limit: z.coerce.number().optional().default(10).describe('返回条数'),
    }),
    handler: async (params, ctx) => {
      const page = ctx.page as Page | undefined;
      if (!page) return fail('需要浏览器页面');
      await page.goto('https://www.zhipin.com/web/geek/chat', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(3000);

      const raw = await page.evaluate(`
        (() => {
          var text = document.body.innerText;
          var items = [];
          var chatEls = [...document.querySelectorAll("[class*=chat-item], [class*=friend-item], [class*=message-item]")].slice(0, ${params.limit ?? 10});
          if (chatEls.length === 0) {
            var lines = text.split("\\n");
            for (var i = 0; i < lines.length; i++) {
              var line = lines[i].trim();
              if (line.includes("[送达]") || line.includes("[已读]")) {
                var prev = i > 0 ? lines[i - 1].trim() : "";
                var parts = prev.split(/(?=[A-Z])/);
                items.push({
                  sender: parts[0] || prev.slice(0, 10),
                  company: parts.slice(1).join(" ") || "",
                  role: "HR",
                  time: line.includes("昨天") ? "昨天" : "今天",
                  preview: line,
                });
              }
            }
          } else {
            chatEls.forEach(function(e) {
              var lines = e.innerText.replace(/\\n/g, "|").split("|").map(function(s) { return s.trim() }).filter(Boolean);
              if (lines.length >= 2) {
                items.push({ sender: lines[0], company: lines[1] || "", role: "HR", time: "", preview: lines.slice(2).join(" ") });
              }
            });
          }
          return items.slice(0, ${params.limit ?? 10});
        })()
      `) as Array<Record<string, unknown>>;

      if (!raw.length) return fail('未找到聊天消息');
      return ok(raw.map((item) => ({
        sender: String(item.sender ?? ''),
        company: String(item.company ?? ''),
        role: String(item.role ?? ''),
        time: String(item.time ?? ''),
        preview: String(item.preview ?? ''),
      })));
    },
  });

  site.command('chat-reply', {
    description: '回复指定对话（通过 chrome-bridge CDP 真实键盘事件发送）',
    scope: 'project',
    // 走用户 Chrome 的 chrome-bridge 时，本地 xbrowser session 没有登录态；
    // 登录态由导航后的真实页面和发送验证兜底，不能让本地空 session 误杀。
    loginRequired: 'none',
    result: chatReplyResult,
    parameters: z.object({
      keyword: z.string().describe('对话关键词，如 "德熙"'),
      message: z.string().describe('要发送的回复内容'),
    }),
    handler: async (params, ctx) => {
      const page = ctx.page as Page | undefined;
      const useBridge = await bridgeRunning();
      if (!page && !useBridge) return fail('需要浏览器页面或已连接的 chrome-bridge');
      const CHAT_URL = 'https://www.zhipin.com/web/geek/chat';
      // Use a dedicated short-lived group for every reply. BOSS chat has
      // demonstrated V8 OOM after long-lived tabs (Chrome error code 5 and
      // crash stacks in its chat bundle); never reuse that renderer.
      const taskName = `boss-reply-${Date.now()}`;
      const navigated = useBridge
        ? await bridgeExec('navigate', { url: CHAT_URL, task: taskName })
        : { ok: true as const, data: {} };
      if (navigated.ok !== true) return fail(navigated.error || 'chrome-bridge 未启动或导航失败');
      const tabId = bridgeData(navigated).tabId;
      if (useBridge && typeof tabId !== 'number') return fail('chrome-bridge 未返回任务 tab');
      await sleep(3000);

      const evaluate = async (expression: string): Promise<BridgeResponse> => useBridge
        ? await bridgeExec('evaluate', { tabId, expression })
        : { ok: true, data: { value: await page!.evaluate(expression) } };

      // Fresh tab + explicit heap check. This is the OOM tripwire: the BOSS
      // renderer can already be near its heap cap after a long-lived session.
      const healthResponse = await evaluate(`
        (() => {
          const memory = performance.memory;
          return {
            ready: document.readyState,
            url: location.href,
            usedMB: memory ? Math.round(memory.usedJSHeapSize / 1048576) : null,
            limitMB: memory ? Math.round(memory.jsHeapSizeLimit / 1048576) : null,
          };
        })()
      `);
      if (healthResponse.ok !== true) return fail(healthResponse.error || '页面健康检查失败');
      const health = bridgeData(healthResponse).value as {
        ready?: string; url?: string; usedMB?: number | null; limitMB?: number | null;
      } | null;
      if (health?.ready !== 'complete' || !health.url?.includes('zhipin.com')) {
        return fail('BOSS 页面未就绪');
      }
      if (typeof health.usedMB === 'number' && typeof health.limitMB === 'number') {
        const usedRatio = health.usedMB / health.limitMB;
        if (usedRatio > 0.65) {
          await bridgeExec('task-close', { name: taskName });
          return fail(`BOSS 渲染进程内存过高（${health.usedMB}/${health.limitMB} MB），已拒绝继续写入`);
        }
      }

      // BOSS 的列表项靠 trusted mousedown 打开会话；el.click() 只会移除
      // no-data 占位，不会真正建立会话。坐标必须用页面视口 CSS 像素。
      const targetResponse = await evaluate(`
        (() => {
          const el = [...document.querySelectorAll(".friend-content")]
            .find(e => e.innerText.includes(${JSON.stringify(params.keyword)}));
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        })()
      `);
      if (targetResponse.ok !== true) return fail(targetResponse.error || '读取会话列表失败');
      const target = bridgeData(targetResponse).value as { x?: number; y?: number } | null;
      if (!target?.x || !target?.y) return fail(`未找到包含 "${params.keyword}" 的对话`);
      const click = useBridge
        ? await bridgeExec('trustedClick', { x: target.x, y: target.y, tabId })
        : { ok: true as const, data: {} };
      if (click.ok !== true) return fail(click.error || '打开会话失败');
      await sleep(2000);

      // 编辑器与发送按钮都接受组件层 click；trustedClick 的独立 press/release
      // 在 BOSS Vue 组件上不稳定。发送后必须读会话消息做业务级验收。
      const typedResponse = await evaluate(`
        (() => {
          const input = document.querySelector(".chat-input");
          if (!input) return false;
          input.textContent = ${JSON.stringify(params.message)};
          input.dispatchEvent(new InputEvent("input", { bubbles: true }));
          return input.textContent === ${JSON.stringify(params.message)};
        })()
      `);
      if (typedResponse.ok !== true) return fail(typedResponse.error || '读取聊天输入框失败');
      const typed = bridgeData(typedResponse).value === true;
      if (!typed) return fail('未找到聊天输入框，请确认已打开对话');
      await sleep(500);

      const clickedResponse = await evaluate(`
        (() => {
          const el = document.querySelector(".btn-send");
          if (!el) return false;
          el.click();
          return true;
        })()
      `);
      if (clickedResponse.ok !== true) return fail(clickedResponse.error || '读取发送按钮失败');
      const clicked = bridgeData(clickedResponse).value === true;
      if (!clicked) return fail('未找到发送按钮');
      await sleep(1000);

      const verifyResponse = await evaluate(`
        (() => {
          const text = ${JSON.stringify(params.message)};
          return [...document.querySelectorAll(".message-item")].some(e => e.innerText.includes(text));
        })()
      `);
      if (verifyResponse.ok !== true) return fail(verifyResponse.error || '读取发送结果失败');
      const verify = bridgeData(verifyResponse).value === true;
      // Close the dedicated tab immediately after business verification. This
      // prevents the renderer from accumulating history/messages across jobs.
      if (useBridge) await bridgeExec('task-close', { name: taskName });
      if (!verify) return fail('发送后未在会话中找到消息');

      return ok({ sent: true, to: params.keyword, message: params.message.slice(0, 50) }, [
        `已回复 "${params.keyword}"`,
      ]);
    },
  });

  site.command('resume', {
    description: '获取在线简历信息',
    scope: 'page',
    loginRequired: 'required',
    result: resumeResult,
    parameters: z.object({}),
    handler: async (_params, ctx) => {
      const page = ctx.page as Page | undefined;
      if (!page) return fail('需要浏览器页面');
      await page.goto('https://www.zhipin.com/web/geek/resume', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(3000);

      const data = await page.evaluate(`
        (() => {
          var nameEl = document.querySelector(".name");
          var ps = [...document.querySelectorAll("p")].map(function(p) { return p.textContent.trim() });
          var exp = ps.find(function(t) { return /\\d+年经验/.test(t) }) || "";
          var contact = ps.find(function(t) { return /\\d{3}\\*/.test(t) }) || "";
          var phoneMatch = contact.match(/(\\d{3}\\*{4}\\d{4})/);
          var emailMatch = contact.match(/[\\w.+-]+@[\\w-]+\\.[\\w.]+/);
          var statusMatch = exp.match(/(离职-\\S+|在职-\\S+)/);
          return {
            name: nameEl ? nameEl.textContent.trim() : "",
            experience: exp.replace(/离职-\\S+|在职-\\S+/, "").trim(),
            phone: phoneMatch ? phoneMatch[1] : "",
            email: emailMatch ? emailMatch[0] : "",
            status: statusMatch ? statusMatch[1] : "",
            advantage: "",
          };
        })()
      `) as Record<string, unknown>;

      if (!data.name) return fail('未获取到简历信息');
      return ok({
        name: String(data.name ?? ''),
        experience: String(data.experience ?? ''),
        education: String(data.education ?? ''),
        phone: String(data.phone ?? ''),
        email: String(data.email ?? ''),
        advantage: String(data.advantage ?? '').slice(0, 200),
        status: String(data.status ?? ''),
      });
    },
  });
}
