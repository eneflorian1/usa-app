const mongoose = require('mongoose');

const UgcProductSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  productImages: [{
    imageData: String,
    mimeType: { type: String, default: 'image/jpeg' },
    name: String,
    uploadedAt: { type: Date, default: Date.now }
  }],
  avatarImages: [{
    imageData: String,
    mimeType: { type: String, default: 'image/jpeg' },
    name: String,
    label: { type: String, default: '' },
    uploadedAt: { type: Date, default: Date.now }
  }],
  referenceImages: [{
    imageData: String,
    mimeType: { type: String, default: 'image/jpeg' },
    name: String,
    label: { type: String, default: '' },
    uploadedAt: { type: Date, default: Date.now }
  }],
  systemPrompt: { type: String, default: 'You have been given a brand\'s images. Create a visual guide that can be used to produce more visuals in the style of this brand.' },
  visualBible: { type: String, default: '' },
  visualBibleGeneratedAt: { type: Date, default: null },
  generations: [{
    prompt: String,
    resultFilename: String,
    status: { type: String, enum: ['pending', 'completed', 'failed', 'cancelled'], default: 'pending' },
    error: String,
    description: String,
    aspectRatio: { type: String, default: 'auto' },
    createdAt: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('UgcProduct', UgcProductSchema);
