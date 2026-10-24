/**
 * Markdown → HTML 转换器（发布插件共用）。
 *
 * 顺序铁律：**行级语法必须先于行内转义识别**。
 * 反例（ERR-20261022-010）：先做全局 HTML 转义（`>` → `&gt;`）再匹配
 * `^>` 引用块，引用块永远匹配不上，页面渲染成字面 `>`。
 *
 * 覆盖：标题 / 引用 / 有序无序列表 / 表格 / 粗体 / 行内代码 / 代码块 / 图片 / 分隔线。
 */

/** HTML 实体转义（仅用于段落内部的裸文本） */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 行内标记：图片 / 粗体 / 行内代码（在已转义的文本上做） */
function renderInline(escaped: string): string {
  return escaped
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%">')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

/** 分隔线判定：`---` / `***` / `___`（至少 3 个） */
function isThematicBreak(text: string): boolean {
  return /^(-{3,}|\*{3,}|_{3,})$/.test(text.trim());
}

/** 表格行判定：以 `|` 开头结尾的 GFM 行 */
function isTableRow(text: string): boolean {
  return /^\s*\|.*\|\s*$/.test(text);
}

/** 表格分隔行判定：`| --- | :--: |` */
function isTableSeparator(text: string): boolean {
  return /^\s*\|[\s:|-]+\|\s*$/.test(text) && text.includes('-');
}

/** 拆分表格单元格（去掉首尾竖线） */
function splitTableCells(text: string): string[] {
  return text.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

/**
 * Markdown → HTML。
 *
 * 与 `mdToHtml` 的差异：无 `<br>` 噪声（空行直接跳过），列表项聚合到同一
 * `<ul>`/`<ol>`，引用块保留 `<blockquote>` 包裹。
 */
export function markdownToHtml(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let inCode = false;
  let listKind: 'ul' | 'ol' | null = null;
  let inTable = false;

  const closeList = (): void => {
    if (listKind) {
      out.push(`</${listKind}>`);
      listKind = null;
    }
  };

  const closeTable = (): void => {
    if (inTable) {
      out.push('</tbody></table>');
      inTable = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    // 代码块围栏
    if (raw.trimStart().startsWith('```')) {
      closeList();
      closeTable();
      inCode = !inCode;
      out.push(inCode ? '<pre><code>' : '</code></pre>');
      continue;
    }
    if (inCode) {
      out.push(escapeHtml(raw));
      continue;
    }

    // 表格：表头行 + 紧跟分隔行才成立（单靠一行 `| a | b |` 不算表格）
    if (isTableRow(raw) && !isTableSeparator(raw) && isTableSeparator(lines[i + 1] ?? '')) {
      closeList();
      closeTable();
      const headers = splitTableCells(raw);
      out.push(
        '<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">'
        + '<thead><tr>' + headers.map((h) => `<th>${renderInline(escapeHtml(h))}</th>`).join('') + '</tr></thead><tbody>',
      );
      inTable = true;
      i++; // 跳过分隔行
      continue;
    }
    if (inTable && isTableRow(raw)) {
      const cells = splitTableCells(raw);
      out.push('<tr>' + cells.map((c) => `<td>${renderInline(escapeHtml(c))}</td>`).join('') + '</tr>');
      continue;
    }
    if (inTable) closeTable();

    // 无序列表（`---` 是分隔线不是列表项——先排除分隔线形态）
    const ulMatch = raw.match(/^\s*[-*+]\s+(.*)$/);
    if (ulMatch && !isThematicBreak(raw)) {
      if (listKind !== 'ul') {
        closeList();
        out.push('<ul>');
        listKind = 'ul';
      }
      out.push(`<li>${renderInline(escapeHtml(ulMatch[1]))}</li>`);
      continue;
    }

    // 有序列表
    const olMatch = raw.match(/^\s*\d+[.)]\s+(.*)$/);
    if (olMatch) {
      if (listKind !== 'ol') {
        closeList();
        out.push('<ol>');
        listKind = 'ol';
      }
      out.push(`<li>${renderInline(escapeHtml(olMatch[1]))}</li>`);
      continue;
    }

    closeList();

    // 标题
    const heading = raw.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(escapeHtml(heading[2]))}</h${level}>`);
      continue;
    }

    // 引用
    if (/^>\s?/.test(raw)) {
      out.push(`<blockquote>${renderInline(escapeHtml(raw.replace(/^>\s?/, '')))}</blockquote>`);
      continue;
    }

    // 分隔线
    if (isThematicBreak(raw)) {
      out.push('<hr>');
      continue;
    }

    // 空行
    if (raw.trim() === '') {
      continue;
    }

    out.push(`<p>${renderInline(escapeHtml(raw))}</p>`);
  }

  closeList();
  closeTable();
  if (inCode) out.push('</code></pre>');
  return out.join('\n');
}

/**
 * 在 markdown 的某行后插入图片。
 *
 * @param markdown 原始 markdown
 * @param anchor 锚点行的匹配（正则，作用于整行）
 * @param imageMd 图片 markdown 行
 * @param once 是否只插一次（默认 true）
 */
export function insertImageAfter(
  markdown: string,
  anchor: RegExp,
  imageMd: string,
  once = true,
): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let done = false;
  for (const line of lines) {
    out.push(line);
    if ((!once || !done) && anchor.test(line)) {
      out.push('', imageMd);
      done = true;
    }
  }
  return out.join('\n');
}
