const { chromium } = require('playwright');

async function safeClick(page, sel) {
  var handle = await page.evaluateHandle(function(s) {
    return document.querySelector(s);
  }, { s: sel });
  var el = handle.asElement();
  if (!el) return false;
  var box = await el.boundingBox();
  if (!box) return false;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return true;
}

async function run() {
  console.log('Connecting to CDP...');
  var browser = await chromium.connectOverCDP('http://localhost:9221');
  var ctx = browser.contexts()[0];
  var page = await ctx.newPage();

  try {
    // Step 1: Open 163 mail fresh
    console.log('Opening 163 mail...');
    await page.goto('https://mail.163.com', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(8000);
    await page.screenshot({ path: '/tmp/serper-m1.png' });

    // Step 2: Click on 收件箱 to go to inbox
    console.log('Clicking inbox...');
    var clickedInbox = await page.evaluate(function() {
      // Find all elements containing "收件箱"
      var els = Array.from(document.querySelectorAll('*'));
      var inboxEls = els.filter(function(el) {
        return el.textContent && el.textContent.trim().match(/^收件箱(\(\d+\))?$/) && el.children.length <= 3;
      });
      console.log('Found inbox elements:', inboxEls.length);
      
      // Click the most specific one (fewest children)
      if (inboxEls.length > 0) {
        var target = inboxEls[0];
        // Try to find anchor parent
        var a = target.closest('a');
        if (a) { a.click(); return 'clicked anchor: ' + a.textContent.trim(); }
        target.click();
        return 'clicked: ' + target.textContent.trim();
      }
      return 'not found';
    });
    console.log('Inbox click:', clickedInbox);
    await page.waitForTimeout(5000);
    await page.screenshot({ path: '/tmp/serper-m2-inbox.png' });

    // Step 3: Get SID from current URL
    var currentUrl = page.url();
    console.log('Current URL:', currentUrl);
    var sidMatch = currentUrl.match(/sid=([^&]+)/);
    var sid = sidMatch ? sidMatch[1] : '';
    console.log('SID:', sid);

    if (!sid) {
      // Try getting SID from main frame
      var mainUrl = page.mainFrame().url();
      console.log('Main frame URL:', mainUrl);
      sidMatch = mainUrl.match(/sid=([^&]+)/);
      sid = sidMatch ? sidMatch[1] : '';
      console.log('SID from frame:', sid);
    }

    // Step 4: Use API to list recent emails
    if (sid) {
      console.log('\nFetching recent emails via API...');
      var emailsResult = await page.evaluate(function(args) {
        return new Promise(function(resolve) {
          var xhr = new XMLHttpRequest();
          xhr.open('POST', '/js6/s?sid=' + args.sid + '&func=mbox:listMessages', true);
          xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
          xhr.onload = function() {
            resolve(xhr.responseText);
          };
          xhr.onerror = function() { resolve('XHR error'); };
          xhr.timeout = 15000;
          xhr.ontimeout = function() { resolve('timeout'); };
          xhr.send('var=<?xml version="1.0"?><object><array name="ids"><object><string name="id">1</string></object></array><object name="filter"><int name="start">0</int><int name="limit">30</int><string name="order">date</string><boolean name="desc">true</boolean></object></object>');
        });
      }, { sid: sid });
      
      // Check if we got XML response
      console.log('API response (first 2000):', emailsResult.substring(0, 2000));
      
      // Check if serper is in the response
      if (emailsResult.toLowerCase().includes('serper')) {
        console.log('\n=== FOUND SERPER IN EMAIL LIST ===');
      } else {
        console.log('Serper not found in first 30 emails');
      }

      // Alternative: Use the simpler API
      var emails2 = await page.evaluate(function(args) {
        return new Promise(function(resolve) {
          var xhr = new XMLHttpRequest();
          xhr.open('POST', '/js6/s?sid=' + args.sid + '&func=mbox:searchMessages', true);
          xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
          xhr.onload = function() { resolve(xhr.responseText); };
          xhr.onerror = function() { resolve('error'); };
          xhr.timeout = 15000;
          xhr.ontimeout = function() { resolve('timeout'); };
          xhr.send('var=<?xml version="1.0"?><object><string name="query">serper</string><int name="start">0</int><int name="limit">10</int></object>');
        });
      }, { sid: sid });
      console.log('\nSearch "serper" result (first 2000):', emails2.substring(0, 2000));

      // Also try to just list all emails using a different API approach
      var emails3 = await page.evaluate(function(args) {
        return new Promise(function(resolve) {
          var xhr = new XMLHttpRequest();
          xhr.open('POST', '/js6/s?sid=' + args.sid + '&func=mbox:listFolderMessages&hasQuota=true&hasFwd=true&hasAttach=true', true);
          xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
          xhr.onload = function() { resolve(xhr.responseText); };
          xhr.onerror = function() { resolve('error'); };
          xhr.timeout = 15000;
          xhr.ontimeout = function() { resolve('timeout'); };
          xhr.send('var=<?xml version="1.0"?><object><string name="folderId">1</string><int name="start">0</int><int name="limit">20</int><string name="order">date</string><boolean name="desc">true</boolean></object>');
        });
      }, { sid: sid });
      console.log('\nFolder messages (first 3000):', emails3.substring(0, 3000));

      // Parse subjects from the XML response to find serper
      var subjectList = emails3.match(/<string name="subject">[^<]+<\/string>/g);
      if (subjectList) {
        console.log('\nRecent email subjects:');
        subjectList.forEach(function(s) {
          console.log(' -', s.replace(/<[^>]+>/g, ''));
        });
      }

      // Check for serper in all API results
      if (emails3.toLowerCase().includes('serper') || emails2.toLowerCase().includes('serper')) {
        console.log('\n=== FOUND SERPER EMAIL ===');
        
        // Find the email ID
        var idMatch = (emails2.includes('serper') ? emails2 : emails3).match(/id[^>]*>(\d+)[^<]*<[\s\S]*?serper/i);
        if (idMatch) {
          console.log('Email ID:', idMatch[1]);
          
          // Read the email
          var emailContent = await page.evaluate(function(args) {
            return new Promise(function(resolve) {
              var xhr = new XMLHttpRequest();
              xhr.open('POST', '/js6/s?sid=' + args.sid + '&func=read:readMessage', true);
              xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
              xhr.onload = function() { resolve(xhr.responseText); };
              xhr.onerror = function() { resolve('error'); };
              xhr.send('var=<?xml version="1.0"?><object><string name="id">' + args.id + '</string><string name="folderId">1</string><boolean name="returnCidInfo">true</boolean><boolean name="returnHtml">true</boolean></object>');
            });
          }, { sid: sid, id: idMatch[1] });
          
          console.log('Email content (first 5000):', emailContent.substring(0, 5000));
          
          // Extract verification link
          var linkMatch = emailContent.match(/href="(https?:\/\/[^"]*serper[^"]*(?:verify|confirm)[^"]*)"/i);
          if (!linkMatch) {
            linkMatch = emailContent.match(/href="(https?:\/\/[^"]*serper[^"]*)"/i);
          }
          if (!linkMatch) {
            // Look for any link with verify
            linkMatch = emailContent.match(/href="(https?:\/\/[^"]*(?:verify|confirm)[^"]*)"/i);
          }
          
          if (linkMatch) {
            var verifyUrl = linkMatch[1].replace(/&amp;/g, '&');
            console.log('\nVerification URL:', verifyUrl);
            
            var vPage = await ctx.newPage();
            await vPage.goto(verifyUrl, { waitUntil: 'load', timeout: 60000 });
            await vPage.waitForTimeout(8000);
            await vPage.screenshot({ path: '/tmp/serper-verified.png' });
            console.log('Verified! URL:', vPage.url());
            
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
              console.log('\nAPI key not found on dashboard. Dashboard text:');
              console.log(await vPage.evaluate(function() { return document.body.innerText.substring(0, 2000); }));
            }
          } else {
            console.log('No verification link found in email HTML');
            // Try to find links in the raw content
            var allLinks = emailContent.match(/href="([^"]+)"/g);
            console.log('All links found:', allLinks ? allLinks.slice(0, 10) : 'none');
          }
        }
      }
    } else {
      console.log('Could not get SID. Trying to navigate inbox via UI...');
      
      // Fallback: click around in the UI
      await page.screenshot({ path: '/tmp/serper-m3-no-sid.png' });
    }

  } catch (error) {
    await page.screenshot({ path: '/tmp/serper-mail-error.png' }).catch(function() {});
    console.log('Error:', error.message);
  }
}

run().catch(console.error);
