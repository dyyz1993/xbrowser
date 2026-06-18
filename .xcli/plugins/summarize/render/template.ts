/**
 * render/template — 模板渲染（设计 §7 降级路径）。
 *
 * 把结构化 Topic 渲染成可读的 flow 正文。生硬但准确，不依赖 LLM。
 * 这是渲染层的安全网：LLM 不可用/失败/省钱时，永远能用模板产出可用正文。
 *
 * 字段值原样保留（不猜测、不编造），selector 带 strategy 标注。
 */
import type { Topic, FieldValue } from '../types.js';

/** 把单个 FieldValue 渲染成可读字符串。 */
function renderField(v: FieldValue): string {
  switch (v.kind) {
    case 'text':
      return v.value;
    case 'selector':
      return v.selector;
    case 'url':
      return v.value;
    case 'files':
      return v.names.join(', ');
  }
}

/** 意图的中文标签（用于标题和描述）。 */
const INTENT_LABEL: Record<string, string> = {
  login: '登录',
  logout: '登出',
  search: '搜索',
  upload: '上传',
  chat: '发送消息',
  'form-submit': '表单提交',
  navigate: '页面导航',
  'menu-interact': '菜单交互',
  unknown: '未识别操作',
};

/** 意图的一句话描述模板。 */
const INTENT_DESC: Record<string, string> = {
  login: '用户通过输入账号密码完成登录。',
  logout: '用户点击退出按钮登出。',
  search: '用户在搜索框输入关键词进行搜索。',
  upload: '用户上传文件。',
  chat: '用户在对话框输入消息并发送。',
  'form-submit': '用户填写表单并提交。',
  navigate: '用户在不同页面间导航。',
  'menu-interact': '用户点击按钮展开菜单。',
  unknown: '用户进行了一组操作（未能匹配预设意图）。',
};

/**
 * 用固定模板把 Topic 渲染成 flow 正文（markdown）。
 * 永远可用，不依赖外部。
 */
export function renderTopicTemplate(topic: Topic): string {
  const label = INTENT_LABEL[topic.intent] ?? topic.intent;
  const desc = INTENT_DESC[topic.intent] ?? '';

  const lines: string[] = [];
  lines.push(`## ${label}`);
  lines.push('');
  if (desc) lines.push(desc);
  if (topic.resultHint) lines.push(`结果：${topic.resultHint}。`);
  lines.push('');

  // 关键元素表
  const fieldEntries = Object.entries(topic.fields);
  if (fieldEntries.length > 0) {
    lines.push('### 关键元素');
    lines.push('');
    lines.push('| 角色 | 值 | 类型 |');
    lines.push('|---|---|---|');
    for (const [key, val] of fieldEntries) {
      lines.push(`| ${key} | ${renderField(val)} | ${val.kind} |`);
    }
    lines.push('');
  }

  // 步骤（从 segments 的 action 粗略生成）
  const actions = topic.segments.flatMap(s => s.actions);
  if (actions.length > 0) {
    lines.push('### 操作步骤');
    lines.push('');
    let step = 1;
    for (const a of actions.slice(0, 20)) {  // 最多列 20 步
      const text = a.element?.text ?? '';
      const val = a.value ?? '';
      const sel = a.element?.selector ?? '';
      // 脱敏：password 类型的 input 不渲染 value
      const isPassword = a.element?.type === 'password';
      let line = '';
      if (a.type === 'click') line = `点击「${text || sel}」`;
      else if (a.type === 'input') line = `输入 ${isPassword ? '***' : (val || '(空)')}${sel ? ` 到 ${sel}` : ''}`;
      else if (a.type === 'navigation' || a.type === 'goto') line = `导航到 ${a.url}`;
      else if (a.type === 'filechooser') line = `选择文件`;
      else if (a.type === 'keydown') line = `按下 ${a.key}`;
      else continue;
      lines.push(`${step}. ${line}`);
      step++;
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}
