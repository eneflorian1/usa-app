const mongoose = require('mongoose');

const NegoLeadSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  userId: { type: String, index: true },
  url: String,
  title: String,
  initialPrice: String,
  price: String,
  sellerName: String,
  phoneNumber: String,
  whatsappId: String,
  isSaved: Boolean,
  status: { type: String, index: true },
  platform: String,
  isBotActive: Boolean,
  channel: String,
  lastMessage: String,
  lastContacted: String,
  finalPrice: String,
  createdAt: String,
}, { strict: false, timestamps: false, collection: 'nego_leads' });

module.exports = mongoose.model('NegoLead', NegoLeadSchema);
