const router = require('express').Router();
const mongoose = require('mongoose');
const { learnObject, approveBatch, dismissBatch } = require('../objectTrackingService');

const HouseObject = mongoose.model('HouseObject');
const DisplacedObject = mongoose.model('DisplacedObject');
const CleanupBatch = mongoose.model('CleanupBatch');

router.get('/house-objects', async (req, res) => {
  try {
    const objects = await HouseObject.find().sort({ lastSeen: -1 });
    res.json(objects);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/house-objects', async (req, res) => {
  try {
    const { name, description, expectedLocation, imageDescription } = req.body;
    if (!name || !expectedLocation) return res.status(400).json({ error: 'name and expectedLocation are required' });
    const result = await learnObject(name, description || '', expectedLocation, imageDescription || '');
    res.status(201).json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/house-objects/:id', async (req, res) => {
  try {
    const obj = await HouseObject.findByIdAndUpdate(req.params.id, { ...req.body, lastSeen: Date.now() }, { new: true });
    if (!obj) return res.status(404).json({ error: 'Object not found' });
    res.json(obj);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/house-objects/:id', async (req, res) => {
  try {
    const obj = await HouseObject.findByIdAndDelete(req.params.id);
    if (!obj) return res.status(404).json({ error: 'Object not found' });
    await DisplacedObject.deleteMany({ houseObjectId: req.params.id });
    res.json({ message: 'Object deleted', object: obj });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/displaced-objects', async (req, res) => {
  try {
    const status = req.query.status || 'pending';
    const displaced = await DisplacedObject.find({ status }).sort({ detectedAt: -1 });
    res.json(displaced);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/displaced-objects/:id/resolve', async (req, res) => {
  try {
    const d = await DisplacedObject.findByIdAndUpdate(req.params.id, { status: 'resolved' }, { new: true });
    if (!d) return res.status(404).json({ error: 'Not found' });
    res.json(d);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/cleanup-batches', async (req, res) => {
  try {
    const batches = await CleanupBatch.find().populate('displacedObjects').sort({ notifiedAt: -1 });
    res.json(batches);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/cleanup-batches/pending', async (req, res) => {
  try {
    const batch = await CleanupBatch.findOne({ status: 'pending' }).populate('displacedObjects');
    res.json(batch);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/cleanup-batches/:id/approve', async (req, res) => {
  try {
    const result = await approveBatch(req.params.id);
    res.json({ message: `Created ${result.tasks.length} tasks`, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/cleanup-batches/:id/dismiss', async (req, res) => {
  try {
    const batch = await dismissBatch(req.params.id);
    res.json({ message: 'Batch dismissed', batch });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
