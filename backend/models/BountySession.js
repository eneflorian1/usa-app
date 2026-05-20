const mongoose = require('mongoose');

const BountyPRSchema = new mongoose.Schema({
  repo: String,
  issueNumber: Number,
  issueTitle: String,
  prNumber: Number,
  prUrl: String,
  platform: { type: String, enum: ['algora', 'opire', 'issuehunt', 'other'], default: 'algora' },
  bountyAmount: Number,
  currency: { type: String, default: 'USD' },
  status: { type: String, enum: ['submitted', 'merged', 'closed', 'paid', 'competing'], default: 'submitted' },
  competitorPRs: { type: Number, default: 0 },
  submittedAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  notes: String,
});

const BountySessionSchema = new mongoose.Schema({
  status: { type: String, enum: ['idle', 'running', 'stopped', 'error'], default: 'idle' },
  skipDangerously: { type: Boolean, default: false },
  githubToken: String,
  githubUser: String,
  logs: [{ ts: { type: Date, default: Date.now }, level: { type: String, default: 'info' }, msg: String }],
  prs: [BountyPRSchema],
  currentIssue: String,
  totalEarned: { type: Number, default: 0 },
  totalPending: { type: Number, default: 0 },
  searchedRepos: [String],
  startedAt: Date,
  stoppedAt: Date,
  cronEnabled: { type: Boolean, default: false },
  cronExpr: { type: String, default: '0 */6 * * *' },
}, { timestamps: true });

mongoose.model('BountySession', BountySessionSchema);
mongoose.model('BountyPR', BountyPRSchema);
