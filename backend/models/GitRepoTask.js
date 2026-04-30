const mongoose = require('mongoose');

const GitRepoTaskSchema = new mongoose.Schema({
  repoId: { type: mongoose.Schema.Types.ObjectId, ref: 'GitRepo', required: true, index: true },
  repoName: { type: String, default: '' },
  taskType: { type: String, enum: ['task', 'agent', 'llm_update', 'commit', 'pull'], default: 'task' },
  task: { type: String, required: true },
  status: { type: String, enum: ['running', 'done', 'error'], default: 'running' },
  output: { type: String, default: '' },
  summary: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null }
});

module.exports = mongoose.model('GitRepoTask', GitRepoTaskSchema);
