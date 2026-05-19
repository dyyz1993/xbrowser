const { chromium } = require('playwright');
const fs = require('fs');

async function run() {
  console.log('Connecting to CDP...');
  var browser = await chromium.connectOverCDP('http://localhost:9221');
  var ctx = browser.contexts()[0];
  var page = await ctx.newPage();

  try {
    console.log('Opening 163 mail...');
    await page.goto('https://mail.163.com', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(8000);

    var sidMatch = page.url().match(/sid=([^&]+)/);
    if (!sidMatch) {
      var frames = page.frames();
      for (var fi = 0; fi < frames.length; fi++) {
        var m = frames[fi].url().match(/sid=([^&]+)/);
        if (m) { sidMatch = m; break; }
      }
    }
    var sid = sidMatch ? sidMatch[1] : '';
    console.log('SID:', sid);

    // Search for serper
    var searchResult = await page.evaluate(function(args) {
      return new Promise(function(resolve) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/js6/s?sid=' + args.sid + '&func=mbox:searchMessages', true);
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        xhr.onload = function() { resolve(xhr.responseText); };
        xhr.onerror = function() { resolve('error'); };
        xhr.send('var=<?xml version="1.0"?><object><string name="query">serper</string><int name="start">0</int><int name="limit">10</int></object>');
      });
    }, { sid: sid });

    var idRegex = /<string>([^<]+)<\/string>/g;
    var emailIds = [];
    var match;
    while ((match = idRegex.exec(searchResult)) !== null) {
      emailIds.push(match[1]);
    }
    console.log('Email IDs:', emailIds.length);

    // Try reading the first email with different API module names
    var latestId = emailIds[0];
    console.log('Reading:', latestId);

    // Try different module names for reading
    var moduleNames = [
      'mbox:readMail',
      'message:read',
      'mail:message',
      'mbox:getMessage',
      'msg:read',
      'read:mail',
    ];

    for (var mi = 0; mi < moduleNames.length; mi++) {
      var result = await page.evaluate(function(args) {
        return new Promise(function(resolve) {
          var xhr = new XMLHttpRequest();
          xhr.open('POST', '/js6/s?sid=' + args.sid + '&func=' + args.module, true);
          xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
          xhr.onload = function() { resolve({ module: args.module, text: xhr.responseText }); };
          xhr.onerror = function() { resolve({ module: args.module, text: 'error' }); };
          xhr.timeout = 10000;
          xhr.ontimeout = function() { resolve({ module: args.module, text: 'timeout' }); };
          xhr.send('var=<?xml version="1.0"?><object><string name="id">' + args.id + '</string><string name="folderId">1</string><boolean name="returnHtml">true</boolean></object>');
        });
      }, { sid: sid, id: latestId, module: moduleNames[mi] });
      
      var isOk = result.text.includes('S_OK');
      console.log(result.module + ':', isOk ? 'SUCCESS' : result.text.substring(0, 200));
      
      if (isOk) {
        fs.writeFileSync('/tmp/serper-email-' + moduleNames[mi] + '.txt', result.text);
        console.log('Saved to /tmp/serper-email-' + moduleNames[mi] + '.txt');
        console.log('Content:', result.text.substring(0, 3000));
        break;
      }
    }

    // Alternative approach: Navigate to the email via the UI
    console.log('\n=== Trying UI approach ===');
    
    // Navigate to inbox list
    await page.evaluate(function() {
      window.location.hash = '#module=mailbox.ListModule|{"filter":{"folder":"1"}}';
    });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: '/tmp/serper-ui-inbox.png' });

    // Search for serper using the UI search
    // The 163 new interface has a search bar
    var searchBoxFound = await page.evaluate(function() {
      // Look for search input
      var inputs = document.querySelectorAll('input');
      for (var i = 0; i < inputs.length; i++) {
        if (inputs[i].placeholder && (inputs[i].placeholder.includes('搜索') || inputs[i].placeholder.includes('Search'))) {
          return { found: true, placeholder: inputs[i].placeholder, id: inputs[i].id, name: inputs[i].name };
        }
      }
      // Also check for textarea or contenteditable
      var textareas = document.querySelectorAll('textarea');
      for (var j = 0; j < textareas.length; j++) {
        if (textareas[j].placeholder && textareas[j].placeholder.includes('搜索')) {
          return { found: true, tag: 'textarea', placeholder: textareas[j].placeholder };
        }
      }
      return { found: false };
    });
    console.log('Search box:', JSON.stringify(searchBoxFound));

    // Try using the AI search - 163 has AI assistant that can find emails
    // Look for the search area
    var aiSearchResult = await page.evaluate(function() {
      var textareas = document.querySelectorAll('textarea');
      for (var i = 0; i < textareas.length; i++) {
        if (textareas[i].placeholder && textareas[i].placeholder.includes('描述您想找的邮件')) {
          return { found: true, index: i, placeholder: textareas[i].placeholder };
        }
      }
      return { found: false };
    });
    console.log('AI search area:', JSON.stringify(aiSearchResult));

    // Use a simpler approach: navigate directly to read the email
    // The email ID format is "fid:id", we can use the hash URL
    var readHash = '#module=read.ReadModule|{"id":"' + latestId + '","folder":"1"}';
    console.log('Navigating to:', readHash);
    
    await page.evaluate(function(h) {
      window.location.hash = h;
    }, readHash);
    await page.waitForTimeout(8000);
    await page.screenshot({ path: '/tmp/serper-ui-email.png' });

    var emailPageText = await page.evaluate(function() {
      return document.body.innerText.substring(0, 5000);
    });
    console.log('Email page text:', emailPageText.substring(0, 3000));
    
    // Check frames for the email content
    var frames2 = page.frames();
    for (var fi2 = 0; fi2 < frames2.length; fi2++) {
      try {
        var fText = await frames2[fi2].evaluate(function() {
          return document.body ? document.body.innerText.substring(0, 3000) : '';
        });
        if (fText.toLowerCase().includes('serper') || fText.toLowerCase().includes('verify') || fText.toLowerCase().includes('confirm')) {
          console.log('Frame', fi2, 'has relevant content:', fText.substring(0, 1500));
          
          // Extract links from this frame
          var links = await frames2[fi2].evaluate(function() {
            var anchors = document.querySelectorAll('a');
            var result = [];
            for (var i = 0; i < anchors.length; i++) {
              result.push({ href: anchors[i].href, text: anchors[i].textContent.trim().substring(0, 100) });
            }
            return result;
          });
          console.log('Links in frame:', JSON.stringify(links, null, 2));
          
          // Find verification link
          var verifyLink = null;
          for (var li = 0; li < links.length; li++) {
            var h = links[li].href;
            if (h.includes('verify') || h.includes('confirm') || (h.includes('serper') && !h.includes('163'))) {
              verifyLink = h;
              break;
            }
          }
          
          if (verifyLink) {
            console.log('\n=== VERIFICATION LINK ===');
            console.log(verifyLink);
            
            var vPage = await ctx.newPage();
            await vPage.goto(verifyLink, { waitUntil: 'load', timeout: 60000 });
            await vPage.waitForTimeout(8000);
            await vPage.screenshot({ path: '/tmp/serper-verified.png' });
            console.log('Verified! URL:', vPage.url());
            
            var vText = await vPage.evaluate(function() { return document.body.innerText.substring(0, 2000); });
            console.log('Page text:', vText.substring(0, 500));

            // Get API key
            await vPage.goto('https://serper.dev/dashboard', { waitUntil: 'load', timeout: 60000 }).catch(function(){});
            await vPage.waitForTimeout(5000);
            await vPage.screenshot({ path: '/tmp/serper-dashboard.png' });

            var apiKey = await vPage.evaluate(function() {
              var inputs = document.querySelectorAll('input');
              for (var i = 0; i < inputs.length; i++) {
                var v = inputs[i].value;
                if (v && v.length > 15) return v;
              }
              return null;
            });

            if (apiKey) {
              console.log('\n========================================');
              console.log('SUCCESS! API Key:', apiKey);
              console.log('========================================');
            } else {
              var dashText = await vPage.evaluate(function() { return document.body.innerText.substring(0, 3000); });
              console.log('Dashboard text:', dashText.substring(0, 1000));
            }
            return;
          }
        }
      } catch(e) {
        // ignore frame errors
      }
    }

    // If we get here, we couldn't find the verification link via UI
    // Let's try reading the email HTML directly via the API
    console.log('\n=== Trying API with correct module ===');
    
    // The correct API for 163 might be different - try listing the message detail
    var detailResult = await page.evaluate(function(args) {
      return new Promise(function(resolve) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/js6/s?sid=' + args.sid + '&func=mbox:getMessage', true);
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        xhr.onload = function() { resolve(xhr.responseText); };
        xhr.onerror = function() { resolve('error'); };
        xhr.timeout = 10000;
        xhr.ontimeout = function() { resolve('timeout'); };
        xhr.send('var=<?xml version="1.0"?><object><string name="id">' + args.id + '</string><int name="fid">1</int><boolean name="returnHtml">true</boolean></object>');
      });
    }, { sid: sid, id: latestId });
    
    console.log('getMessage result:', detailResult.substring(0, 2000));
    fs.writeFileSync('/tmp/serper-email-detail.txt', detailResult);

    // Extract any URL from the result
    var urlMatches = detailResult.match(/https?:\/\/[^\s"<>]+/g);
    if (urlMatches) {
      console.log('URLs found in email:');
      urlMatches.forEach(function(u) { console.log(' ', u); });
    }

  } catch (error) {
    await page.screenshot({ path: '/tmp/serper-error-final.png' }).catch(function() {});
    console.log('Error:', error.message);
  }
}

run().catch(console.error);
