const router = require('express').Router();
const mongoose = require('mongoose');
const webAgent = require('../webAgentService');

router.post('/run', async (req, res) => {
  try {
    const { task, startUrl } = req.body;
    if (!task) return res.status(400).json({ error: 'task description is required' });
    const session = await mongoose.model('WebAgentSession').create({
      task, status: 'running', startUrl: startUrl || ''
    });
    res.status(202).json({ sessionId: session._id, status: 'running', message: 'Task started' });
    webAgent.runTask(task, { startUrl, existingSessionId: session._id }).catch(err => {
      console.error('[WebAgent Route] Background task error:', err.message);
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/sessions', async (req, res) => {
  try {
    const sessions = await webAgent.listSessions(parseInt(req.query.limit) || 20);
    res.json(sessions);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/sessions/:id', async (req, res) => {
  try {
    const session = await webAgent.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/sessions/:id/stop', async (req, res) => {
  try {
    const result = await webAgent.stopSession(req.params.id);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
