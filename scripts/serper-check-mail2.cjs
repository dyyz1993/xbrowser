const { chromium } = require('playwright');

async function run() {
  console.log('Connecting to CDP...');
  const browser = await chromium.connectOverCDP('http://localhost:9221');
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();

  try {
    // Navigate to 163 mail inbox directly using hash URL
    console.log('Opening 163 mail inbox list...');
    // The 163 mail uses hash routing - navigate to inbox module
    await page.goto('https://mail.163.com/js6/main.jsp?sid=iMloKRRkwUrTydaCUpRxgppwFCZaJcNz&df=mail163_letter#module=mailbox.ListModule%7C%7B%22filter%22%3A%7B%22folder%22%3A%221%22%7D%7D', 
      { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(8000);
    await page.screenshot({ path: '/tmp/serper-mail-inbox-01.png' });

    // Check if inbox loaded
    var inboxText = await page.evaluate(function() {
      return document.body.innerText.substring(0, 3000);
    });
    console.log('Inbox text (first 1500):', inboxText.substring(0, 1500));

    // Look for Serper email in the inbox
    var serperFound = await page.evaluate(function() {
      var allText = document.body.innerText;
      if (allText.toLowerCase().includes('serper')) return 'found in text';
      
      // Check all visible elements
      var rows = document.querySelectorAll('tr[class*="js-component-emailcolumn"], div[class*="emaillist"], div[class*="mail-list"], table[class*="emaillist"]');
      var results = [];
      for (var i = 0; i < rows.length; i++) {
        results.push(rows[i].textContent.trim().substring(0, 200));
      }
      if (results.length > 0) return 'rows: ' + JSON.stringify(results.slice(0, 5));
      return 'not found - checking DOM structure';
    });
    console.log('Serper search:', serperFound);

    // Try clicking 收件箱 to load the inbox list via UI
    console.log('\nTrying to click inbox via UI...');
    var clickResult = await page.evaluate(function() {
      var els = Array.from(document.querySelectorAll('a, span, div, li'));
      for (var i = 0; i < els.length; i++) {
        var t = els[i].textContent?.trim();
        if (t && (t === '收件箱' || t.startsWith('收件箱(') || t === 'Inbox')) {
          // Find the closest clickable link
          var target = els[i];
          // Check if it's an anchor
          if (target.tagName !== 'A') {
            var parent = target.closest('a');
            if (parent) target = parent;
          }
          target.click();
          return 'clicked: ' + t;
        }
      }
      return 'not found';
    });
    console.log('Click result:', clickResult);
    await page.waitForTimeout(5000);
    await page.screenshot({ path: '/tmp/serper-mail-inbox-02.png' });

    // Get the main frame content
    var mainFrame = page.mainFrame();
    var mainText = await mainFrame.evaluate(function() {
      return document.body.innerText.substring(0, 5000);
    });
    console.log('Main frame text (first 2000):', mainText.substring(0, 2000));

    // Check all child frames for email list
    var frames = page.frames();
    console.log('Frames:', frames.length);
    for (var fi = 0; fi < frames.length; fi++) {
      try {
        var fText = await frames[fi].evaluate(function() {
          return document.body ? document.body.innerText.substring(0, 2000) : '';
        });
        if (fText.length > 50) {
          console.log('Frame', fi, 'url:', frames[fi].url().substring(0, 80));
          console.log('Frame', fi, 'text:', fText.substring(0, 500));
        }
      } catch(e) {}
    }

    // Try using 163 mail API to search for emails
    // Extract the sid from current URL
    var currentUrl = page.url();
    var sidMatch = currentUrl.match(/sid=([^&]+)/);
    var sid = sidMatch ? sidMatch[1] : '';
    console.log('\nSID:', sid);

    if (sid) {
      // Use 163 mail API to search for Serper emails
      console.log('Searching via 163 API...');
      
      // Navigate to search in the mailbox
      var searchUrl = 'https://mail.163.com/js6/main.jsp?sid=' + sid + '&df=mail163_letter#module=search.SearchModule%7C%7B%22query%22%3A%22serper%22%7D';
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(8000);
      await page.screenshot({ path: '/tmp/serper-mail-search-01.png' });

      var searchText = await page.evaluate(function() {
        return document.body.innerText.substring(0, 5000);
      });
      console.log('Search result text:', searchText.substring(0, 2000));

      // Also try the API endpoint directly via evaluate (fetch from within the page context, same origin)
      var apiResult = await page.evaluate(function(args) {
        return new Promise(function(resolve) {
          var xhr = new XMLHttpRequest();
          xhr.open('POST', 'https://mail.163.com/js6/s?sid=' + args.sid + '&func=mbox:searchMessages&hasQuota=true&hasFwd=true&hasAttach=true', true);
          xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
          xhr.onload = function() {
            resolve(xhr.responseText.substring(0, 5000));
          };
          xhr.onerror = function() {
            resolve('error');
          };
          xhr.send('var=<?xml version="1.0"?><object><string name="query">serper</string><int name="folder">1</int><int name="start">0</int><int name="limit">20</int></object>');
        });
      }, { sid: sid });
      console.log('\nAPI search result:', apiResult.substring(0, 2000));

      // Try newer API format
      var apiResult2 = await page.evaluate(function(args) {
        return new Promise(function(resolve) {
          var xhr = new XMLHttpRequest();
          xhr.open('GET', 'https://mail.163.com/js6/s?sid=' + args.sid + '&func=mbox:listMessages&folderId=1&start=0&limit=20&order=date&desc=true&hasQuota=true&hasFwd=true&hasAttach=true', true);
          xhr.onload = function() {
            resolve(xhr.responseText.substring(0, 5000));
          };
          xhr.onerror = function() {
            resolve('error');
          };
          xhr.send();
        });
      }, { sid: sid });
      console.log('\nList messages result:', apiResult2.substring(0, 3000));

      // If API returned email IDs, try to find serper in them
      if (apiResult2.includes('serper') || apiResult2.toLowerCase().includes('serper')) {
        console.log('\n=== FOUND SERPER EMAIL VIA API ===');
        
        // Extract the email ID
        var emailIdMatch = apiResult2.match(/id[^>]*>(\d+)[^<]*<.*?serper/si);
        if (emailIdMatch) {
          console.log('Email ID:', emailIdMatch[1]);
          
          // Open the email
          var emailUrl = 'https://mail.163.com/js6/main.jsp?sid=' + sid + '&df=mail163_letter#module=read.ReadModule%7C%7B%22id%22%3A' + emailIdMatch[1] + '%2C%22folder%22%3A%221%22%7D';
          await page.goto(emailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(5000);
          await page.screenshot({ path: '/tmp/serper-mail-opened.png' });
          
          var emailContent = await page.evaluate(function() {
            return document.body.innerText.substring(0, 5000);
          });
          console.log('Email content:', emailContent.substring(0, 2000));

          // Extract verification link
          var verifyLink = await page.evaluate(function() {
            var links = Array.from(document.querySelectorAll('a'));
            for (var i = 0; i < links.length; i++) {
              var h = links[i].href;
              if (h.includes('verify') || h.includes('confirm') || (h.includes('serper') && !h.includes('163'))) {
                return h;
              }
            }
            return null;
          });

          if (verifyLink) {
            console.log('\n=== VERIFICATION LINK FOUND ===');
            console.log(verifyLink);
            
            // Open the verification link
            var vPage = await ctx.newPage();
            await vPage.goto(verifyLink, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await vPage.waitForTimeout(8000);
            await vPage.screenshot({ path: '/tmp/serper-verified.png' });
            
            var vUrl = vPage.url();
            var vText = await vPage.evaluate(function() {
              return document.body.innerText.substring(0, 2000);
            });
            console.log('Verification page URL:', vUrl);
            console.log('Verification page text:', vText);

            // Now try to get the API key
            await vPage.goto('https://serper.dev/dashboard', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(function() {});
            await vPage.waitForTimeout(5000);
            await vPage.screenshot({ path: '/tmp/serper-dashboard.png' });

            var apiKey = await vPage.evaluate(function() {
              var inputs = document.querySelectorAll('input');
              for (var i = 0; i < inputs.length; i++) {
                var v = inputs[i].value;
                if (v && v.length > 15) return v;
              }
              var spans = document.querySelectorAll('code, pre, span');
              for (var j = 0; j < spans.length; j++) {
                var t = spans[j].textContent.trim();
                if (t && t.length > 20 && /^[a-f0-9]+$/i.test(t)) return t;
              }
              return null;
            });

            if (apiKey) {
              console.log('\n=== SUCCESS ===');
              console.log('API Key:', apiKey);
              console.log(JSON.stringify({ success: true, apiKey: apiKey }, null, 2));
            } else {
              console.log('\nAPI key not found on dashboard');
              var dashText = await vPage.evaluate(function() {
                return document.body.innerText.substring(0, 3000);
              });
              console.log('Dashboard text:', dashText);
            }
          }
        }
      }
    }

  } catch (error) {
    await page.screenshot({ path: '/tmp/serper-mail-error.png' }).catch(function() {});
    console.log('Error:', error.message);
    console.log(error.stack);
  }
}

run().catch(console.error);
