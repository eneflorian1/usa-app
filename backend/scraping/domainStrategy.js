/**
 * DomainStrategy — caches per-domain extraction strategies as JSON files.
 * Ported from NegoApp/src/scraper/domain-strategy.js (ESM → CommonJS).
 *
 * Storage: backend/data/strategies/<domain>.json
 */
const { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } = require('fs');
const path = require('path');

const STRATEGIES_DIR = path.join(__dirname, '..', 'data', 'strategies');

class DomainStrategy {
  constructor() {
    if (!existsSync(STRATEGIES_DIR)) {
      mkdirSync(STRATEGIES_DIR, { recursive: true });
    }
  }

  /** Load cached strategy for a domain, or null if missing/corrupt. */
  load(domain) {
    const filePath = path.join(STRATEGIES_DIR, `${domain}.json`);
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch (err) {
      console.error(`[DomainStrategy] Failed to load ${domain}:`, err.message);
      return null;
    }
  }

  save(domain, strategy) {
    const filePath = path.join(STRATEGIES_DIR, `${domain}.json`);
    strategy.lastUpdated = new Date().toISOString().split('T')[0];
    writeFileSync(filePath, JSON.stringify(strategy, null, 2));
    console.log(`[DomainStrategy] Saved strategy for ${domain}`);
  }

  /** Update success rate via exponential moving average; degrade if <50%. */
  updateSuccessRate(domain, success) {
    const strategy = this.load(domain);
    if (!strategy) return;

    const alpha = 0.1;
    strategy.successRate = (strategy.successRate || 0) * (1 - alpha) + (success ? 1 : 0) * alpha;

    if (strategy.successRate < 0.5) {
      strategy.status = 'degraded';
      console.warn(`[DomainStrategy] ${domain} degraded (success rate: ${(strategy.successRate * 100).toFixed(0)}%)`);
    }

    this.save(domain, strategy);
  }

  listAll() {
    if (!existsSync(STRATEGIES_DIR)) return [];
    const files = readdirSync(STRATEGIES_DIR).filter(f => f.endsWith('.json'));
    return files.map(f => {
      try {
        const data = JSON.parse(readFileSync(path.join(STRATEGIES_DIR, f), 'utf-8'));
        return {
          domain: data.domain,
          status: data.status || 'active',
          successRate: data.successRate,
          version: data.version,
          lastUpdated: data.lastUpdated,
        };
      } catch {
        return { domain: f.replace('.json', ''), status: 'error', successRate: 0 };
      }
    });
  }
}

module.exports = DomainStrategy;
