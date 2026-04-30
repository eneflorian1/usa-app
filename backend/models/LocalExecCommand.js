const mongoose = require('mongoose');

const LocalExecCommandSchema = new mongoose.Schema({
  command: { type: String, required: true },
  label: { type: String, default: '' },
  cwd: { type: String, default: '' },
  execType: { type: String, enum: ['shell', 'mcp'], default: 'shell' },
  mcpServer: { type: String, default: '' },
  mcpArgs: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ['pending', 'running', 'done', 'error'], default: 'pending' },
  output: { type: String, default: '' },
  exitCode: { type: Number, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('LocalExecCommand', LocalExecCommandSchema);
