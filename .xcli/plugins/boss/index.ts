import { z } from "zod/v4";
import type { XCLIAPI } from "@dyyz1993/xcli-core";
import { ok, fail } from "@dyyz1993/xcli-core";
import type { Page } from "../types.js";
import {
  textOf,
  parseJobDetailTarget,
  extractJobDetail,
  extractCompanies,
  extractRecommend,
  extractChats,
  extractResume,
  parseResumeContact,
  type JobDetailData,
  type CompanyData,
  type RecommendData,
  type ChatData,
  type ResumeData,
} from "./selectors.js";

const jobResult = z
  .array(
    z.object({
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
      detailUrl: z.string(),
      url: z.string(),
    }),
  )
  .describe("Job search results");

const companyResult = z
  .array(
    z.object({
      rank: z.number(),
      name: z.string(),
      industry: z.string(),
      funding: z.string(),
      size: z.string(),
      hotJob: z.string(),
      url: z.string(),
    }),
  )
  .describe("Company search results");

const recommendResult = z.object({
  whoViewedMe: z.array(
    z.object({
      name: z.string(),
      company: z.string(),
      title: z.string(),
      salary: z.string(),
    }),
  ),
  profile: z.object({
    name: z.string(),
    experience: z.string(),
    status: z.string(),
    expectation: z.string(),
  }),
});

const chatResult = z
  .array(
    z.object({
      sender: z.string(),
      company: z.string(),
      role: z.string(),
      time: z.string(),
      preview: z.string(),
    }),
  )
  .describe("Chat message list");

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

type BridgeResponse = {
  ok?: boolean;
  data?: Record<string, unknown>;
  error?: string;
};

export interface BossMistakeRecorder {
  (input: {
    category: string;
    fingerprint?: string;
    command: string;
    message: string;
    context?: Record<string, unknown>;
  }): unknown;
}

export interface BossBrowserContext {
  newPage?: () => Promise<Page>;
  pages?: () => Page[];
}

async function pageUrl(page: Page): Promise<string> {
  const evaluated = await page
    .evaluate<string>("location.href")
    .catch(() => undefined);
  return typeof evaluated === "string" && evaluated ? evaluated : page.url();
}

export function recordBossMistake(
  command: string,
  reason: string,
  tabName?: string,
): void {
  const recordBossMistakeImpl = (globalThis as Record<string, unknown>)
    .__xbrowserRecordMistake as BossMistakeRecorder | undefined;
  if (!recordBossMistakeImpl) return;
  const reasonCode = reason
    .replace(/\d+(?:\.\d+)?/g, '<number>')
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/\s+/g, ' ')
    .trim();
  recordBossMistakeImpl({
    category: "boss-collector",
    fingerprint: `boss-collector::${command}::${reasonCode}`,
    command: `boss ${command}`,
    message: reason,
    context: { plugin: "boss", reason, ...(tabName ? { tabName } : {}) },
  });
}

