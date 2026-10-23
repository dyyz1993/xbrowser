import { describe, it, expect, vi } from 'vitest';
import {
  extractLocalImagePaths,
  replaceImagePaths,
  uploadViaEditorPaste,
  uploadImagesForSite,
} from '../../.xcli/plugins/shared/publishing/image-upload.js';
import type { PageAdapter } from '../../.xcli/plugins/shared/publishing/channel.js';

describe('publishing/image-upload', () => {
  describe('extractLocalImagePaths', () => {
    it('提取 markdown 里的本地路径，跳过 http/data 外链', () => {
      const md = [
        '# 标题',
        '![封面](./assets/cover.png)',
        '![外链](https://cdn.example.com/a.png)',
        '![绝对](/tmp/shot.png)',
        '![data](data:image/png;base64,xxx)',
        '![重复](./assets/cover.png)',
      ].join('\n');
      expect(extractLocalImagePaths(md)).toEqual(['./assets/cover.png', '/tmp/shot.png']);
    });

    it('无图返回空数组', () => {
      expect(extractLocalImagePaths('# 纯文本')).toEqual([]);
    });
  });

  describe('replaceImagePaths', () => {
    it('本地路径替换为 CDN URL（含多次出现）', () => {
      const md = '![a](./x.png) 中间 ![b](./x.png) 结尾 ![c](./y.png)';
      const out = replaceImagePaths(md, new Map([
        ['./x.png', 'https://cdn/x.png'],
        ['./y.png', 'https://cdn/y.png'],
      ]));
      expect(out).toBe('![a](https://cdn/x.png) 中间 ![b](https://cdn/x.png) 结尾 ![c](https://cdn/y.png)');
    });
  });

  describe('uploadViaEditorPaste（51CTO 协议）', () => {
    function adapterWith(newImgSrc: string | null) {
      return {
        channel: 'local' as const,
        evaluate: vi.fn(async (expr: string) => {
          if (expr.includes('contenteditable')) {
            return newImgSrc;
          }
          return undefined;
        }),
      } as unknown as PageAdapter;
    }

    it('成功路径：读到新 img 的 CDN src', async () => {
      const adapter = adapterWith('https://cdn.51cto.com/imgs/abc.png');
      const url = await uploadViaEditorPaste(adapter, '/tmp/a.png', 'aGVsbG8=');
      expect(url).toBe('https://cdn.51cto.com/imgs/abc.png');
      // 表达式含 paste 派发与文件名
      const expr = (adapter.evaluate as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(expr).toContain('ClipboardEvent');
      expect(expr).toContain('a.png');
    });

    it('编辑器缺失 / 上传超时都抛明确错误', async () => {
      await expect(uploadViaEditorPaste(adapterWith('no-editor'), '/tmp/a.png', 'b64'))
        .rejects.toThrow('no-editor');
      await expect(uploadViaEditorPaste(adapterWith('upload-timeout'), '/tmp/a.png', 'b64'))
        .rejects.toThrow('upload-timeout');
    });
  });

  describe('uploadImagesForSite 分层策略', () => {
    it('51cto 走编辑器 paste，其余站走 CSDN 图床', async () => {
      const calls: string[] = [];
      const adapter = {
        channel: 'local' as const,
        evaluate: vi.fn(async () => 'https://cdn.51cto.com/x.png'),
      } as unknown as PageAdapter;
      // 桥接层 stub：CSDN OBS 不应被 51cto 调用
      const bridge = {
        call: vi.fn(async (cmd: string) => {
          calls.push(cmd);
          throw new Error('bridge should not be called for 51cto');
        }),
      };

      const m1 = await uploadImagesForSite('51cto', adapter, bridge as never, [
        { path: '/tmp/a.png', base64: 'b64' },
      ]);
      expect(m1.get('/tmp/a.png')).toBe('https://cdn.51cto.com/x.png');
      expect(calls).toHaveLength(0);
    });

    it('多文件逐张上传并保留映射顺序', async () => {
      let n = 0;
      const adapter = {
        channel: 'local' as const,
        evaluate: vi.fn(async () => `https://cdn.51cto.com/img-${++n}.png`),
      } as unknown as PageAdapter;
      const bridge = { call: vi.fn(async () => { throw new Error('unused'); }) };
      const m = await uploadImagesForSite('51cto', adapter, bridge as never, [
        { path: '/a.png', base64: 'a' },
        { path: '/b.png', base64: 'b' },
      ]);
      expect(m.get('/a.png')).toBe('https://cdn.51cto.com/img-1.png');
      expect(m.get('/b.png')).toBe('https://cdn.51cto.com/img-2.png');
    });
  });
});
