const { chromium } = require('playwright');

async function run() {
  var browser = await chromium.connectOverCDP('http://localhost:9221', { timeout: 60000 });
  var ctx = browser.contexts()[0];
  var page = await ctx.newPage();
  console.log('Connected');

  try {
    // Use domcontentloaded instead of load
    await page.goto('https://serper.dev/api-keys', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(8000);
    await page.screenshot({ path: '/tmp/serper-ak1.png' });
    console.log('URL:', page.url());

    var pageText = await page.evaluate(function() { return document.body.innerText; });
    console.log('Page text:', pageText.substring(0, 2000));

    // Click "Create New Key"
    console.log('Creating new key...');
    await page.evaluate(function() {
      var btns = Array.from(document.querySelectorAll('button, a, div'));
      var btn = btns.find(function(el) { 
        var t = el.textContent?.trim();
        return t === 'Create New Key' || t === 'Create new key' || t === 'Create New'; 
      });
      if (btn) { btn.click(); return 'clicked'; }
      return null;
    });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/tmp/serper-ak2-create.png' });

    // Check if dialog/modal appeared
    var modalText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
    console.log('After create click:', modalText);

    // Fill name if prompted
    await page.evaluate(function() {
      var inputs = document.querySelectorAll('input');
      for (var i = 0; i < inputs.length; i++) {
        if (inputs[i].type === 'text' && !inputs[i].value) {
          var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(inputs[i], 'default');
          inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
          return 'filled: ' + inputs[i].name;
        }
      }
      return 'no empty text input';
    });

    // Click any confirm/create button in modal
    await page.evaluate(function() {
      var btns = Array.from(document.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i++) {
        var t = btns[i].textContent?.trim().toLowerCase();
        if (t === 'create' || t === 'confirm' || t === 'ok') {
          btns[i].click();
          return 'clicked: ' + t;
        }
      }
      return null;
    });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: '/tmp/serper-ak3-result.png' });

    // Get the result
    var resultText = await page.evaluate(function() { return document.body.innerText; });
    console.log('Result text:', resultText.substring(0, 3000));

    // Find API key
    var apiKey = await page.evaluate(function() {
      var hexMatch = document.body.innerText.match(/[a-f0-9]{30,}/i);
      if (hexMatch) return hexMatch[0];
      var inputs = document.querySelectorAll('input');
      for (var i = 0; i < inputs.length; i++) {
        var v = inputs[i].value;
        if (v && v.length > 15 && /^[a-f0-9]+$/i.test(v)) return v;
      }
      return null;
    });

    if (apiKey) {
      console.log('\n========================================');
      console.log('SUCCESS! API Key:', apiKey);
      console.log('========================================');
    } else {
      console.log('No API key found yet. Check screenshots.');

      // Get all candidate strings
      var candidates = await page.evaluate(function() {
        var els = document.querySelectorAll('span, p, div, code, td, input');
        var results = [];
        for (var i = 0; i < els.length; i++) {
          var t = (els[i].value || els[i].textContent || '').trim();
          if (t.length > 10 && t.length < 100) results.push(t);
        }
        return results.filter(function(v, i, a) { return a.indexOf(v) === i; }).slice(0, 30);
      });
      console.log('All candidate strings:', JSON.stringify(candidates, null, 2));
    }

  } catch (error) {
    await page.screenshot({ path: '/tmp/serper-error.png' }).catch(function() {});
    console.log('Error:', error.message);
  }
}

run().catch(console.error);
