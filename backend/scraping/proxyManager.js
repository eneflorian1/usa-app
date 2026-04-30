/**
 * ProxyManager — rotates through a pool of HTTP(S) proxies, tracking
 * usage and cooldowns. Ported from NegoApp/src/scraper/proxy-manager.js
 * (ESM → CommonJS, no behavioural changes).
 */
class ProxyManager {
  constructor(proxies = []) {
    this.proxies = proxies.map((p, i) => ({
      ...p,
      id: i,
      usageCount: 0,
      lastUsed: null,
      blocked: false,
    }));
    this.currentIndex = 0;
  }

  /** Build a proxy pool from a VPS host with N consecutive ports. */
  static fromVPS(host, startPort, count) {
    const proxies = [];
    for (let i = 0; i < count; i++) {
      proxies.push({
        host,
        port: startPort + i,
        protocol: 'http',
        url: `http://${host}:${startPort + i}`,
      });
    }
    return new ProxyManager(proxies);
  }

  /** Round-robin pick of the least-recently-used unblocked proxy. */
  getNext() {
    const available = this.proxies.filter(p => !p.blocked);
    if (available.length === 0) throw new Error('All proxies are blocked. Wait for cooldown.');

    available.sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0));
    const proxy = available[0];
    proxy.usageCount++;
    proxy.lastUsed = Date.now();
    return proxy;
  }

  getByIndex(index) {
    return this.proxies[index];
  }

  getRandom() {
    const available = this.proxies.filter(p => !p.blocked);
    if (available.length === 0) throw new Error('All proxies are blocked.');
    const idx = Math.floor(Math.random() * available.length);
    const proxy = available[idx];
    proxy.usageCount++;
    proxy.lastUsed = Date.now();
    return proxy;
  }

  /** Mark a proxy as blocked for `cooldownMs` (default 1h). */
  markBlocked(proxyId, cooldownMs = 3600000) {
    const proxy = this.proxies.find(p => p.id === proxyId);
    if (proxy) {
      proxy.blocked = true;
      setTimeout(() => { proxy.blocked = false; }, cooldownMs);
    }
  }

  getStats() {
    return this.proxies.map(p => ({
      id: p.id,
      url: p.url,
      usageCount: p.usageCount,
      lastUsed: p.lastUsed ? new Date(p.lastUsed).toISOString() : 'never',
      blocked: p.blocked,
    }));
  }

  get availableCount() {
    return this.proxies.filter(p => !p.blocked).length;
  }

  get totalCount() {
    return this.proxies.length;
  }
}

module.exports = ProxyManager;
