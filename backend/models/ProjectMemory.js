const mongoose = require('mongoose');

const ProjectMemorySchema = new mongoose.Schema({
  projectPath: { type: String, required: true, unique: true },
  projectName: { type: String, default: '' },
  techStack: { type: String, default: '' },
  structure: { type: String, default: '' },
  conventions: { type: String, default: '' },
  recentChanges: [{
    date: { type: Date, default: Date.now },
    summary: String,
    files: [String]
  }],
  knownIssues: [String],
  deployNotes: { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ProjectMemory', ProjectMemorySchema);
