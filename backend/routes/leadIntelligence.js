const router = require('express').Router();
const { runLeadIntelligencePipeline, runBatchAnalysis } = require('../services/leadIntelligence');

// POST /api/lead-intelligence/analyze
// Body: { url, chatId, userId }
router.post('/analyze', async (req, res) => {
    const { url, chatId, userId } = req.body;
    if (!url) return res.status(400).json({ error: 'url is required' });

    try {
        const result = await runLeadIntelligencePipeline({ url, chatId, userId });
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('[LeadIntelligence] Pipeline error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/lead-intelligence/batch
// Body: { chatId, userId, limit }
router.post('/batch', async (req, res) => {
    const { chatId, userId, limit } = req.body;
    try {
        const result = await runBatchAnalysis({ chatId, userId, limit: limit || 10 });
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('[LeadIntelligence] Batch error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
