const { chromium } = require('playwright');

async function run() {
  var browser = await chromium.connectOverCDP('http://localhost:9221', { timeout: 60000 });
  var ctx = browser.contexts()[0];
  var page = await ctx.newPage();
  console.log('Connected');

  try {
    // Step 1: Open verification link
    var verifyUrl = 'https://serper.dev/confirm-email?token=7575bf79161129bed9b9c521dbb6726dd310a62b';
    console.log('Opening verification link...');
    await page.goto(verifyUrl, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(8000);
    await page.screenshot({ path: '/tmp/serper-verify-result.png' });
    console.log('After verify URL:', page.url());
    
    var vText = await page.evaluate(function() { return document.body.innerText.substring(0, 2000); });
    console.log('Verify page text:', vText.substring(0, 500));

    // Step 2: Navigate to dashboard
    console.log('\nNavigating to dashboard...');
    await page.goto('https://serper.dev/dashboard', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: '/tmp/serper-dashboard.png' });
    console.log('Dashboard URL:', page.url());

    var dashText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
    console.log('Dashboard text:', dashText.substring(0, 1500));

    // Step 3: Find API key
    var apiKey = await page.evaluate(function() {
      var inputs = document.querySelectorAll('input');
      for (var i = 0; i < inputs.length; i++) {
        var v = inputs[i].value;
        if (v && v.length > 15) return v;
      }
      var codeEls = document.querySelectorAll('code, pre, span');
      for (var j = 0; j < codeEls.length; j++) {
        var t = codeEls[j].textContent.trim();
        if (t && t.length > 20 && /^[a-f0-9]+$/i.test(t)) return t;
      }
      return null;
    });

    if (apiKey) {
      console.log('\n========================================');
      console.log('SUCCESS! API Key:', apiKey);
      console.log('========================================');
      console.log(JSON.stringify({ success: true, apiKey: apiKey }, null, 2));
    } else {
      console.log('API key not found directly. Looking deeper...');
      
      // Try settings page
      await page.goto('https://serper.dev/settings', { waitUntil: 'load', timeout: 60000 }).catch(function(){});
      await page.waitForTimeout(5000);
      await page.screenshot({ path: '/tmp/serper-settings.png' });
      
      var settingsText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
      console.log('Settings text:', settingsText.substring(0, 1000));

      // Try API key page
      await page.goto('https://serper.dev/api-key', { waitUntil: 'load', timeout: 60000 }).catch(function(){});
      await page.waitForTimeout(5000);
      await page.screenshot({ path: '/tmp/serper-apikey-page.png' });
      
      var apiKeyPageText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
      console.log('API key page text:', apiKeyPageText.substring(0, 1000));

      // Deep search for API key
      var apiKey2 = await page.evaluate(function() {
        var allInputs = document.querySelectorAll('input');
        var inputInfo = [];
        var keyValue = null;
        for (var i = 0; i < allInputs.length; i++) {
          var inp = allInputs[i];
          inputInfo.push({ type: inp.type, name: inp.name, id: inp.id, value: inp.value.substring(0, 50), placeholder: inp.placeholder });
          if (inp.value && inp.value.length > 15) keyValue = inp.value;
        }
        console.log('All inputs:', JSON.stringify(inputInfo));
        return keyValue;
      });

      if (apiKey2) {
        console.log('\n========================================');
        console.log('SUCCESS! API Key:', apiKey2);
        console.log('========================================');
      } else {
        console.log('Still no API key found. Check screenshots.');
      }
    }

  } catch (error) {
    await page.screenshot({ path: '/tmp/serper-error-final.png' }).catch(function() {});
    console.log('Error:', error.message);
  }
}

run().catch(console.error);
