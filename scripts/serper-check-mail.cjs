const { chromium } = require('playwright');

async function run() {
  console.log('Connecting to CDP...');
  const browser = await chromium.connectOverCDP('http://localhost:9221');
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();

  try {
    // Go to 163 inbox directly
    console.log('Opening 163 inbox...');
    await page.goto('https://mail.163.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: '/tmp/serper-mail-01.png' });

    // Click on inbox (收件箱)
    var inboxClicked = await page.evaluate(function() {
      var links = Array.from(document.querySelectorAll('a, span, div, li'));
      var inbox = links.find(function(el) {
        var t = el.textContent?.trim();
        return t === '收件箱' || t === 'Inbox' || t === '收信';
      });
      if (inbox) {
        inbox.click();
        return 'clicked: ' + inbox.textContent?.trim();
      }
      return null;
    });
    console.log('Inbox:', inboxClicked);
    await page.waitForTimeout(5000);
    await page.screenshot({ path: '/tmp/serper-mail-02-inbox.png' });

    // Get inbox content
    var inboxContent = await page.evaluate(function() {
      return document.body.innerText.substring(0, 5000);
    });
    console.log('Inbox text (first 2000):', inboxContent.substring(0, 2000));

    // Try looking for iframe-based inbox (163 mail often uses iframes)
    var frames = page.frames();
    console.log('Number of frames:', frames.length);
    for (var i = 0; i < frames.length; i++) {
      console.log('Frame', i, ':', frames[i].url());
    }

    // Check for Serper in all frames
    for (var fi = 0; fi < frames.length; fi++) {
      try {
        var frameText = await frames[fi].evaluate(function() {
          return document.body ? document.body.innerText.substring(0, 2000) : 'no body';
        });
        if (frameText.toLowerCase().includes('serper')) {
          console.log('Found Serper in frame', fi, ':', frameText.substring(0, 500));
          
          // Try to click on Serper email in this frame
          var clicked = await frames[fi].evaluate(function() {
            var els = Array.from(document.querySelectorAll('td, tr, a, span, div'));
            for (var i = 0; i < els.length; i++) {
              if (els[i].textContent && els[i].textContent.toLowerCase().includes('serper')) {
                els[i].click();
                return 'clicked: ' + els[i].textContent.trim().substring(0, 100);
              }
            }
            return null;
          });
          console.log('Clicked in frame:', clicked);
        }
      } catch(e) {
        console.log('Frame', fi, 'error:', e.message);
      }
    }

    // Try direct inbox URL
    console.log('\nTrying direct inbox URL...');
    await page.goto('https://mail.163.com/???' , { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(function() {});
    
    // The 163 mail might use a different approach - let's try using the old interface
    await page.goto('https://mail.163.com/js6/main.jsp', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(function() {});
    await page.waitForTimeout(5000);
    await page.screenshot({ path: '/tmp/serper-mail-03-classic.png' });

    // Get all frame contents
    frames = page.frames();
    console.log('Frames after classic URL:', frames.length);
    for (var fi2 = 0; fi2 < frames.length; fi2++) {
      try {
        var ft = await frames[fi2].evaluate(function() {
          return document.body ? document.body.innerText.substring(0, 1000) : '';
        });
        console.log('Frame', fi2, 'url:', frames[fi2].url(), 'text:', ft.substring(0, 200));
      } catch(e) {}
    }

    // Try using the 163 mail API or new interface to search for Serper
    console.log('\nTrying mail search...');
    await page.goto('https://mail.163.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Try to use the search box to find serper
    var searchResult = await page.evaluate(function() {
      var searchInput = document.querySelector('input[type="search"], input[placeholder*="搜索"], input[placeholder*="Search"]');
      if (searchInput) {
        var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(searchInput, 'serper');
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        return 'filled search';
      }
      return 'no search input found';
    });
    console.log('Search:', searchResult);
    
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/serper-mail-04-search.png' });

    // Press Enter to search
    await page.keyboard.press('Enter');
    await page.waitForTimeout(5000);
    await page.screenshot({ path: '/tmp/serper-mail-05-search-result.png' });

    var searchPageText = await page.evaluate(function() {
      return document.body.innerText.substring(0, 3000);
    });
    console.log('Search result text:', searchPageText.substring(0, 1000));

    // Check frames again after search
    frames = page.frames();
    for (var fi3 = 0; fi3 < frames.length; fi3++) {
      try {
        var ft2 = await frames[fi3].evaluate(function() {
          var text = document.body ? document.body.innerText : '';
          if (text.toLowerCase().includes('serper')) return text.substring(0, 1000);
          return null;
        });
        if (ft2) {
          console.log('Serper found in frame', fi3, ':', ft2);
        }
      } catch(e) {}
    }

    console.log('\nDone. Check /tmp/serper-mail-*.png for details.');

  } catch (error) {
    await page.screenshot({ path: '/tmp/serper-mail-error.png' }).catch(function() {});
    console.log('Error:', error.message);
  }
}

run().catch(console.error);
