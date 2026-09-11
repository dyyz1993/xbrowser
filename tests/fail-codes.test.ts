import { describe, it, expect } from 'vitest';
import { classifyFailure, structuredFail, FAIL_CODES } from '../src/fail-codes.js';

describe('fail-codes 分类器', () => {
  it('captcha → HUMAN: captcha', () => {
    expect(classifyFailure('检测到验证码，请完成人机校验').code).toBe(FAIL_CODES.captcha);
    expect(classifyFailure('recaptcha challenge detected').level).toBe('HUMAN');
  });

  it('login wall → HUMAN: login-wall', () => {
    expect(classifyFailure('需要登录后才能发布').code).toBe(FAIL_CODES.loginWall);
    expect(classifyFailure('LOGIN_REQUIRED').level).toBe('HUMAN');
  });

  it('permission → FATAL: permission-denied', () => {
    expect(classifyFailure('permission denied for this operation').code).toBe(FAIL_CODES.permissionDenied);
    expect(classifyFailure('没有权限执行').level).toBe('FATAL');
  });

  it('selector → RETRYABLE: selector-not-found', () => {
    expect(classifyFailure('element not found: #submit').code).toBe(FAIL_CODES.selectorNotFound);
    expect(classifyFailure('选择器未匹配到元素').level).toBe('RETRYABLE');
  });

  it('timeout → RETRYABLE: page-not-ready', () => {
    expect(classifyFailure('waiting for navigation timed out').code).toBe(FAIL_CODES.pageNotReady);
  });

  it('target gone → FATAL: target-gone', () => {
    expect(classifyFailure('net::ERR_NAME_NOT_RESOLVED').code).toBe(FAIL_CODES.targetGone);
    expect(classifyFailure('404 page not found after navigation').level).toBe('FATAL');
  });

  it('unknown → FATAL: unknown', () => {
    expect(classifyFailure('完全未知的奇怪错误').code).toBe(FAIL_CODES.unknown);
  });

  it('empty message → FATAL: unknown', () => {
    expect(classifyFailure(undefined).code).toBe(FAIL_CODES.unknown);
  });

  it('structuredFail 显式构造带 stuck', () => {
    const f = structuredFail('RETRYABLE: selector-not-found', 'msg', { tried: ['.a', '.b'] });
    expect(f.stuck?.tried).toEqual(['.a', '.b']);
    expect(f.level).toBe('RETRYABLE');
  });
});
