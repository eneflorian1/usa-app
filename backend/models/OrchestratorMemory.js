const mongoose = require('mongoose');

const OrchestratorMemorySchema = new mongoose.Schema({
  category: { type: String, default: 'general' },
  content: { type: String, required: true },
  source: { type: String, default: 'orchestrator' },
  updatedAt: { type: Date, default: Date.now }
});

OrchestratorMemorySchema.index({ content: 'text', category: 'text' });

module.exports = mongoose.model('OrchestratorMemory', OrchestratorMemorySchema);