function bridgeData(response: BridgeResponse): Record<string, unknown> {
  return response.data ?? {};
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

type BossMemory = { usedMB: number | null; limitMB: number | null };

function bossMemoryExpression(): string {
  return `
    (() => {
      const memory = performance.memory;
      return {
        ready: document.readyState,
        url: location.href,
        usedMB: memory ? Math.round(memory.usedJSHeapSize / 1048576) : null,
        limitMB: memory ? Math.round(memory.jsHeapSizeLimit / 1048576) : null,
      };
    })()
  `;
}

function assertBossMemory(
  health: BossMemory & { ready?: string; url?: string },
): string | null {
  if (health.ready !== "complete" || !health.url?.includes("zhipin.com")) {
    return "BOSS 页面未就绪";
  }
  if (typeof health.usedMB === "number" && typeof health.limitMB === "number") {
    const usedRatio = health.usedMB / health.limitMB;
    if (usedRatio > 0.65) {
      return `BOSS 渲染进程内存过高（${health.usedMB}/${health.limitMB} MB），已拒绝继续`;
    }
  }
  return null;
}

function rejectUnsafeEvaluate(value: unknown, message: string): string | null {
  if (value && typeof value === "object" && "ok" in value) return message;
  return null;
}

type BossTab = { name: string; page: Page; reusable: boolean };

async function openReadOnlyBossTab(
  ctx: unknown,
  name: string,
): Promise<BossTab | null> {
  const browserContext = (ctx as { browserContext?: BossBrowserContext })
    .browserContext;
  if (!browserContext?.newPage) return null;
  const page = await browserContext.newPage();
  return { name, page, reusable: false };
}

async function openReusableBossTab(
  ctx: unknown,
  name: string,
): Promise<BossTab | null> {
  const browserContext = (ctx as { browserContext?: BossBrowserContext })
    .browserContext;
  if (!browserContext?.newPage) return null;
  const pages = browserContext.pages?.() ?? [];
  const pageUrls = await Promise.all(pages.map(async (page) => pageUrl(page)));
  const existingIndex = pageUrls.findIndex((pageUrl) => {
    if (typeof pageUrl !== "string") return false;
    try {
      const parsed = new URL(pageUrl);
      return (
        (parsed.hostname === "www.zhipin.com" || parsed.hostname === "zhipin.com") &&
        parsed.searchParams.get("__xbrowser_tab") === name
      );
    } catch {
      return false;
    }
  });
  const existing = existingIndex >= 0 ? pages[existingIndex] : undefined;
  if (existing) return { name, page: existing, reusable: true };
  const page = await browserContext.newPage();
  return { name, page, reusable: false };
}

async function closeBossTab(page: Page): Promise<void> {
  await page.close().catch(() => {});
}

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: "boss",
    url: "https://www.zhipin.com",
    description: "Boss直聘 - 职位搜索、公司信息",
    // requiresLogin 由各命令分别声明；chat-reply 走 chrome-bridge 时依赖
    // 用户 Chrome 登录态，不能使用本地 Chromium session 判断。
    requiresLogin: false,
  });

  site.command("search", {
    description: "搜索 Boss直聘 职位",
    scope: "page",
    loginRequired: "required",
    result: jobResult,
    parameters: z.object({
      query: z.string().describe('职位关键词，如 "前端"'),
      city: z.string().optional().describe("城市代码，如 101010100（北京）"),
      limit: z.coerce.number().optional().default(10).describe("返回数量"),
    }),
    examples: [
      {
        cmd: 'xbrowser boss search --query "前端" --city 101010100',
        description: "搜索北京前端岗位",
      },
    ],
    handler: async (params, ctx) => {
      const tab = await openReadOnlyBossTab(ctx, "boss-search");
      if (!tab) {
        recordBossMistake(
          "search",
          "无法从 BrowserCommandContext 创建独立采集 tab",
          "boss-search",
        );
        return fail("需要浏览器上下文以创建独立采集 tab");
      }
      const page = tab.page;
      try {
        const url = `https://www.zhipin.com/web/geek/job?query=${encodeURIComponent(params.query)}&city=${params.city ?? ""}&__xbrowser_tab=${encodeURIComponent(tab.name)}`;
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(3000);
        const evaluate = async (
          expression: string,
        ): Promise<BridgeResponse> => ({
          ok: true,
          data: { value: await page.evaluate(expression) },
        });
        const healthResponse = await evaluate(bossMemoryExpression());
        if (healthResponse.ok !== true) {
          const message = healthResponse.error || "页面健康检查失败";
          recordBossMistake("search", message, tab.name);
          return fail(message);
        }
        const healthError = assertBossMemory(
          bridgeData(healthResponse).value as BossMemory & {
            ready?: string;
            url?: string;
          },
        );
        if (healthError) {
          recordBossMistake("search", healthError, tab.name);
          return fail(healthError);
        }
        const limit = params.limit ?? 10;
        const rawResponse = await evaluate(`
          JSON.stringify((() => {
            var cards = [...document.querySelectorAll('.job-card-box')].slice(0, ${limit});
            return cards.map(function(card, i) {
              var link = card.querySelector('a[href*=job_detail]');
              var title = card.querySelector('.job-name');
              var salary = card.querySelector('.job-salary');
              var company = card.querySelector('.boss-name');
              var location = card.querySelector('.company-location');
              var tags = card.querySelectorAll('.tag-list li');
              var href = link ? link.getAttribute('href') : '';
              var idMatch = href.match(/job_detail\.([a-f0-9]+)/);
              return {
                rank: i + 1,
                jobId: idMatch ? idMatch[1] : "",
                title: title ? title.textContent.trim() : '',
                salary: salary ? salary.textContent.trim() : '',
                company: company ? company.textContent.trim() : '',
                location: location ? location.textContent.trim() : '',
                experience: tags.length > 0 ? tags[0].textContent.trim() : '',
                education: tags.length > 1 ? tags[1].textContent.trim() : '',
                tags: [].map.call(tags, function(t) { return t.textContent.trim() }).join(", "),
                href: href,
              };
            });
          })())
        `);
        let raw: Array<Record<string, unknown>> = [];
        try {
          raw = JSON.parse(String(bridgeData(rawResponse).value)) as Array<
            Record<string, unknown>
          >;
        } catch {
          raw = [];
        }
        if (!raw.length) {
          const message = `未匹配 "${params.query}" 的职位，请确认已登录`;
          recordBossMistake("search", message, tab.name);
          return fail(message);
        }
        return ok(
          raw.map((item) => ({
            rank: Number(item.rank ?? 0),
            jobId: String(item.jobId ?? ""),
            title: String(item.title ?? ""),
            salary: String(item.salary ?? ""),
            company: String(item.company ?? ""),
            location: String(item.location ?? ""),
            experience: String(item.experience ?? ""),
            education: String(item.education ?? ""),
            tags: String(item.tags ?? ""),
            salaryNote:
              "BOSS直聘列表页薪资为字体渲染反爬，真实薪资请通过 detail 命令查看",
            detailUrl: `https://www.zhipin.com${item.href ?? ""}`,
            url: `https://www.zhipin.com${item.href ?? ""}`,
          })),
        );
      } catch (error) {
        recordBossMistake(
          "search",
          error instanceof Error ? error.message : String(error),
          tab.name,
        );
        throw error;
      } finally {
        if (!tab.reusable) await closeBossTab(page);
      }
    },
  });

  site.command("detail", {
    description: "打开 Boss直聘 职位详情页",
    scope: "page",
    loginRequired: "required",
    result: z.object({
      jobId: z.string(),
      url: z.string(),
      pageTitle: z.string(),
      jobTitle: z.string(),
      salary: z.string(),
      company: z.string(),
      location: z.string(),
      experience: z.string(),
      education: z.string(),
      description: z.string(),
    }),
    parameters: z.object({
      jobId: z.string().describe("职位 ID"),
    }),
    handler: async (params, ctx) => {
      const tab = await openReadOnlyBossTab(ctx, "boss-detail");
      if (!tab) {
        recordBossMistake(
          "detail",
          "无法从 BrowserCommandContext 创建独立采集 tab",
          "boss-detail",
        );
        return fail("需要浏览器上下文以创建独立采集 tab");
      }
      const page = tab.page;
      try {
        let target: string;
        try {
          target = parseJobDetailTarget(params.jobId);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "无效的职位详情标识";
          recordBossMistake("detail", message, tab.name);
          return fail(message);
        }
        const url = `${target}${target.includes("?") ? "&" : "?"}__xbrowser_tab=${encodeURIComponent(tab.name)}`;
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(1500);
        const evaluate = async (
          expression: string,
        ): Promise<BridgeResponse> => ({
          ok: true,
          data: { value: await page.evaluate(expression) },
        });
        const healthResponse = await evaluate(bossMemoryExpression());
        if (healthResponse.ok !== true) {
          const message = healthResponse.error || "页面健康检查失败";
          recordBossMistake("detail", message, tab.name);
          return fail(message);
        }
        const healthError = assertBossMemory(
          bridgeData(healthResponse).value as BossMemory & {
            ready?: string;
            url?: string;
          },
        );
        if (healthError) return fail(healthError);
        const titleResponse = await evaluate("document.title");
        if (titleResponse.ok !== true) {
          const message = titleResponse.error || "读取标题失败";
          recordBossMistake("detail", message, tab.name);
          return fail(message);
        }
        const pageTitle = String(bridgeData(titleResponse).value ?? "");
        const detailScript =
          "const extract = " +
          extractJobDetail.toString() +
          ";\nreturn extract();";
        const detailBody = textOf.toString() + "\n" + detailScript;
        const raw = await evaluate(
          "JSON.stringify((function(){" + detailBody + "})())",
        );
        let data: JobDetailData | null = null;
        try {
          data = JSON.parse(String(bridgeData(raw).value)) as JobDetailData;
        } catch {
          data = null;
        }
        if (pageTitle.includes("您访问的页面不存在")) {
          recordBossMistake("detail", `职位详情不存在：${target}`, tab.name);
          return fail(`职位详情不存在：${target}`);
        }
        const jobId =
          new URL(url).pathname.match(/job_detail\/([A-Za-z0-9_-]+)\.html/i)?.[1] ??
          params.jobId;
        return ok({
          jobId,
          url,
          pageTitle,
          jobTitle: data?.jobTitle ?? "",
          salary: data?.salary ?? "",
          company: data?.company ?? "",
          location: data?.location ?? "",
          experience: data?.experience ?? "",
          education: data?.education ?? "",
          description: data?.description ?? "",
        });
      } catch (error) {
        recordBossMistake(
          "detail",
          error instanceof Error ? error.message : String(error),
          tab.name,
        );
        throw error;
      } finally {
        if (!tab.reusable) await closeBossTab(page);
      }
    },
  });

  site.command("companies", {
    description: "搜索 Boss直聘 公司",
    scope: "page",
    loginRequired: "required",
    result: companyResult,
    parameters: z.object({
      query: z.string().optional().describe("公司关键词"),
      city: z.string().optional().describe("城市拼音，如 guangzhou、beijing"),
      limit: z.coerce.number().optional().default(10).describe("返回数量"),
    }),
    examples: [{ cmd: "xbrowser boss companies", description: "搜索公司列表" }],
    handler: async (params, ctx) => {
      const tab = await openReadOnlyBossTab(ctx, "boss-companies");
      if (!tab) {
        recordBossMistake(
          "companies",
          "无法从 BrowserCommandContext 创建独立采集 tab",
          "boss-companies",
        );
        return fail("需要浏览器上下文以创建独立采集 tab");
      }
      const page = tab.page;
      try {
        const city = params.city ?? "guangzhou";
        const baseUrl = params.query
          ? `https://www.zhipin.com/gongsi/?query=${encodeURIComponent(params.query)}`
          : `https://www.zhipin.com/${city}/gongsi/`;
        const url = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}__xbrowser_tab=${encodeURIComponent(tab.name)}`;
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(3000);
        const evaluate = async (
          expression: string,
        ): Promise<BridgeResponse> => ({
          ok: true,
          data: { value: await page.evaluate(expression) },
        });
        const healthResponse = await evaluate(bossMemoryExpression());
        if (healthResponse.ok !== true) {
          const message = healthResponse.error || "页面健康检查失败";
          recordBossMistake("companies", message, tab.name);
          return fail(message);
        }
        const healthError = assertBossMemory(
          bridgeData(healthResponse).value as BossMemory & {
            ready?: string;
            url?: string;
          },
        );
        if (healthError) {
          recordBossMistake("companies", healthError, tab.name);
          return fail(healthError);
        }
        const limit = params.limit ?? 10;
        const companyScript =
          textOf.toString() +
          "\nconst extract = " +
          extractCompanies.toString() +
          ";\nreturn extract(" +
          limit +
          ");";
        const rawResponse = await evaluate(
          "JSON.stringify((function(){" + companyScript + "})())",
        );
        let raw: CompanyData[] = [];
        try {
          raw = JSON.parse(
            String(bridgeData(rawResponse).value),
          ) as CompanyData[];
        } catch {
          raw = [];
        }
        if (!raw.length) {
          const message = "未找到公司数据，请确认已登录";
          recordBossMistake("companies", message, tab.name);
          return fail(message);
        }
        return ok(
          raw.map((item) => ({
            rank: Number(item.rank ?? 0),
            name: String(item.name ?? ""),
            industry: String(item.industry ?? ""),
            funding: String(item.funding ?? ""),
            size: String(item.size ?? ""),
            hotJob: String(item.hotJob ?? ""),
            url: String(item.href ?? "").startsWith("http")
              ? String(item.href)
              : `https://www.zhipin.com${item.href ?? ""}`,
          })),
        );
      } catch (error) {
        recordBossMistake(
          "companies",
          error instanceof Error ? error.message : String(error),
          tab.name,
        );
        throw error;
      } finally {
        if (!tab.reusable) await closeBossTab(page);
      }
    },
  });

  site.command("recommend", {
    description: "获取推荐职位和谁看过我",
    scope: "page",
    loginRequired: "required",
    result: recommendResult,
    parameters: z.object({}),
    handler: async (_params, ctx) => {
      const tab = await openReadOnlyBossTab(ctx, "boss-recommend");
      if (!tab) {
        recordBossMistake(
          "recommend",
          "无法从 BrowserCommandContext 创建独立采集 tab",
          "boss-recommend",
        );
        return fail("需要浏览器上下文以创建独立采集 tab");
      }
      const page = tab.page;
      try {
        const url = `https://www.zhipin.com/web/geek/recommend?__xbrowser_tab=${encodeURIComponent(tab.name)}`;
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(5000);
        const evaluate = async (
          expression: string,
        ): Promise<BridgeResponse> => ({
          ok: true,
          data: { value: await page.evaluate(expression) },
        });
        const healthResponse = await evaluate(bossMemoryExpression());
        if (healthResponse.ok !== true) {
          const message = healthResponse.error || "页面健康检查失败";
          recordBossMistake("recommend", message, tab.name);
          return fail(message);
        }
        const healthError = assertBossMemory(
          bridgeData(healthResponse).value as BossMemory & {
            ready?: string;
            url?: string;
          },
        );
        if (healthError) {
          recordBossMistake("recommend", healthError, tab.name);
          return fail(healthError);
        }
        const recommendScript =
          textOf.toString() +
          "\nconst extract = " +
          extractRecommend.toString() +
          ";\nreturn extract();";
        const rawResponse = await evaluate(
          "JSON.stringify((function(){" + recommendScript + "})())",
        );
        let data: RecommendData = { viewers: [], profile: null };
        try {
          data = JSON.parse(
            String(bridgeData(rawResponse).value),
          ) as RecommendData;
        } catch {
          data = { viewers: [], profile: null };
        }
        if (!data.viewers.length && !data.profile) {
          const message = "未获取到推荐数据";
          recordBossMistake("recommend", message, tab.name);
          return fail(message);
        }
        return ok({
          whoViewedMe: data.viewers.map((v) => ({
            name: String(v.name ?? ""),
            company: String(v.company ?? ""),
            title: String(v.title ?? ""),
            salary: String(v.salary ?? ""),
          })),
          profile: {
            name: String(data.profile?.name ?? ""),
            experience: String(data.profile?.experience ?? ""),
            status: String(data.profile?.status ?? ""),
            expectation: String(data.profile?.expectation ?? ""),
          },
        });
      } catch (error) {
        recordBossMistake(
          "recommend",
          error instanceof Error ? error.message : String(error),
          tab.name,
        );
        throw error;
      } finally {
        if (!tab.reusable) await closeBossTab(page);
      }
    },
  });

  site.command("chat", {
    description: "获取沟通消息列表",
    scope: "page",
    loginRequired: "required",
    result: chatResult,
    parameters: z.object({
      limit: z.coerce.number().optional().default(10).describe("返回条数"),
    }),
    handler: async (params, ctx) => {
      const tab = await openReadOnlyBossTab(ctx, "boss-chat-list");
      if (!tab) {
        recordBossMistake(
          "chat",
          "无法从 BrowserCommandContext 创建独立采集 tab",
          "boss-chat-list",
        );
        return fail("需要浏览器上下文以创建独立采集 tab");
      }
      const page = tab.page;
      try {
        const url = `https://www.zhipin.com/web/geek/chat?__xbrowser_tab=${encodeURIComponent(tab.name)}`;
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(5000);
        const evaluate = async (
          expression: string,
        ): Promise<BridgeResponse> => ({
          ok: true,
          data: { value: await page.evaluate(expression) },
        });
        const healthResponse = await evaluate(bossMemoryExpression());
        if (healthResponse.ok !== true) {
          const message = healthResponse.error || "页面健康检查失败";
          recordBossMistake("chat", message, tab.name);
          return fail(message);
        }
        const healthError = assertBossMemory(
          bridgeData(healthResponse).value as BossMemory & {
            ready?: string;
            url?: string;
          },
        );
        if (healthError) {
          recordBossMistake("chat", healthError, tab.name);
          return fail(healthError);
        }
        const chatLimit = params.limit ?? 10;
        const chatScript =
          textOf.toString() +
          "\nconst extract = " +
          extractChats.toString() +
          ";\nreturn extract(" +
          chatLimit +
          ");";
        const rawResponse = await evaluate(
          "JSON.stringify((function(){" + chatScript + "})())",
        );
        let raw: ChatData[] = [];
        try {
          raw = JSON.parse(String(bridgeData(rawResponse).value)) as ChatData[];
        } catch {
          raw = [];
        }
        if (!raw.length) {
          const message = "未找到聊天消息";
          recordBossMistake("chat", message, tab.name);
          return fail(message);
        }
        return ok(
          raw.map((item) => ({
            sender: String(item.sender ?? ""),
            company: String(item.company ?? ""),
            role: String(item.role ?? ""),
            time: String(item.time ?? ""),
            preview: String(item.preview ?? ""),
          })),
        );
      } catch (error) {
        recordBossMistake(
          "chat",
          error instanceof Error ? error.message : String(error),
          tab.name,
        );
        throw error;
      } finally {
        if (!tab.reusable) await closeBossTab(page);
      }
    },
  });

  site.command("chat-reply", {
    description:
      "在独立 Chromium 采集器中回复指定对话；--dry-run 只完成选会和输入校验，不发送",
    scope: "page",
    loginRequired: "required",
    result: chatReplyResult,
    parameters: z.object({
      keyword: z.string().describe('对话关键词，如 "德熙"'),
      message: z.string().describe("要发送的回复内容"),
      dryRun: z.coerce
        .boolean()
        .optional()
        .default(false)
        .describe("只验证选会与输入，不点击发送"),
      tabName: z
        .string()
        .optional()
        .default("boss-chat")
        .describe("chat-reply 复用的独立 tab 标记"),
    }),
    examples: [
      {
        cmd: 'xbrowser --cdp http://127.0.0.1:9445 --session boss-collect boss chat-reply --keyword "德熙" --message "您好" --dry-run true',
        description: "独立 Chromium 可控验证",
      },
    ],
    handler: async (params, ctx) => {
      const tab = await openReusableBossTab(ctx, params.tabName);
      if (!tab) {
        recordBossMistake(
          "chat-reply",
          "无法从 BrowserCommandContext 创建或复用 chat tab",
          params.tabName,
        );
        return fail("需要浏览器上下文以创建或复用 chat tab");
      }
      const page = tab.page;
      const CHAT_URL = `https://www.zhipin.com/web/geek/chat?__xbrowser_tab=${encodeURIComponent(tab.name)}`;
      const failWith = (message: string) => {
        recordBossMistake("chat-reply", message, params.tabName);
        return fail(message);
      };
      try {
        await page.goto(CHAT_URL, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
        await page.waitForTimeout(3000);
        await page
          .evaluate(
            `history.replaceState(null, '', ${JSON.stringify(CHAT_URL)})`,
          )
          .catch(() => {});
        const evaluate = async (expression: string): Promise<unknown> =>
          page.evaluate(expression);
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
        const healthErrorShape = rejectUnsafeEvaluate(
          healthResponse,
          "页面健康检查失败",
        );
        if (healthErrorShape) return failWith(healthErrorShape);
        const health = healthResponse as {
          ready?: string;
          url?: string;
          usedMB?: number | null;
          limitMB?: number | null;
        } | null;
        if (health?.ready !== "complete" || !health.url?.includes("zhipin.com"))
          return failWith("BOSS 页面未就绪");
        if (
          typeof health.usedMB === "number" &&
          typeof health.limitMB === "number"
        ) {
          const usedRatio = health.usedMB / health.limitMB;
          if (usedRatio > 0.65)
            return failWith(
              `BOSS 渲染进程内存过高（${health.usedMB}/${health.limitMB} MB），已拒绝继续写入`,
            );
        }
        const targetResponse = await evaluate(`
          (() => {
            const el = [...document.querySelectorAll('.friend-content')]
              .find(e => e.innerText.includes(${JSON.stringify(params.keyword)}));
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          })()
        `);
        const targetErrorShape = rejectUnsafeEvaluate(
          targetResponse,
          "读取会话列表失败",
        );
        if (targetErrorShape) return failWith(targetErrorShape);
        const target = targetResponse as { x?: number; y?: number } | null;
        if (!target?.x || !target?.y)
          return failWith(`未找到包含 "${params.keyword}" 的对话`);
        await page.mouse.move(target.x - 30, target.y - 10);
        await page.mouse.move(target.x, target.y, { steps: 8 });
        await page.mouse.click(target.x, target.y);
        await sleep(2000);
        const hasInput = await evaluate(
          `Boolean(document.querySelector('.chat-input'))`,
        );
        if (hasInput !== true)
          return failWith("未找到聊天输入框，请确认已打开对话");
        if (params.dryRun) {
          return ok({ sent: false, to: params.keyword }, [
            `dry-run 通过：已选中 "${params.keyword}"，输入存在，未写入或发送`,
          ]);
        }
        await page.fill(".chat-input", params.message, { timeout: 10000 });
        await sleep(500);
        const clickedResponse = await evaluate(`
          (() => {
            const r = document.querySelector('.btn-send')?.getBoundingClientRect();
            if (!r || r.width <= 0 || r.height <= 0) return null;
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          })()
        `);
        const clickedErrorShape = rejectUnsafeEvaluate(
          clickedResponse,
          "读取发送按钮失败",
        );
        if (clickedErrorShape) return failWith(clickedErrorShape);
        const sendButton = clickedResponse as { x?: number; y?: number } | null;
        if (!sendButton?.x || !sendButton?.y) return failWith("未找到发送按钮");
        await page.mouse.move(sendButton.x - 20, sendButton.y - 8);
        await page.mouse.move(sendButton.x, sendButton.y, { steps: 6 });
        await page.mouse.click(sendButton.x, sendButton.y);
        await sleep(1000);
        const verifyResponse = await evaluate(`
          (() => {
            const text = ${JSON.stringify(params.message)};
            return [...document.querySelectorAll('.message-item')].some(e => e.innerText.includes(text));
          })()
        `);
        const verifyErrorShape = rejectUnsafeEvaluate(
          verifyResponse,
          "读取发送结果失败",
        );
        if (verifyErrorShape) return failWith(verifyErrorShape);
        if (verifyResponse !== true)
          return failWith("发送后未在会话中找到消息");
        return ok(
          {
            sent: true,
            to: params.keyword,
            message: params.message.slice(0, 50),
          },
          [`已回复 "${params.keyword}"`],
        );
      } catch (error) {
        recordBossMistake(
          "chat-reply",
          error instanceof Error ? error.message : String(error),
          params.tabName,
        );
        throw error;
      }
    },
  });

  site.command("resume", {
    description: "获取在线简历信息",
    scope: "page",
    loginRequired: "required",
    result: resumeResult,
    parameters: z.object({}),
    handler: async (_params, ctx) => {
      const tab = await openReadOnlyBossTab(ctx, "boss-resume");
      if (!tab) {
        recordBossMistake(
          "resume",
          "无法从 BrowserCommandContext 创建独立采集 tab",
          "boss-resume",
        );
        return fail("需要浏览器上下文以创建独立采集 tab");
      }
      const page = tab.page;
      try {
        const url = `https://www.zhipin.com/web/geek/resume?__xbrowser_tab=${encodeURIComponent(tab.name)}`;
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(6000);
        const evaluate = async (
          expression: string,
        ): Promise<BridgeResponse> => ({
          ok: true,
          data: { value: await page.evaluate(expression) },
        });
        const healthResponse = await evaluate(bossMemoryExpression());
        if (healthResponse.ok !== true) {
          const message = healthResponse.error || "页面健康检查失败";
          recordBossMistake("resume", message, tab.name);
          return fail(message);
        }
        const healthError = assertBossMemory(
          bridgeData(healthResponse).value as BossMemory & {
            ready?: string;
            url?: string;
          },
        );
        if (healthError) {
          recordBossMistake("resume", healthError, tab.name);
          return fail(healthError);
        }
        const resumeScript =
          textOf.toString() +
          "\nconst parseResumeContact = " +
          parseResumeContact.toString() +
          ";" +
          "\nconst extract = " +
          extractResume.toString() +
          ";" +
          '\ntry { return extract(); } catch (error) { return { name: "", error: String(error) }; }';
        const rawResponse = await evaluate(
          "JSON.stringify((function(){" + resumeScript + "})())",
        );
        let parsed: ResumeData | null = null;
        try {
          parsed = JSON.parse(
            String(bridgeData(rawResponse).value),
          ) as ResumeData;
        } catch {
          parsed = null;
        }
        if (!parsed?.name) {
          const message =
            parsed && "error" in parsed
              ? `简历解析失败：${String(parsed.error)}`
              : "未获取到简历信息";
          recordBossMistake("resume", message, tab.name);
          return fail(message);
        }
        return ok({
          name: String(parsed.name ?? ""),
          experience: String(parsed.experience ?? ""),
          education: String(parsed.education ?? ""),
          phone: String(parsed.phone ?? ""),
          email: String(parsed.email ?? ""),
          advantage: String(parsed.advantage ?? "").slice(0, 200),
          status: String(parsed.status ?? ""),
        });
      } catch (error) {
        recordBossMistake(
          "resume",
          error instanceof Error ? error.message : String(error),
          tab.name,
        );
        throw error;
      } finally {
        if (!tab.reusable) await closeBossTab(page);
      }
    },
  });
}
