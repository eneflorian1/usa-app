const router = require('express').Router();
const mongoose = require('mongoose');

const Escalation = mongoose.model('Escalation');

router.get('/', async (req, res) => {
  try {
    const escalations = await Escalation.find().sort({ createdAt: -1 });
    res.json(escalations);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const esc = await Escalation.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!esc) return res.status(404).json({ error: 'Escalation not found' });
    res.json(esc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
