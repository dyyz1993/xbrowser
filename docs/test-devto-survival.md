# I Spent 3 Hours Debugging a CSS Selector. Then I Found a Better Way.

Last Tuesday I needed to scrape product prices from an e-commerce site. "Simple," I thought. Just query the price element and done.

Three hours later I was still staring at my screen, cursing whoever decided to use dynamically-generated class names.

## What went wrong

The page used something like this:

```html
<span class="price sc-dkzDqf jhKMRz eBvMAx">¥199</span>
```

Those classes? They change every deploy. My `querySelector('.price')` worked for about 2 days, then the frontend team pushed an update and everything broke. No warning, no deprecation, just... gone.

I tried being smarter. Used `[class*="price"]` — worked until they added a "price-match" badge that had nothing to do with actual prices. Then I tried `span.price` — but sometimes the price was in a `<div>`.

At 11 PM I realized: I was spending more time maintaining selectors than actually getting data.

## The shift in thinking

Here's what I eventually figured out: instead of hard-coding selectors, what if I could just describe what I wanted in plain English and let the tool figure out the DOM?

Something like:

```bash
# Instead of writing this:
page.querySelector('.price.sc-dkzDqf')

# What if I could just do this:
extract "the product price" --from https://example.com/product/123
```

That's basically what I've been using for the past month. The tool figures out the selector, and when the page changes, it re-discovers it.

## Real numbers from a real project

I tracked my time for 2 weeks before and after:

- **Before**: ~45 min per site to write scraper, then 10-15 min/week fixing broken selectors
- **After**: ~5 min per site to set up, 0 min/week maintenance (selectors auto-recover)

Over a month, across 8 sites, that's roughly 12 hours saved. Not life-changing, but enough to actually go home on time.

## The catch

It's not perfect. Complex interactions (multi-step forms, SPAs with heavy JS) still need manual scripting. And if a page changes its entire structure, no amount of auto-discovery will save you.

But for 80% of my scraping tasks — get text, get prices, get links — it's been surprisingly reliable.

If you're spending more time fixing selectors than building features, maybe it's time to try a different approach. The [xbrowser CLI](https://github.com/dyyz1993/xbrowser) is what I've been using — it's open source, works with your existing Chrome, and doesn't require writing 50 lines of Puppeteer every time.
