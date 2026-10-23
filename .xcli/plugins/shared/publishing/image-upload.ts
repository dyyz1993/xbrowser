/**
 * 图片直传层（发布插件共用）。
 *
 * 图床分层策略（实战 2026-10 实证）：
 * - **51CTO**：编辑器 paste 事件上传（File → ClipboardEvent → 编辑器自动
 *   传到自家 CDN）——本站 CDN，权重最高
 * - **CSDN**：OBS 签名直传（XHR 钩子截获签名 + 驼峰表单 POST）
 * - **博客园 / OSChina**：复用 CSDN 图床（i-blog.csdnimg.cn 公开可外链，
 *   跨站引用是 Markdown 编辑器标准行为——OSC 实战发布用的就是 CSDN 的图，
 *   正常显示）
 *
 * 已知坑（实战实录）：
 * - CSDN 签名必须**先装 XHR 钩子再触发** cfw change——`window.__sig` 是
 *   钩子写的，产品化初版漏了钩子注入导致 `--images` 静默失败
 * - 51CTO paste 后要等 3s+ 再读 img（上传异步）
 */

import type { PageAdapter } from './channel.js';
import type { BridgeTransport } from './bridge.js';
import { sleep } from './bridge.js';

/** markdown 里的本地图片引用（相对/绝对路径，非 http） */
export function extractLocalImagePaths(markdown: string): string[] {
  const out: string[] = [];
  const re = /!\[[^\]]*\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    const p = m[1];
    if (!/^(https?:|data:|\/\/)/i.test(p) && !out.includes(p)) out.push(p);
  }
  return out;
}

/** 把 markdown 里的本地路径替换为 CDN URL */
export function replaceImagePaths(
  markdown: string,
  mapping: Map<string, string>,
): string {
  let out = markdown;
  for (const [local, cdn] of mapping) {
    out = out.split(local).join(cdn);
  }
  return out;
}

/**
 * 51CTO 编辑器 paste 上传：构造 File → ClipboardEvent 派发到 contenteditable
 * 编辑器 → 编辑器自动上传 → 从 DOM 读新 img 的 CDN src。
 */
export async function uploadViaEditorPaste(
  adapter: PageAdapter,
  filePath: string,
  fileBase64: string,
): Promise<string> {
  const result = await adapter.evaluate<string>(`/* @xb-probe */(async function(){
    var ce = Array.from(document.querySelectorAll('[contenteditable=true]'))
      .filter(function(e){ return e.getBoundingClientRect().width > 300; })[0];
    if (!ce) return 'no-editor';
    ce.focus();
    var before = new Set(Array.from(ce.querySelectorAll('img')).map(function(m){ return m.src; }));
    var b64 = ${JSON.stringify(fileBase64)};
    var bin = atob(b64); var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    var f = new File([arr], ${JSON.stringify(filePath.split('/').pop() || 'img.png')}, { type: 'image/png' });
    var dt = new DataTransfer();
    dt.items.add(f);
    ce.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    // 上传是异步的：轮询新 img 出现（编辑器把 blob 占位换成 CDN src）
    for (var attempt = 0; attempt < 16; attempt++) {
      await new Promise(function(r){ setTimeout(r, 500); });
      var imgs = Array.from(ce.querySelectorAll('img'));
      for (var j = 0; j < imgs.length; j++) {
        if (!before.has(imgs[j].src) && /^https?:/.test(imgs[j].src)) {
          return imgs[j].src;
        }
      }
    }
    return 'upload-timeout';
  })()`);
  if (!result || result === 'no-editor' || result === 'upload-timeout') {
    throw new Error(`编辑器 paste 上传失败（${filePath}）：${result ?? 'evaluate 失败'}`);
  }
  return result;
}

/**
 * CSDN OBS 直传：helper tab 装 XHR 钩子截获签名 → 触发 cfw change →
 * 驼峰表单 POST → 返回 i-blog.csdnimg.cn URL。
 *
 * 兼作博客园 / OSChina 的通用图床（跨站引用，实战实证）。
 */
