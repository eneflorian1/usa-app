/**
 * NegoOrchestratorService — coordinates the scraping pipeline.
 * Ported from NegoApp/src/core/agent-orchestrator.js (ESM → CommonJS).
 *
 * Flow:
 *   1. DomainStrategy.load(domain) → cached? use it : SiteIntelligence.discover()
 *   2. CategoryScraper.scrape(categoryUrl, strategy) → [url1, url2, ..., urlN]
 *   3. BatchProcessor.process(urls, { proxyManager, strategy }) → [{ phone, listing }]
 *   4. (Future) NegotiationEngine.startNegotiation(bestDeals)
 *
 * Mission state is held in-memory (Map) per process. Routes are responsible
 * for persisting missions to MongoDB via the NegoMission model.
 */
const DomainStrategy = require('./scraping/domainStrategy');
const SiteIntelligence = require('./scraping/siteIntelligence');
const CategoryScraper = require('./scraping/categoryScraper');
const BatchProcessor = require('./scraping/batchProcessor');
const PhoneRevealer = require('./scraping/phoneRevealer');
const GeminiAdapter = require('./scraping/geminiAdapter');

class NegoOrchestratorService {
  constructor({ proxyManager, geminiClient } = {}) {
    this.proxyManager = proxyManager || null;
    this.gemini = geminiClient || new GeminiAdapter();
    this.domainStrategy = new DomainStrategy();
    this.siteIntelligence = new SiteIntelligence({
      geminiClient: this.gemini,
      domainStrategy: this.domainStrategy,
      proxyManager: this.proxyManager,
    });
    this.categoryScraper = new CategoryScraper({
      domainStrategy: this.domainStrategy,
      siteIntelligence: this.siteIntelligence,
      proxyManager: this.proxyManager,
    });

    this.missions = new Map();
    this.activeControllers = new Map(); // missionId -> { scraper, processor, shouldAbort }
    this._handlers = {};
  }

