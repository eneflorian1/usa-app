const router = require('express').Router();
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const { processOrchestratorMessage } = require('../orchestratorService');

const AgentChat = mongoose.model('AgentChat');
const OrchestratorMemory = mongoose.model('OrchestratorMemory');

// ── Session Management ─────────────────────────────────────────────────────

// List all sessions (for sidebar)
router.get('/sessions', async (req, res) => {
  try {
    const sessions = await AgentChat
      .find({ agentType: 'orchestrator' })
      .select('sessionId title createdAt updatedAt messages')
      .sort({ updatedAt: -1 })
      .lean();
    res.json(sessions.map(s => ({
      sessionId: s.sessionId,
      title: s.title || 'Conversație nouă',
      messageCount: s.messages?.length || 0,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create new session
router.post('/sessions', async (req, res) => {
  try {
    const sessionId = `orch-${uuidv4()}`;
    const chat = await AgentChat.create({
      sessionId,
      agentType: 'orchestrator',
      title: req.body.title || '',
      messages: [],
    });
    res.status(201).json({ sessionId: chat.sessionId, title: chat.title });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Rename session
router.patch('/sessions/:sessionId', async (req, res) => {
  try {
    const { title } = req.body;
    const chat = await AgentChat.findOneAndUpdate(
      { sessionId: req.params.sessionId },
      { title },
      { new: true }
    );
    if (!chat) return res.status(404).json({ error: 'Session not found' });
    res.json({ sessionId: chat.sessionId, title: chat.title });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete session
router.delete('/sessions/:sessionId', async (req, res) => {
  try {
    await AgentChat.deleteOne({ sessionId: req.params.sessionId });
    res.json({ message: 'Session deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Chat ──────────────────────────────────────────────────────────────────

router.post('/chat', async (req, res) => {
  try {
    const { message, sessionId, projectPath } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });
    const sid = sessionId || 'orchestrator-default';
    console.log('[Orchestrator Route] Processing:', message.substring(0, 50));
    const result = await processOrchestratorMessage(message, sid, { projectPath: projectPath || null });

    // Auto-set title from first user message
    const chat = await AgentChat.findOne({ sessionId: sid });
    if (chat && !chat.title && chat.messages.length <= 2) {
      const title = message.length > 60 ? message.substring(0, 57) + '...' : message;
      await AgentChat.updateOne({ sessionId: sid }, { title });
    }

    res.json(result);
  } catch (err) {
    console.error('[Orchestrator Route] Error:', err.message);
    // Gemini quota exhausted — return friendly reply instead of 500
    if (err.message?.includes('429') || err.message?.includes('quota')) {
      return res.json({
        agent: 'general',
        reply: 'Sistemul AI este temporar supraîncărcat (limita de cereri per minut/zi a fost atinsă). Te rog încearcă din nou în câteva secunde.',
        error: 'quota_exceeded'
      });
    }
    res.status(500).json({ error: err.message });
  }
});

router.get('/chat/history', async (req, res) => {
  try {
    const sid = req.query.sessionId || 'orchestrator-default';
    const chat = await AgentChat.findOne({ sessionId: sid });
    res.json(chat ? chat.messages : []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/chat/history', async (req, res) => {
  try {
    const sid = req.query.sessionId || 'orchestrator-default';
    await AgentChat.deleteOne({ sessionId: sid });
    res.json({ message: 'Orchestrator chat history cleared' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Memory ────────────────────────────────────────────────────────────────

router.get('/memory', async (req, res) => {
  try {
    const { category } = req.query;
    const filter = category ? { category } : {};
    const memories = await OrchestratorMemory.find(filter).sort({ updatedAt: -1 });
    res.json(memories);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/memory', async (req, res) => {
  try {
    const { category, content, key } = req.body;
    if (!content) return res.status(400).json({ error: 'content is required' });
    const mem = await OrchestratorMemory.create({
      category: category || 'general',
      key: key || '',
      content,
      source: 'manual',
    });
    res.status(201).json(mem);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/memory/:id', async (req, res) => {
  try {
    const { category, content, key } = req.body;
    const mem = await OrchestratorMemory.findByIdAndUpdate(
      req.params.id,
      { ...(category && { category }), ...(content && { content }), ...(key !== undefined && { key }), updatedAt: Date.now() },
      { new: true }
    );
    if (!mem) return res.status(404).json({ error: 'Memory not found' });
    res.json(mem);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/memory/:id', async (req, res) => {
  try {
    const mem = await OrchestratorMemory.findByIdAndDelete(req.params.id);
    if (!mem) return res.status(404).json({ error: 'Memory not found' });
    res.json({ message: 'Memory deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/memory', async (req, res) => {
  try {
    await OrchestratorMemory.deleteMany({});
    res.json({ message: 'All orchestrator memories cleared' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Cassandra semantic memory ─────────────────────────────────────────────

router.get('/cassandra-memory', async (req, res) => {
  try {
    const cassandraMem = require('../services/cassandra');
    if (!cassandraMem.isReady()) {
      return res.json({ ready: false, memories: [] });
    }
    const query = (req.query.q || '').toString().trim();
    const category = (req.query.category || '').toString().trim() || null;

    if (query) {
      const results = await cassandraMem.recallMemories(query, {
        topK: Number(req.query.limit) || 30,
        minScore: Number(req.query.minScore) || 0.4,
        category,
      });
      return res.json({ ready: true, mode: 'semantic', query, memories: results });
    }

    const rows = await cassandraMem.loadAllMemoriesWithEmbeddings(200);
    const memories = rows
      .filter(r => !category || String(r.category).toLowerCase() === category.toLowerCase())
      .map(r => ({
        category: r.category,
        key: r.key,
        value: r.value,
        confidence: r.confidence,
        updatedAt: r.updated_at,
      }))
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, Number(req.query.limit) || 100);
    res.json({ ready: true, mode: 'recent', memories });
  } catch (err) {
    console.error('[Orchestrator Route] Cassandra memory error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
