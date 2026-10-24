/**
 * 雪花 id 安全提取（LRN-20261025-002）
 *
 * 19 位 id 超过 Number.MAX_SAFE_INTEGER（9007199254740991），
 * 一旦被 JSON.parse 成 number 就会被舍入（知乎 ...5415129 → ...5415200，差 71），
 * 拿去发 DELETE/PUT 会打到不存在的资源上，表现为「点了没反应」或 404。
 *
 * 铁律：id 一律走字符串通道；取 id 优先 URL/href（天然精确），
 * 其次 data-* 属性，最后才是 JSON 字段——且 JSON 字段必须先用
 * `readRawId` 以文本方式截取（不要让 JSON.parse 经手）。
 */

/** 超过这个位数的整数字面量在 JS number 下不安全 */
export const SAFE_ID_DIGITS = 16;

/** 判断一个 id 字面量是否超出安全整数范围（按位数判断，避免 Number 转换本身失真） */
export function isUnsafeNumericId(raw: string | number): boolean {
  const digits = String(raw).replace(/^[+-]/, '').replace(/^0+(?=\d)/, '');
  if (!/^\d+$/.test(digits)) return false;
  if (digits.length > SAFE_ID_DIGITS) return true;
  return digits.length === SAFE_ID_DIGITS && digits > String(Number.MAX_SAFE_INTEGER);
}

/**
 * 从候选来源里按优先级取 id，返回字符串。
 * 顺序：URL 路径 → data 属性 → 原始文本 id。
 * 全都没有时返回 null（调用方必须处理，不要退回 number 字段）。
 */
export function pickIdFromSources(sources: {
  url?: string | null;
  dataAttr?: string | null;
  rawIdText?: string | null;
}): string | null {
  const fromUrl = sources.url?.match(/\/(?:p|article|post|note|draft|status|details?)\/(\d{6,})/i)?.[1];
  if (fromUrl) return fromUrl;
  const fromData = sources.dataAttr?.trim();
  if (fromData && /^\d{6,}$/.test(fromData)) return fromData;
  const fromRaw = sources.rawIdText?.trim().replace(/^["']|["']$/g, '');
  if (fromRaw && /^\d{6,}$/.test(fromRaw)) return fromRaw;
  return null;
}

/**
 * 从 JSON 文本里按 key 读出 id 的**原始字面量**（不经 JSON.parse）。
 * 用于服务端把 id 当裸数字返回、前端 parse 必然失真的场景。
 */
export function readRawId(jsonText: string, key = 'id'): string | null {
  const re = new RegExp(`"${key}"\\s*:\\s*("?)(\\d{6,})\\1`);
  return jsonText.match(re)?.[2] ?? null;
}
