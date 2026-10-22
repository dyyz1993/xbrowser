import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  markdownToHtml,
  insertImageAfter,
} from '../../.xcli/plugins/shared/publishing/md-to-html.js';
import { deriveSummary } from '../../.xcli/plugins/shared/publishing/sites/51cto.js';

describe('publishing/md-to-html', () => {
  describe('转义顺序（ERR-20261022-010 回归）', () => {
    it('引用块必须渲染成 blockquote 而非字面 &gt;', () => {
      const html = markdownToHtml('> 这是一段引用\n\n正文');
      expect(html).toContain('<blockquote>这是一段引用</blockquote>');
      expect(html).not.toContain('&gt;');
    });

    it('段落内的裸尖括号仍应转义', () => {
      const html = markdownToHtml('a > b');
      expect(html).toBe('<p>a &gt; b</p>');
    });

    it('标题行首的 # 不应被转义', () => {
      const html = markdownToHtml('## 小标题');
      expect(html).toBe('<h2>小标题</h2>');
    });
  });

  describe('块级语法', () => {
    it('支持 h1~h6', () => {
      expect(markdownToHtml('# H1')).toBe('<h1>H1</h1>');
      expect(markdownToHtml('### H3')).toBe('<h3>H3</h3>');
      expect(markdownToHtml('###### H6')).toBe('<h6>H6</h6>');
    });

    it('无序列表聚合成单个 ul', () => {
      const html = markdownToHtml('- 甲\n- 乙');
      expect(html.replace(/\s+/g, '')).toBe('<ul><li>甲</li><li>乙</li></ul>');
      expect((html.match(/<ul>/g) || []).length).toBe(1);
    });

    it('有序列表聚合成单个 ol', () => {
      const html = markdownToHtml('1. 甲\n2. 乙');
      expect(html.replace(/\s+/g, '')).toBe('<ol><li>甲</li><li>乙</li></ol>');
      expect((html.match(/<ol>/g) || []).length).toBe(1);
    });

    it('列表与段落混排时列表正确闭合', () => {
      const html = markdownToHtml('- 甲\n\n普通段落');
      expect(html.replace(/\s+/g, '')).toContain('</ul><p>普通段落</p>');
    });

    it('代码块内容原样保留（不转义、不解析）', () => {
      const html = markdownToHtml('```\nconst a = 1 < 2 && 3 > 2;\n```');
      expect(html).toContain('<pre><code>');
      expect(html).toContain('&lt;');
      expect(html).not.toContain('<strong>');
    });

    it('分隔线渲染成 hr', () => {
      expect(markdownToHtml('---')).toBe('<hr>');
    });

    it('空行不产生 br 噪声', () => {
      const html = markdownToHtml('甲\n\n\n乙');
      expect(html).not.toContain('<br>');
    });
  });

  describe('行内语法', () => {
    it('图片渲染成 img', () => {
      expect(markdownToHtml('![alt](https://x.com/a.png)')).toContain(
        '<img src="https://x.com/a.png" alt="alt"',
      );
    });

    it('粗体渲染成 strong', () => {
      expect(markdownToHtml('**粗**')).toBe('<p><strong>粗</strong></p>');
    });

    it('行内代码渲染成 code', () => {
      expect(markdownToHtml('`code`')).toBe('<p><code>code</code></p>');
    });
  });

  describe('escapeHtml', () => {
    it('转义 & < > 三者', () => {
      expect(escapeHtml('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
    });
  });

  describe('insertImageAfter', () => {
    it('在锚点行后插入图片', () => {
      const md = '# 标题\n\n> 引言\n\n正文';
      const out = insertImageAfter(md, /^>\s/, '![图](https://x.com/a.png)');
      const lines = out.split('\n');
      expect(lines[lines.indexOf('> 引言') + 2]).toBe('![图](https://x.com/a.png)');
    });

    it('once=true 时只插一次', () => {
      const md = '> 甲\n\n> 乙';
      const out = insertImageAfter(md, /^>\s/, '![图](u)');
      expect((out.match(/!\[图\]/g) || []).length).toBe(1);
    });
  });
});

describe('publishing/sites/51cto deriveSummary', () => {
  it('跳过标题/引用/图片行，只取正文段落', () => {
    const md = '# 标题\n\n> 引用\n\n![图](u)\n\n第一段文字。\n\n第二段文字。';
    const s = deriveSummary(md);
    expect(s).toContain('第一段文字');
    expect(s).not.toContain('引用');
    expect(s).not.toContain('![图]');
  });

  it('长度不超过上限', () => {
    const md = '正文'.repeat(500);
    expect(deriveSummary(md).length).toBeLessThanOrEqual(200);
  });
});
