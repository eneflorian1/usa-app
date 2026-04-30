const mongoose = require('mongoose');

const NegoMessageSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  userId: { type: String, index: true },
  leadId: { type: String, index: true },
  sender: String,
  text: String,
  timestamp: String,
  channel: { type: String, index: true },
  from: String,
  to: String,
  subject: String,
  emailMessageId: String,
}, { strict: false, timestamps: false, collection: 'nego_messages' });

NegoMessageSchema.index({ leadId: 1, timestamp: -1 });

module.exports = mongoose.model('NegoMessage', NegoMessageSchema);
