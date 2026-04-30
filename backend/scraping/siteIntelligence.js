/**
 * SiteIntelligence — AI-powered marketplace DOM analysis.
 * Ported from NegoApp/src/scraper/site-intelligence.js (ESM → CommonJS).
 *
 * When no cached strategy exists for a domain, this module uses Gemini
 * to analyze the live DOM and discover selectors for listings, phone reveal,
 * pagination, etc. Result is saved via DomainStrategy.
 */
const { StealthBrowser, sleep } = require('./stealthBrowser');
const DomainStrategy = require('./domainStrategy');
const GeminiAdapter = require('./geminiAdapter');

const MAX_HTML_LENGTH = 20000;
const MAX_RETRIES = 2;

class SiteIntelligence {
  constructor(options = {}, proxyManager = null) {
    if (options.geminiClient) {
      this.gemini = options.geminiClient;
      this.proxyManager = options.proxyManager || null;
      this.domainStrategy = options.domainStrategy || new DomainStrategy();
    } else if (options && typeof options.generate === 'function') {
      // Legacy positional: (gemini, proxyManager)
      this.gemini = options;
      this.proxyManager = proxyManager;
      this.domainStrategy = new DomainStrategy();
    } else {
      this.gemini = new GeminiAdapter();
      this.proxyManager = proxyManager;
      this.domainStrategy = new DomainStrategy();
    }
  }

