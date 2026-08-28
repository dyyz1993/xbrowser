const out = document.getElementById('out');
const domain = () => document.getElementById('domain').value.trim();

function show(obj) { out.textContent = JSON.stringify(obj, null, 1).substring(0, 600); }

document.getElementById('exp').onclick = async () => {
  out.textContent = '导出中…';
  chrome.runtime.sendMessage({ type: 'export', domain: domain() }, (r) => show(r));
};
document.getElementById('imp').onclick = async () => {
  out.textContent = '导入中…';
  chrome.runtime.sendMessage({ type: 'import', domain: domain() }, (r) => show(r));
};
document.getElementById('tabs').onclick = async () => {
  chrome.runtime.sendMessage({ type: 'tabs' }, (r) => show(r));
};