export async function uploadViaCsdnObs(
  bridge: BridgeTransport,
  fileBase64: string,
  options: { helperName?: string } = {},
): Promise<string> {
  const helperName = options.helperName ?? `pub-img-helper-${Date.now()}`;
  const opened = (await bridge.call('task-open', {
    name: helperName,
    url: 'https://mp.csdn.net/mp_blog/creation/editor',
  })) as { tabId?: number };
  const tabId = opened?.tabId;
  if (!tabId) throw new Error('CSDN helper tab 打开失败（bridge 无扩展连接？）');
  try {
    // 1) 等上传器就绪
    for (let i = 0; i < 15; i++) {
      const r = (await bridge.call('evaluate', {
        expression: '(typeof CKEDITOR!=="undefined")&&!!document.querySelector("input.cfw-file-input")',
        tabId,
      })) as { value?: boolean };
      if (r?.value) break;
      await sleep(2000);
    }

    // 2) 装 XHR 钩子（截获签名响应到 window.__sig）——必须先于触发
    await bridge.call('evaluate', {
      expression: `(function(){
        window.__sig = null;
        var os = XMLHttpRequest.prototype.send;
        var oo = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(m, u) {
          this.__u = String(u);
          return oo.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function() {
          var x = this;
          if (/upload\\/signature/i.test(x.__u || '')) {
            x.addEventListener('load', function() {
              try { window.__sig = JSON.parse(x.responseText); } catch (e) { /* keep null */ }
            });
          }
          return os.apply(this, arguments);
        };
        return 'hooked';
      })()`,
      tabId,
    });

    // 3) 触发真实签名（cfw change）
    await bridge.call('evaluate', {
      expression: `/* @xb-probe */(function(){
        window.__sig = null;
        var inp = document.querySelector('input.cfw-file-input');
        if (!inp) return 'no-input';
        var b64 = ${JSON.stringify(fileBase64)};
        var bin = atob(b64); var arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        var f = new File([arr], 'img.png', { type: 'image/png' });
        var dt = new DataTransfer();
        dt.items.add(f);
        inp.files = dt.files;
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        return 'ok';
      })()`,
      tabId,
    });

    // 4) 等签名响应
    let sig: Record<string, unknown> | null = null;
    for (let i = 0; i < 12; i++) {
      const s = (await bridge.call('evaluate', {
        expression: 'window.__sig?JSON.stringify(window.__sig.data):null',
        tabId,
      })) as { value?: string };
      if (s?.value) {
        sig = JSON.parse(s.value) as Record<string, unknown>;
        break;
      }
      await sleep(1500);
    }
    if (!sig) throw new Error('CSDN 签名响应未截获（window.__sig 为空——登录态失效？）');

    // 5) OBS 驼峰表单直传
    const d = sig as Record<string, string> & { customParam?: Record<string, unknown> };
    const host = String(d.host).replace(/\/$/, '');
    const form: Record<string, string> = {
      key: String(d.filePath),
      policy: d.policy,
      signature: d.signature,
      callbackBody: d.callbackBody ?? '',
      callbackBodyType: d.callbackBodyType ?? '',
    };
    if (String(d.provider) === 'obs') {
      form.callbackUrl = d.callbackUrl ?? '';
      form.AccessKeyId = d.accessId;
    } else {
      form.callback = d.callbackUrl ?? '';
      form.OSSAccessKeyId = d.accessId;
    }
    const custom = d.customParam ?? {};
    for (const k of Object.keys(custom)) form[`x:${k}`] = String(custom[k]);

    const r = (await bridge.call('evaluate', {
      expression: `/* @xb-probe */(async function(){
        var b64 = ${JSON.stringify(fileBase64)};
        var bin = atob(b64); var arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        var f = new File([arr], 'img.png', { type: 'image/png' });
        var form = new FormData();
        var spec = ${JSON.stringify(Object.entries(form))};
        for (var i = 0; i < spec.length; i++) form.append(spec[i][0], spec[i][1]);
        form.append('file', f);
        var ur = await fetch(${JSON.stringify(host)}, { method: 'POST', body: form });
        var t = await ur.text();
        return 'status:' + ur.status + ' body:' + t.slice(0, 600);
      })()`,
      tabId,
    })) as { value?: string };
    const out = String(r?.value ?? '');
    const m = out.match(/https:\/\/i-blog\.csdnimg\.cn\/[^\s"]+/);
    if (!m) throw new Error(`CSDN OBS 上传失败: ${out.slice(0, 200)}`);
    return m[0];
  } finally {
    await bridge.call('task-close', { name: helperName }).catch(() => undefined);
  }
}

/**
 * 站点分层上传：51CTO 走本站 paste；其余站走 CSDN 通用图床。
 *
 * @param adapter 站点编辑器 adapter（51CTO paste 需要）
 * @param bridge bridge 传输（CSDN OBS 需要）
 */
export async function uploadImagesForSite(
  site: string,
  adapter: PageAdapter,
  bridge: BridgeTransport,
  filePaths: Array<{ path: string; base64: string }>,
): Promise<Map<string, string>> {
  const mapping = new Map<string, string>();
  for (const { path, base64 } of filePaths) {
    const url = site === '51cto'
      ? await uploadViaEditorPaste(adapter, path, base64)
      : await uploadViaCsdnObs(bridge, base64);
    mapping.set(path, url);
  }
  return mapping;
}
