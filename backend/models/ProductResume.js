const mongoose = require('mongoose');

const ProductResumeSchema = new mongoose.Schema({
  url: { type: String, required: true, unique: true },
  title: { type: String, default: '' },
  type: { type: String, default: 'other' },
  price: { type: String, default: null },
  currency: { type: String, default: null },
  seller: { type: String, default: null },
  description: { type: String, default: '' },
  keyFeatures: [{ type: String }],
  negotiationNotes: { type: String, default: '' },
  category: { type: String, default: 'other' },
  location: { type: String, default: null },
  condition: { type: String, default: null },
  rawContent: { type: String, default: '' },
  inboxId: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ProductResume', ProductResumeSchema);