  async executeMission(params) {
    const {
      url,
      query = '',
      domain: forceDomain,
      useProxy = false,
      maxPages = 2,
      maxListings = 50,
      maxReveals = 5,
      batchOptions = {},
      personality = 'diplomat',
      onPhoneRevealed = null,
      geminiClient = null,
    } = params;

    const activeGemini = geminiClient || this.gemini;
    const activeSiteIntelligence = geminiClient
      ? new SiteIntelligence({ geminiClient: activeGemini, domainStrategy: this.domainStrategy, proxyManager: this.proxyManager })
      : this.siteIntelligence;

    const urlObj = new URL(url);
    const domain = forceDomain || urlObj.hostname.replace('www.', '');

    const missionId = `mission-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const mission = {
      id: missionId,
      url,
      query,
      domain,
      useProxy,
      status: 'initializing',
      phases: {},
      steps: [],
      listings: [],
      reveals: [],
      phones: [],
      personality,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.missions.set(missionId, mission);
    this._emit('mission:started', mission);

    try {
      // ─── PHASE 1: Ensure domain strategy exists ────────────────────────
      let strategy = this.domainStrategy.load(domain);

      if (!strategy) {
        if (this._isAborted(missionId)) return;
        this._step(mission, 'strategy', `No cached strategy. Running AI discovery for ${domain}...`);
        mission.status = 'discovering';
        this._emit('mission:updated', mission);

        strategy = await activeSiteIntelligence.discover(domain, { categoryUrl: url });
        this._step(mission, 'strategy', `Strategy discovered for ${domain}`);
      }

      mission.phases.strategy = { status: 'done', version: strategy.version };

      // ─── PHASE 2: Category scraping ────────────────────────────────────
      if (this._isAborted(missionId)) return;
      this._step(mission, 'scraping', `Scraping: ${url}`);
      mission.status = 'scraping';
      this._emit('mission:updated', mission);

      const scraper = this.categoryScraper;
      this.activeControllers.set(missionId, { ...this.activeControllers.get(missionId), scraper });

      const scrapeResult = await scraper.scrape(url, {
        maxPages,
        maxListings,
        headless: true,
      });

      const listings = scrapeResult.listings || scrapeResult;
      mission.listings = listings;
      mission.phases.scraping = { status: 'done', count: listings.length, pagesScraped: scrapeResult.pagesScraped || 0 };
      this._step(mission, 'scraping', `Found ${listings.length} listings`);
      this._emit('mission:updated', mission);

      if (listings.length === 0) {
        mission.status = 'completed';
        mission.phases.scraping.note = 'No listings found';
        this._step(mission, 'complete', 'No listings found. Mission ended.');
        this._emit('mission:completed', mission);
        return mission;
      }

      // ─── PHASE 3: Batch phone reveal ───────────────────────────────────
      if (this._isAborted(missionId)) return;

      const toReveal = listings.slice(0, maxReveals);
      this._step(mission, 'revealing', `Revealing ${toReveal.length} phone numbers...`);
      mission.status = 'revealing';
      this._emit('mission:updated', mission);

      const batchProcessor = new BatchProcessor(
        useProxy ? this.proxyManager : null,
        this.domainStrategy,
        {
          useProxy,
          maxRevealsPerProxy: 3,
          delayBetweenRevealsMs: [15000, 25000],
          retryFailedOnce: true,
          ...batchOptions,
        }
      );

      this.activeControllers.set(missionId, { ...this.activeControllers.get(missionId), processor: batchProcessor });

      batchProcessor.on('batch:progress', (data) => {
        mission.phases.revealing = {
          status: 'running',
          progress: data.percentComplete,
          completed: data.completed,
          total: data.total,
          success: data.success,
        };
        this._emit('mission:updated', mission);
      });

      const batchResult = await batchProcessor.process(toReveal, {
        domain,
        onItemSuccess: onPhoneRevealed,
      });

      const phones = batchResult.completed.map(r => r.phone).filter(Boolean);
      const successCount = batchResult.completed.length;
      const totalCount = successCount + batchResult.failed.length;
      const successRate = totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 0;

      mission.reveals = batchResult.completed;
      mission.phones = phones;
      mission.phases.revealing = {
        status: 'done',
        total: totalCount,
        success: successCount,
        failed: batchResult.failed.length,
        successRate,
      };

      this._step(mission, 'revealing',
        `Reveal complete: ${successCount}/${totalCount} successful, ${phones.length} phones found`
      );

      // ─── PHASE 4: Results ──────────────────────────────────────────────
      mission.status = 'completed';
      mission.updatedAt = new Date().toISOString();

      mission.summary = {
        domain,
        listingsFound: listings.length,
        phonesRevealed: phones.length,
        successRate,
        phones,
        topListings: listings.slice(0, 10).map(l => ({
          title: l.title,
          price: l.price,
          url: l.url,
          location: l.location,
        })),
      };

      this._step(mission, 'complete',
        `Mission complete: ${listings.length} listings, ${phones.length} phones, ${successRate}% success rate`
      );

      this._emit('mission:completed', mission);
      this.activeControllers.delete(missionId);
      return mission;

    } catch (err) {
      if (mission.status === 'aborted') return mission;
      mission.status = 'error';
      mission.error = err.message;
      mission.updatedAt = new Date().toISOString();
      this._step(mission, 'error', `Mission failed: ${err.message}`);
      this._emit('mission:error', mission);
      this.activeControllers.delete(missionId);
      throw err;
    }
  }

  /**
   * Single-listing reveal (no category scraping).
   */
  async executeSingleReveal(params) {
    const { url, useProxy = false } = params;
    const urlObj = new URL(url);
    const domain = urlObj.hostname.replace('www.', '');

    let strategy = this.domainStrategy.load(domain);
    const singleGemini = params.geminiClient || this.gemini;
    if (!strategy && singleGemini.isAvailable) {
      const si = params.geminiClient
        ? new SiteIntelligence({ geminiClient: singleGemini, domainStrategy: this.domainStrategy, proxyManager: this.proxyManager })
        : this.siteIntelligence;
      strategy = await si.discover(domain, { listingUrl: url });
    }

    const revealer = new PhoneRevealer(useProxy ? this.proxyManager : null);
    const result = await revealer.revealPhone(url, { debugScreenshot: true });

    this.domainStrategy.updateSuccessRate(domain, result.success);
    return result;
  }

  // ─── Mission management ─────────────────────────────────────────────

  getMission(id) { return this.missions.get(id); }

  getAllMissions() {
    return Array.from(this.missions.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  getStats() {
    const all = this.getAllMissions();
    const completed = all.filter(m => m.status === 'completed');
    const running = all.filter(m => ['scraping', 'revealing', 'discovering'].includes(m.status));

    return {
      total: all.length,
      completed: completed.length,
      running: running.length,
      failed: all.filter(m => m.status === 'error').length,
      totalPhones: completed.reduce((sum, m) => sum + (m.phones?.length || 0), 0),
      totalListings: completed.reduce((sum, m) => sum + (m.listings?.length || 0), 0),
    };
  }

  stopMission(id) {
    const mission = this.getMission(id);
    if (!mission) return false;

    if (mission.status === 'completed' || mission.status === 'error' || mission.status === 'aborted') {
      return false;
    }

    console.log(`[NegoOrchestrator] Stopping mission: ${id}`);
    mission.status = 'aborted';

    const ctrl = this.activeControllers.get(id);
    if (ctrl) {
      ctrl.shouldAbort = true;
      if (ctrl.scraper) ctrl.scraper.stop();
      if (ctrl.processor) ctrl.processor.stop();
    }

    this._step(mission, 'aborted', 'Mission stopped by user');
    this._emit('mission:updated', mission);
    this.activeControllers.delete(id);
    return true;
  }

  deleteMission(id) {
    this.stopMission(id);
    return this.missions.delete(id);
  }

  _isAborted(id) {
    const mission = this.getMission(id);
    return mission && mission.status === 'aborted';
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  _step(mission, phase, message) {
    const step = { phase, message, timestamp: new Date().toISOString() };
    mission.steps.push(step);
    mission.updatedAt = new Date().toISOString();
    console.log(`[NegoOrchestrator] [${mission.id}] ${message}`);
    this._emit('mission:step', { missionId: mission.id, step });
  }

  // ─── Event system ──────────────────────────────────────────────────

  on(event, handler) {
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(handler);
    return this;
  }

  _emit(event, data) {
    for (const h of (this._handlers[event] || [])) {
      try { h(data); } catch (err) {
        console.error(`[NegoOrchestrator] Event handler error (${event}):`, err.message);
      }
    }
  }
}

module.exports = NegoOrchestratorService;
