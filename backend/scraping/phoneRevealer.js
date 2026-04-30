/**
 * PhoneRevealer — phone number reveal system for OLX and similar marketplaces.
 * Ported from NegoApp/src/scraper/phone-revealer.js (ESM → CommonJS).
 *
 * Strategy:
 * 1. Click "Suna vanzatorul" (ad-contact-phone) OR "Arata" (show-phone)
 * 2. After click, look for tel: links, phones-container text changes,
 *    or network API responses containing phone data
 */
const { StealthBrowser, sleep } = require('./stealthBrowser');
const OlxSession = require('./olxSession');

const LISTING_SELECTORS = {
  olx: {
    title: '[data-testid="offer_title"]',
    price: '[data-testid="ad-price-container"]',
    description: '[data-testid="ad_description"]',
    sellerName: '[data-testid="user-profile-user-name"]',
    location: '[data-testid="aside-location-section"]',
    memberSince: '[data-testid="member-since"]',
    lastSeen: '[data-testid="lastSeenBox"]',
  },
  generic: {
    title: 'h1',
    price: '[class*="price"]',
    description: '[class*="description"]',
  },
};

class PhoneRevealer {
  constructor(proxyManager = null) {
    this.proxyManager = proxyManager;
    this.results = [];
  }

  async revealPhone(url, options = {}) {
    const browser = new StealthBrowser();
    const proxy = this.proxyManager ? this.proxyManager.getRandom() : null;

    const result = {
      url,
      phone: null,
      listing: {},
      proxy: proxy ? proxy.url : 'direct',
      success: false,
      error: null,
      timing: { start: Date.now() },
    };

    try {
      console.log(`[Reveal] ${url}${proxy ? ` (proxy: ${proxy.url})` : ''}`);

      await browser.launch(proxy, {
        headless: options.headless !== false ? 'new' : false,
      });

      if (url.includes('olx.ro')) {
        const cookies = OlxSession.getCookies();
        if (cookies) {
          await browser.injectCookies(cookies);
          console.log('[Reveal] OLX session cookies injected — authenticated mode');
        } else {
          console.log('[Reveal] No OLX session — anonymous mode (limited phone visibility)');
        }
      }

      let apiPhone = null;
      browser.page.on('response', async (response) => {
        try {
          const rUrl = response.url();
          if (rUrl.includes('/phones/') || rUrl.includes('phone_number') ||
              (rUrl.includes('/api/') && rUrl.includes('phone'))) {
            const body = await response.text();
            const match = body.match(/"phone_number":\s*"([^"]+)"/) ||
                          body.match(/"phone":\s*"([^"]+)"/) ||
                          body.match(/\b(0[237][0-9]{8})\b/) ||
                          body.match(/\b(\+40[237][0-9]{8})\b/);
            if (match) {
              apiPhone = match[1];
              console.log(`[Reveal] Phone from API: ${apiPhone}`);
            }
          }
        } catch (e) { /* response not readable */ }
      });

      await browser.goto(url);
      result.timing.navigated = Date.now();

      const platform = this._detectPlatform(url);

      result.listing = await this._extractListingData(browser, platform);
      console.log(`[Reveal] "${result.listing.title}" — ${result.listing.price}`);

      await browser.humanScroll(1);
      await sleep(800, 1500);
      await browser.page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
      await sleep(500, 1000);

      let phone = null;

      phone = await this._checkPhonesContainer(browser);
      if (phone) {
        console.log(`[Reveal] Phone already visible in container: ${phone}`);
      }

      if (!phone) {
        phone = await this._clickAndReveal(browser, 'button[data-testid="ad-contact-phone"]', 'ad-contact-phone');
      }

      if (!phone) {
        phone = await this._clickAndReveal(browser, 'button[data-testid="show-phone"]', 'show-phone');
      }

      if (!phone) {
        const genericBtn = await this._findButtonByText(browser, ['suna', 'telefon', 'phone', 'arata', 'call', 'reveal']);
        if (genericBtn) {
          phone = await this._clickAndReveal(browser, genericBtn, 'text-search');
        }
      }

      if (!phone && apiPhone) {
        phone = this._normalizePhone(apiPhone);
        console.log(`[Reveal] Using API-intercepted phone: ${phone}`);
      }

      if (!phone) {
        const debug = await browser.page.evaluate(() => {
          const pc = document.querySelector('[data-testid="phones-container"]');
          const contactBar = document.querySelector('[data-testid="ad-contact-bar"]');
          return {
            phonesContainer: pc ? pc.innerHTML.substring(0, 300) : 'NOT FOUND',
            contactBar: contactBar ? contactBar.innerHTML.substring(0, 300) : 'NOT FOUND',
            allTelLinks: Array.from(document.querySelectorAll('a[href^="tel:"]')).map(a => ({ href: a.href, text: a.textContent })),
          };
        });
        console.log(`[Reveal] Debug:`, JSON.stringify(debug, null, 2));

        if (options.debugScreenshot) {
          await browser.screenshot(`debug_reveal_${Date.now()}.png`);
        }
        throw new Error('All reveal approaches failed');
      }

