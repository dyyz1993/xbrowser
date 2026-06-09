/**
 * test-routes — 插件指令测试命令
 *
 * 用法:
 *   xbrowser test <plugin> <command> [参数...] [选项]
 *   xbrowser test doubao list --cdp 9221
 *   xbrowser test doubao image --prompt "一只猫" --cdp 9221
 *
 * 自动从插件指令的 result schema 提取字段定义，
 * 执行指令后对比实际输出，报告差异。
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getPluginLoader } from '../utils/plugin-singleton.js';

function findPluginPath(plugin: string): string {
  const candidates = [
    resolve(process.cwd(), '.xcli/plugins', plugin, 'index.ts'),
    resolve(process.cwd(), 'node_modules/@xbrowser/cli/.xcli/plugins', plugin, 'index.ts'),
  ];
  for (const p of candidates) {
    try { readFileSync(p, 'utf-8'); return p; } catch { /* try next */ }
  }
  return resolve(process.cwd(), '.xcli/plugins', plugin, 'index.ts');
}

interface SchemaField {
  name: string;
  type: string;
  optional: boolean;
}

/**
 * 从插件源码提取指定指令的 result schema
 */
function extractSchema(plugin: string, command: string): SchemaField[] | null {
  const pluginPath = findPluginPath(plugin);
  let src: string;
  try {
    src = readFileSync(pluginPath, 'utf-8');
  } catch {
    return null;
  }

  // 找到 command('xxx', { ... result: ... })
  const cmdIdx = src.indexOf(`.command('${command}'`);
  if (cmdIdx < 0) return null;

  // 从 cmdIdx 往后找 result: 字段
  const after = src.slice(cmdIdx);
  const resultIdx = after.indexOf('result:');
  if (resultIdx < 0) return null;

  // 提取从 result: 到下一个顶级 }, 之间的内容
  // 跳过 parameters 等后续字段
  let block = after.slice(resultIdx + 7);
  let depth = 0;
  let schemaStr = '';
  for (const ch of block) {
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    if (ch === '}' || ch === ')' || ch === ']') {
      depth--;
      if (depth < 0) break; // 超出 result 块
    }
    // 遇到下一个顶级字段（不缩进的单词）时停止
    if (depth === 0 && /\w/.test(ch) && schemaStr.trim().endsWith(',')) {
      break;
    }
    schemaStr += ch;
  }

  // 找到 z.object({...}) 块
  const objStart = schemaStr.indexOf('z.object({');
  const objEnd = objStart >= 0 ? schemaStr.indexOf('})', objStart) : -1;
  const objStr = objStart >= 0 && objEnd > objStart ? schemaStr.slice(objStart + 10, objEnd) : schemaStr;

  // 提取字段: key: z.type
  const fields: SchemaField[] = [];
  const SKIP_NAMES = new Set(['passthrough', 'optional', 'describe', 'default']);
  const fieldRegex = /(\w+)\s*:\s*z\.(\w+)/g;
  let match;
  while ((match = fieldRegex.exec(objStr)) !== null) {
    const name = match[1];
    const type = match[2];
    if (SKIP_NAMES.has(name) || type === 'union' || type === 'enum') continue;

    const afterField = objStr.slice(match.index + match[0].length);
    const isOptional = afterField.trimStart().startsWith('.optional()');

    fields.push({
      name,
      type: type === 'string' ? 'string' :
            type === 'number' ? 'number' :
            type === 'boolean' ? 'boolean' :
            type === 'array' ? 'array' : type,
      optional: isOptional || name === 'index',
    });
  }

  return fields.length > 0 ? fields : null;
}

/**
 * 执行指令并校验输出
 */
