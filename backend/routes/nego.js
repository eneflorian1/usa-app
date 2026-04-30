/**
 * NegoApp routes — /api/nego/*
 *
 * Consolidates leads / missions / messages / config / batch / reveal /
 * strategy / OLX session endpoints into a single Express router.
 *
 * Backed by:
 *   - Mongoose models: NegoLead, NegoMission, NegoMessage, NegoConfig
 *   - Services: negoOrchestratorService, negotiationService
 *   - Scraping: scraping/{phoneRevealer, batchProcessor, categoryScraper,
 *               siteIntelligence, domainStrategy, proxyManager, olxSession}
 *
 * Notes:
 *   - No auth middleware (backend is single-user). Add later if multi-user.
 *   - Mission state lives in the orchestrator (in-memory). Persisted snapshots
 *     are written to NegoMission on completion/error/abort.
 *   - Batch + reveal use module-level singletons to enforce one-at-a-time.
 */
const router = require('express').Router();
const mongoose = require('mongoose');

const negotiationService = require('../negotiationService');
const PhoneRevealer = require('../scraping/phoneRevealer');
const BatchProcessor = require('../scraping/batchProcessor');
const CategoryScraper = require('../scraping/categoryScraper');
const SiteIntelligence = require('../scraping/siteIntelligence');
const OlxSession = require('../scraping/olxSession');
const { orchestrator, domainStrategy } = require('../negoSingleton');

const NegoLead = mongoose.model('NegoLead');
const NegoMission = mongoose.model('NegoMission');
const NegoMessage = mongoose.model('NegoMessage');
const NegoConfig = mongoose.model('NegoConfig');

// ─── Singletons ─────────────────────────────────────────────────────────────
const activeBatch = { processor: null, running: false };
const activeReveal = { running: false, result: null };

const newId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

