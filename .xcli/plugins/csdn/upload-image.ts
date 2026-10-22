/**
 * CSDN 图片直传 + 表单契约（2026-10-22 实战逆向，ERR-007 结案方案）
 *
 * 协议：POST bizapi.csdn.net/resource-api/v1/image/direct/upload/signature
 *（X-Ca-Key 网关签名——由页面真实上传器发出，此处截获其响应）
 * → { provider:'obs', accessId, policy, signature, host, filePath,
 *     callbackUrl, callbackBody, callbackBodyType, customParam }
 * → 按上传器源码（g.csdnimg.cn/csdn-upload/2.0.1）驼峰字段 1:1 组 OBS 表单 POST host
 * → 回调响应 data.imageUrl 即最终 CDN 地址
 */

/** 签名接口响应 data（字段以实测为准） */
export interface CsdnSignatureData {
  provider: string;
  accessId: string;
  policy: string;
  signature: string;
  dir?: string;
  expire?: string;
  host: string;
  filePath: string;
  callbackUrl?: string;
  callbackBody?: string;
  callbackBodyType?: string;
  customParam?: Record<string, unknown>;
}

/** OBS 表单字段（保持插入顺序：file 由调用方最后 append） */
export function buildObsFormFields(sig: CsdnSignatureData): Array<[string, string]> {
  const fields: Array<[string, string]> = [
    ['key', String(sig.filePath)],
    ['policy', sig.policy],
    ['signature', sig.signature],
    ['callbackBody', sig.callbackBody ?? ''],
    ['callbackBodyType', sig.callbackBodyType ?? ''],
  ];
  if (sig.provider === 'obs') {
    fields.push(['callbackUrl', sig.callbackUrl ?? ''], ['AccessKeyId', sig.accessId]);
  } else {
    fields.push(['callback', sig.callbackUrl ?? ''], ['OSSAccessKeyId', sig.accessId]);
  }
  const custom = sig.customParam ?? {};
  for (const k of Object.keys(custom)) fields.push([`x:${k}`, String(custom[k])]);
  return fields;
}

/** 从签名/回调响应文本提取最终图片 URL（data.imageUrl 优先，兜底全文首个 http 图链） */
export function extractImageUrl(text: string): string | null {
  try {
    const j = JSON.parse(text) as { data?: { imageUrl?: string; hostname?: string } } | null;
    const d = j?.data;
    if (d?.imageUrl) return d.imageUrl.startsWith('http') ? d.imageUrl : (d.hostname || '') + d.imageUrl;
  } catch { /* 非 JSON 走兜底 */ }
  const m = text.match(/https?:\/\/[^\s"']+/);
  return m ? m[0] : null;
}

/** 横版裁剪决策（用户规范：配图一律 16:9 横版；已达标则不裁） */
export function landscapeDecision(
  width: number,
  height: number,
): { crop: boolean; targetWidth: number; targetHeight: number; offsetY: number } {
  const targetHeight = Math.round((width * 9) / 16);
  if (height <= targetHeight) {
    return { crop: false, targetWidth: width, targetHeight: height, offsetY: 0 };
  }
  const offsetY = Math.round((height - targetHeight) / 2);
  return { crop: true, targetWidth: width, targetHeight, offsetY };
}

/** 在 markdown 中插图：封面（首图）插在引言（> 引用）后，其余依次插在二级标题后（图前留空行） */
export function insertImages(markdown: string, imageUrls: string[]): string {
  if (!imageUrls.length) return markdown;
  const lines = markdown.split('\n');
  const out: string[] = [];
  let coverDone = false;
  let inserted = 0;
  for (const ln of lines) {
    out.push(ln);
    if (!coverDone && ln.startsWith('> ')) {
      out.push('', `![封面](${imageUrls[0]})`);
      coverDone = true;
      inserted++;
      continue;
    }
    if (coverDone && inserted < imageUrls.length && /^## /.test(ln)) {
      out.push('', `![配图 ${inserted + 1}](${imageUrls[inserted]})`);
      inserted++;
    }
  }
  while (inserted < imageUrls.length) {
    out.push('', `![配图 ${inserted + 1}](${imageUrls[inserted]})`);
    inserted++;
  }
  return out.join('\n');
}
