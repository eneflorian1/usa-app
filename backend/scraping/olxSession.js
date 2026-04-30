/**
 * OlxSession — OLX cookie-based session management.
 * Ported from NegoApp/src/scraper/olx-session.js (ESM → CommonJS).
 *
 * Strategies:
 * 1. login(email, password) — uses xvfb on VPS for visible browser (bypasses Cloudflare)
 * 2. importCookies(cookieString) — manual import from user's browser
 * 3. getCookies() — reads saved cookies for injection via page.setCookie()
 * 4. isValid() — checks if saved session is still alive
 *
 * Storage: backend/data/olx_session.json
 */
const { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const { StealthBrowser, sleep } = require('./stealthBrowser');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SESSION_FILE = path.join(DATA_DIR, 'olx_session.json');

const SELECTORS = {
  emailInput: '#username',
  passwordInput: '#password',
  loginButton: '#Login',
  cookieConsent: '#onetrust-accept-btn-handler',
};

function ensureDisplay() {
  if (process.env.DISPLAY) {
    console.log(`[OlxSession] Display available: ${process.env.DISPLAY}`);
    return null;
  }

  if (process.platform === 'win32') return null;

  try {
    execSync('which Xvfb', { stdio: 'ignore' });
  } catch {
    console.warn('[OlxSession] Xvfb not installed. Run: sudo apt-get install -y xvfb');
    return null;
  }

  const display = ':99';
  console.log(`[OlxSession] Starting Xvfb on display ${display}...`);

  try {
    try { execSync('kill $(cat /tmp/.X99-lock 2>/dev/null) 2>/dev/null', { stdio: 'ignore' }); } catch {}

    const xvfb = spawn('Xvfb', [display, '-screen', '0', '1280x720x24', '-ac'], {
      stdio: 'ignore',
      detached: true,
    });
    xvfb.unref();

    const waitUntil = Date.now() + 500;
    while (Date.now() < waitUntil) { /* busy-wait 500ms */ }

    process.env.DISPLAY = display;
    console.log(`[OlxSession] Xvfb started on ${display}`);

    return { xvfbProcess: xvfb, display };
  } catch (e) {
    console.error(`[OlxSession] Failed to start Xvfb: ${e.message}`);
    return null;
  }
}

function cleanupDisplay(xvfbInfo) {
  if (xvfbInfo?.xvfbProcess) {
    try {
      xvfbInfo.xvfbProcess.kill('SIGTERM');
      console.log('[OlxSession] Xvfb stopped');
    } catch {}
  }
}

class OlxSession {
  static async login(email, password) {
    if (!email || !password) {
      return { success: false, cookieCount: 0, error: 'Email and password are required' };
    }

    const xvfbInfo = ensureDisplay();
    const useHeadless = !process.env.DISPLAY && process.platform !== 'win32';

    const browser = new StealthBrowser();
    try {
      if (useHeadless) {
        console.log('[OlxSession] No display available — falling back to headless mode');
        console.log('[OlxSession] ⚠ Headless may be blocked by Cloudflare. Consider: sudo apt-get install -y xvfb');
        await browser.launch(null, { headless: 'new' });
      } else {
        console.log('[OlxSession] Launching visible browser (Cloudflare-proof)...');
        await browser.launch(null, { headless: false });
      }

      console.log('[OlxSession] Navigating to OLX login...');
      await browser.page.goto('https://www.olx.ro/cont/', {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });
      await sleep(2000, 3000);

      try {
        const consent = await browser.page.$(SELECTORS.cookieConsent);
        if (consent) {
          await consent.click();
          await sleep(1000, 1500);
          console.log('[OlxSession] Cookie consent dismissed');
        }
      } catch (e) { /* no consent popup */ }

      await browser.page.waitForSelector(SELECTORS.emailInput, { timeout: 15000 });
      console.log('[OlxSession] Login form found');

      await browser.page.click(SELECTORS.emailInput);
      await sleep(300, 500);
      await browser.page.type(SELECTORS.emailInput, email, { delay: 50 + Math.random() * 40 });
      await sleep(300, 500);

      await browser.page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) {
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
        }
      }, SELECTORS.emailInput);
      await sleep(500, 800);

      await browser.page.click(SELECTORS.passwordInput);
      await sleep(300, 500);
      await browser.page.type(SELECTORS.passwordInput, password, { delay: 50 + Math.random() * 40 });
      await sleep(300, 500);

      await browser.page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) {
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
        }
      }, SELECTORS.passwordInput);
      await sleep(1000, 1500);

      console.log('[OlxSession] Waiting for Login button to enable...');
      let buttonEnabled = false;
      for (let i = 0; i < 20; i++) {
        buttonEnabled = await browser.page.evaluate((sel) => {
          const btn = document.querySelector(sel);
          return btn && !btn.disabled;
        }, SELECTORS.loginButton);
        if (buttonEnabled) break;
        await sleep(500);
      }

      if (!buttonEnabled) {
        console.error('[OlxSession] Login button stayed disabled');
        try { await browser.page.screenshot({ path: path.join(DATA_DIR, 'olx_debug_disabled.png') }); } catch {}
        return { success: false, cookieCount: 0, error: 'Butonul de Login nu s-a activat. Verifică email-ul și parola.' };
      }

      console.log('[OlxSession] Clicking Login...');
      await browser.page.click(SELECTORS.loginButton);

      let isStillOnLogin = true;
      let errorText = null;
      for (let waited = 0; waited < 30000; waited += 2000) {
        await sleep(2000);
        const url = browser.page.url();
        isStillOnLogin = url.includes('login.olx') || url.includes('/cont/') || url.includes('/login');
        if (!isStillOnLogin) break;

        errorText = await browser.page.evaluate(() => {
          const els = document.querySelectorAll('[class*="error"], [class*="Error"], [role="alert"]');
          for (const el of els) {
            const t = el.textContent.trim();
            if (t.length > 0 && t.length < 150 && !t.includes('cookie')) return t;
          }
          return null;
        });
        if (errorText) break;
      }

      if (errorText) {
        console.error(`[OlxSession] Login error: ${errorText}`);
        return { success: false, cookieCount: 0, error: `OLX: ${errorText}` };
      }

      if (isStillOnLogin) {
        try { await browser.page.screenshot({ path: path.join(DATA_DIR, 'olx_debug_timeout.png') }); } catch {}
        return { success: false, cookieCount: 0, error: 'Login timeout. Posibil CAPTCHA sau altă problemă.' };
      }

      const cookies = await browser.page.cookies();
      console.log(`[OlxSession] ✅ Login successful! ${cookies.length} cookies extracted`);
      OlxSession._saveCookies(cookies, email);
      return { success: true, cookieCount: cookies.length };

    } catch (error) {
      console.error(`[OlxSession] Login failed: ${error.message}`);
      if (browser?.page) {
        try { await browser.page.screenshot({ path: path.join(DATA_DIR, `olx_error_${Date.now()}.png`) }); } catch {}
      }
      return { success: false, cookieCount: 0, error: error.message };
    } finally {
      await browser.close();
      cleanupDisplay(xvfbInfo);
    }
  }

  static importCookies(cookieInput) {
    try {
      let cookies;

      if (cookieInput.trim().startsWith('[')) {
        cookies = JSON.parse(cookieInput);
      } else {
        cookies = cookieInput.split(';').map(pair => {
          const [name, ...rest] = pair.trim().split('=');
          return {
            name: name.trim(),
            value: rest.join('=').trim(),
            domain: '.olx.ro',
            path: '/',
            httpOnly: false,
            secure: true,
            sameSite: 'Lax',
          };
        }).filter(c => c.name && c.value);
      }

      if (!cookies || cookies.length === 0) {
        return { success: false, error: 'Nu am putut extrage cookies din textul furnizat.' };
      }

      OlxSession._saveCookies(cookies, 'manual-import');
      console.log(`[OlxSession] ✅ Imported ${cookies.length} cookies manually`);
      return { success: true, cookieCount: cookies.length };
    } catch (e) {
      return { success: false, error: `Eroare la parsarea cookie-urilor: ${e.message}` };
    }
  }

  static _saveCookies(cookies, email) {
    const sessionData = {
      cookies,
      loginDate: new Date().toISOString(),
      email: typeof email === 'string' ? email.replace(/(.{2}).+(@.+)/, '$1***$2') : email,
    };
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(SESSION_FILE, JSON.stringify(sessionData, null, 2), 'utf8');
    console.log(`[OlxSession] Session saved to ${SESSION_FILE}`);
  }

  static getCookies() {
    if (!existsSync(SESSION_FILE)) return null;
    try {
      const data = JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
      if (!data.cookies?.length) return null;

      const now = Date.now() / 1000;
      const valid = data.cookies.filter(c => !(c.expires && c.expires > 0 && c.expires < now));
      return valid.length > 0 ? valid : null;
    } catch {
      return null;
    }
  }

  static isValid() {
    if (!existsSync(SESSION_FILE)) {
      return { valid: false, cookieCount: 0, loginDate: null, expiresAt: null };
    }
    try {
      const data = JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
      const cookies = data.cookies || [];
      const now = Date.now() / 1000;

      const authCookies = cookies.filter(c =>
        ['session', 'auth', 'token', 'ssid'].some(k => c.name?.toLowerCase().includes(k))
      );
      const relevant = authCookies.length > 0 ? authCookies : cookies;
      const valid = relevant.filter(c => !(c.expires && c.expires > 0 && c.expires < now));

      const expiring = valid.filter(c => c.expires && c.expires > 0).sort((a, b) => a.expires - b.expires);

      return {
        valid: valid.length > 0,
        cookieCount: valid.length,
        loginDate: data.loginDate || null,
        expiresAt: expiring[0] ? new Date(expiring[0].expires * 1000).toISOString() : null,
      };
    } catch {
      return { valid: false, cookieCount: 0, loginDate: null, expiresAt: null };
    }
  }

  static clear() {
    if (existsSync(SESSION_FILE)) {
      unlinkSync(SESSION_FILE);
      console.log('[OlxSession] Session cleared');
    }
  }
}

module.exports = OlxSession;
