const router = require('express').Router();
const mongoose = require('mongoose');

const LocalExecCommand = mongoose.model('LocalExecCommand');

router.post('/queue', async (req, res) => {
  try {
    const { command, label, cwd } = req.body;
    if (!command) return res.status(400).json({ error: 'command is required' });
    const doc = await LocalExecCommand.create({ command, label: label || '', cwd: cwd || '' });
    console.log('[LocalExec] Queued:', command);
    res.status(201).json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/pending', async (req, res) => {
  try {
    const doc = await LocalExecCommand.findOneAndUpdate(
      { status: 'pending' }, { status: 'running', updatedAt: Date.now() }, { new: true, sort: { createdAt: 1 } }
    );
    if (!doc) return res.json(null);
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/result/:id', async (req, res) => {
  try {
    const { output, exitCode, status } = req.body;
    const doc = await LocalExecCommand.findByIdAndUpdate(
      req.params.id,
      { output: output || '', exitCode: exitCode ?? null, status: status || 'done', updatedAt: Date.now() },
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: 'Command not found' });
    console.log('[LocalExec] Result for', doc.command, '→ exit', exitCode);
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/history', async (req, res) => {
  try {
    const docs = await LocalExecCommand.find().sort({ createdAt: -1 }).limit(50);
    res.json(docs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const doc = await LocalExecCommand.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
