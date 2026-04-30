const mongoose = require('mongoose');

const WebAgentSessionSchema = new mongoose.Schema({
  task: { type: String, required: true },
  status: { type: String, enum: ['running', 'completed', 'failed'], default: 'running' },
  startUrl: { type: String, default: '' },
  steps: [{
    stepNumber: Number,
    action: String,
    details: String,
    reasoning: String,
    screenshot: String,
    timestamp: { type: Date, default: Date.now }
  }],
  finalResult: { type: String, default: '' },
  finalScreenshot: { type: String, default: '' },
  error: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null }
});

module.exports = mongoose.model('WebAgentSession', WebAgentSessionSchema);
