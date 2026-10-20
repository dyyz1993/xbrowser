import { z } from "zod/v4";
import type { XCLIAPI } from "@dyyz1993/xcli-core";
import { ok, fail } from "@dyyz1993/xcli-core";
import { mkdir, appendFile } from "fs/promises";
import { dirname, join } from "path";
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

const applyResult = z.object({
  dryRun: z.boolean(),
  quota: z.object({
    used: z.number(),
    limit: z.number(),
  }),
  candidates: z.array(
    z.object({
      title: z.string(),
      company: z.string(),
      salary: z.string(),
      url: z.string(),
      reason: z.string(),
    }),
  ),
  submitted: z.array(
    z.object({
      title: z.string(),
      company: z.string(),
      salary: z.string(),
      url: z.string(),
      success: z.boolean(),
      status: z.string(),
    }),
  ).optional(),
  stoppedAt: z.string().optional(),
});

const smartReplyResult = z.object({
  mode: z.enum(["draft", "sent"]),
  quota: z.object({
    used: z.number(),
    limit: z.number(),
  }),
  replies: z.array(
    z.object({
      conversation: z.string(),
      company: z.string(),
      intent: z.string(),
      job: z.object({
        title: z.string(),
        salary: z.string(),
        requirements: z.string(),
      }),
      reply: z.string(),
      sent: z.boolean(),
      duplicateBlocked: z.boolean(),
    }),
  ),
  reportPath: z.string().optional(),
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
  if (!page) throw new Error("browserContext.newPage returned no page");
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
  if (!page) throw new Error("browserContext.newPage returned no page");
  return { name, page, reusable: false };
}

async function closeBossTab(page: Page): Promise<void> {
  await page.close().catch(() => {});
}

const DEFAULT_COMPANY_BLOCKLIST = [
  "美团",
  "腾讯",
  "阿里",
  "阿里巴巴",
  "字节",
  "字节跳动",
  "华为",
  "网易",
  "京东",
  "百度",
  "拼多多",
  "小米",
  "快手",
  "滴滴",
  "美团点评",
];

type SalaryRange = { min: number; max: number; months: number | null };

export function parseMonthlySalaryK(input: string): SalaryRange | null {
  const match = input
    .replace(/\s+/g, "")
    .match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)K(?:·(\d+)薪)?$/);
  if (!match) return null;
  return {
    min: Number(match[1]),
    max: Number(match[2]),
    months: match[3] ? Number(match[3]) : null,
  };
}

export function isEligibleApplySalary(input: string): boolean {
  const salary = parseMonthlySalaryK(input);
  return !!salary && salary.min >= 20 && salary.max >= 28;
}

export function companyIsBlocked(
  company: string,
  extraBlocklist: readonly string[] = [],
): boolean {
  const terms = [...DEFAULT_COMPANY_BLOCKLIST, ...extraBlocklist]
    .map(term => term.trim())
    .filter(Boolean);
  return terms.some(term => company.includes(term));
}