// ─── Health ─────────────────────────────────────────────────────────────────
router.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// ─── Leads ──────────────────────────────────────────────────────────────────
router.get('/leads', async (req, res) => {
  try {
    const leads = await NegoLead.find({}).sort({ createdAt: -1 }).limit(500).lean();
    res.json(leads);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/leads/meta', async (req, res) => {
  try {
    const total = await NegoLead.countDocuments();
    const byStatus = await NegoLead.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
    res.json({ total, byStatus });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/leads/:id', async (req, res) => {
  try {
    const lead = await NegoLead.findOne({ id: req.params.id }).lean();
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json(lead);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/leads', async (req, res) => {
  try {
    const lead = { ...req.body, id: req.body.id || newId('lead'), createdAt: new Date().toISOString() };
    await NegoLead.updateOne({ id: lead.id }, { $set: lead }, { upsert: true });
    res.json(lead);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/leads/:id', async (req, res) => {
  try {
    await NegoLead.updateOne({ id: req.params.id }, { $set: req.body });
    const updated = await NegoLead.findOne({ id: req.params.id }).lean();
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/leads/:id', async (req, res) => {
  try {
    await NegoLead.deleteOne({ id: req.params.id });
    await NegoMessage.deleteMany({ leadId: req.params.id });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Messages (per lead) ────────────────────────────────────────────────────
router.get('/leads/:id/messages', async (req, res) => {
  try {
    const messages = await NegoMessage.find({ leadId: req.params.id }).sort({ timestamp: 1 }).lean();
    res.json(messages);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/messages/:leadId', async (req, res) => {
  try {
    const messages = await NegoMessage.find({ leadId: req.params.leadId }).sort({ timestamp: 1 }).lean();
    res.json(messages);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/leads/:id/messages', async (req, res) => {
  try {
    const lead = await NegoLead.findOne({ id: req.params.id });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const message = {
      id: newId('msg'),
      leadId: req.params.id,
      sender: req.body.sender || 'me',
      text: req.body.text,
      timestamp: new Date().toISOString(),
      ...req.body,
    };
    await NegoMessage.create(message);

    // Update lead's last message preview
    await NegoLead.updateOne({ id: req.params.id }, { $set: { lastMessage: message.text, lastContacted: message.timestamp } });

    res.json(message);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/leads/:id/messages', async (req, res) => {
  try {
    await NegoMessage.deleteMany({ leadId: req.params.id });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/conversations/:leadId', async (req, res) => {
  try {
    await NegoMessage.deleteMany({ leadId: req.params.leadId });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── AI chat for a lead (negotiation engine) ────────────────────────────────
router.post('/chat', async (req, res) => {
  try {
    const { leadId, channel = 'whatsapp', systemPrompt } = req.body;
    if (!leadId) return res.status(400).json({ error: 'leadId is required' });

    const lead = await NegoLead.findOne({ id: leadId }).lean();
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const messages = await NegoMessage.find({ leadId }).sort({ timestamp: 1 }).lean();
    const reply = await negotiationService.generateReply({ systemPrompt, lead, messages, channel });

    res.json({ reply });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/leads/:id/start-conversation', async (req, res) => {
  try {
    const lead = await NegoLead.findOne({ id: req.params.id }).lean();
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const reply = await negotiationService.generateFirstMessage({ lead, systemPrompt: req.body.systemPrompt });
    res.json({ reply });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Missions ───────────────────────────────────────────────────────────────
router.get('/missions', async (req, res) => {
  try {
    // Merge in-memory (running) with persisted (history)
    const persisted = await NegoMission.find({}).sort({ createdAt: -1 }).limit(200).lean();
    const inMemory = orchestrator.getAllMissions();
    const persistedIds = new Set(persisted.map(m => m.id));
    const merged = [...inMemory.filter(m => !persistedIds.has(m.id)), ...persisted];
    res.json(merged);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/missions/stats', async (req, res) => {
  try {
    const dbStats = await NegoMission.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
    res.json({ inMemory: orchestrator.getStats(), db: dbStats });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/missions/:id', async (req, res) => {
  try {
    const inMem = orchestrator.getMission(req.params.id);
    if (inMem) return res.json(inMem);
    const persisted = await NegoMission.findOne({ id: req.params.id }).lean();
    if (!persisted) return res.status(404).json({ error: 'Mission not found' });
    res.json(persisted);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/missions/:id/stop', (req, res) => {
  const stopped = orchestrator.stopMission(req.params.id);
  if (!stopped) return res.status(404).json({ error: 'Mission not found or already finished' });
  res.json({ ok: true });
});

router.delete('/missions/:id', async (req, res) => {
  try {
    orchestrator.deleteMission(req.params.id);
    await NegoMission.deleteOne({ id: req.params.id });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/missions', async (req, res) => {
  try {
    for (const m of orchestrator.getAllMissions()) orchestrator.deleteMission(m.id);
    await NegoMission.deleteMany({});
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Start a full mission (strategy → scrape → batch reveal)
router.post('/orchestrate/full', async (req, res) => {
  try {
    const { url, query, useProxy = false, maxPages = 2, maxListings = 50, maxReveals = 5 } = req.body;
    if (!url) return res.status(400).json({ error: 'url is required' });

    // Fire and forget — return immediately, client polls /missions/:id
    orchestrator.executeMission({ url, query, useProxy, maxPages, maxListings, maxReveals })
      .catch(err => console.error('[NegoRoutes] executeMission error:', err.message));

    // Grab the mission ID from the most recent in-memory mission
    setTimeout(() => {
      const all = orchestrator.getAllMissions();
      const created = all[0];
      res.json({ status: 'started', missionId: created?.id || null });
    }, 50);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Scraping primitives ────────────────────────────────────────────────────
router.post('/category/scrape', async (req, res) => {
  try {
    const { url, maxPages = 2, maxListings = 50 } = req.body;
    if (!url) return res.status(400).json({ error: 'url is required' });
    const scraper = new CategoryScraper();
    const result = await scraper.scrape(url, { maxPages, maxListings, headless: true });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/intelligence/discover', async (req, res) => {
  try {
    const { domain, listingUrl, categoryUrl } = req.body;
    if (!domain) return res.status(400).json({ error: 'domain is required' });
    const si = new SiteIntelligence();
    const strategy = await si.discover(domain, { listingUrl, categoryUrl, forceRediscover: true });
    res.json(strategy);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/strategies', (req, res) => {
  res.json(domainStrategy.listAll());
});

router.get('/strategy/:domain', (req, res) => {
  const s = domainStrategy.load(req.params.domain);
  if (!s) return res.status(404).json({ error: 'Strategy not found' });
  res.json(s);
});

// ─── Reveal (single) ────────────────────────────────────────────────────────
router.post('/reveal', async (req, res) => {
  if (activeReveal.running) {
    return res.status(429).json({ error: 'A reveal is already in progress. Please wait.' });
  }
  const { url, useProxy = false } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });

  activeReveal.running = true;
  activeReveal.result = null;
  try {
    console.log(`[NegoRoutes] Reveal: ${url}`);
    const revealer = new PhoneRevealer(useProxy ? null : null);
    const result = await revealer.revealPhone(url, { debugScreenshot: false });
    const domain = new URL(url).hostname.replace('www.', '');
    domainStrategy.updateSuccessRate(domain, result.success);
    activeReveal.result = result;
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    activeReveal.running = false;
  }
});

// ─── Batch processing ───────────────────────────────────────────────────────
router.post('/batch/start', async (req, res) => {
  try {
    const { listings, domain, useProxy = false, maxRevealsPerProxy = 3, delayMin = 15000, delayMax = 25000 } = req.body;
    if (!Array.isArray(listings) || listings.length === 0) {
      return res.status(400).json({ error: 'listings array is required' });
    }
    if (!domain) return res.status(400).json({ error: 'domain is required' });
    if (activeBatch.running) {
      return res.status(429).json({ error: 'A batch is already running. Stop it first.' });
    }

    const processor = new BatchProcessor(null, domainStrategy, {
      useProxy,
      maxRevealsPerProxy,
      delayBetweenRevealsMs: [delayMin, delayMax],
      retryFailedOnce: true,
    });

    activeBatch.processor = processor;
    activeBatch.running = true;

    processor.process(listings, { domain })
      .then(result => {
        activeBatch.running = false;
        console.log(`[NegoRoutes] Batch done: ${result.completed.length}/${result.totalListings}`);
      })
      .catch(err => {
        activeBatch.running = false;
        console.error(`[NegoRoutes] Batch error: ${err.message}`);
      });

    res.json({ status: 'started', total: listings.length, domain });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/batch/status', (req, res) => {
  if (!activeBatch.processor) return res.json({ running: false });
  res.json(activeBatch.processor.getProgress());
});

router.get('/batch/results', (req, res) => {
  if (!activeBatch.processor) return res.json({ results: [] });
  res.json({ results: activeBatch.processor.getResults() });
});

router.post('/batch/stop', (req, res) => {
  if (!activeBatch.processor || !activeBatch.running) return res.json({ message: 'No active batch.' });
  activeBatch.processor.stop();
  res.json({ message: 'Stop requested.' });
});

router.post('/batch/pause', (req, res) => {
  if (!activeBatch.processor || !activeBatch.running) return res.json({ message: 'No active batch.' });
  activeBatch.processor.pause();
  res.json({ message: 'Paused.' });
});

router.post('/batch/resume', (req, res) => {
  if (!activeBatch.processor) return res.json({ message: 'Nothing to resume.' });
  activeBatch.processor.resume();
  res.json({ message: 'Resumed.' });
});

// ─── Config (per-user, single 'default' user) ───────────────────────────────
router.get('/config', async (req, res) => {
  try {
    const cfg = await NegoConfig.findOne({ userId: 'default' }).lean();
    res.json(cfg?.data || {});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/config', async (req, res) => {
  try {
    await NegoConfig.updateOne(
      { userId: 'default' },
      { $set: { userId: 'default', data: req.body || {} } },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/config', async (req, res) => {
  try {
    await NegoConfig.updateOne(
      { userId: 'default' },
      { $set: { userId: 'default', data: req.body || {} } },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── OLX session ────────────────────────────────────────────────────────────
router.get('/session/olx/status', (req, res) => {
  res.json(OlxSession.isValid());
});

router.post('/session/olx/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await OlxSession.login(email, password);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/session/olx/import', (req, res) => {
  const { cookies } = req.body;
  if (!cookies) return res.status(400).json({ error: 'cookies string is required' });
  res.json(OlxSession.importCookies(cookies));
});

router.post('/session/olx/clear', (req, res) => {
  OlxSession.clear();
  res.json({ ok: true });
});

module.exports = router;
