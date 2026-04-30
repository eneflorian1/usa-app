const mongoose = require('mongoose');

const EmailAgentConfigSchema = new mongoose.Schema({
  inboxId: { type: String, required: true, unique: true },
  enabled: { type: Boolean, default: false },
  persona: { type: String, default: '' },
  maxRepliesPerThread: { type: Number, default: 10 },
  pollingInterval: { type: Number, default: 30000 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('EmailAgentConfig', EmailAgentConfigSchema);
