import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatDetectionMessage } from '../src/lib/anti-bot.js';
import type { DetectionResult } from '../src/lib/anti-bot.js';

describe('formatDetectionMessage', () => {
  it('should format not-detected result', () => {
    const result: DetectionResult = { detected: false };
    const msg = formatDetectionMessage(result);
    expect(msg).toContain('No anti-bot');
    expect(msg).toContain('✅');
  });

  it('should format high severity with alarm emoji', () => {
    const result: DetectionResult = {
      detected: true,
      type: 'captcha',
      severity: 'high',
      message: 'reCAPTCHA detected',
      actionRequired: 'manual',
    };
    const msg = formatDetectionMessage(result);
    expect(msg).toContain('🚨');
    expect(msg).toContain('reCAPTCHA detected');
    expect(msg).toContain('high');
    expect(msg).toContain('manually');
  });

  it('should format medium severity with warning emoji', () => {
    const result: DetectionResult = {
      detected: true,
      type: 'warning',
      severity: 'medium',
      message: 'Rate limited',
      actionRequired: 'retry',
    };
    const msg = formatDetectionMessage(result);
    expect(msg).toContain('⚠️');
    expect(msg).toContain('retrying');
  });

  it('should format low severity with info emoji', () => {
    const result: DetectionResult = {
      detected: true,
      type: 'warning',
      severity: 'low',
      message: '验证码',
      actionRequired: 'switch',
    };
    const msg = formatDetectionMessage(result);
    expect(msg).toContain('ℹ️');
    expect(msg).toContain('switching');
  });

  it('should handle undefined severity and action', () => {
    const result: DetectionResult = {
      detected: true,
      message: 'Something detected',
    };
    const msg = formatDetectionMessage(result);
    expect(msg).toContain('Something detected');
  });
});
