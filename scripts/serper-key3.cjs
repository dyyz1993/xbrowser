const { chromium } = require('playwright');

async function run() {
  var browser = await chromium.connectOverCDP('http://localhost:9221', { timeout: 60000 });
  var ctx = browser.contexts()[0];
  var page = await ctx.newPage();
  console.log('Connected');

  try {
    // Go to dashboard first
    console.log('Opening dashboard...');
    await page.goto('https://serper.dev/dashboard', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: '/tmp/serper-dash1.png' });

    // Click on "API keys" menu item
    console.log('Clicking API keys menu...');
    var clicked = await page.evaluate(function() {
      var links = Array.from(document.querySelectorAll('a, div, span, button'));
      var apiKeyLink = links.find(function(el) {
        var t = el.textContent?.trim();
        return t === 'API keys' || t === 'API Keys' || t === 'API KEYS';
      });
      if (apiKeyLink) {
        apiKeyLink.click();
        return 'clicked: ' + apiKeyLink.textContent.trim();
      }
      return 'not found';
    });
    console.log('Click result:', clicked);
    await page.waitForTimeout(5000);
    await page.screenshot({ path: '/tmp/serper-dash2-apikeys.png' });
    console.log('URL:', page.url());

    // Get the full page text
    var pageText = await page.evaluate(function() { return document.body.innerText; });
    console.log('Page text:', pageText.substring(0, 3000));

    // Extract API key from the page
    var apiKey = await page.evaluate(function() {
      // Method 1: Look for input with long value
      var inputs = document.querySelectorAll('input');
      for (var i = 0; i < inputs.length; i++) {
        var v = inputs[i].value;
        if (v && /^[a-f0-9]{20,}$/i.test(v)) return { method: 'input', key: v };
      }
      
      // Method 2: Look for text that matches API key pattern
      var bodyText = document.body.innerText;
      var hexMatch = bodyText.match(/[a-f0-9]{30,}/i);
      if (hexMatch) return { method: 'regex', key: hexMatch[0] };
      
      // Method 3: Check code/pre elements
      var codeEls = document.querySelectorAll('code, pre, span, p, div');
      for (var j = 0; j < codeEls.length; j++) {
        var t = codeEls[j].textContent.trim();
        if (/^[a-f0-9]{20,}$/i.test(t)) return { method: 'code', key: t };
      }

      // Method 4: Check all inputs for any value
      var allInputValues = [];
      for (var k = 0; k < inputs.length; k++) {
        allInputValues.push({ 
          type: inputs[k].type, 
          name: inputs[k].name, 
          value: inputs[k].value ? inputs[k].value.substring(0, 80) : '',
          placeholder: inputs[k].placeholder 
        });
      }

      return { method: 'none', allInputs: allInputValues };
    });

    console.log('\nAPI Key result:', JSON.stringify(apiKey, null, 2));

    if (apiKey.key) {
      console.log('\n========================================');
      console.log('SUCCESS!');
      console.log('API Key:', apiKey.key);
      console.log('========================================');
    }

  } catch (error) {
    await page.screenshot({ path: '/tmp/serper-error.png' }).catch(function() {});
    console.log('Error:', error.message);
  }
}

run().catch(console.error);
