const mongoose = require('mongoose');

const CodingSessionSchema = new mongoose.Schema({
  task: { type: String, required: true },
  projectPath: { type: String, required: true },
  projectName: { type: String, default: '' },
  status: { type: String, enum: ['running', 'done', 'error'], default: 'running' },
  steps: [{
    step: Number,
    type: { type: String, enum: ['think', 'act', 'observe'] },
    tool: String,
    args: mongoose.Schema.Types.Mixed,
    result: String,
    timestamp: { type: Date, default: Date.now }
  }],
  summary: { type: String, default: '' },
  filesChanged: [String],
  createdAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null }
});

module.exports = mongoose.model('CodingSession', CodingSessionSchema);