async function runTest(plugin: string, command: string, cmdArgs: string[], options: Record<string, unknown>): Promise<Record<string, unknown>> {
  const cdp = options.cdp || options.cdpEndpoint || 'http://localhost:9221';
  const argsStr = cmdArgs.filter(a => !a.startsWith('--cdp')).join(' ');

  // 1. 提取 schema
  const schema = extractSchema(plugin, command);

  // 2. 执行指令
  const fullCmd = `npx xbrowser ${plugin} ${command} ${argsStr} --cdp ${cdp} --json --timeout 60000`;
  let stdout = '';
  try {
    stdout = execSync(fullCmd, {
      timeout: 65000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
    });
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer; message?: string };
    stdout = (err.stdout?.toString() || '');

    // 解析 stdout 中的 JSON（含 LOGIN_REQUIRED 等正常响应）
    const jsonLine = stdout.split('\n').find(l => {
      try { JSON.parse(l); return true; } catch { return false; }
    });
    if (jsonLine) {
      try {
        const parsed = JSON.parse(jsonLine);
        const code = parsed?.data?.code || '';
        if (code === 'LOGIN_REQUIRED') {
          return { status: 'LOGIN_REQUIRED', message: parsed.message || '需要登录', viewerUrl: 'http://localhost:9224/preview/default' };
        }
      } catch { /* JSON 解析失败则继续 */ }
    }

    // 检查 CAPTCHA
    const stderr = (err.stderr?.toString() || '');
    if (stdout.includes('captcha') || stderr.includes('captcha') || stdout.includes('CAPTCHA')) {
      return { status: 'CAPTCHA', message: '检测到验证码', viewerUrl: 'http://localhost:9224/preview/default' };
    }
    return { status: 'EXEC_ERROR', message: (err.message || '').slice(0, 200) || '执行失败' };
  }

  // 3. 解析 JSON 输出（跨多行）
  const allLines = stdout.split('\n');
  const jsonStart = allLines.findIndex(l => l.trim().startsWith('{'));
  const jsonStr = jsonStart >= 0 ? allLines.slice(jsonStart).join('\n') : '';
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return { status: 'EXEC_ERROR', message: '无法解析 CLI 输出' };
  }

  const rawData = parsed.data;
  const rawTips = (parsed.tips || []) as string[];

  // 检查 LOGIN_REQUIRED
  if (parsed.success === false) {
    const code = (rawData as Record<string, unknown> | null)?.code || '';
    if (code === 'LOGIN_REQUIRED') {
      return { status: 'LOGIN_REQUIRED', message: (parsed.message as string) || '需要登录', viewerUrl: 'http://localhost:9224/preview/default' };
    }
    if (rawTips.join(' ').includes('captcha') || rawTips.join(' ').includes('CAPTCHA')) {
      return { status: 'CAPTCHA', message: (parsed.message as string) || '验证码', viewerUrl: 'http://localhost:9224/preview/default' };
    }
  }

  const data = rawData;

  if (data === null || data === undefined) {
    const msg = (parsed.message as string) || '';
    const tips = rawTips.join(' ');
    const viewerUrl = (parsed.viewerUrl as string) || (rawData as Record<string, unknown> | null)?.viewerUrl as string || '';
    let status = 'NO_DATA';
    if (msg.includes('block') || msg.includes('anti-bot') || msg.includes('captcha') || tips.includes('viewer')) {
      status = 'BLOCKED';
    } else if (msg.includes('登录') || msg.includes('login')) {
      status = 'LOGIN_REQUIRED';
    }
    const ret: Record<string, unknown> = { status, message: msg || '暂无数据' };
    if (viewerUrl) ret.viewerUrl = viewerUrl;
    return ret as unknown as { status: string; message?: string; viewerUrl?: string; count?: number; data?: string; errors?: string[]; note?: string; };
  }

  // 4. Schema 校验
  if (!schema) {
    return { status: 'OK', note: '无 result schema', data: JSON.stringify(data).slice(0, 200) };
  }

  const errors: string[] = [];
  const items = Array.isArray(data) ? data.slice(0, 3) : [data];

  for (const item of items) {
    if (typeof item !== 'object' || item === null) {
      errors.push('数据项不是对象');
      continue;
    }
    for (const field of schema) {
      const val = (item as Record<string, unknown>)[field.name];
      if (val === undefined) {
        if (!field.optional) errors.push(`缺少: ${field.name}`);
        continue;
      }
      if (field.type === 'array') {
        if (!Array.isArray(val)) errors.push(`${field.name}: 期望 array`);
      } else if (typeof val !== field.type) {
        errors.push(`${field.name}: 期望 ${field.type}, 实际 ${typeof val}`);
      }
    }
  }

  if (errors.length > 0) {
    return { status: 'SCHEMA_ERROR', errors, data: JSON.stringify(data).slice(0, 200) };
  }

  const count = Array.isArray(data) ? data.length : 1;
  return { status: 'OK', count, data: JSON.stringify(data).slice(0, 200) };
}

export async function handleTest(
  cmdArgs: string[],
  options: Record<string, unknown>,
  mode: string,
  cdpEndpoint?: string,
): Promise<void> {
  const plugin = cmdArgs[0];
  const command = cmdArgs[1];

  if (!plugin || !command) {
    console.error('用法: xbrowser test <plugin> <command> [参数...]');
    console.error('示例: xbrowser test doubao list --cdp 9221');
    return;
  }

  // 检查插件是否存在
  const loader = await getPluginLoader();
  const internalLoader = loader.getCore().loader;
  const site = internalLoader.getSite(plugin);
  if (!site) {
    console.error(`插件 "${plugin}" 不存在`);
    return;
  }

  const cmdEntry = site.getCommand(command);
  if (!cmdEntry) {
    console.error(`指令 "${command}" 不存在`);
    return;
  }

  // 提取参数（去掉 plugin 和 command）
  const testArgs = cmdArgs.slice(2);
  const mergedOptions = { ...options, cdp: cdpEndpoint || options.cdp };

  const result = await runTest(plugin, command, testArgs, mergedOptions);

  // 输出结果
  if (mode === 'json') {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const r = result as Record<string, unknown>;
  const icons: Record<string, string> = {
    OK: '✅', LOGIN_REQUIRED: '🔑', CAPTCHA: '🚨',
    SCHEMA_ERROR: '❌', BLOCKED: '🚧', NO_DATA: '📭', EXEC_ERROR: '💥',
  };
  const status = String(r.status);
  const icon = icons[status] || '❓';

  console.log(`\n${icon}  ${plugin}.${command}`);
  console.log(`   状态: ${status}`);
  if (status === 'OK') {
    if (r.count) console.log(`   数据: ${r.count} 项`);
    if (r.data) console.log(`   预览: ${String(r.data).slice(0, 150)}`);
  } else if (status === 'LOGIN_REQUIRED' || status === 'CAPTCHA') {
    console.log(`   信息: ${String(r.message)}`);
    console.log(`   Viewer: ${String(r.viewerUrl)}`);
  } else if (status === 'SCHEMA_ERROR') {
    const errs = r.errors as string[] | undefined;
    if (errs) console.log(`   错误: ${errs.join('; ')}`);
  } else if (['NO_DATA', 'BLOCKED'].includes(status)) {
    console.log(`   信息: ${String(r.message)}`);
    if (r.viewerUrl) console.log(`   Viewer: ${String(r.viewerUrl)}`);
  } else {
    console.log(`   信息: ${String(r.message)}`);
  }
}
