const mongoose = require('mongoose');

const KnowledgeEntrySchema = new mongoose.Schema({
  category: { type: String, required: true },
  key: { type: String, required: true },
  value: { type: String, required: true },
  tags: [String],
  availableTo: { type: String, default: 'all' },
  source: { type: String, default: 'manual' },
  updatedAt: { type: Date, default: Date.now }
});

KnowledgeEntrySchema.index({ key: 'text', value: 'text', category: 'text' });

module.exports = mongoose.model('KnowledgeEntry', KnowledgeEntrySchema);
