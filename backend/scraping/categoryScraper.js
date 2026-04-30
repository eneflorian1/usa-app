/**
 * CategoryScraper — extracts listing URLs from a marketplace category page.
 * Ported from NegoApp/src/scraper/category-scraper.js (ESM → CommonJS).
 *
 * Input:  Category URL (e.g., https://www.olx.ro/imobiliare/...)
 * Output: { listings: [{url, title, price, thumbnail, location}], pagesScraped, domain }
 *
 * Depends on: DomainStrategy (selectors), StealthBrowser
 */
const DomainStrategy = require('./domainStrategy');
const { StealthBrowser, sleep, killZombieChrome } = require('./stealthBrowser');

class CategoryScraper {
  constructor(options = {}) {
    this.domainStrategy = options.domainStrategy || new DomainStrategy();
    this.siteIntelligence = options.siteIntelligence || null;
    this.proxyManager = options.proxyManager || null;
    this.options = {
      maxPages: options.maxPages || 5,
      maxListings: options.maxListings || 200,
      delayBetweenPages: options.delayBetweenPages || [2000, 4000],
      headless: options.headless !== false,
      ...options,
    };
    this.shouldAbort = false;
  }

  stop() {
    this.shouldAbort = true;
    console.log('[CategoryScraper] Stop requested');
  }

  async scrape(categoryUrl, opts = {}) {
    const maxPages = opts.maxPages || this.options.maxPages;
    const maxListings = opts.maxListings || this.options.maxListings;

    const urlObj = new URL(categoryUrl);
    const domain = urlObj.hostname.replace('www.', '');

    const strategy = this.domainStrategy.load(domain);
    if (!strategy) {
      throw new Error(`No strategy found for ${domain}. Run SiteIntelligence.discover() first or add a manual strategy.`);
    }

    const selectors = strategy.categorySelectors;
    if (!selectors || !selectors.listingCard) {
      throw new Error(`Strategy for ${domain} has no categorySelectors. Cannot scrape.`);
    }

    console.log(`[CategoryScraper] ${domain}: ${maxListings} listings from max ${maxPages} pages`);

    killZombieChrome();

    const browser = new StealthBrowser();
    const allListings = [];
    let pagesScraped = 0;
    let currentUrl = categoryUrl;

    try {
      await browser.launch(null, { headless: this.options.headless ? 'new' : false });

      while (pagesScraped < maxPages && allListings.length < maxListings) {
        if (this.shouldAbort) {
          console.log('[CategoryScraper] Scrape aborted by user');
          break;
        }

        console.log(`[CategoryScraper] Page ${pagesScraped + 1}/${maxPages}: ${currentUrl}`);

        await browser.goto(currentUrl, { waitUntil: 'domcontentloaded' });
        await sleep(1000, 2000);

        const pageListings = await this._extractListings(browser, selectors, domain);
        console.log(`[CategoryScraper] Found ${pageListings.length} listings on page ${pagesScraped + 1}`);

        if (pageListings.length === 0) {
          console.log(`[CategoryScraper] No listings found, stopping pagination`);
          break;
        }

        for (const listing of pageListings) {
          if (allListings.length >= maxListings) break;
          const isDuplicate = allListings.some(l => l.url === listing.url);
          if (!isDuplicate) {
            allListings.push(listing);
          }
        }

        pagesScraped++;

        if (pagesScraped < maxPages && allListings.length < maxListings) {
          const nextUrl = await this._getNextPageUrl(browser, selectors, currentUrl, pagesScraped);
          if (!nextUrl) {
            console.log(`[CategoryScraper] No next page found, stopping`);
            break;
          }
          currentUrl = nextUrl;

          const [minDelay, maxDelay] = this.options.delayBetweenPages;
          await sleep(minDelay, maxDelay);
        }
      }
    } finally {
      await browser.close();
    }

    console.log(`[CategoryScraper] Done. ${allListings.length} listings from ${pagesScraped} pages`);

    return {
      listings: allListings,
      pagesScraped,
      domain,
      totalFound: allListings.length,
      scrapedAt: new Date().toISOString(),
    };
  }

  async _extractListings(browser, selectors, domain) {
    const listings = await browser.page.evaluate((sel, dom) => {
      const cards = document.querySelectorAll(sel.listingCard);
      const results = [];

      for (const card of cards) {
        try {
          let linkEl = sel.listingLink
            ? card.querySelector(sel.listingLink.replace(sel.listingCard + ' ', ''))
            : card.querySelector('a[href]');
          if (!linkEl) linkEl = card.querySelector('a[href]');
          if (!linkEl && card.tagName === 'A') linkEl = card;

          const href = linkEl?.href;
          if (!href || href === '#') continue;

          try {
            const linkUrl = new URL(href);
            if (!linkUrl.hostname.includes(dom)) continue;
          } catch { continue; }

          const titleEl = card.querySelector('h6, h4, h3, h2, [class*="title"], [data-testid*="title"]');
          const title = titleEl?.textContent?.trim() || '';

          const priceEl = card.querySelector('[data-testid*="price"], [class*="price"], .price');
          const priceText = priceEl?.textContent?.trim() || '';

          const imgEl = card.querySelector('img[src]');
          const thumbnail = imgEl?.src || null;

          const locEl = card.querySelector('[class*="location"], [data-testid*="location"]');
          const location = locEl?.textContent?.trim() || '';

          results.push({ url: href, title, price: priceText, thumbnail, location });
        } catch (e) { /* skip malformed */ }
      }

      return results;
    }, selectors, domain);

    return listings.map(l => ({
      ...l,
      url: l.url.startsWith('http') ? l.url : `https://www.${domain}${l.url}`,
      domain,
      scrapedAt: new Date().toISOString(),
    }));
  }

  async _getNextPageUrl(browser, selectors, currentUrl, currentPage) {
    if (selectors.nextPage) {
      const nextUrl = await browser.page.evaluate((sel) => {
        const nextBtn = document.querySelector(sel);
        if (!nextBtn) return null;

        if (nextBtn.tagName === 'A' && nextBtn.href) return nextBtn.href;

        const parentLink = nextBtn.closest('a[href]');
        if (parentLink) return parentLink.href;

        return '__CLICK_NEEDED__';
      }, selectors.nextPage);

      if (nextUrl && nextUrl !== '__CLICK_NEEDED__') {
        return nextUrl;
      }

      if (nextUrl === '__CLICK_NEEDED__') {
        try {
          await browser.page.evaluate((sel) => {
            const btn = document.querySelector(sel);
            if (btn) btn.click();
          }, selectors.nextPage);
          await sleep(2000, 3000);
          const newUrl = browser.page.url();
          if (newUrl !== currentUrl) return newUrl;
        } catch (e) {
          console.log(`[CategoryScraper] Next button click failed: ${e.message}`);
        }
      }
    }

    const urlObj = new URL(currentUrl);
    const pageParam = urlObj.searchParams.get('page');
    if (pageParam !== null) {
      urlObj.searchParams.set('page', String(Number(pageParam) + 1));
      return urlObj.toString();
    }

    urlObj.searchParams.set('page', String(currentPage + 1));
    return urlObj.toString();
  }
}

module.exports = CategoryScraper;
