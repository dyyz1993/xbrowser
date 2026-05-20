const { chromium } = require('playwright');

async function run() {
  var browser = await chromium.connectOverCDP('http://localhost:9221', { timeout: 60000 });
  var ctx = browser.contexts()[0];
  var page = await ctx.newPage();
  console.log('Connected');

  try {
    // Go to API keys page
    await page.goto('https://serper.dev/dashboard', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);
    
    // Click API keys
    await page.evaluate(function() {
      var links = Array.from(document.querySelectorAll('a, div, span'));
      var apiKeyLink = links.find(function(el) { return el.textContent?.trim() === 'API keys'; });
      if (apiKeyLink) apiKeyLink.click();
    });
    await page.waitForTimeout(5000);
    console.log('On API keys page:', page.url());

    // Click "Create New Key" button
    console.log('Clicking Create New Key...');
    var createClicked = await page.evaluate(function() {
      var btns = Array.from(document.querySelectorAll('button, a, div'));
      var btn = btns.find(function(el) { 
        return el.textContent?.trim() === 'Create New Key' || el.textContent?.trim() === 'Create new key'; 
      });
      if (btn) { btn.click(); return 'clicked'; }
      return 'not found';
    });
    console.log('Create clicked:', createClicked);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/tmp/serper-create-key.png' });

    // Check if a dialog appeared asking for key name
    var dialogText = await page.evaluate(function() { return document.body.innerText.substring(0, 3000); });
    console.log('Dialog text:', dialogText);

    // If there's a name input, fill it
    await page.evaluate(function() {
      var nameInput = document.querySelector('input[name="name"], input[placeholder*="name"], input[placeholder*="Name"]');
      if (nameInput) {
        var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(nameInput, 'default-key');
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
        return 'filled name';
      }
      return 'no name input';
    });

    // Click confirm/create in the dialog
    await page.evaluate(function() {
      var btns = Array.from(document.querySelectorAll('button'));
      var confirmBtn = btns.find(function(b) {
        var t = b.textContent?.trim().toLowerCase();
        return t === 'create' || t === 'confirm' || t === 'ok' || t === 'submit';
      });
      if (confirmBtn) confirmBtn.click();
    });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: '/tmp/serper-key-created.png' });

    // Check for the newly created key
    var pageText = await page.evaluate(function() { return document.body.innerText; });
    console.log('Page after create:', pageText.substring(0, 3000));

    // Look for the API key
    var apiKey = await page.evaluate(function() {
      // Check for hex string in the page
      var hexMatch = document.body.innerText.match(/[a-f0-9]{30,}/i);
      if (hexMatch) return hexMatch[0];
      
      // Check all inputs
      var inputs = document.querySelectorAll('input');
      for (var i = 0; i < inputs.length; i++) {
        var v = inputs[i].value;
        if (v && v.length > 15) return v;
      }
      
      // Check table cells
      var tds = document.querySelectorAll('td');
      for (var j = 0; j < tds.length; j++) {
        var t = tds[j].textContent.trim();
        if (t.length > 15 && /^[a-f0-9]+$/i.test(t)) return t;
      }

      return null;
    });

    if (apiKey) {
      console.log('\n========================================');
      console.log('SUCCESS! API Key:', apiKey);
      console.log('========================================');
    } else {
      console.log('API key not visible. May need to check screenshot.');
      // Try getting all visible text that might be a key
      var allText = await page.evaluate(function() {
        var spans = document.querySelectorAll('span, p, div, code, td');
        var candidates = [];
        for (var i = 0; i < spans.length; i++) {
          var t = spans[i].textContent.trim();
          if (t.length > 10 && t.length < 80 && !t.includes(' ') && !t.includes('\n')) {
            candidates.push(t);
          }
        }
        return candidates.slice(0, 20);
      });
      console.log('Candidate strings:', JSON.stringify(allText, null, 2));
    }

  } catch (error) {
    await page.screenshot({ path: '/tmp/serper-error.png' }).catch(function() {});
    console.log('Error:', error.message);
  }
}

run().catch(console.error);
