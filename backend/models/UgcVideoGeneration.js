const mongoose = require('mongoose');

const UgcVideoGenerationSchema = new mongoose.Schema({
  prompt: { type: String, required: true },
  referenceImageIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'UgcReferenceImage' }],
  analysis: { type: String, default: '' },
  videoPrompt: { type: String, default: '' },
  videoFilename: { type: String, default: '' },
  description: { type: String, default: '' },
  aspectRatio: { type: String, default: '16:9' },
  duration: { type: String, default: '8' },
  status: { type: String, enum: ['pending', 'analyzing', 'generating', 'completed', 'failed'], default: 'pending' },
  error: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('UgcVideoGeneration', UgcVideoGenerationSchema);
