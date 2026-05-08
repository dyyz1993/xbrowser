import { describe, it, expect } from 'vitest';
import { parseActionDsl } from '../src/lib/parse-action-dsl.js';

describe('parseActionDsl', () => {
  it('parses wait with number', () => {
    expect(parseActionDsl('wait 1000')).toEqual({ type: 'wait', milliseconds: 1000 });
  });

  it('parses wait with selector', () => {
    expect(parseActionDsl('wait #content')).toEqual({ type: 'wait', selector: '#content' });
  });

  it('parses click with selector', () => {
    expect(parseActionDsl('click #btn')).toEqual({ type: 'click', selector: '#btn' });
  });

  it('parses click with --all flag', () => {
    expect(parseActionDsl('click .btn --all')).toEqual({ type: 'click', selector: '.btn', all: true });
  });

  it('parses write with multi-word text', () => {
    expect(parseActionDsl('write hello world')).toEqual({ type: 'write', text: 'hello world' });
  });

  it('parses press with key', () => {
    expect(parseActionDsl('press Enter')).toEqual({ type: 'press', key: 'Enter' });
  });

  it('parses scroll down', () => {
    expect(parseActionDsl('scroll down')).toEqual({ type: 'scroll', direction: 'down' });
  });

  it('parses scroll up', () => {
    expect(parseActionDsl('scroll up')).toEqual({ type: 'scroll', direction: 'up' });
  });

  it('parses scroll with selector', () => {
    expect(parseActionDsl('scroll down .container')).toEqual({ type: 'scroll', direction: 'down', selector: '.container' });
  });

  it('parses screenshot bare', () => {
    expect(parseActionDsl('screenshot')).toEqual({ type: 'screenshot' });
  });

  it('parses screenshot with --full-page', () => {
    expect(parseActionDsl('screenshot --full-page')).toEqual({ type: 'screenshot', fullPage: true });
  });

  it('parses screenshot with --quality', () => {
    expect(parseActionDsl('screenshot --quality 80')).toEqual({ type: 'screenshot', quality: 80 });
  });

  it('parses screenshot with --full-page and --quality', () => {
    expect(parseActionDsl('screenshot --full-page --quality 60')).toEqual({ type: 'screenshot', fullPage: true, quality: 60 });
  });

  it('parses scrape bare', () => {
    expect(parseActionDsl('scrape')).toEqual({ type: 'scrape' });
  });

  it('parses exec with code', () => {
    expect(parseActionDsl('exec document.title')).toEqual({ type: 'executeJavascript', script: 'document.title' });
  });

  it('parses pdf bare', () => {
    expect(parseActionDsl('pdf')).toEqual({ type: 'pdf' });
  });

  it('parses pdf with --landscape', () => {
    expect(parseActionDsl('pdf --landscape')).toEqual({ type: 'pdf', landscape: true });
  });

  it('parses pdf with --format', () => {
    expect(parseActionDsl('pdf --format A4')).toEqual({ type: 'pdf', format: 'A4' });
  });

  it('parses pdf with all flags', () => {
    expect(parseActionDsl('pdf --landscape --format A4 --scale 1.5')).toEqual({
      type: 'pdf',
      landscape: true,
      format: 'A4',
      scale: 1.5,
    });
  });

  it('throws on unknown type', () => {
    expect(() => parseActionDsl('fly away')).toThrow('Unknown action type: "fly"');
  });

  it('throws on empty string', () => {
    expect(() => parseActionDsl('')).toThrow('Empty action DSL');
  });

  it('throws on whitespace-only string', () => {
    expect(() => parseActionDsl('   ')).toThrow('Empty action DSL');
  });
});
