/**
 * 动态 JSON 响应的宽松类型。
 *
 * 站点插件的 API 返回是动态 JSON，字段可能缺失/类型可变。
 * 这里提供既类型安全（避免 `as any`）又能方便访问的结构。
 *
 * 用法：
 *   import type { JsonObject } from '../shared/json-types.js';
 *   const data = await fetch(url).then(r => r.json()) as JsonObject;
 *   const results = (data.results as JsonObject[] | undefined) ?? [];
 *
 * 对于已知结构的响应，建议在各插件内定义更精确的接口；
 * 此类型用于「结构不固定、只需逐字段兜底」的场景。
 */

/** 任意 JSON 对象：字符串键，值为 JsonValue */
export type JsonObject = Record<string, JsonValue>;

/** 任意 JSON 值 */
export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

/** 断言为对象数组（常见于 results/list 字段） */
export function asJsonArray(v: JsonValue | undefined): JsonObject[] {
  return Array.isArray(v) ? (v as JsonObject[]) : [];
}
