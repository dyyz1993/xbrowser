#!/usr/bin/env node
const { execSync } = require('child_process');
const { WebSocket } = require('ws');

const CDP = 'http://localhost:9221';
const SITE = 'https://github.com/dyyz1993';

function cdp(wsUrl, method, params) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const id = Date.now();
    const timer = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 30000);
    ws.on('open', () => ws.send(JSON.stringify({ id, method, params })));
    ws.on('message', d => {
      const r = JSON.parse(d.toString());
      if (r.id === id) { clearTimeout(timer); ws.close(); resolve(r.result); }
    });
    ws.on('error', e => { clearTimeout(timer); reject(e); });
  });
}

const wait = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  const list = JSON.parse(execSync(`curl -s ${CDP}/json`).toString());
  
  // Find an existing page with Google cookies (any google.com page)
  let tab = list.find(t => t.type === 'page' && t.url && t.url.includes('google.com'));
  if (!tab) tab = list.find(t => t.type === 'page' && t.url && !t.url.startsWith('file://'));
  if (!tab) { console.log('No pages found'); return; }
  
  console.log(`Using tab: ${tab.url.slice(0, 60)}`);
  const ws = tab.webSocketDebuggerUrl;

  // Create a new tab in the same browser (inherits cookies)
  const createResult = await cdp(ws, 'Target.createTarget', { url: 'about:blank' }).catch(() => null);
  let tabWs = ws;
  if (createResult) {
    const newTab = list.find(t => t.id === createResult.targetId);
    if (newTab) tabWs = newTab.webSocketDebuggerUrl;
  }

  const platforms = [
    { name: 'StackOverflow', url: 'https://stackoverflow.com/users/edit/current' },
    { name: 'Vimeo', url: 'https://vimeo.com/settings' },
    { name: 'Reddit', url: 'https://old.reddit.com/prefs/' },
    { name: 'Imgur', url: 'https://imgur.com/account/settings' },
  ];

  for (const p of platforms) {
    console.log(`\n[${p.name}] -> ${p.url}`);
    
    await cdp(tabWs, 'Page.navigate', { url: p.url }).catch(() => {});
    await wait(8000);

    const t = await cdp(tabWs, 'Runtime.evaluate', {
      expression: 'document.title', returnByValue: true
    }).catch(() => ({ result: { value: '?' } }));
    console.log(`  Title: ${(t.result?.value || '?').slice(0, 50)}`);

    // Check if login page
    const isLogin = await cdp(tabWs, 'Runtime.evaluate', {
      expression: `(document.body?.innerText||'').match(/(sign in|log in|login)/i) ? true : false`,
      returnByValue: true
    }).catch(() => ({ value: false }));

    if (isLogin.value) {
      console.log('  Login page detected, trying Google OAuth...');
      const click = await cdp(tabWs, 'Runtime.evaluate', {
        expression: `
          (() => {
            const items = [...document.querySelectorAll('button, a, div[role="button"], span')];
            const g = items.find(el => {
              const t = (el.textContent||'').toLowerCase();
              return (t.includes('google') && (t.includes('sign') || t.includes('log') || t.includes('continue')));
            });
            if (!g) return 'not-found';
            g.click();
            return 'clicked';
          })()
        `,
        returnByValue: true
      }).catch(() => ({ result: { value: 'error' } }));
      console.log(`  OAuth: ${click.result?.value}`);
      if (click.result?.value === 'clicked') {
        await wait(10000);
        const nt = await cdp(tabWs, 'Runtime.evaluate', {
          expression: 'document.title', returnByValue: true
        }).catch(() => ({ result: { value: '?' } }));
        console.log(`  After OAuth: ${(nt.result?.value || '?').slice(0, 50)}`);
      }
    }

    // Find and fill URL input
    const fill = await cdp(tabWs, 'Runtime.evaluate', {
      expression: `
        (() => {
          const all = [...document.querySelectorAll('input')];
          const seen = new Set();
          const match = all.filter(i => {
            const key = (i.id||'') + '|' + (i.name||'') + '|' + (i.placeholder||'');
            if (seen.has(key)) return false;
            seen.add(key);
            const t = key.toLowerCase();
            return /(url|web|site|link)/.test(t) && (!i.type || i.type === 'text' || i.type === 'url');
          });
          if (match.length > 0) {
            const el = match[0];
            const old = el.value;
            el.value = '';
            el.value = '${SITE}';
            el.dispatchEvent(new Event('input', {bubbles:true}));
            el.dispatchEvent(new Event('change', {bubbles:true}));
            return JSON.stringify({ok:true, id: el.id||el.name, old: old.slice(0,40)});
          }
          return JSON.stringify({ok:false, all: all.map(i => ({id:i.id, name:i.name, ph:i.placeholder, type:i.type}))});
        })()
      `,
      returnByValue: true
    }).catch(() => ({ result: { value: '{}' } }));

    const fillRes = JSON.parse(fill.result?.value || '{}');
    if (fillRes.ok) {
      console.log(`  Filled: ${fillRes.id} (was: "${fillRes.old}")`);
      const save = await cdp(tabWs, 'Runtime.evaluate', {
        expression: `
          (() => {
            const btns = [...document.querySelectorAll('button, input[type="submit"]')];
            const s = btns.find(b => /Save|Update|Submit|Apply/.test(b.textContent||b.value||''));
            if (!s) return 'no-save-btn';
            s.click();
            return 'saved';
          })()
        `,
        returnByValue: true
      }).catch(() => ({ result: { value: 'error' } }));
      console.log(`  Save: ${save.result?.value}`);
    } else {
      console.log(`  No match (${fillRes.all?.length || 0} inputs)`);
    }
    
    await wait(2000);
  }
  console.log('\nDone');
}

run().catch(e => console.error(`Error: ${e.message.slice(0, 100)}`));
