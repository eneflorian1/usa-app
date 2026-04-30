const mongoose = require('mongoose');

const NegoMissionSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  userId: { type: String, index: true },
  mode: String,
  platform: String,
  url: String,
  query: String,
  useProxy: Boolean,
  status: { type: String, index: true },
  domain: String,
  strategy: String,
  results: [mongoose.Schema.Types.Mixed],
  leadsFound: { type: Number, default: 0 },
  leadsContacted: { type: Number, default: 0 },
  progress: { type: Number, default: 0 },
  summary: mongoose.Schema.Types.Mixed,
  createdAt: String,
  updatedAt: String,
}, { strict: false, timestamps: false, collection: 'nego_missions' });

module.exports = mongoose.model('NegoMission', NegoMissionSchema);
