const router = require('express').Router();
const mongoose = require('mongoose');
const { processAgentMessage } = require('../agentChatService');

const AgentConfig = mongoose.model('AgentConfig');
const AgentChat = mongoose.model('AgentChat');
const Conversation = mongoose.model('Conversation');

router.get('/config', async (req, res) => {
  try {
    let config = await AgentConfig.findOne();
    if (!config) config = await AgentConfig.create({});
    res.json(config);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/config', async (req, res) => {
  try {
    const { isActive, systemPrompt } = req.body;
    let config = await AgentConfig.findOne();
    if (config) {
      config.isActive = isActive !== undefined ? isActive : config.isActive;
      config.systemPrompt = systemPrompt !== undefined ? systemPrompt : config.systemPrompt;
      config.updatedAt = Date.now();
      await config.save();
    } else {
      config = await AgentConfig.create({ isActive, systemPrompt });
    }
    res.json(config);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/memory/clear', async (req, res) => {
  try {
    await Conversation.deleteMany({});
    res.json({ message: 'Agent memory cleared successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });
    const result = await processAgentMessage(message, sessionId || 'default');
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/chat/history', async (req, res) => {
  try {
    const sid = req.query.sessionId || 'default';
    const chat = await AgentChat.findOne({ sessionId: sid });
    res.json(chat ? chat.messages : []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/chat/history', async (req, res) => {
  try {
    const sid = req.query.sessionId || 'default';
    await AgentChat.deleteOne({ sessionId: sid });
    res.json({ message: 'Chat history cleared' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
