const router = require('express').Router();
const mongoose = require('mongoose');
const bountyHunter = require('../bountyHunterService');
const { createCronJob, deleteCronJob, listCronJobs } = require('../cronService');

// ─── GET state ────────────────────────────────────────────────────────────────
router.get('/state', async (req, res) => {
  try {
    const state = await bountyHunter.getState();
    res.json(state);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST start ───────────────────────────────────────────────────────────────
router.post('/start', async (req, res) => {
  try {
    const { githubToken, githubUser, skipDangerously } = req.body;
    const session = await bountyHunter.start({ githubToken, githubUser, skipDangerously });
    res.json(session);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST stop ────────────────────────────────────────────────────────────────
router.post('/stop', async (req, res) => {
  try {
    const result = await bountyHunter.stop();
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST refresh PR statuses ─────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  try {
    const state = await bountyHunter.refreshStatuses();
    res.json(state);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PATCH update config (token, user, skipDangerously, cronEnabled) ──────────
router.patch('/config', async (req, res) => {
  try {
    const { githubToken, githubUser, skipDangerously, cronEnabled, cronExpr } = req.body;
    const BountySession = mongoose.model('BountySession');
    let session = await BountySession.findOne().sort({ createdAt: -1 });
    if (!session) {
      session = await BountySession.create({ githubToken, githubUser, skipDangerously, cronEnabled, cronExpr });
    } else {
      const update = {};
      if (githubToken !== undefined) update.githubToken = githubToken;
      if (githubUser !== undefined) update.githubUser = githubUser;
      if (skipDangerously !== undefined) update.skipDangerously = skipDangerously;
      if (cronEnabled !== undefined) update.cronEnabled = cronEnabled;
      if (cronExpr !== undefined) update.cronExpr = cronExpr;
      await BountySession.updateOne({ _id: session._id }, { $set: update });
      session = await BountySession.findById(session._id);
    }

    // Sync cron job if cronEnabled or cronExpr changed
    if (cronEnabled !== undefined || cronExpr !== undefined) {
      try {
        const finalSession = await BountySession.findOne().sort({ createdAt: -1 }).lean();
        const CronJob = mongoose.model('CronJob');
        // Remove existing bounty-hunter cron first
        const existingJobs = await CronJob.find({ name: 'Bounty Hunter Auto-Run' });
        for (const j of existingJobs) {
          try { await deleteCronJob(j._id.toString()); } catch { }
        }
        // Re-create if enabled
        if (finalSession?.cronEnabled) {
          await createCronJob(
            'Bounty Hunter Auto-Run',
            finalSession.cronExpr || '0 */6 * * *',
            'bounty_hunt',
            { skipDangerously: finalSession.skipDangerously || false }
          );
        }
      } catch (cronErr) {
        console.warn('[BountyHunter] Cron sync error:', cronErr.message);
      }
    }

    res.json(session);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── DELETE clear logs ────────────────────────────────────────────────────────
router.delete('/logs', async (req, res) => {
  try {
    const BountySession = mongoose.model('BountySession');
    await BountySession.updateOne({}, { $set: { logs: [] } }, { sort: { createdAt: -1 } });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── SSE log stream ───────────────────────────────────────────────────────────
router.get('/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const BountySession = mongoose.model('BountySession');
  let lastLogCount = 0;
  let lastStatus = '';

  const interval = setInterval(async () => {
    try {
      const session = await BountySession.findOne().sort({ createdAt: -1 }).lean();
      if (!session) return;

      // Send new logs
      const logs = session.logs || [];
      if (logs.length > lastLogCount) {
        const newLogs = logs.slice(lastLogCount);
        for (const l of newLogs) {
          res.write(`data: ${JSON.stringify({ type: 'log', log: l })}\n\n`);
        }
        lastLogCount = logs.length;
      }

      // Send status if changed
      const status = session.status;
      if (status !== lastStatus) {
        res.write(`data: ${JSON.stringify({ type: 'status', status, currentIssue: session.currentIssue })}\n\n`);
        lastStatus = status;
      }
    } catch { }
  }, 1500);

  req.on('close', () => clearInterval(interval));
});

// ─── GET PR list ──────────────────────────────────────────────────────────────
router.get('/prs', async (req, res) => {
  try {
    const BountySession = mongoose.model('BountySession');
    const session = await BountySession.findOne().sort({ createdAt: -1 }).lean();
    if (!session) return res.json([]);
    res.json({
      prs: session.prs || [],
      totalEarned: session.totalEarned || 0,
      totalPending: session.totalPending || 0,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PATCH update single PR status ───────────────────────────────────────────
router.patch('/prs/:prNumber', async (req, res) => {
  try {
    const { status, notes } = req.body;
    const prNumber = parseInt(req.params.prNumber);
    const BountySession = mongoose.model('BountySession');
    const session = await BountySession.findOne().sort({ createdAt: -1 });
    if (!session) return res.status(404).json({ error: 'No session' });

    const pr = session.prs.find(p => p.prNumber === prNumber);
    if (!pr) return res.status(404).json({ error: 'PR not found' });
    if (status) pr.status = status;
    if (notes) pr.notes = notes;
    pr.updatedAt = new Date();

    await session.save();
    res.json(pr);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
