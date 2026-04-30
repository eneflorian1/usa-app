const mongoose = require('mongoose');

const NegoConfigSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, index: true },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true, collection: 'nego_configs' });

module.exports = mongoose.model('NegoConfig', NegoConfigSchema);
