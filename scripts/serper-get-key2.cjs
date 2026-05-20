const { chromium } = require('playwright');

async function run() {
  var browser = await chromium.connectOverCDP('http://localhost:9221', { timeout: 60000 });
  var ctx = browser.contexts()[0];
  var page = await ctx.newPage();
  console.log('Connected');

  try {
    // Navigate to API keys page
    console.log('Opening API keys page...');
    await page.goto('https://serper.dev/api-keys', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: '/tmp/serper-apikeys-page.png' });
    console.log('URL:', page.url());

    var pageText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
    console.log('Page text:', pageText);

    // Find API key - look for the actual key value
    var apiKeyInfo = await page.evaluate(function() {
      // Log all inputs
      var inputs = document.querySelectorAll('input');
      var inputList = [];
      for (var i = 0; i < inputs.length; i++) {
        var v = inputs[i].value;
        var p = inputs[i].placeholder;
        var t = inputs[i].type;
        var n = inputs[i].name;
        inputList.push({ type: t, name: n, value: v ? v.substring(0, 80) : '', placeholder: p });
      }
      
      // Look for text that looks like an API key in the page
      var bodyText = document.body.innerText;
      // Serper API keys are typically long alphanumeric strings
      var keyMatch = bodyText.match(/[a-f0-9]{30,}/i);
      
      // Also check for any copy button nearby
      var buttons = document.querySelectorAll('button');
      var btnTexts = [];
      for (var j = 0; j < buttons.length; j++) {
        btnTexts.push(buttons[j].textContent.trim().substring(0, 50));
      }

      return { inputs: inputList, keyMatch: keyMatch ? keyMatch[0] : null, buttons: btnTexts };
    });

    console.log('API key info:', JSON.stringify(apiKeyInfo, null, 2));

    if (apiKeyInfo.keyMatch) {
      console.log('\n========================================');
      console.log('API Key:', apiKeyInfo.keyMatch);
      console.log('========================================');
    }

    // If not found, try looking at the specific input that might contain the key
    // Look for the key in the dashboard text more carefully
    var detailedScan = await page.evaluate(function() {
      var result = {};
      
      // Check all text nodes
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      var textNodes = [];
      while (walker.nextNode()) {
        var t = walker.currentNode.textContent.trim();
        if (t.length > 20 && t.length < 100) {
          textNodes.push(t);
        }
      }
      result.textNodes = textNodes;
      
      // Check code elements
      var codeEls = document.querySelectorAll('code, pre, tt, kbd');
      var codeTexts = [];
      for (var i = 0; i < codeEls.length; i++) {
        codeTexts.push(codeEls[i].textContent.trim());
      }
      result.codeElements = codeTexts;

      return result;
    });

    console.log('\nDetailed scan:', JSON.stringify(detailedScan, null, 2));

  } catch (error) {
    await page.screenshot({ path: '/tmp/serper-error.png' }).catch(function() {});
    console.log('Error:', error.message);
  }
}

run().catch(console.error);
