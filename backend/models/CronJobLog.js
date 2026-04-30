const mongoose = require('mongoose');

const CronJobLogSchema = new mongoose.Schema({
  cronJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'CronJob' },
  jobName: String,
  actionType: String,
  result: { type: String, enum: ['success', 'error'], default: 'success' },
  output: String,
  executedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('CronJobLog', CronJobLogSchema);
