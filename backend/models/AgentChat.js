const mongoose = require('mongoose');

const AgentChatSchema = new mongoose.Schema({
  sessionId: { type: String, default: 'default', index: true },
  title: { type: String, default: '' },
  agentType: { type: String, default: 'general' },
  userProfile: {
    name: String,
    phone: String,
    preferences: [String],
    notes: String
  },
  summary: { type: String, default: '' },
  messages: [{
    role: { type: String, enum: ['user', 'model'] },
    content: String,
    timestamp: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('AgentChat', AgentChatSchema);