  async discover(domain, options = {}) {
    if (!options.forceRediscover) {
      const cached = this.domainStrategy.load(domain);
      if (cached) {
        console.log(`[Intelligence] Using cached strategy for ${domain}`);
        return cached;
      }
    }

    if (!this.gemini.isAvailable) {
      throw new Error(`Cannot discover strategy for ${domain}: Gemini API key not configured.`);
    }

    console.log(`\n[Intelligence] ══════════════════════════════════════`);
    console.log(`[Intelligence] Discovering strategy for: ${domain}`);
    console.log(`[Intelligence] ══════════════════════════════════════\n`);

    let strategy = null;
    let lastError = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`[Intelligence] Retry ${attempt}/${MAX_RETRIES}...`);
        }

        const sampleListingUrl = options.sampleListingUrl || options.listingUrl;
        const sampleCategoryUrl = options.sampleCategoryUrl || options.categoryUrl;

        const listingHtml = sampleListingUrl ? await this._fetchAndCleanPage(sampleListingUrl) : null;
        const categoryHtml = sampleCategoryUrl ? await this._fetchAndCleanPage(sampleCategoryUrl) : null;

        if (!listingHtml && !categoryHtml) {
          throw new Error('Need at least one sample URL (listing or category) to analyze');
        }

        strategy = await this._analyzeWithAI(domain, listingHtml, categoryHtml, attempt);

        if (!strategy) {
          throw new Error('AI returned no usable strategy');
        }

        if (listingHtml) {
          const validationResult = await this._validateListingSelectors(sampleListingUrl, strategy.listingSelectors);

          if (!validationResult.valid) {
            console.warn(`[Intelligence] Validation failed: ${validationResult.reason}`);
            if (attempt < MAX_RETRIES) {
              lastError = validationResult.reason;
              continue;
            }
          } else {
            console.log(`[Intelligence] ✅ Listing selectors validated (${validationResult.matchCount}/${validationResult.totalChecked} matched)`);
          }
        }

        if (categoryHtml) {
          const catValidation = await this._validateCategorySelectors(sampleCategoryUrl, strategy.categorySelectors);

          if (!catValidation.valid) {
            console.warn(`[Intelligence] Category validation failed: ${catValidation.reason}`);
            if (attempt < MAX_RETRIES) {
              lastError = catValidation.reason;
              continue;
            }
          } else {
            console.log(`[Intelligence] ✅ Category selectors validated (${catValidation.matchCount} cards found)`);
          }
        }

        break;

      } catch (err) {
        lastError = err.message;
        console.error(`[Intelligence] Attempt ${attempt} failed: ${err.message}`);
        if (attempt >= MAX_RETRIES) {
          throw new Error(`Failed to discover strategy for ${domain} after ${MAX_RETRIES + 1} attempts. Last error: ${lastError}`);
        }
      }
    }

    const finalStrategy = {
      domain,
      version: 1,
      status: 'active',
      successRate: 0.8,
      discoveredBy: 'site-intelligence-ai',
      discoveredAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString().split('T')[0],
      ...strategy,
    };

    this.domainStrategy.save(domain, finalStrategy);
    console.log(`[Intelligence] ✅ Strategy saved for ${domain}\n`);

    return finalStrategy;
  }

  async _fetchAndCleanPage(url) {
    const proxy = this.proxyManager ? this.proxyManager.getRandom() : null;
    const attempts = proxy ? [proxy, null] : [null];

    for (const currentProxy of attempts) {
      const browser = new StealthBrowser();
      try {
        console.log(`[Intelligence] Fetching: ${url}${currentProxy ? ' (via proxy)' : ' (direct)'}`);
        await browser.launch(currentProxy, { headless: 'new' });
        await browser.goto(url);

        await sleep(2000, 3000);

        const html = await browser.page.evaluate(() => {
          const clone = document.body.cloneNode(true);

          const removeSelectors = [
            'script', 'style', 'svg', 'iframe', 'noscript',
            '[class*="ad-"]', '[class*="advertisement"]', '[id*="google_ads"]',
            '[class*="cookie"]', '[class*="consent"]', '[class*="popup"]',
            '[class*="modal"]', '[class*="overlay"]',
            'img', 'video', 'audio', 'canvas', 'picture',
            'header > nav', 'footer',
          ];

          for (const sel of removeSelectors) {
            try { clone.querySelectorAll(sel).forEach(el => el.remove()); } catch {}
          }

          clone.querySelectorAll('[style]').forEach(el => el.removeAttribute('style'));

          clone.querySelectorAll('[class]').forEach(el => {
            const classes = el.className.split(/\s+/).filter(c =>
              c.length > 3 && !c.match(/^css-/) && !c.match(/^_/) && !c.match(/^[a-z]{1,2}\d{4,}/)
            );
            if (classes.length > 0) {
              el.className = classes.join(' ');
            } else {
              el.removeAttribute('class');
            }
          });

          const walker = document.createTreeWalker(clone, NodeFilter.SHOW_COMMENT);
          const comments = [];
          while (walker.nextNode()) comments.push(walker.currentNode);
          comments.forEach(c => c.remove());

          return clone.innerHTML;
        });

        const cleaned = html.replace(/\s+/g, ' ').replace(/>\s+</g, '><').trim();

        console.log(`[Intelligence] Fetched ${url} — cleaned HTML: ${cleaned.length} chars`);

        if (cleaned.length > MAX_HTML_LENGTH) {
          console.log(`[Intelligence] Truncating to ${MAX_HTML_LENGTH} chars`);
          return cleaned.substring(0, MAX_HTML_LENGTH);
        }

        return cleaned;

      } catch (err) {
        await browser.close();
        const isProxyError = currentProxy && (
          err.message.includes('ERR_TUNNEL') ||
          err.message.includes('ERR_PROXY') ||
          err.message.includes('ERR_CONNECTION') ||
          err.message.includes('TIMEOUT') ||
          err.message.includes('net::')
        );
        if (isProxyError && attempts.indexOf(null) >= 0) {
          console.warn(`[Intelligence] Proxy failed (${err.message}), retrying direct...`);
          continue;
        }
        throw err;
      } finally {
        try { await browser.close(); } catch {}
      }
    }
  }

  async _analyzeWithAI(domain, listingHtml, categoryHtml, retryAttempt = 0) {
    const parts = [];

    if (listingHtml) parts.push(this._buildListingPrompt(domain, listingHtml, retryAttempt));
    if (categoryHtml) parts.push(this._buildCategoryPrompt(domain, categoryHtml, retryAttempt));

    const combinedPrompt = parts.join('\n\n---\n\n') + `

IMPORTANT: Respond with a SINGLE JSON object combining all analysis. No markdown, no explanation.
The JSON must have this exact structure:
{
  "listingSelectors": {
    "title": "CSS selector for product title",
    "price": "CSS selector for price",
    "description": "CSS selector for description",
    "sellerName": "CSS selector for seller name",
    "location": "CSS selector for location",
    "memberSince": "CSS selector for member registration date (if exists)",
    "lastSeen": "CSS selector for last seen indicator (if exists)"
  },
  "phoneReveal": {
    "approach": "click_button | api_call | visible_on_page | none",
    "strategies": [
      {
        "name": "descriptive_name",
        "selector": "CSS selector for the reveal button/element",
        "description": "How this approach works"
      }
    ],
    "resultSelector": "CSS selector where the phone number appears after reveal",
    "phonePattern": "regex pattern matching phone numbers on this platform",
    "needsVisibleCheck": true,
    "duplicateButtons": false
  },
  "categorySelectors": {
    "listingCard": "CSS selector for individual listing cards in category view",
    "listingLink": "CSS selector for the link inside a listing card",
    "nextPage": "CSS selector for the next-page/pagination button",
    "itemsPerPage": 40
  },
  "contactMethods": ["in_app_chat", "phone_reveal", "email"],
  "rateLimit": {
    "maxRevealsPerSession": 5,
    "delayBetweenMs": 30000
  },
  "pagination": {
    "type": "page_number | offset | load_more | infinite_scroll",
    "urlPattern": "URL pattern with {page} or {offset} placeholder"
  }
}`;

    console.log(`[Intelligence] Sending to Gemini (${combinedPrompt.length} chars)...`);

    const response = await this.gemini.generate(combinedPrompt, {
      temperature: retryAttempt === 0 ? 0.2 : 0.4 + (retryAttempt * 0.1),
      maxTokens: 4096,
    });

    try {
      const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      console.log(`[Intelligence] AI returned strategy with ${Object.keys(parsed).length} sections`);
      return parsed;
    } catch (err) {
      console.error(`[Intelligence] Failed to parse AI response: ${err.message}`);
      console.error(`[Intelligence] Raw response (first 500 chars): ${response.substring(0, 500)}`);
      return null;
    }
  }

  _buildListingPrompt(domain, html, retryAttempt) {
    const extraHint = retryAttempt > 0
      ? `\nPREVIOUS ATTEMPT FAILED. Be more careful with selectors. Try data-testid attributes first, then structural selectors. Avoid class-based selectors that might be CSS-module hashes.`
      : '';

    return `Analyze this marketplace LISTING page from ${domain}.
Find CSS selectors for:
1. Product title (usually h1 or a prominent heading)
2. Price (the main price display)
3. Description (product description text)
4. Seller name / profile link
5. Location / city
6. Phone reveal mechanism — how does a user see the seller's phone number?
   - Is there a "show phone" / "call" / "reveal" button?
   - What happens when clicked? Does a tel: link appear? Does text change?
   - Are there duplicate buttons (mobile + desktop)?
7. Contact methods available (chat, phone, email, WhatsApp)

PREFER data-testid or data-cy attributes when available. These are stable across deploys.
AVOID CSS hash classes like "css-1abc23" or "_2xFG" — they change frequently.
${extraHint}

LISTING PAGE HTML:
${html}`;
  }

  _buildCategoryPrompt(domain, html, retryAttempt) {
    const extraHint = retryAttempt > 0
      ? `\nPREVIOUS ATTEMPT FAILED. Focus on finding the repeating card pattern. Look for data-testid on card containers or list items.`
      : '';

    return `Analyze this marketplace CATEGORY/SEARCH RESULTS page from ${domain}.
Find CSS selectors for:
1. Individual listing card container (the repeating element for each product)
2. Link to the full listing inside each card
3. Pagination — next page button or mechanism
4. How many items per page

Look for a repeating pattern of product cards. Each card typically has: title, price, thumbnail, location.
The card selector should match ALL cards on the page.
${extraHint}

CATEGORY PAGE HTML:
${html}`;
  }

  async _validateListingSelectors(url, selectors) {
    if (!selectors) return { valid: false, reason: 'No selectors returned' };

    const browser = new StealthBrowser();
    try {
      await browser.launch(null, { headless: 'new' });
      await browser.goto(url);
      await sleep(1500, 2500);

      const result = await browser.page.evaluate((sels) => {
        const results = {};
        let matched = 0;
        let total = 0;

        for (const [field, selector] of Object.entries(sels)) {
          if (!selector) continue;
          total++;
          try {
            const el = document.querySelector(selector);
            results[field] = {
              found: !!el,
              text: el ? el.textContent.trim().substring(0, 100) : null,
            };
            if (el) matched++;
          } catch {
            results[field] = { found: false, error: 'Invalid selector' };
          }
        }

        return { matched, total, results };
      }, selectors);

      const hasTitle = result.results.title?.found;
      const hasPrice = result.results.price?.found;

      if (!hasTitle && !hasPrice) {
        return {
          valid: false,
          reason: `Neither title nor price selectors matched. Matched ${result.matched}/${result.total}`,
          matchCount: result.matched,
          totalChecked: result.total,
          details: result.results,
        };
      }

      return {
        valid: true,
        matchCount: result.matched,
        totalChecked: result.total,
        details: result.results,
      };

    } finally {
      await browser.close();
    }
  }

  async _validateCategorySelectors(url, selectors) {
    if (!selectors || !selectors.listingCard) {
      return { valid: false, reason: 'No listingCard selector returned' };
    }

    const browser = new StealthBrowser();
    try {
      await browser.launch(null, { headless: 'new' });
      await browser.goto(url);
      await sleep(1500, 2500);

      const cardCount = await browser.page.evaluate((sel) => {
        try {
          return document.querySelectorAll(sel).length;
        } catch {
          return 0;
        }
      }, selectors.listingCard);

      if (cardCount === 0) {
        return {
          valid: false,
          reason: `listingCard selector "${selectors.listingCard}" found 0 elements`,
          matchCount: 0,
        };
      }

      console.log(`[Intelligence] Category validation: ${cardCount} cards found with "${selectors.listingCard}"`);
      return { valid: true, matchCount: cardCount };

    } finally {
      await browser.close();
    }
  }

  async quickAnalyze(url) {
    if (!this.gemini.isAvailable) {
      throw new Error('Gemini API not available');
    }

    const domain = new URL(url).hostname.replace('www.', '');
    const html = await this._fetchAndCleanPage(url);

    const result = await this.gemini.analyzePageStructure(html, domain);
    return { domain, url, analysis: result, htmlLength: html.length };
  }
}

module.exports = SiteIntelligence;
