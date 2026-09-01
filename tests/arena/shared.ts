/**
 * 录制回放竞技场共享件 — 靶场页 + DOM 变异器 + 攻击级别
 *
 * 使用方：
 *   tests/arena/arena.test.ts            影子链竞技场（测试本地 fallback chain）
 *   tests/arena/arena-production.test.ts 生产竞技场（直连 SessionReplayer）
 *
 * S203: removeElement 变异补齐（此前 LEVELS.apocalypse 引用但 MUTATIONS 未定义，
 * applyMutations 静默跳过——apocalypse 实际攻击强度低于声称值）。
 */

// ── 靶场页生成 ──
// data-arena 是测量仪器：heal 链的候选永远由录制选择器文本派生，不可能引用它，
// 因此语义校验（值是否落进对的字段）可以依赖它，且不会反向"帮助"heal。
// preventSubmit: 生产竞技场用 type="button" 防止表单提交导航清空字段值。

export function buildTargetPage(prefix: string, opts: { preventSubmit?: boolean } = {}): string {
  const submitType = opts.preventSubmit ? 'button' : 'submit';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Arena ${prefix}</title></head>
<body>
  <form id="login-${prefix}">
    <input id="username-${prefix}" class="field-input" name="username" placeholder="Username" type="text" data-arena="username" />
    <input id="password-${prefix}" class="field-input" name="password" placeholder="Password" type="password" data-arena="password" />
    <input id="email-${prefix}" class="field-input" name="email" placeholder="Email" type="email" data-arena="email" />
    <textarea id="comment-${prefix}" class="field-area" name="comment" data-arena="comment">initial</textarea>
    <select id="role-${prefix}" class="field-select" data-arena="role"><option value="user">user</option><option value="admin">admin</option></select>
    <button id="submit-${prefix}" class="btn-primary" type="${submitType}" data-arena="submit">Login</button>
  </form>
  <form>
    <!-- class/coords 靶场（S203 cron r3/r5）：无 id/name/placeholder，无 type
         属性（隐式 text 但 [type="text"] 属性选择器不匹配）——meta-type 在此
         场景不可用；删 class 后只剩坐标可依赖。 -->
    <input class="search-box" data-arena="search" />
    <input class="qty-box" data-arena="qty" />
    <button class="btn-secondary" type="button" data-arena="go">Go</button>
  </form>
  <div id="result-${prefix}" class="result-area">waiting</div>
</body></html>`;
}

// ── DOM 攻击变异器 ──

export const MUTATIONS: Record<string, { desc: string; fn: string }> = {
  changeId: { desc: '改所有 id（加 -mutated 后缀）', fn: `document.querySelectorAll('[id]').forEach(function(el){ if(el.id && el.id !== 'result-') el.id = el.id + '-mut'; });` },
  changeClass: { desc: '改所有 class（加 mutated 后缀）', fn: `document.querySelectorAll('[class]').forEach(function(el){ el.className = el.className + ' mutated'; });` },
  addWrapper: { desc: '每个 input/button 外加包裹 div', fn: `document.querySelectorAll('form input, form button, form textarea, form select').forEach(function(el){ var w = document.createElement('div'); el.parentNode.insertBefore(w, el); w.appendChild(el); });` },
  removeName: { desc: '删所有 name 属性', fn: `document.querySelectorAll('[name]').forEach(function(el){ el.removeAttribute('name'); });` },
  removePlaceholder: { desc: '删所有 placeholder', fn: `document.querySelectorAll('[placeholder]').forEach(function(el){ el.removeAttribute('placeholder'); });` },
  randomizeId: { desc: 'id 全部随机化（不可预测）', fn: `document.querySelectorAll('[id]').forEach(function(el){ el.id = 'el-' + Math.random().toString(36).substr(2,8); });` },
  removeId: { desc: '删所有 id 属性', fn: `document.querySelectorAll('[id]').forEach(function(el){ el.removeAttribute('id'); });` },
  changeName: { desc: 'name 属性全部随机化', fn: `document.querySelectorAll('[name]').forEach(function(el){ el.setAttribute('name', 'fld-' + Math.random().toString(36).substr(2,6)); });` },
  shuffleForm: { desc: 'form 子元素随机重排', fn: `document.querySelectorAll('form').forEach(function(f){ var kids=Array.from(f.children); for(var i=kids.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1)); f.insertBefore(kids[j],kids[i]);} });` },
  removeClass: { desc: '删所有 class 属性', fn: `document.querySelectorAll('[class]').forEach(function(el){ el.removeAttribute('class'); });` },
  removeElement: { desc: '删除 submit 按钮后原位重建（等价替换攻击）', fn: `document.querySelectorAll('form button[type="submit"], form button[type="button"]').forEach(function(el){ var n = el.cloneNode(true); el.parentNode.replaceChild(n, el); });` },
};

export const LEVELS: Record<string, string[]> = {
  none: [],
  light: ['changeId'],
  medium: ['changeId', 'changeClass', 'addWrapper'],
  aggressive: ['changeId', 'changeClass', 'addWrapper', 'removeName', 'removePlaceholder'],
  extreme2: ['randomizeId', 'removeId', 'changeName', 'addWrapper'],
  nuclear: ['randomizeId', 'removeId', 'changeName', 'removePlaceholder', 'addWrapper', 'changeClass'],
  apocalypse: ['randomizeId', 'removeId', 'changeName', 'removePlaceholder', 'addWrapper', 'changeClass', 'shuffleForm', 'removeClass', 'removeElement'],
};

// ── 语义校验期望值（生产竞技场用）──

export const SEMANTIC_EXPECTED: Record<string, string> = {
  username: 'arena-user',
  password: 'arena-pass-123',
  email: 'arena@test.com',
  comment: 'arena comment',
  role: 'admin',
};
