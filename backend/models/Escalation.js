const mongoose = require('mongoose');

const EscalationSchema = new mongoose.Schema({
  reason: { type: String, required: true },
  context: String,
  chatHistory: [{ role: String, content: String }],
  sessionId: String,
  agentType: String,
  status: { type: String, enum: ['pending', 'handled'], default: 'pending' },
  priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Escalation', EscalationSchema);
