/**
 * BatchProcessor — processes multiple listings with proxy rotation and rate limiting.
 * Ported from NegoApp/src/scraper/batch-processor.js (ESM → CommonJS).
 *
 * Features:
 * - Rotates through proxies (max N reveals per proxy per session)
 * - Configurable delay between reveals
 * - Progress tracking via EventEmitter
 * - Resume capability: saves progress to disk, can continue after restart
 * - Respects platform rate limits from domain strategy
 */
const { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const PhoneRevealer = require('./phoneRevealer');
const DomainStrategy = require('./domainStrategy');

const PROGRESS_DIR = path.join(__dirname, '..', 'data', 'batch-progress');

class BatchProcessor extends EventEmitter {
  constructor(proxyManager, domainStrategy, options = {}) {
    super();
    this.proxyManager = proxyManager;
    this.domainStrategy = domainStrategy || new DomainStrategy();

    this.options = {
      maxRevealsPerProxy: options.maxRevealsPerProxy ?? 3,
      delayMinMs: options.delayMinMs ?? (options.delayBetweenRevealsMs?.[0] ?? 15000),
      delayMaxMs: options.delayMaxMs ?? (options.delayBetweenRevealsMs?.[1] ?? 25000),
      maxConcurrent: options.maxConcurrent ?? 1,
      useProxy: options.useProxy ?? true,
      headless: options.headless ?? true,
      debugScreenshots: options.debugScreenshots ?? false,
      retryFailedOnce: options.retryFailedOnce ?? false,
    };

    this.batchId = null;
    this.isRunning = false;
    this.isPaused = false;
    this.shouldAbort = false;
    this._lastResult = null;

    this.proxyUsage = new Map();

    if (!existsSync(PROGRESS_DIR)) {
      mkdirSync(PROGRESS_DIR, { recursive: true });
    }
  }

  async process(listings, batchOptions = {}) {
    if (this.isRunning) {
      throw new Error('Batch already running. Pause or abort before starting a new one.');
    }

    this.batchId = batchOptions.batchId || `batch-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    this.isRunning = true;
    this.isPaused = false;
    this.shouldAbort = false;
    this.proxyUsage.clear();

    const domain = batchOptions.domain || this._extractDomain(listings[0]?.url);
    const strategy = this.domainStrategy.load(domain);
    const maxListings = batchOptions.maxListings || listings.length;
    const toProcess = listings.slice(0, maxListings);

    const progress = this._loadProgress(this.batchId);
    const completedUrls = new Set(progress.completed.map(r => r.url));
    const remaining = toProcess.filter(l => !completedUrls.has(l.url));

    const result = {
      batchId: this.batchId,
      domain,
      totalListings: toProcess.length,
      completed: [...progress.completed],
      failed: [...progress.failed],
      skipped: [],
      startedAt: progress.startedAt || new Date().toISOString(),
      finishedAt: null,
      aborted: false,
    };

    this.emit('batch:start', {
      batchId: this.batchId,
      total: toProcess.length,
      remaining: remaining.length,
      resumed: progress.completed.length > 0,
    });

    console.log(`[Batch] Starting: ${toProcess.length} listings, delay ${this.options.delayMinMs / 1000}s-${this.options.delayMaxMs / 1000}s${this.options.useProxy ? `, ${this.proxyManager.availableCount} proxies` : ', direct'}`);

    let effectiveDelayMin = this.options.delayMinMs;
    let effectiveDelayMax = this.options.delayMaxMs;
    if (strategy?.rateLimit?.delayBetweenMs) {
      effectiveDelayMin = Math.max(effectiveDelayMin, strategy.rateLimit.delayBetweenMs);
      effectiveDelayMax = Math.max(effectiveDelayMax, strategy.rateLimit.delayBetweenMs * 1.5);
    }

    for (let i = 0; i < remaining.length; i++) {
      if (this.shouldAbort) {
        console.log(`[Batch] Aborted at ${i}/${remaining.length}`);
        result.aborted = true;
        break;
      }

      while (this.isPaused) {
        await this._sleep(1000);
        if (this.shouldAbort) break;
      }
      if (this.shouldAbort) {
        result.aborted = true;
        break;
      }

      const listing = remaining[i];
      const listingIndex = result.completed.length + result.failed.length + 1;
      const totalToProcess = toProcess.length;

      console.log(`[Batch] [${listingIndex}/${totalToProcess}] ${listing.title || listing.url}`);
      this.emit('batch:item_start', {
        batchId: this.batchId,
        index: listingIndex,
        total: totalToProcess,
        listing,
      });

      let proxy = null;
      if (this.options.useProxy) {
        proxy = this._getNextProxy();
        if (!proxy) {
          console.warn(`[Batch] No proxies available — skipping ${listing.url}`);
          result.skipped.push({ ...listing, reason: 'no_proxy_available' });
          this.emit('batch:item_skip', { batchId: this.batchId, listing, reason: 'no_proxy_available' });
          continue;
        }
      }

      try {
        const revealer = new PhoneRevealer(proxy ? { getRandom: () => proxy } : null);
        const revealResult = await revealer.revealPhone(listing.url, {
          headless: this.options.headless,
          debugScreenshot: this.options.debugScreenshots,
        });

        if (proxy) {
          const usage = (this.proxyUsage.get(proxy.id) || 0) + 1;
          this.proxyUsage.set(proxy.id, usage);
        }

        this.domainStrategy.updateSuccessRate(domain, revealResult.success);

        if (revealResult.success) {
          const item = {
            url: listing.url,
            title: listing.title || revealResult.listing?.title || null,
            price: listing.price || revealResult.listing?.price || null,
            phone: revealResult.phone,
            listing: revealResult.listing,
            proxy: revealResult.proxy,
            timing: revealResult.timing,
          };
          result.completed.push(item);
          console.log(`[Batch] ✅ ${revealResult.phone} — "${item.title}" (${revealResult.timing?.totalMs}ms)`);

          this.emit('batch:item_success', {
            batchId: this.batchId,
            index: listingIndex,
            total: totalToProcess,
            item,
          });

          if (batchOptions.onItemSuccess) {
            try {
              console.log(`[Batch] Running onItemSuccess callback for ${revealResult.phone}...`);
              await batchOptions.onItemSuccess(item);
              console.log(`[Batch] onItemSuccess callback finished.`);
            } catch (cbErr) {
              console.error(`[Batch] onItemSuccess callback error: ${cbErr.message}`);
            }
          }
        } else {
          const failItem = {
            url: listing.url,
            title: listing.title || null,
            error: revealResult.error,
            proxy: revealResult.proxy,
          };
          result.failed.push(failItem);
          console.log(`[Batch] ❌ Failed: ${revealResult.error}`);

          this.emit('batch:item_fail', {
            batchId: this.batchId,
            index: listingIndex,
            total: totalToProcess,
            item: failItem,
          });
        }
      } catch (err) {
        const failItem = { url: listing.url, title: listing.title || null, error: err.message };
        result.failed.push(failItem);
        console.error(`[Batch] ❌ Exception: ${err.message}`);

        this.emit('batch:item_fail', {
          batchId: this.batchId,
          index: listingIndex,
          total: totalToProcess,
          item: failItem,
        });
      }

      this._saveProgress(this.batchId, result);
      this._lastResult = result;

      this.emit('batch:progress', {
        batchId: this.batchId,
        processed: result.completed.length + result.failed.length,
        total: totalToProcess,
        successCount: result.completed.length,
        failCount: result.failed.length,
        percent: Math.round(((result.completed.length + result.failed.length) / totalToProcess) * 100),
      });

      if (i < remaining.length - 1 && !this.shouldAbort) {
        const delay = this._randomDelay(effectiveDelayMin, effectiveDelayMax);
        console.log(`[Batch] Next in ${(delay / 1000).toFixed(0)}s`);
        this.emit('batch:waiting', { batchId: this.batchId, delayMs: delay });

        const waited = await this._interruptibleSleep(delay);
        if (!waited) {
          if (this.shouldAbort) {
            result.aborted = true;
            break;
          }
        }
      }
    }

    result.finishedAt = new Date().toISOString();
    this._saveProgress(this.batchId, result);
    this.isRunning = false;

    const successRate = result.completed.length > 0
      ? Math.round((result.completed.length / (result.completed.length + result.failed.length)) * 100)
      : 0;

    console.log(`[Batch] Done: ${result.completed.length} OK, ${result.failed.length} failed (${successRate}%)${result.aborted ? ' — ABORTED' : ''}`);
    if (result.completed.length > 0) console.log(`[Batch] Phones: ${result.completed.map(r => r.phone).join(', ')}`);

    this.emit('batch:done', {
      batchId: this.batchId,
      completed: result.completed.length,
      failed: result.failed.length,
      skipped: result.skipped.length,
      successRate,
      aborted: result.aborted,
    });

    return result;
  }

  getProgress() {
    if (!this._lastResult) {
      return {
        running: this.isRunning,
        paused: this.isPaused,
        batchId: this.batchId,
        completed: 0,
        failed: 0,
        total: 0,
        percentComplete: 0,
        success: 0,
      };
    }
    const total = this._lastResult.totalListings || 0;
    const completed = (this._lastResult.completed?.length || 0) + (this._lastResult.failed?.length || 0);
    return {
      running: this.isRunning,
      paused: this.isPaused,
      batchId: this.batchId,
      completed: this._lastResult.completed?.length || 0,
      failed: this._lastResult.failed?.length || 0,
      total,
      percentComplete: total > 0 ? Math.round((completed / total) * 100) : 0,
      success: this._lastResult.completed?.length || 0,
    };
  }

  getResults() {
    return this._lastResult?.completed || [];
  }

  stop() {
    this.abort();
  }

  pause() {
    if (!this.isRunning) return;
    this.isPaused = true;
    console.log(`[Batch] Paused`);
    this.emit('batch:paused', { batchId: this.batchId });
  }

  resume() {
    if (!this.isPaused) return;
    this.isPaused = false;
    console.log(`[Batch] Resumed`);
    this.emit('batch:resumed', { batchId: this.batchId });
  }

  abort() {
    this.shouldAbort = true;
    this.isPaused = false;
    console.log(`[Batch] Abort requested`);
    this.emit('batch:abort_requested', { batchId: this.batchId });
  }

  async resumeBatch(batchId, originalListings, batchOptions = {}) {
    return this.process(originalListings, { ...batchOptions, batchId });
  }

  _getNextProxy() {
    const maxUsage = this.options.maxRevealsPerProxy;

    try {
      const available = [];
      for (let i = 0; i < this.proxyManager.totalCount; i++) {
        const proxy = this.proxyManager.getByIndex(i);
        if (!proxy || proxy.blocked) continue;
        const usage = this.proxyUsage.get(proxy.id) || 0;
        if (usage < maxUsage) {
          available.push(proxy);
        }
      }

      if (available.length === 0) {
        console.log(`[Batch] All proxies hit ${maxUsage} reveals — resetting counters`);
        this.proxyUsage.clear();
        return this.proxyManager.getNext();
      }

      available.sort((a, b) => (this.proxyUsage.get(a.id) || 0) - (this.proxyUsage.get(b.id) || 0));
      const chosen = available[0];
      chosen.lastUsed = Date.now();
      chosen.usageCount = (chosen.usageCount || 0) + 1;
      return chosen;
    } catch (err) {
      console.warn(`[Batch] Proxy selection error: ${err.message}`);
      return null;
    }
  }

  _saveProgress(batchId, result) {
    try {
      const file = path.join(PROGRESS_DIR, `${batchId}.json`);
      writeFileSync(file, JSON.stringify(result, null, 2));
    } catch (err) {
      console.warn(`[Batch] Failed to save progress: ${err.message}`);
    }
  }

  _loadProgress(batchId) {
    const file = path.join(PROGRESS_DIR, `${batchId}.json`);
    if (!existsSync(file)) {
      return { completed: [], failed: [], startedAt: null };
    }
    try {
      const data = JSON.parse(readFileSync(file, 'utf-8'));
      console.log(`[Batch] Resuming from saved progress: ${data.completed?.length || 0} completed, ${data.failed?.length || 0} failed`);
      return {
        completed: data.completed || [],
        failed: data.failed || [],
        startedAt: data.startedAt || null,
      };
    } catch {
      return { completed: [], failed: [], startedAt: null };
    }
  }

  static listSavedBatches() {
    if (!existsSync(PROGRESS_DIR)) return [];
    return readdirSync(PROGRESS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const data = JSON.parse(readFileSync(path.join(PROGRESS_DIR, f), 'utf-8'));
          return {
            batchId: data.batchId,
            domain: data.domain,
            completed: data.completed?.length || 0,
            failed: data.failed?.length || 0,
            total: data.totalListings || 0,
            startedAt: data.startedAt,
            finishedAt: data.finishedAt,
            aborted: data.aborted || false,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  _randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min)) + min;
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async _interruptibleSleep(totalMs) {
    const interval = 1000;
    let elapsed = 0;
    while (elapsed < totalMs) {
      if (this.shouldAbort || this.isPaused) return false;
      await this._sleep(Math.min(interval, totalMs - elapsed));
      elapsed += interval;
    }
    return true;
  }

  _extractDomain(url) {
    if (!url) return 'unknown';
    try {
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return 'unknown';
    }
  }
}

module.exports = BatchProcessor;
