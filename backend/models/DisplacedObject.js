const mongoose = require('mongoose');

const DisplacedObjectSchema = new mongoose.Schema({
  houseObjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'HouseObject', index: true },
  objectName: { type: String, required: true },
  expectedLocation: { type: String, required: true },
  foundLocation: { type: String, required: true },
  status: { type: String, enum: ['pending', 'added_to_calendar', 'resolved'], default: 'pending' },
  detectedAt: { type: Date, default: Date.now, index: true }
});

module.exports = mongoose.model('DisplacedObject', DisplacedObjectSchema);
