const { chromium } = require('playwright');

const STEPS = [];

async function run() {
  console.log('Connecting to CDP tunnel...');
  const browser = await chromium.connectOverCDP('http://localhost:9221');
  const ctx = browser.contexts()[0];
  if (!ctx) throw new Error('No browser context found');

  const page = await ctx.newPage();
  STEPS.push('Created new page');

  try {
    console.log('Navigating to serper.dev signup...');
    await page.goto('https://serper.dev/signup', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: '/tmp/serper-01-signup.png' });
    STEPS.push('Navigated to signup');
    console.log('URL:', page.url());

    // Fill form
    console.log('Filling form...');
    
    async function reactFill(sel, val) {
      return page.evaluate(function(args) {
        var el = document.querySelector(args.sel);
        if (!el) return false;
        var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, args.val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }, { sel: sel, val: val });
    }

    console.log('firstName:', await reactFill('input[name="firstName"]', 'Yingzhou'));
    console.log('lastName:', await reactFill('input[name="lastName"]', 'Xu'));
    console.log('email:', await reactFill('input[name="email"]', 'dyyz1993@163.com'));
    console.log('password:', await reactFill('input[name="password"]', 'Xyz@Serper2026!'));
    STEPS.push('Form filled');
    await page.screenshot({ path: '/tmp/serper-02-filled.png' });

    // Wait for Turnstile
    console.log('Waiting for Turnstile...');
    var turnstileDone = false;
    for (var i = 0; i < 30; i++) {
      await page.waitForTimeout(1000);
      var cfVal = await page.evaluate(function() {
        var inp = document.querySelector('input[name="cf-turnstile-response"]');
        return inp ? inp.value : '';
      });
      if (cfVal && cfVal.length > 10) {
        console.log('Turnstile completed!');
        turnstileDone = true;
        break;
      }
      if (i % 5 === 0) console.log('Waiting turnstile...', i);
    }
    STEPS.push('Turnstile: ' + (turnstileDone ? 'done' : 'timeout'));
    await page.screenshot({ path: '/tmp/serper-03-turnstile.png' });

    // Click submit
    console.log('Clicking submit...');
    await page.evaluate(function() {
      var btn = document.querySelector('button[type="submit"]');
      if (btn) btn.click();
    });
    STEPS.push('Clicked submit');
    
    await page.waitForTimeout(10000);
    await page.screenshot({ path: '/tmp/serper-04-after-submit.png' });
    console.log('URL after submit:', page.url());

    var pageText = await page.evaluate(function() {
      return document.body.innerText.substring(0, 2000);
    });
    console.log('Page text:', pageText.substring(0, 500));

    // Check for email verification
    var needsVerify = /verif|check your email|confirm/i.test(pageText);
    
    if (needsVerify) {
      STEPS.push('Email verification required');
      console.log('\nOpening 163 mail for verification...');

      var mailPage = await ctx.newPage();
      await mailPage.goto('https://mail.163.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await mailPage.waitForTimeout(8000);
      await mailPage.screenshot({ path: '/tmp/serper-05-mail.png' });
      STEPS.push('Opened 163 mail');

      // Wait for email to arrive
      console.log('Waiting for email to arrive...');
      for (var attempt = 0; attempt < 6; attempt++) {
        await mailPage.waitForTimeout(5000);
        await mailPage.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await mailPage.waitForTimeout(3000);
        
        var foundEmail = await mailPage.evaluate(function() {
          var all = document.body.innerText.toLowerCase();
          return all.includes('serper');
        });
        console.log('Email found:', foundEmail, 'attempt:', attempt);
        if (foundEmail) break;
      }
      
      await mailPage.screenshot({ path: '/tmp/serper-06-mail-content.png' });

      // Click on Serper email
      var clickedEmail = await mailPage.evaluate(function() {
        var els = Array.from(document.querySelectorAll('*'));
        for (var i = 0; i < els.length; i++) {
          if (els[i].textContent && els[i].textContent.toLowerCase().includes('serper') && els[i].children.length < 3) {
            var target = els[i];
            while (target.parentElement && target.tagName !== 'A' && !target.getAttribute('onclick')) {
              target = target.parentElement;
            }
            target.click();
            return true;
          }
        }
        return false;
      });

      if (clickedEmail) {
        await mailPage.waitForTimeout(5000);
        await mailPage.screenshot({ path: '/tmp/serper-07-email-detail.png' });

        var verifyLink = await mailPage.evaluate(function() {
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
          console.log('Verify link:', verifyLink);
          STEPS.push('Verify link found');
          var vPage = await ctx.newPage();
          await vPage.goto(verifyLink, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await vPage.waitForTimeout(5000);
          await vPage.screenshot({ path: '/tmp/serper-08-verified.png' });
          STEPS.push('Verification completed');
        } else {
          STEPS.push('No verify link in email');
        }
      } else {
        STEPS.push('Could not find Serper email');
      }
    }

    // Look for API key
    console.log('\nLooking for API key...');
    await page.goto('https://serper.dev/dashboard', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(function() {});
    await page.waitForTimeout(5000);
    await page.screenshot({ path: '/tmp/serper-09-dashboard.png' });

    var apiKey = await page.evaluate(function() {
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

    STEPS.push(apiKey ? 'API key: ' + apiKey.substring(0, 10) + '...' : 'No API key found');

    var result = {
      success: !!apiKey,
      apiKey: apiKey || undefined,
      error: apiKey ? undefined : 'API key not found. Check /tmp/serper-*.png screenshots.',
      steps: STEPS,
      finalUrl: page.url(),
    };

    console.log('\n=== RESULT ===');
    console.log(JSON.stringify(result, null, 2));

  } catch (error) {
    await page.screenshot({ path: '/tmp/serper-error.png' }).catch(function() {});
    console.log('\n=== ERROR ===');
    console.log(JSON.stringify({ success: false, error: error.message, steps: STEPS }, null, 2));
  }
}

run().catch(console.error);
