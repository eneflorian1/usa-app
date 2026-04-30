const mongoose = require('mongoose');

const GlassesMemorySchema = new mongoose.Schema({
  category: { type: String, default: 'general' },
  content: { type: String, required: true },
  importance: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  source: { type: String, default: 'glasses' },
  updatedAt: { type: Date, default: Date.now }
});

GlassesMemorySchema.index({ content: 'text', category: 'text' });

module.exports = mongoose.model('GlassesMemory', GlassesMemorySchema);
