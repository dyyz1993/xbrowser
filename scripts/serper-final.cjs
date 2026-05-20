const { chromium } = require('playwright');
const fs = require('fs');

async function run() {
  var browser = await chromium.connectOverCDP('http://localhost:9221', { timeout: 60000 });
  var ctx = browser.contexts()[0];
  var page = await ctx.newPage();
  console.log('Connected');

  try {
    // Step 1: Open 163 mail
    await page.goto('https://mail.163.com', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(8000);
    var sid = (page.url().match(/sid=([^&]+)/) || [])[1] || '';
    console.log('SID:', sid);

    // Step 2: Search for serper emails
    var search = await page.evaluate(function(args) {
      return new Promise(function(resolve) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/js6/s?sid=' + args.sid + '&func=mbox:searchMessages', true);
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        xhr.onload = function() { resolve(xhr.responseText); };
        xhr.onerror = function() { resolve('error'); };
        xhr.send('var=<?xml version="1.0"?><object><string name="query">serper</string><int name="start">0</int><int name="limit">5</int></object>');
      });
    }, { sid: sid });

    var ids = [];
    var m;
    var re = /<string>([^<]+)<\/string>/g;
    while ((m = re.exec(search)) !== null) ids.push(m[1]);
    console.log('Email IDs:', ids.length);
    if (ids.length === 0) { console.log('No serper emails found'); return; }

    // Step 3: Read email via UI navigation
    var emailId = ids[0];
    console.log('Reading email:', emailId);
    
    // Navigate to the read module
    var readUrl = 'https://mail.163.com/js6/main.jsp?sid=' + sid + '&df=mail163_letter#module=read.ReadModule%7C%7B%22id%22%3A%22' + encodeURIComponent(emailId) + '%22%2C%22folder%22%3A%221%22%7D';
    console.log('Navigating to read URL...');
    
    // Use hash change instead of full navigation
    await page.evaluate(function(args) {
      window.location.hash = '#module=read.ReadModule|{"id":"' + args.id + '","folder":"1"}';
    }, { id: emailId });
    await page.waitForTimeout(8000);
    await page.screenshot({ path: '/tmp/serper-email-ui.png' });

    // Check main frame and child frames for email content
    var frames = page.frames();
    console.log('Frames:', frames.length);
    
    var allLinks = [];
    var emailHtml = '';

    for (var fi = 0; fi < frames.length; fi++) {
      try {
        var fText = await frames[fi].evaluate(function() {
          return document.body ? document.body.innerText.substring(0, 2000) : '';
        });
        if (fText.toLowerCase().includes('serper') || fText.toLowerCase().includes('verify')) {
          console.log('Found content in frame', fi, ':', fText.substring(0, 500));
          
          // Get all links from this frame
          var links = await frames[fi].evaluate(function() {
            var as = document.querySelectorAll('a');
            var result = [];
            for (var i = 0; i < as.length; i++) {
              result.push({ href: as[i].href, text: as[i].textContent.trim().substring(0, 100) });
            }
            return result;
          });
          allLinks = allLinks.concat(links);
        }
      } catch(e) {}
    }

    // Also try getting the email HTML from the content frame
    // 163 mail usually loads email body in an iframe
    for (var fi2 = 0; fi2 < frames.length; fi2++) {
      try {
        var fUrl = frames[fi2].url();
        if (fUrl.includes('read') || fUrl.includes('content') || fUrl.includes('body')) {
          console.log('Content frame', fi2, ':', fUrl.substring(0, 100));
          var cText = await frames[fi2].evaluate(function() {
            return document.body ? document.body.innerHTML.substring(0, 5000) : '';
          });
          emailHtml += cText;
        }
      } catch(e) {}
    }

    console.log('\nAll links found:', JSON.stringify(allLinks, null, 2));

    // Find verification link
    var verifyLink = null;
    for (var i = 0; i < allLinks.length; i++) {
      var h = allLinks[i].href;
      if (h.includes('verify') || h.includes('confirm') || (h.includes('serper') && !h.includes('163'))) {
        verifyLink = h;
        break;
      }
    }

    // Also check email HTML for links
    if (!verifyLink && emailHtml) {
      var htmlLinkMatch = emailHtml.match(/href="(https?:\/\/[^"]*(?:verify|confirm)[^"]*)"/i);
      if (htmlLinkMatch) verifyLink = htmlLinkMatch[1];
    }

    // Also try to extract from raw HTML of all frames
    if (!verifyLink) {
      for (var fi3 = 0; fi3 < frames.length; fi3++) {
        try {
          var rawHtml = await frames[fi3].evaluate(function() {
            return document.body ? document.body.innerHTML : '';
          });
          if (rawHtml.includes('serper')) {
            fs.writeFileSync('/tmp/serper-frame-' + fi3 + '.html', rawHtml);
            var linkM = rawHtml.match(/href="(https?:\/\/[^"]+)"/g);
            if (linkM) {
              for (var li = 0; li < linkM.length; li++) {
                var url = linkM[li].replace('href="', '').replace('"', '').replace(/&amp;/g, '&');
                if (url.includes('verify') || url.includes('confirm') || (url.includes('serper') && !url.includes('163'))) {
                  verifyLink = url;
                  break;
                }
              }
            }
            if (verifyLink) break;
          }
        } catch(e) {}
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
      console.log('Text:', vText.substring(0, 500));

      // Navigate to dashboard for API key
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
    } else {
      console.log('\nNo verification link found in email');
      console.log('Check /tmp/serper-email-ui.png and /tmp/serper-frame-*.html');
    }

  } catch (error) {
    await page.screenshot({ path: '/tmp/serper-error.png' }).catch(function() {});
    console.log('Error:', error.message);
  }
}

run().catch(console.error);
