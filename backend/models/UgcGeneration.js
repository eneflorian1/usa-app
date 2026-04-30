const mongoose = require('mongoose');

const UgcGenerationSchema = new mongoose.Schema({
  prompt: { type: String, required: true },
  referenceImageIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'UgcReferenceImage' }],
  resultFilename: { type: String, default: '' },
  resultImageData: { type: String, default: '' },
  description: { type: String, default: '' },
  aspectRatio: { type: String, default: 'auto' },
  resolution: { type: String, default: '1K' },
  status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
  error: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('UgcGeneration', UgcGenerationSchema);
