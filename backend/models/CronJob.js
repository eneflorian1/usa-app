const mongoose = require('mongoose');

const CronJobSchema = new mongoose.Schema({
  name: { type: String, required: true },
  cronExpression: { type: String, required: true },
  actionType: { type: String, enum: ['notification', 'task', 'whatsapp', 'http'], required: true },
  actionPayload: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ['active', 'paused'], default: 'active' },
  lastRun: { type: Date, default: null },
  nextRun: { type: Date, default: null },
  runCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('CronJob', CronJobSchema);
