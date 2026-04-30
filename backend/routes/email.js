const router = require('express').Router();
const mongoose = require('mongoose');
const emailService = require('../emailService');
const emailAgent = require('../emailAgentService');
const linkProcessor = require('../linkProcessorService');

const EmailThread = mongoose.model('EmailThread');
const EmailAgentConfig = mongoose.model('EmailAgentConfig');
const ProductResume = mongoose.model('ProductResume');

// Inboxes
router.get('/inboxes', async (req, res) => {
  try { const inboxes = await emailService.listInboxes(); res.json(inboxes); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/inboxes', async (req, res) => {
  try { const inbox = await emailService.createInbox(req.body); res.status(201).json(inbox); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/inboxes/:inboxId', async (req, res) => {
  try { const inbox = await emailService.getInbox(req.params.inboxId); res.json(inbox); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/inboxes/:inboxId', async (req, res) => {
  try { await emailService.deleteInbox(req.params.inboxId); res.json({ message: 'Inbox deleted' }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/inboxes/:inboxId', async (req, res) => {
  try { const result = await emailService.updateInbox(req.params.inboxId, req.body); res.json(result); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Messages
router.get('/inboxes/:inboxId/messages', async (req, res) => {
  try {
    const result = await emailService.listMessages(req.params.inboxId, {
      limit: parseInt(req.query.limit) || 20, pageToken: req.query.pageToken || undefined
    });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/inboxes/:inboxId/messages/:messageId', async (req, res) => {
  try { const msg = await emailService.getMessage(req.params.inboxId, req.params.messageId); res.json(msg); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/inboxes/:inboxId/send', async (req, res) => {
  try { const result = await emailService.sendEmail(req.params.inboxId, req.body); res.json(result); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/inboxes/:inboxId/messages/:messageId', async (req, res) => {
  try {
    await emailService.getInbox(req.params.inboxId);
    res.json({ success: true, messageId: req.params.messageId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Agent
router.delete('/agent/thread/:threadId', async (req, res) => {
  try { await EmailThread.findByIdAndDelete(req.params.threadId); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/agent/config/:inboxId', async (req, res) => {
  try {
    let config = await EmailAgentConfig.findOne({ inboxId: req.params.inboxId });
    if (!config) config = { inboxId: req.params.inboxId, enabled: false, persona: '', maxRepliesPerThread: 10, pollingInterval: 30000 };
    res.json({ ...config.toJSON ? config.toJSON() : config, isPolling: emailAgent.isPolling(req.params.inboxId) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/agent/config/:inboxId', async (req, res) => {
  try {
    const { persona, maxRepliesPerThread, pollingInterval } = req.body;
    const config = await EmailAgentConfig.findOneAndUpdate(
      { inboxId: req.params.inboxId },
      { persona, maxRepliesPerThread: maxRepliesPerThread || 10, pollingInterval: pollingInterval || 30000, updatedAt: Date.now() },
      { upsert: true, new: true }
    );
    if (config.enabled && emailAgent.isPolling(req.params.inboxId)) {
      emailAgent.stopPolling(req.params.inboxId);
      emailAgent.startPolling(req.params.inboxId, config);
    }
    res.json(config);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/agent/start/:inboxId', async (req, res) => {
  try {
    let config = await EmailAgentConfig.findOneAndUpdate(
      { inboxId: req.params.inboxId }, { enabled: true, updatedAt: Date.now() }, { upsert: true, new: true }
    );
    emailAgent.startPolling(req.params.inboxId, config);
    res.json({ message: 'Agent started', inboxId: req.params.inboxId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/agent/stop/:inboxId', async (req, res) => {
  try {
    await EmailAgentConfig.findOneAndUpdate({ inboxId: req.params.inboxId }, { enabled: false, updatedAt: Date.now() });
    emailAgent.stopPolling(req.params.inboxId);
    res.json({ message: 'Agent stopped', inboxId: req.params.inboxId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/agent/threads/:inboxId', async (req, res) => {
  try {
    const threads = await EmailThread.find({ inboxId: req.params.inboxId }).sort({ lastReplyAt: -1, createdAt: -1 }).limit(50);
    res.json(threads);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/agent/thread/:threadId', async (req, res) => {
  try {
    const thread = await EmailThread.findById(req.params.threadId);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    res.json(thread);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Products
router.get('/products', async (req, res) => {
  try { const products = await ProductResume.find().sort({ updatedAt: -1 }).limit(50); res.json(products); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/products/process', async (req, res) => {
  try {
    const { url, inboxId } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    const result = await linkProcessor.processLink(url, { inboxId, force: req.body.force });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/products/:id', async (req, res) => {
  try { await ProductResume.findByIdAndDelete(req.params.id); res.json({ message: 'Deleted' }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
