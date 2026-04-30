const router = require('express').Router();
const mongoose = require('mongoose');
const { processOrchestratorMessage } = require('../orchestratorService');

const AgentChat = mongoose.model('AgentChat');
const OrchestratorMemory = mongoose.model('OrchestratorMemory');

router.post('/chat', async (req, res) => {
  try {
    const { message, sessionId, projectPath } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });
    console.log('[Orchestrator Route] Processing:', message.substring(0, 50));
    const result = await processOrchestratorMessage(
      message,
      sessionId || 'orchestrator-default',
      { projectPath: projectPath || null }
    );
    res.json(result);
  } catch (err) {
    console.error('[Orchestrator Route] Error:', err.message, err.stack);
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

// Memory
router.get('/memory', async (req, res) => {
  try {
    const memories = await OrchestratorMemory.find().sort({ updatedAt: -1 });
    res.json(memories);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/memory', async (req, res) => {
  try {
    const { category, content } = req.body;
    if (!content) return res.status(400).json({ error: 'content is required' });
    const mem = await OrchestratorMemory.create({ category: category || 'general', content, source: 'manual' });
    res.status(201).json(mem);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/memory/:id', async (req, res) => {
  try {
    const mem = await OrchestratorMemory.findByIdAndDelete(req.params.id);
    if (!mem) return res.status(404).json({ error: 'Memory not found' });
    res.json({ message: 'Memory deleted', memory: mem });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/memory', async (req, res) => {
  try {
    await OrchestratorMemory.deleteMany({});
    res.json({ message: 'All orchestrator memories cleared' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Cassandra semantic memory — read-only viewer for consolidated long-term memory
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
