const mongoose = require('mongoose');

const GitRepoSchema = new mongoose.Schema({
  name: { type: String, required: true },
  fullName: { type: String, default: '' },
  githubUrl: { type: String, default: '' },
  cloneUrl: { type: String, default: '' },
  description: { type: String, default: '' },
  isPrivate: { type: Boolean, default: false },
  language: { type: String, default: '' },
  localPath: { type: String, default: '' },
  status: { type: String, enum: ['remote_only', 'cloned', 'clone_error'], default: 'remote_only' },
  defaultBranch: { type: String, default: 'main' },
  lastTask: { type: String, default: '' },
  lastError: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('GitRepo', GitRepoSchema);
