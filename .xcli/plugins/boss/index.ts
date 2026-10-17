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

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'boss',
    url: 'https://www.zhipin.com',
    description: 'Boss直聘 - 职位搜索、公司信息',
    requiresLogin: true,
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
