const router = require('express').Router();
const mongoose = require('mongoose');
const { processGlassesRequest, validateGlassesToken, getRecentMemories, getAllMemories } = require('../glassesGatewayService');

const GlassesMemory = mongoose.model('GlassesMemory');

// OpenAI-compatible endpoint
router.post('/v1/chat/completions', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }
    const token = authHeader.substring(7);
    const valid = await validateGlassesToken(token);
    if (!valid) return res.status(401).json({ error: 'Invalid gateway token' });

    const { messages } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    const sessionKey = req.headers['x-openclaw-session-key'] || 'glasses-default';
    console.log(`[Glasses Gateway] Session: ${sessionKey}, Messages: ${messages.length}`);
    const result = await processGlassesRequest(messages, sessionKey);

    res.json({
      id: `glasses-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'glasses-gateway',
      choices: [{ index: 0, message: { role: 'assistant', content: result.content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    });
  } catch (err) {
    console.error('[Glasses Gateway] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/memories', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const memories = await getRecentMemories(limit);
    res.json(memories);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/memories', async (req, res) => {
  try {
    await GlassesMemory.deleteMany({});
    res.json({ message: 'All glasses memories cleared' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/memories/:id', async (req, res) => {
  try {
    const mem = await GlassesMemory.findByIdAndDelete(req.params.id);
    if (!mem) return res.status(404).json({ error: 'Memory not found' });
    res.json({ message: 'Memory deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/memories/export', async (req, res) => {
  try {
    const memories = await getAllMemories();
    res.json(memories);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/sync-from-vps', async (req, res) => {
  try {
    const { vpsUrl } = req.body;
    if (!vpsUrl) return res.status(400).json({ error: 'vpsUrl is required (e.g. http://155.117.45.192:5000)' });

    console.log(`[Glasses Sync] Fetching memories from ${vpsUrl}...`);
    const response = await fetch(`${vpsUrl}/api/glasses/memories/export`);
    if (!response.ok) throw new Error(`VPS returned ${response.status}: ${response.statusText}`);
    const vpsMemories = await response.json();

    if (!Array.isArray(vpsMemories) || vpsMemories.length === 0) {
      return res.json({ message: 'No memories on VPS to sync', synced: 0 });
    }

    let synced = 0, skipped = 0;
    for (const mem of vpsMemories) {
      const existing = await GlassesMemory.findOne({ content: mem.content });
      if (!existing) {
        await GlassesMemory.create({
          category: mem.category || 'general', content: mem.content,
          importance: mem.importance || 'medium', source: mem.source || 'vps-sync',
          updatedAt: mem.updatedAt || new Date()
        });
        synced++;
      } else { skipped++; }
    }

    console.log(`[Glasses Sync] Done: ${synced} synced, ${skipped} skipped (duplicates)`);
    res.json({ message: `Synced ${synced} memories from VPS`, synced, skipped, total: vpsMemories.length });
  } catch (err) {
    console.error('[Glasses Sync] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
