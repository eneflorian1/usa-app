const mongoose = require('mongoose');

const ConversationSchema = new mongoose.Schema({
  phoneNumber: { type: String, unique: true },
  messages: [{
    role: { type: String, enum: ['user', 'model'] },
    content: String,
    timestamp: { type: Date, default: Date.now }
  }],
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Conversation', ConversationSchema);
