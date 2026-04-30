const mongoose = require('mongoose');

const EmailThreadSchema = new mongoose.Schema({
  inboxId: { type: String, required: true },
  threadKey: { type: String, required: true },
  senderEmail: { type: String, default: '' },
  subject: { type: String, default: '' },
  messages: [{
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, default: '' },
    messageId: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now }
  }],
  replyCount: { type: Number, default: 0 },
  status: { type: String, enum: ['active', 'paused', 'closed', 'max-replies'], default: 'active' },
  persona: { type: String, default: '' },
  lastReplyAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

EmailThreadSchema.index({ inboxId: 1, threadKey: 1 }, { unique: true });

module.exports = mongoose.model('EmailThread', EmailThreadSchema);