      result.phone = phone;
      result.success = true;
      result.timing.done = Date.now();
      result.timing.totalMs = result.timing.done - result.timing.start;
      console.log(`[Reveal] ✅ ${result.phone} (${result.timing.totalMs}ms)`);

    } catch (error) {
      result.error = error.message;
      result.timing.done = Date.now();
      result.timing.totalMs = result.timing.done - result.timing.start;
      console.error(`[Reveal] ❌ ${error.message}`);

      if (proxy && this.proxyManager) {
        const isBlocked = error.message.includes('blocked') || error.message.includes('403') || error.message.includes('captcha');
        if (isBlocked) this.proxyManager.markBlocked(proxy.id);
      }
    } finally {
      await browser.close();
    }

    this.results.push(result);
    return result;
  }

  async _checkPhonesContainer(browser) {
    try {
      const phone = await browser.page.evaluate(() => {
        const container = document.querySelector('[data-testid="phones-container"]');
        if (!container) return null;

        const telLink = container.querySelector('a[href^="tel:"]');
        if (telLink) return telLink.href.replace('tel:', '');

        const text = container.textContent;
        if (text.includes('xxx')) return null;
        const match = text.match(/\b(0[237][0-9]{1,2}[\s.-]?[0-9]{3}[\s.-]?[0-9]{3,4})\b/);
        return match ? match[1] : null;
      });

      if (phone) return this._normalizePhone(phone);
    } catch (e) { /* container not found */ }
    return null;
  }

  async _clickAndReveal(browser, selector, label) {
    try {
      const visibleIdx = await browser.page.evaluate((sel) => {
        const els = document.querySelectorAll(sel);
        for (let i = 0; i < els.length; i++) {
          const rect = els[i].getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) return i;
        }
        return -1;
      }, selector);

      if (visibleIdx === -1) {
        console.log(`[Reveal] No visible ${label} button found`);
        return null;
      }

      console.log(`[Reveal] Clicking visible ${label} button (index ${visibleIdx})...`);

      await browser.page.evaluate((sel, idx) => {
        const els = document.querySelectorAll(sel);
        const el = els[idx];
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
      }, selector, visibleIdx);
      await sleep(300, 600);

      await browser.page.evaluate((sel, idx) => {
        const els = document.querySelectorAll(sel);
        els[idx].click();
      }, selector, visibleIdx);

      await sleep(2000, 3500);

      const telPhone = await browser.page.evaluate(() => {
        const links = document.querySelectorAll('a[href^="tel:"]');
        for (const link of links) {
          const href = link.href.replace('tel:', '').trim();
          if (href.length >= 8 && !href.includes('xxx')) return href;
        }
        return null;
      });
      if (telPhone) {
        console.log(`[Reveal] Got tel: link after ${label} click: ${telPhone}`);
        return this._normalizePhone(telPhone);
      }

      const containerPhone = await this._checkPhonesContainer(browser);
      if (containerPhone) {
        console.log(`[Reveal] Container revealed after ${label} click: ${containerPhone}`);
        return containerPhone;
      }

      const btnPhone = await browser.page.evaluate((sel, idx) => {
        const els = document.querySelectorAll(sel);
        const el = els[idx];
        if (!el) return null;
        const text = el.textContent;
        const match = text.match(/\b(0[237][0-9]{1,2}[\s.-]?[0-9]{3}[\s.-]?[0-9]{3,4})\b/);
        return match ? match[1] : null;
      }, selector, visibleIdx);
      if (btnPhone) {
        console.log(`[Reveal] Button text has phone after ${label} click: ${btnPhone}`);
        return this._normalizePhone(btnPhone);
      }

      console.log(`[Reveal] ${label} click didn't reveal phone`);
      return null;

    } catch (e) {
      console.log(`[Reveal] ${label} click error: ${e.message}`);
      return null;
    }
  }

  async _findButtonByText(browser, keywords) {
    try {
      const selector = await browser.page.evaluate((kws) => {
        const buttons = document.querySelectorAll('button, a[role="button"]');
        for (const btn of buttons) {
          const rect = btn.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;

          const text = btn.textContent.toLowerCase().trim();
          for (const kw of kws) {
            if (text.includes(kw)) {
              if (btn.dataset.testid) return `[data-testid="${btn.dataset.testid}"]`;
              if (btn.id) return `#${btn.id}`;
              return null;
            }
          }
        }
        return null;
      }, keywords);
      return selector;
    } catch (e) { return null; }
  }

  _detectPlatform(url) {
    if (url.includes('olx.ro')) return 'olx';
    if (url.includes('autovit.ro')) return 'autovit';
    return 'generic';
  }

  async _extractListingData(browser, platform) {
    const selectors = LISTING_SELECTORS[platform] || LISTING_SELECTORS.generic;
    const data = {};
    for (const [field, selector] of Object.entries(selectors)) {
      data[field] = await browser.getText(selector);
    }
    if (data.price) {
      data.price = this._sanitizePrice(data.price);
    }
    data.url = browser.getUrl();
    return data;
  }

  _sanitizePrice(raw) {
    if (!raw) return raw;
    const match = raw.match(/^([\d][\d\s.,]*\s*(?:€|lei|RON|EUR|USD|\$|£))/i);
    if (match) return match[1].trim();
    const match2 = raw.match(/^((?:€|lei|RON|EUR|USD|\$|£)\s*[\d][\d\s.,]*)/i);
    if (match2) return match2[1].trim();
    const match3 = raw.match(/^([\d][\d\s.,]*)/);
    if (match3 && match3[1].trim().length >= 2) return match3[1].trim();
    return raw;
  }

  _normalizePhone(phone) {
    let clean = phone.replace(/[\s.\-()]/g, '');
    if (clean.startsWith('+40')) clean = '0' + clean.slice(3);
    else if (clean.startsWith('40') && clean.length === 11) clean = '0' + clean.slice(2);
    return clean;
  }

  getResults() { return this.results; }

  getStats() {
    const total = this.results.length;
    const success = this.results.filter(r => r.success).length;
    return { total, success, failed: total - success };
  }
}

module.exports = PhoneRevealer;
