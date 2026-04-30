/**
 * StealthBrowser — Puppeteer with anti-detection measures.
 * Ported from NegoApp/src/scraper/stealth-browser.js (ESM → CommonJS).
 *
 * - puppeteer-extra-plugin-stealth (evades common bot detections)
 * - Proxy integration per session
 * - Human-like behavior helpers (random delays, scrolling)
 * - VPS-optimized: low memory args, force-kill zombie Chrome processes
 */
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { execSync } = require('child_process');

puppeteer.use(StealthPlugin());

function sleep(min, max) {
  const ms = max ? Math.floor(Math.random() * (max - min) + min) : min;
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Kill orphaned Chrome processes on Linux (parent PID = 1).
 * Leaves WhatsApp's Chrome and active scrapers alone.
 */
function killZombieChrome() {
  if (process.platform !== 'linux') return;
  try {
    const output = execSync(
      'ps -eo pid,ppid,args 2>/dev/null | grep -i "[c]hrom" | awk \'$2 == 1 {print $1}\'',
      { timeout: 5000, encoding: 'utf-8' }
    ).trim();
    if (output) {
      const pids = output.split('\n').filter(Boolean);
      for (const pid of pids) {
        try { execSync(`kill -9 ${pid} 2>/dev/null || true`, { timeout: 2000 }); } catch {}
      }
      if (pids.length > 0) console.log(`[StealthBrowser] Killed ${pids.length} orphaned Chrome process(es)`);
    }
  } catch { /* ignore */ }
}

class StealthBrowser {
  constructor() {
    this.browser = null;
    this.page = null;
    this.proxy = null;
    this._pid = null;
  }

  async launch(proxy = null, options = {}) {
    this.proxy = proxy;

    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--window-size=1366,768',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-translate',
      '--metrics-recording-only',
      '--no-first-run',
      '--renderer-process-limit=1',
      '--js-flags=--max-old-space-size=256',
    ];

    if (process.platform === 'linux' && !process.env.DISPLAY) {
      args.push(
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-dev-shm-usage',
        '--ozone-platform=headless',
      );
    }

    if (proxy) {
      args.push(`--proxy-server=${proxy.protocol || 'http'}://${proxy.host}:${proxy.port}`);
    }

    this.browser = await puppeteer.launch({
      headless: 'new',
      protocolTimeout: 180000,
      args,
      defaultViewport: { width: 1366, height: 768 },
      ...options,
    });

    this._pid = this.browser.process()?.pid || null;

    this.page = await this.browser.newPage();

    await this.page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );

    await this.page.setExtraHTTPHeaders({
      'Accept-Language': 'ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    });

    await this.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.chrome = { runtime: {} };
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters);
    });

    return this;
  }

  async injectCookies(cookies) {
    if (!this.page || !cookies || cookies.length === 0) return;
    await this.page.setCookie(...cookies);
    console.log(`[StealthBrowser] Injected ${cookies.length} cookies`);
  }

  async goto(url, options = {}) {
    await this.page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
      ...options,
    });
    await sleep(1000, 2500);
    await this._handlePopups();
    return this.page;
  }

  async _handlePopups() {
    const popupSelectors = [
      '#onetrust-accept-btn-handler',
      '._close',
      'button[class*="close"]',
      '[data-testid="cookie-accept"]',
      '.cookie-consent-accept',
    ];

    for (const selector of popupSelectors) {
      try {
        const element = await this.page.$(selector);
        if (element) {
          const isVisible = await element.evaluate(el => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
          });
          if (isVisible) {
            await element.click();
            await sleep(500, 1000);
          }
        }
      } catch (e) { /* ignore */ }
    }
  }

  async humanScroll(scrolls = 3) {
    for (let i = 0; i < scrolls; i++) {
      const scrollAmount = Math.floor(Math.random() * 300) + 200;
      await this.page.evaluate((amount) => {
        window.scrollBy({ top: amount, behavior: 'smooth' });
      }, scrollAmount);
      await sleep(800, 2000);
    }
  }

  async humanClick(selector) {
    const element = await this.page.waitForSelector(selector, { timeout: 10000 });
    if (!element) throw new Error(`Element not found: ${selector}`);

    const box = await element.boundingBox();
    if (!box) throw new Error(`Element not visible: ${selector}`);

    const x = box.x + Math.random() * box.width;
    const y = box.y + Math.random() * box.height;

    await this.page.mouse.move(x, y, { steps: Math.floor(Math.random() * 5) + 3 });
    await sleep(100, 300);
    await this.page.mouse.click(x, y);
    await sleep(300, 800);

    return element;
  }

  async getText(selector) {
    try {
      const element = await this.page.$(selector);
      if (!element) return null;
      return await element.evaluate(el => el.textContent.trim());
    } catch {
      return null;
    }
  }

  async waitAndGetText(selector, timeout = 5000) {
    try {
      await this.page.waitForSelector(selector, { timeout });
      return await this.getText(selector);
    } catch {
      return null;
    }
  }

  getUrl() {
    return this.page.url();
  }

  async screenshot(path) {
    await this.page.screenshot({ path, fullPage: false });
  }

  async close() {
    if (!this.browser) return;

    const pid = this._pid;

    try {
      await Promise.race([
        this.browser.close(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('close timeout')), 15000)),
      ]);
    } catch (err) {
      console.warn(`[StealthBrowser] Graceful close failed (${err.message}), force-killing pid ${pid}`);
      this._forceKill(pid);
    }

    this.browser = null;
    this.page = null;
    this._pid = null;
  }

  _forceKill(pid) {
    if (!pid) return;
    try {
      if (process.platform === 'linux') {
        execSync(`kill -9 ${pid} 2>/dev/null || true`, { timeout: 3000 });
        execSync(`pkill -9 -P ${pid} 2>/dev/null || true`, { timeout: 3000 });
      } else {
        process.kill(pid, 'SIGKILL');
      }
    } catch { /* already dead */ }
  }
}

module.exports = { StealthBrowser, sleep, killZombieChrome };
