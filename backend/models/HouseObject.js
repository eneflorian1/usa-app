const mongoose = require('mongoose');

const HouseObjectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  expectedLocation: { type: String, required: true },
  imageDescription: { type: String, default: '' },
  embedding: { type: [Number], default: [] },
  lastSeen: { type: Date, default: Date.now },
  lastSeenLocation: { type: String, default: '' },
  timesDisplaced: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('HouseObject', HouseObjectSchema);
