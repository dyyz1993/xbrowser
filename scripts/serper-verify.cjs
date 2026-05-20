const { chromium } = require('playwright');

async function run() {
  console.log('Connecting to CDP...');
  var browser = await chromium.connectOverCDP('http://localhost:9221');
  var ctx = browser.contexts()[0];
  var page = await ctx.newPage();

  try {
    // Open 163 mail and get SID
    console.log('Opening 163 mail...');
    await page.goto('https://mail.163.com', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(8000);

    var currentUrl = page.url();
    var sidMatch = currentUrl.match(/sid=([^&]+)/);
    if (!sidMatch) {
      // Try frames
      var frames = page.frames();
      for (var fi = 0; fi < frames.length; fi++) {
        var fUrl = frames[fi].url();
        var m = fUrl.match(/sid=([^&]+)/);
        if (m) { sidMatch = m; break; }
      }
    }
    var sid = sidMatch ? sidMatch[1] : '';
    console.log('SID:', sid);

    if (!sid) throw new Error('No SID found');

    // Search for Serper emails
    console.log('Searching for Serper emails...');
    var searchResult = await page.evaluate(function(args) {
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

    console.log('Search result:', searchResult.substring(0, 2000));

    // Extract email IDs
    var idRegex = /<string>([^<]+)<\/string>/g;
    var emailIds = [];
    var match;
    while ((match = idRegex.exec(searchResult)) !== null) {
      emailIds.push(match[1]);
    }
    console.log('Found email IDs:', emailIds);

    if (emailIds.length === 0) throw new Error('No Serper emails found');

    // Read the first (most recent) email
    var latestId = emailIds[0];
    console.log('Reading email:', latestId);

    var emailContent = await page.evaluate(function(args) {
      return new Promise(function(resolve) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/js6/s?sid=' + args.sid + '&func=read:readMessage', true);
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        xhr.onload = function() { resolve(xhr.responseText); };
        xhr.onerror = function() { resolve('error'); };
        xhr.timeout = 15000;
        xhr.ontimeout = function() { resolve('timeout'); };
        xhr.send('var=<?xml version="1.0"?><object><string name="id">' + args.id + '</string><string name="folderId">1</string><boolean name="returnHtml">true</boolean></object>');
      });
    }, { sid: sid, id: latestId });

    // Save full email content for debugging
    require('fs').writeFileSync('/tmp/serper-email-raw.txt', emailContent);
    console.log('Email content saved to /tmp/serper-email-raw.txt');
    console.log('Email content length:', emailContent.length);
    console.log('Email content (first 3000):', emailContent.substring(0, 3000));

    // Extract verification link from the email
    // Try multiple patterns
    var verifyUrl = null;
    var patterns = [
      /href="(https?:\/\/serper[^"]*(?:verify|confirm)[^"]*)"/i,
      /href="(https?:\/\/[^"]*serper[^"]*(?:verify|confirm)[^"]*)"/i,
      /href="(https?:\/\/[^"]*(?:verify|confirm)[^"]*serper[^"]*)"/i,
      /href="(https?:\/\/[^"]*(?:verify|confirm)[^"]*)"/i,
      /(https?:\/\/serper\.dev\/[^\s"<>]+)/,
      /(https?:\/\/[^\s"<>]*serper[^\s"<>]*(?:verify|confirm)[^\s"<>]*)/i,
    ];

    for (var pi = 0; pi < patterns.length; pi++) {
      var m = emailContent.match(patterns[pi]);
      if (m) {
        verifyUrl = m[1].replace(/&amp;/g, '&');
        console.log('Found verify URL via pattern', pi, ':', verifyUrl);
        break;
      }
    }

    if (!verifyUrl) {
      console.log('No verification link found. All links in email:');
      var allLinks = emailContent.match(/href="([^"]+)"/g);
      if (allLinks) {
        allLinks.forEach(function(l) { console.log(' ', l); });
      }
    } else {
      console.log('\n=== OPENING VERIFICATION LINK ===');
      console.log(verifyUrl);

      var vPage = await ctx.newPage();
      await vPage.goto(verifyUrl, { waitUntil: 'load', timeout: 60000 });
      await vPage.waitForTimeout(8000);
      await vPage.screenshot({ path: '/tmp/serper-verified.png' });

      var vUrl = vPage.url();
      var vText = await vPage.evaluate(function() {
        return document.body.innerText.substring(0, 2000);
      });
      console.log('Verification page URL:', vUrl);
      console.log('Verification page text:', vText.substring(0, 500));

      // Try to get API key from dashboard
      console.log('\n=== LOOKING FOR API KEY ===');
      await vPage.goto('https://serper.dev/dashboard', { waitUntil: 'load', timeout: 60000 }).catch(function() {});
      await vPage.waitForTimeout(5000);
      await vPage.screenshot({ path: '/tmp/serper-dashboard.png' });

      var dashText = await vPage.evaluate(function() {
        return document.body.innerText.substring(0, 3000);
      });
      console.log('Dashboard URL:', vPage.url());
      console.log('Dashboard text:', dashText.substring(0, 1000));

      // Look for API key
      var apiKey = await vPage.evaluate(function() {
        // Check inputs
        var inputs = document.querySelectorAll('input');
        for (var i = 0; i < inputs.length; i++) {
          var v = inputs[i].value;
          if (v && v.length > 15) return { source: 'input', key: v };
        }
        // Check spans/code
        var spans = document.querySelectorAll('code, pre, span');
        for (var j = 0; j < spans.length; j++) {
          var t = spans[j].textContent.trim();
          if (t && t.length > 20 && /^[a-f0-9]+$/i.test(t)) return { source: 'span', key: t };
        }
        return null;
      });

      if (apiKey) {
        console.log('\n========================================');
        console.log('SUCCESS!');
        console.log('API Key:', apiKey.key);
        console.log('========================================');
        console.log(JSON.stringify({ success: true, apiKey: apiKey.key }, null, 2));
      } else {
        console.log('API key not directly visible. The verification may have succeeded.');
        console.log('Check /tmp/serper-dashboard.png');
      }
    }

  } catch (error) {
    await page.screenshot({ path: '/tmp/serper-final-error.png' }).catch(function() {});
    console.log('Error:', error.message);
  }
}

run().catch(console.error);
