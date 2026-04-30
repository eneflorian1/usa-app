const mongoose = require('mongoose');

const UgcReferenceImageSchema = new mongoose.Schema({
  name: { type: String, required: true },
  imageData: { type: String, required: true },
  mimeType: { type: String, default: 'image/jpeg' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('UgcReferenceImage', UgcReferenceImageSchema);
