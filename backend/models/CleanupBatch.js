const mongoose = require('mongoose');

const CleanupBatchSchema = new mongoose.Schema({
  displacedObjects: [{ type: mongoose.Schema.Types.ObjectId, ref: 'DisplacedObject' }],
  status: { type: String, enum: ['pending', 'approved', 'dismissed'], default: 'pending' },
  notifiedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('CleanupBatch', CleanupBatchSchema);