type DailyQuota = {
  date: string;
  count: number;
  sentMessages?: Array<{ conversation: string; reply: string }>;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

type PluginStorage = {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
};

function storageOf(ctx: unknown): PluginStorage | null {
  const storage = (ctx as { storage?: unknown }).storage;
  if (!storage || typeof storage !== "object") return null;
  const candidate = storage as Partial<PluginStorage>;
  if (typeof candidate.get !== "function" || typeof candidate.set !== "function") {
    return null;
  }
  return candidate as PluginStorage;
}

async function readDailyQuota(
  storage: PluginStorage | null,
  key: string,
): Promise<DailyQuota> {
  const saved = await storage?.get<DailyQuota>(key).catch(() => null);
  return saved?.date === today() ? saved : { date: today(), count: 0 };
}

async function incrementDailyQuota(
  storage: PluginStorage | null,
  key: string,
  quota: DailyQuota,
  by = 1,
): Promise<DailyQuota> {
  const next = { ...quota, date: today(), count: quota.count + by };
  await storage?.set(key, next).catch(() => undefined);
  return next;
}

type Intent = "interview" | "jd" | "experience" | "salary";

export function classifyMessageIntent(message: string): Intent {
  if (/面试|电话|视频|沟通时间|方便聊聊|约/.test(message)) return "interview";
  if (/JD|岗位描述|职位描述|职责|要求/.test(message)) return "jd";
  if (/薪资|期望薪资|待遇|报酬|工资/.test(message)) return "salary";
  return "experience";
}

export function buildSmartReply(input: {
  intent: Intent;
  sender: string;
  job: Pick<JobDetailData, "jobTitle" | "salary" | "description">;
  resume: Pick<ResumeData, "name" | "experience" | "status" | "advantage">;
}): string {
  const requirements = input.job.description
    .replace(/\s+/g, " ")
    .slice(0, 120);
  const experience = input.resume.experience || "10年经验";
  const availability = input.resume.status || "随时到岗";
  if (input.intent === "interview") {
    return `${input.sender}您好，${input.job.jobTitle}（${input.job.salary}）与我的方向匹配。我${experience}，${availability}，方便按您建议的时间面试；可先看我的项目与工程化经验，若需补充材料我随后提供。`;
  }
  if (input.intent === "jd") {
    return `${input.sender}您好，已读 ${input.job.jobTitle} 岗位信息。核心要求可概括为：${requirements}。我在前端/Node 全栈、AI 工具链和自动化工程上有落地产品，能对齐该职责；如需完整材料我可进一步整理发送。`;
  }
  if (input.intent === "salary") {
    return `${input.sender}您好，该岗位 ${input.job.salary} 在我的可沟通范围内。我会结合职责、团队与技术栈综合评估，也欢迎说明绩效与项目激励结构；我们可以先完成技术沟通再确认细节。`;
  }
  return `${input.sender}您好，我${experience}，${availability}。${input.job.jobTitle}（${input.job.salary}）要求：${requirements}。我有前端、Node.js、AI 工具链与团队负责经验，可提供可验证的开源和产品成果，期待进一步沟通。`;
}

function redactContact(value: string): string {
  return value
    .replace(/1[3-9]\d{9}/g, "1**********")
    .replace(/[\w.+-]+@[\w.-]+/g, "[email]");
}

async function appendSmartReplyLog(
  path: string,
  entry: Record<string, unknown>,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify(entry, null, 2) + "\n", "utf8");
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
      let tab: BossTab | null = null;
      try {
        tab = await openReadOnlyBossTab(ctx, "boss-search");
        if (!tab) {
          recordBossMistake(
            "search",
            "无法从 BrowserCommandContext 创建独立采集 tab",
            "boss-search",
          );
          return fail("需要浏览器上下文以创建独立采集 tab");
        }
        const page = tab.page;
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
          tab?.name ?? "boss-search",
        );
        throw error;
      } finally {
        if (tab && !tab.reusable) await closeBossTab(tab.page);
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
      let tab: BossTab | null = null;
      try {
        tab = await openReadOnlyBossTab(ctx, "boss-detail");
        if (!tab) {
          recordBossMistake(
            "detail",
            "无法从 BrowserCommandContext 创建独立采集 tab",
            "boss-detail",
          );
          return fail("需要浏览器上下文以创建独立采集 tab");
        }
        const page = tab.page;
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
          tab?.name ?? "boss-detail",
        );
        throw error;
      } finally {
        if (tab && !tab.reusable) await closeBossTab(tab.page);
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
      let tab: BossTab | null = null;
      try {
        tab = await openReadOnlyBossTab(ctx, "boss-companies");
        if (!tab) {
          recordBossMistake(
            "companies",
            "无法从 BrowserCommandContext 创建独立采集 tab",
            "boss-companies",
          );
          return fail("需要浏览器上下文以创建独立采集 tab");
        }
        const page = tab.page;
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
          tab?.name ?? "boss-companies",
        );
        throw error;
      } finally {
        if (tab && !tab.reusable) await closeBossTab(tab.page);
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
      let tab: BossTab | null = null;
      try {
        tab = await openReadOnlyBossTab(ctx, "boss-recommend");
        if (!tab) {
          recordBossMistake(
            "recommend",
            "无法从 BrowserCommandContext 创建独立采集 tab",
            "boss-recommend",
          );
          return fail("需要浏览器上下文以创建独立采集 tab");
        }
        const page = tab.page;
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
          tab?.name ?? "boss-recommend",
        );
        throw error;
      } finally {
        if (tab && !tab.reusable) await closeBossTab(tab.page);
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
      let tab: BossTab | null = null;
      try {
        tab = await openReadOnlyBossTab(ctx, "boss-chat-list");
        if (!tab) {
          recordBossMistake(
            "chat",
            "无法从 BrowserCommandContext 创建独立采集 tab",
            "boss-chat-list",
          );
          return fail("需要浏览器上下文以创建独立采集 tab");
        }
        const page = tab.page;
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
          tab?.name ?? "boss-chat-list",
        );
        throw error;
      } finally {
        if (tab && !tab.reusable) await closeBossTab(tab.page);
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
      let tab: BossTab | null = null;
      const failWith = (message: string) => {
        recordBossMistake("chat-reply", message, params.tabName);
        return fail(message);
      };
      try {
        tab = await openReusableBossTab(ctx, params.tabName);
        if (!tab) {
          return failWith("无法从 BrowserCommandContext 创建或复用 chat tab");
        }
        const page = tab.page;
        const CHAT_URL = `https://www.zhipin.com/web/geek/chat?__xbrowser_tab=${encodeURIComponent(tab.name)}`;
        if (tab.reusable) {
          const currentUrl = await pageUrl(page);
          let currentTabName: string | null = null;
          try {
            currentTabName = new URL(currentUrl).searchParams.get(
              "__xbrowser_tab",
            );
          } catch {
            currentTabName = null;
          }
          if (
            !currentUrl.startsWith("https://www.zhipin.com/web/geek/chat") ||
            currentTabName !== tab.name
          ) {
            return failWith("复用的 chat tab 健康检查失败");
          }
        } else {
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
        }
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
          tab?.name ?? params.tabName,
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
      let tab: BossTab | null = null;
      try {
        tab = await openReadOnlyBossTab(ctx, "boss-resume");
        if (!tab) {
          recordBossMistake(
            "resume",
            "无法从 BrowserCommandContext 创建独立采集 tab",
            "boss-resume",
          );
          return fail("需要浏览器上下文以创建独立采集 tab");
        }
        const page = tab.page;
        const url = `https://www.zhipin.com/web/geek/resume?__xbrowser_tab=${encodeURIComponent(tab.name)}`;
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page
          .waitForFunction(
            "document.body.innerText.includes('教育经历') && document.body.innerText.includes('专业技能') && document.body.innerText.includes('本科')",
            { timeout: 15000, polling: 500 },
          )
          .catch(() => page.waitForTimeout(8000));
        await page.waitForTimeout(500);
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
          tab?.name ?? "boss-resume",
        );
        throw error;
      } finally {
        if (tab && !tab.reusable) await closeBossTab(tab.page);
      }
    },
  });

  site.command("apply", {
    description:
      "筛选并投递 Boss 职位；默认 dry-run，仅输出可投递清单，不点击沟通/投递",
    scope: "page",
    loginRequired: "required",
    result: applyResult,
    parameters: z.object({
      query: z.string().optional().default("AI工程师").describe("职位关键词"),
      city: z.string().optional().describe("城市代码，如 101280100"),
      limit: z.coerce.number().optional().default(20).describe("筛选岗位数量"),
      dryRun: z.coerce.boolean().optional().default(true).describe("只生成清单，不点击"),
      dailyLimit: z.coerce.number().optional().default(20).describe("每日投递上限"),
      blocklist: z.string().optional().describe("追加排除公司，逗号分隔"),
    }),
    examples: [
      {
        cmd: 'xbrowser boss apply --query "AI工程师" --dry-run true',
        description: "生成投递清单",
      },
    ],
    handler: async (params, ctx) => {
      const storage = storageOf(ctx);
      const quota = await readDailyQuota(storage, "boss_apply_daily_quota");
      if (quota.count >= params.dailyLimit) {
        return ok({
          dryRun: params.dryRun,
          quota: { used: quota.count, limit: params.dailyLimit },
          candidates: [],
          submitted: [],
          stoppedAt: "daily-limit",
        }, [`今日已投递 ${quota.count}/${params.dailyLimit} 个岗位，已达上限`]);
      }

      let searchTab: BossTab | null = null;
      let jobs: Array<{
        title: string;
        company: string;
        salary: string;
        detailUrl: string;
      }> = [];
      try {
        searchTab = await openReadOnlyBossTab(ctx, "boss-apply-search");
        if (!searchTab) {
          recordBossMistake(
            "apply",
            "无法从 BrowserCommandContext 创建独立采集 tab",
            "boss-apply-search",
          );
          return fail("需要浏览器上下文以创建独立采集 tab");
        }
        await searchTab.page.goto(
          `https://www.zhipin.com/web/geek/job?query=${encodeURIComponent(params.query)}&city=${params.city ?? ""}&__xbrowser_tab=boss-apply-search`,
          { waitUntil: "domcontentloaded", timeout: 20000 },
        );
        await searchTab.page.waitForTimeout(3000);
        const health = await searchTab.page
          .evaluate(bossMemoryExpression())
          .catch(() => null);
        const healthError = assertBossMemory(health as never);
        if (healthError) {
          recordBossMistake("apply", healthError, searchTab.name);
          return fail(healthError);
        }
        const raw = await searchTab.page.evaluate<string>(`
          JSON.stringify([...document.querySelectorAll('.job-card-box')].slice(0, ${params.limit}).map(card => {
            const link = card.querySelector('a[href*=job_detail]');
            const href = link ? link.getAttribute('href') : '';
            const absolute = href && href.startsWith('http')
              ? href
              : 'https://www.zhipin.com' + (href || '');
            return {
              title: card.querySelector('.job-name')?.textContent?.trim() ?? '',
              company: card.querySelector('.boss-name')?.textContent?.trim() ?? '',
              salary: card.querySelector('.job-salary')?.textContent?.trim() ?? '',
              detailUrl: absolute,
            };
          }))
        `);
        jobs = JSON.parse(raw) as typeof jobs;
      } catch (error) {
        recordBossMistake(
          "apply",
          error instanceof Error ? error.message : String(error),
          searchTab?.name ?? "boss-apply-search",
        );
        return fail(`读取投递候选失败：${error instanceof Error ? error.message : String(error)}`);
      } finally {
        if (searchTab && !searchTab.reusable) await closeBossTab(searchTab.page);
      }

      const extraBlocklist = (params.blocklist ?? "")
        .split(",")
        .map(value => value.trim())
        .filter(Boolean);
      const candidates = jobs
        .filter(job => isEligibleApplySalary(job.salary))
        .filter(job => !companyIsBlocked(job.company, extraBlocklist))
        .map(job => ({
          title: job.title,
          company: job.company,
          salary: job.salary,
          url: job.detailUrl,
          reason: "salary-and-company-passed",
        }));

      if (params.dryRun) {
        return ok({
          dryRun: true,
          quota: { used: quota.count, limit: params.dailyLimit },
          candidates,
          submitted: [],
        }, [`dry-run：${candidates.length} 个岗位符合条件，未点击任何按钮`]);
      }

      const submitted: Array<{
        title: string;
        company: string;
        salary: string;
        url: string;
        success: boolean;
        status: string;
      }> = [];
      let currentQuota = quota;
      for (const [index, job] of candidates.entries()) {
        if (currentQuota.count >= params.dailyLimit) {
          return ok({
            dryRun: false,
            quota: { used: currentQuota.count, limit: params.dailyLimit },
            candidates,
            submitted,
            stoppedAt: "daily-limit",
          });
        }
        let applyTab: BossTab | null = null;
        try {
          applyTab = await openReadOnlyBossTab(ctx, `boss-apply-${index + 1}`);
          if (!applyTab) throw new Error("无法创建独立投递 tab");
          const url = `${job.url}${job.url.includes("?") ? "&" : "?"}__xbrowser_tab=${encodeURIComponent(applyTab.name)}`;
          await applyTab.page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 20000,
          });
          await applyTab.page.waitForTimeout(2000);
          const button = await applyTab.page.evaluate<{
            x: number;
            y: number;
            confirm?: { x: number; y: number };
          } | null>(`
            (() => {
              const el = [...document.querySelectorAll('.btn-startchat, a, button')]
                .find(el => /立即沟通|投递简历|申请职位/.test(el.innerText || '') && el.getBoundingClientRect().width > 0);
              if (!el) return null;
              const r = el.getBoundingClientRect();
              const confirmEl = [...document.querySelectorAll('button, a')]
                .find(el => /确定|确认/.test(el.innerText || '') && el.getBoundingClientRect().width > 0);
              const cr = confirmEl?.getBoundingClientRect();
              return {
                x: r.x + r.width / 2,
                y: r.y + r.height / 2,
                ...(cr ? { confirm: { x: cr.x + cr.width / 2, y: cr.y + cr.height / 2 } } : {}),
              };
            })()
          `).catch(() => null);
          if (!button) throw new Error("未找到可见沟通或投递按钮");
          await applyTab.page.mouse.move(button.x - 10, button.y - 5, { steps: 4 });
          await applyTab.page.mouse.click(button.x, button.y);
          await applyTab.page.waitForTimeout(800);
          if (button.confirm) {
            await applyTab.page.mouse.click(button.confirm.x, button.confirm.y);
            await applyTab.page.waitForTimeout(800);
          }
          const verified = await applyTab.page.evaluate<boolean>(`
            Boolean(
              location.href.includes('/web/geek/chat') ||
              document.querySelector('.chat-input, .job-chat, [class*=chat-input]')
            )
          `).catch(() => false);
          if (!verified) throw new Error("未验证到沟通会话或投递成功状态");
          currentQuota = await incrementDailyQuota(
            storage,
            "boss_apply_daily_quota",
            currentQuota,
          );
          submitted.push({ ...job, success: true, status: "conversation-created" });
        } catch (error) {
          recordBossMistake(
            "apply",
            error instanceof Error ? error.message : String(error),
            applyTab?.name ?? `boss-apply-${index + 1}`,
          );
          submitted.push({
            ...job,
            success: false,
            status: error instanceof Error ? error.message : String(error),
          });
        } finally {
          if (applyTab && !applyTab.reusable) await closeBossTab(applyTab.page);
        }
        if (index < Math.min(candidates.length, params.dailyLimit - currentQuota.count) - 1) {
          await sleep(45_000 + Math.floor(Math.random() * 75_001));
        }
      }
      return ok({
        dryRun: false,
        quota: { used: currentQuota.count, limit: params.dailyLimit },
        candidates,
        submitted,
      });
    },
  });

  site.command("smart-reply", {
    description:
      "根据会话消息与职位信息生成确定性回复；默认 draft 不发送，--send true 才真实发送",
    scope: "page",
    loginRequired: "required",
    result: smartReplyResult,
    parameters: z.object({
      keyword: z.string().optional().describe("指定会话关键词；缺省处理最近会话"),
      limit: z.coerce.number().optional().default(5).describe("处理会话数量"),
      send: z.coerce.boolean().optional().default(false).describe("默认仅生成草稿"),
      dailyLimit: z.coerce.number().optional().default(10).describe("每日发送上限"),
      report: z.string().optional().default("output/boss-apply/smart-reply-drafts.jsonl").describe("上下文与草稿日志"),
    }),
    examples: [
      { cmd: "xbrowser boss smart-reply --limit 5", description: "生成 5 条回复草稿" },
    ],
    handler: async (params, ctx) => {
      const storage = storageOf(ctx);
      const quotaKey = "boss_smart_reply_daily_quota";
      let quota = await readDailyQuota(storage, quotaKey);
      quota.sentMessages ??= [];
      let chatTab: BossTab | null = null;
      let resumeTab: BossTab | null = null;
      let detailTab: BossTab | null = null;
      const reportPath = join(ctx.cwd, params.report);
      const replies: Array<{
        conversation: string;
        company: string;
        intent: string;
        job: { title: string; salary: string; requirements: string };
        reply: string;
        sent: boolean;
        duplicateBlocked: boolean;
      }> = [];

      try {
        chatTab = await openReadOnlyBossTab(ctx, "boss-smart-chat");
        if (!chatTab) throw new Error("无法创建独立会话采集 tab");
        resumeTab = await openReadOnlyBossTab(ctx, "boss-smart-resume");
        if (!resumeTab) throw new Error("无法创建独立简历采集 tab");
        detailTab = await openReadOnlyBossTab(ctx, "boss-smart-detail");
        if (!detailTab) throw new Error("无法创建独立职位详情 tab");

        await chatTab.page.goto(
          "https://www.zhipin.com/web/geek/chat?__xbrowser_tab=boss-smart-chat",
          { waitUntil: "domcontentloaded", timeout: 20000 },
        );
        await chatTab.page.waitForTimeout(4000);
        const rawChats = await chatTab.page.evaluate<string>(`
          JSON.stringify((function(){
            ${textOf.toString()}
            const extract = ${extractChats.toString()};
            return extract(${params.limit});
          })())
        `);
        const chats = JSON.parse(rawChats) as ChatData[];

        await resumeTab.page.goto(
          "https://www.zhipin.com/web/geek/resume?__xbrowser_tab=boss-smart-resume",
          { waitUntil: "domcontentloaded", timeout: 20000 },
        );
        await resumeTab.page.waitForTimeout(4000);
        const rawResume = await resumeTab.page.evaluate<string>(`
          JSON.stringify((function(){
            ${textOf.toString()}
            ${parseResumeContact.toString()}
            const extract = ${extractResume.toString()};
            return extract();
          })())
        `);
        const resume = JSON.parse(rawResume) as ResumeData;

        for (const chat of chats) {
          if (params.keyword && !`${chat.sender}${chat.company}`.includes(params.keyword)) continue;
          const intent = classifyMessageIntent(chat.preview);
          const job = {
            jobTitle: chat.preview.slice(0, 40) || "待确认岗位",
            salary: "",
            company: chat.company,
            location: "",
            experience: "",
            education: "",
            description: chat.preview,
          } satisfies JobDetailData;
          const reply = buildSmartReply({
            intent,
            sender: chat.sender,
            job,
            resume,
          });
          const conversationKey = `${chat.sender}|${chat.company}|${chat.role}`;
          const duplicateBlocked = (quota.sentMessages ?? []).some(
            item => item.conversation === conversationKey && item.reply === reply,
          );
          const canSend =
            params.send &&
            !duplicateBlocked &&
            quota.count < params.dailyLimit;
          if (canSend) {
            const target = await chatTab.page.evaluate<{ x: number; y: number } | null>(`
              (() => {
                const el = [...document.querySelectorAll('.friend-content')]
                  .find(el => el.innerText.includes(${JSON.stringify(chat.sender)}));
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
              })()
            `).catch(() => null);
            if (!target) throw new Error(`未找到会话 ${chat.sender}`);
            await chatTab.page.mouse.click(target.x, target.y);
            await chatTab.page.waitForTimeout(1000);
            await chatTab.page.fill(".chat-input", reply, { timeout: 10000 });
            const sendButton = await chatTab.page.evaluate<{ x: number; y: number } | null>(`
              (() => {
                const r = document.querySelector('.btn-send')?.getBoundingClientRect();
                return r && r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
              })()
            `).catch(() => null);
            if (!sendButton) throw new Error("未找到发送按钮");
            await chatTab.page.mouse.click(sendButton.x, sendButton.y);
            await chatTab.page.waitForTimeout(1000);
            const verified = await chatTab.page.evaluate<boolean>(`
              [...document.querySelectorAll('.message-item')].some(el => el.innerText.includes(${JSON.stringify(reply.slice(0, 30))}))
            `).catch(() => false);
            if (!verified) throw new Error("发送后未验证到消息");
            quota = await incrementDailyQuota(storage, quotaKey, quota);
            quota.sentMessages = [...(quota.sentMessages ?? []), { conversation: conversationKey, reply }];
            await storage?.set(quotaKey, quota).catch(() => undefined);
          }
          const item = {
            conversation: conversationKey,
            company: chat.company,
            intent,
            job: {
              title: job.jobTitle,
              salary: job.salary,
              requirements: job.description.replace(/\s+/g, " ").slice(0, 180),
            },
            reply,
            sent: canSend,
            duplicateBlocked,
          };
          replies.push(item);
          await appendSmartReplyLog(reportPath, {
            ...item,
            reply: redactContact(item.reply),
            job: { ...item.job, requirements: redactContact(item.job.requirements) },
          });
        }

        return ok({
          mode: params.send ? "sent" : "draft",
          quota: { used: quota.count, limit: params.dailyLimit },
          replies,
          reportPath,
        });
      } catch (error) {
        recordBossMistake(
          "smart-reply",
          error instanceof Error ? error.message : String(error),
          chatTab?.name ?? "boss-smart-chat",
        );
        return fail(`智能回复失败：${error instanceof Error ? error.message : String(error)}`);
      } finally {
        if (detailTab && !detailTab.reusable) await closeBossTab(detailTab.page);
        if (resumeTab && !resumeTab.reusable) await closeBossTab(resumeTab.page);
        if (chatTab && !chatTab.reusable) await closeBossTab(chatTab.page);
      }
    },
  });
}
