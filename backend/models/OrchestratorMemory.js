const mongoose = require('mongoose');

const OrchestratorMemorySchema = new mongoose.Schema({
  key: { type: String, default: '' },
  category: { type: String, default: 'general' },
  content: { type: String, required: true },
  source: { type: String, default: 'orchestrator' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

OrchestratorMemorySchema.index({ content: 'text', category: 'text' });

module.exports = mongoose.model('OrchestratorMemory', OrchestratorMemorySchema);
