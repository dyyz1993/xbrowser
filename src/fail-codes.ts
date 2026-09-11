/**
 * 结构化失败码（阶梯 L0~L4 的路由依据）。
 *
 * 所有工具的失败结果经 executor 归一化时自动附带 `error: { code, stuck }`，
 * 上层（ION coordinator / 人工门）据此路由到正确的处理层级：
 *
 * | code 前缀    | 层级 | 含义                     |
 * |--------------|------|--------------------------|
 * | RETRYABLE:*  | L0/L1 | 可重试或重新定位（自愈） |
 * | HUMAN:*      | L4   | 需要人工介入             |
 * | FATAL:*      | L3   | 需要重规划（换路径）     |
 *
 * 分类由 classifyFailure(message) 按报错文案模式推断——无需每个 handler
 * 显式声明；handler 可通过 structuredFail() 显式指定以覆盖推断。
 */

export type FailLevel = 'RETRYABLE' | 'HUMAN' | 'FATAL';

export interface FailCode {
  code: string;
  level: FailLevel;
  message: string;
  stuck?: {
    step?: string;
    screenshot?: string;
    tried?: string[];
  };
}

export const FAIL_CODES = {
  selectorNotFound: 'RETRYABLE: selector-not-found',
  pageNotReady: 'RETRYABLE: page-not-ready',
  elementGone: 'RETRYABLE: element-gone',
  captcha: 'HUMAN: captcha',
  loginWall: 'HUMAN: login-wall',
  permissionDenied: 'FATAL: permission-denied',
  targetGone: 'FATAL: target-gone',
  unknown: 'FATAL: unknown',
} as const;

/** 按失败文案模式推断失败码（executor 归一化时调用） */
export function classifyFailure(message: string | undefined): FailCode {
  const msg = (message || '').toLowerCase();
  const pick = (code: string): FailCode => ({
    code,
    level: code.split(':')[0] as FailLevel,
    message: message || code,
  });

  if (/captcha|验证码|人机校验|recaptcha|hcaptcha|turnstile/.test(msg)) return pick(FAIL_CODES.captcha);
  if (/login|登录|signin|sign in|未登录|login-required|LOGIN_REQUIRED/.test(msg)) return pick(FAIL_CODES.loginWall);
  if (/permission|权限|not allowed|forbidden|EACCES/.test(msg)) return pick(FAIL_CODES.permissionDenied);
  if (/selector|选择器|element not found|未找到元素|no such element|queryselector returned null/.test(msg))
    return pick(FAIL_CODES.selectorNotFound);
  if (/timeout|超时|timed out|waiting for/.test(msg)) return pick(FAIL_CODES.pageNotReady);
  if (/net::err|404|navigation failed|页面不存在|target closed|element-gone/.test(msg))
    return pick(FAIL_CODES.targetGone);
  return pick(FAIL_CODES.unknown);
}

/** 显式构造带码失败（handler 可用，覆盖自动推断） */
export function structuredFail(code: string, message: string, stuck?: FailCode['stuck']): FailCode {
  return { code, level: code.split(':')[0] as FailLevel, message, ...(stuck ? { stuck } : {}) };
}
