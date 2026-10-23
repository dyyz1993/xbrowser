/**
 * csdn draft —— 一键发草稿（chrome-bridge 通道，用户浏览器登录态）
 *
 * 流程：横版裁剪配图 → 直传 CSDN CDN（签名截获+OBS 驼峰表单）→ editor.csdn.net/md
 * 填标题+正文（PRE paste 管线，换行零丢失）→ 保存草稿 → 返回编辑器 URL 交用户确认发布。
 *
 * 铁律（用户 2026-10-22 定）：草稿先行——本命令默认不点发布；
 * 配图一律横版 16:9；地址/用户名明文不掩码（引流且纯文本不判链接）。
 */
import { z } from 'zod/v4';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { CommandContext } from '@dyyz1993/xcli-core';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const MD_EDITOR_URL = 'https://editor.csdn.net/md/?not_checkout=1';

export interface BridgeTransport {
  call(cmd: string, args: Record<string, unknown>): Promise<unknown>;
}

export function createHttpBridge(port = 9347): BridgeTransport {
  return {
    async call(cmd, args) {
      const r = await fetch(`http://127.0.0.1:${port}/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd, args }),
      }).then((x) => x.json());
      const j = r as { ok?: boolean; data?: unknown; error?: string };
      if (j && j.ok === false && j.error) throw new Error(String(j.error).slice(0, 200));
      return j?.data;
    },
  };
}

/** 横版裁剪（sips，macOS）：高于 16:9 则中心裁剪 */
export async function landscapeCrop(path: string): Promise<void> {
  const { stdout } = await execFileAsync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', path]);
  const w = Number((stdout.match(/pixelWidth:\s*(\d+)/) || [])[1] || 0);
  const h = Number((stdout.match(/pixelHeight:\s*(\d+)/) || [])[1] || 0);
  const targetH = Math.round((w * 9) / 16);
  if (!w || !h || h <= targetH) return;
  const offsetY = Math.round((h - targetH) / 2);
  await execFileAsync('sips', ['-c', String(targetH), String(w), '--cropOffset', String(offsetY), '0', path, '--out', path]);
}

/** 在 markdown 文本中插图：封面在引言行后，其余按锚点文本行后（缺省顺序追加到首个二级标题后） */
export function insertImages(markdown: string, imageUrls: string[]): string {
  if (!imageUrls.length) return markdown;
  const lines = markdown.split('\n');
  const out: string[] = [];
  let coverDone = false;
  let inserted = 0;
  for (const ln of lines) {
    out.push(ln);
    if (!coverDone && ln.startsWith('> ')) {
      out.push(`![封面](${imageUrls[0]})`);
      coverDone = true;
      inserted++;
      continue;
    }
    if (coverDone && inserted < imageUrls.length && /^## /.test(ln)) {
      out.push(`![配图 ${inserted + 1}](${imageUrls[inserted]})`);
      inserted++;
    }
  }
  while (inserted < imageUrls.length) {
    out.push(`![配图 ${inserted + 1}](${imageUrls[inserted]})`);
    inserted++;
  }
  return out.join('\n');
}

/** 直传一张图：helper tab 签名截获 + OBS 驼峰表单（1:1 上传器源码复刻） */
export async function uploadImageViaBridge(
  bridge: BridgeTransport,
  opts: { helperName: string; file: Buffer; name: string },
): Promise<string> {
  const opened = (await bridge.call('task-open', {
    name: opts.helperName,
    url: 'https://mp.csdn.net/mp_blog/creation/editor',
  })) as { tabId?: number };
  const tabId = opened?.tabId;
  if (!tabId) throw new Error('helper tab 打开失败（bridge 无扩展连接？）');
  try {
    // 等上传器就绪
    for (let i = 0; i < 15; i++) {
      const r = (await bridge.call('evaluate', {
        expression: '(typeof CKEDITOR!=="undefined")&&!!document.querySelector("input.cfw-file-input")',
        tabId,
      })) as { value?: boolean };
      if (r?.value) break;
      await new Promise((res) => setTimeout(res, 2000));
    }
    const b64 = opts.file.toString('base64');
    // 触发真实签名（cfw change）
    await bridge.call('evaluate', {
      expression:
        '/* @xb-probe */(function(){var inp=document.querySelector("input.cfw-file-input");' +
        `var b64='${b64}';var bin=atob(b64);var arr=new Uint8Array(bin.length);` +
        'for(var i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);' +
        'var f=new File([arr],"img.png",{type:"image/png"});var dt=new DataTransfer();dt.items.add(f);' +
        'inp.files=dt.files;inp.dispatchEvent(new Event("change",{bubbles:true}));return "ok";})()',
      tabId,
    });
    // 等签名响应（页面钩子由调用方前置安装；此处轮询 window.__sig）
    let sig: Record<string, unknown> | null = null;
    for (let i = 0; i < 10; i++) {
      const s = (await bridge.call('evaluate', { expression: 'window.__sig?JSON.stringify(window.__sig.data):null', tabId })) as { value?: string };
      if (s?.value) {
        sig = JSON.parse(s.value) as Record<string, unknown>;
        break;
      }
      await new Promise((res) => setTimeout(res, 1500));
    }
    if (!sig) throw new Error('签名响应未截获（window.__sig 为空）');
    // OBS 驼峰表单（upload-image.ts 的契约）
    const d = sig as never as Record<string, string> & { customParam?: Record<string, unknown> };
    const host = String(d.host).replace(/\/$/, '');
    const form: Record<string, string> = {
      key: String(d.filePath),
      policy: d.policy,
      signature: d.signature,
      callbackBody: d.callbackBody ?? '',
      callbackBodyType: d.callbackBodyType ?? '',
      callbackUrl: d.callbackUrl ?? '',
      AccessKeyId: d.accessId,
    };
    const custom = (d.customParam ?? {}) as Record<string, unknown>;
    for (const k of Object.keys(custom)) form[`x:${k}`] = String(custom[k]);
    form['__file_b64'] = b64; // 页内脚本取用并替换为真 File
    const r = (await bridge.call('evaluate', {
      expression:
        '/* @xb-probe */(async function(){var d=' +
        JSON.stringify({ ...sig, __file_b64: undefined }).replace(/"customParam":\{[^}]*\}/, '"customParam":{}') +
        ';var form=new FormData();' +
        'var spec=' + JSON.stringify(Object.entries(form).filter(([k]) => k !== '__file_b64')) + ';' +
        'for(var i=0;i<spec.length;i++)form.append(spec[i][0],spec[i][1]);' +
        'var b64=form.get("__file_b64");' +
        'var bin=atob(String(b64));var arr=new Uint8Array(bin.length);' +
        'for(var i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);' +
        'form.append("file",new File([arr],"img.png",{type:"image/png"}));' +
        'form.delete("__file_b64");' +
        'var ur=await fetch(String(' + JSON.stringify(host) + ').replace(/\\/$/,""),{method:"POST",body:form});' +
        'var t=await ur.text();' +
        'return "status:"+ur.status+" body:"+t.slice(0,600);})()',
      tabId,
    })) as { value?: string };
    const out = String(r?.value ?? '');
    const m = out.match(/https:\/\/i-blog\.csdnimg\.cn\/[^\s"]+/);
    if (!m) throw new Error(`OBS 上传失败: ${out.slice(0, 200)}`);
    return m[0];
  } finally {
    await bridge.call('task-close', { name: opts.helperName }).catch(() => { });
  }
}

interface DraftDeps {
  site: { command(name: string, config: unknown): void };
  bridge: BridgeTransport;
}

export function registerDraftCommand(deps: DraftDeps): void {
  deps.site.command('draft', {
    description: '发草稿到 CSDN MD 编辑器（含横版配图直传；草稿先行，不自动发布）',
    loginRequired: 'required',
    scope: 'page',
    parameters: z.object({
      title: z.string().describe('文章标题'),
      content: z.string().optional().describe('正文 Markdown（与 file 二选一）'),
      file: z.string().optional().describe('Markdown 文件路径'),
      images: z.string().optional().describe('配图路径，逗号分隔（自动横版裁剪并直传 CDN）'),
    }),
    result: z
      .object({
        title: z.string(),
        draftUrl: z.string(),
        imageUrls: z.array(z.string()),
        chars: z.number(),
      })
      .passthrough(),
    examples: [{ cmd: 'xbrowser csdn draft --title "T" --file a.md --images c1.png,c2.png', description: '发草稿（含图）' }],
    handler: async (params: { title: string; content?: string; file?: string; images?: string }, ctx: CommandContext) => {
      // 约定：scope=page 命令须校验页面并在提供时导航（seo-plugins-comprehensive 契约测试）
      const ctxAny = ctx as unknown as { page?: { goto: (u: string, o?: Record<string, unknown>) => Promise<unknown> } };
      if (!ctxAny.page) throw new Error('需要浏览器页面');
      await ctxAny.page.goto(MD_EDITOR_URL, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => { });
      const fsp = await import('fs/promises');
      const content = params.content || (params.file ? fsp.readFile(params.file, 'utf-8') : '');
      const body = await content;
      if (!body) return fail('必须提供 --content 或 --file 参数');
      const imagePaths = (params.images || '').split(',').map((s) => s.trim()).filter(Boolean);
      const imageUrls: string[] = [];
      for (let i = 0; i < imagePaths.length; i++) {
        await landscapeCrop(imagePaths[i]);
        const buf = await fsp.readFile(imagePaths[i]);
        const url = await uploadImageViaBridge(
          deps.bridge,
          { helperName: `pub-csdn-img-${i}`, file: buf, name: `img${i}.png` },
        );
        imageUrls.push(url);
      }
      const markdown = insertImages(body, imageUrls);
      // MD 编辑器 tab
      const opened = (await deps.bridge.call('task-open', { name: 'pub-csdn-md', url: MD_EDITOR_URL })) as { tabId?: number };
      const tabId = opened?.tabId;
      if (!tabId) return fail('MD 编辑器 tab 打开失败');
      await new Promise((res) => setTimeout(res, 6000));
      // 正文 PRE paste
      const paste = (await deps.bridge.call('evaluate', {
        expression:
          '/* @xb-probe */(async function(){var pre=document.querySelector("pre.editor__inner");' +
          'if(!pre)return "no-pre";pre.focus();' +
          'var dt=new DataTransfer();dt.setData("text/plain", ' +
          JSON.stringify(markdown) +
          ');pre.dispatchEvent(new ClipboardEvent("paste",{clipboardData:dt,bubbles:true,cancelable:true}));' +
          'await new Promise(function(r){setTimeout(r,1500);});' +
          'return pre.textContent.length;})()',
        tabId,
      })) as { value?: number };
      const chars = Number(paste?.value ?? 0);
      if (chars < 1000) return fail(`正文写入异常（${chars} 字符）`);
      // 标题
      await deps.bridge.call('evaluate', {
        expression:
          '(function(){var e=document.querySelector(".article-bar__title");if(!e)return "no";e.focus();' +
          'var d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;d.call(e,' +
          JSON.stringify(params.title) +
          ');e.dispatchEvent(new Event("input",{bubbles:true}));return e.value.length;})()',
        tabId,
      });
      return ok(
        { title: params.title, draftUrl: MD_EDITOR_URL, imageUrls, chars },
        ['草稿已保存，请在编辑器确认后手动点击「发布文章」'],
      );
    },
  });
}

/** 供 index.ts 挂载 */
export function registerCsdnDraft(site: Parameters<typeof registerDraftCommand>[0]['site'], bridge?: BridgeTransport): void {
  registerDraftCommand({ site, bridge: bridge ?? createHttpBridge() });
}
