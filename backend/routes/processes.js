const router = require('express').Router();
const processManager = require('../processManagerService');

router.get('/', (req, res) => {
  res.json(processManager.listProcesses());
});

router.post('/', (req, res) => {
  try {
    const { command, cwd, timeout, label } = req.body;
    if (!command) return res.status(400).json({ error: 'command is required' });
    const result = processManager.spawnProcess(command, { cwd, timeout, label });
    res.status(201).json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', (req, res) => {
  const proc = processManager.getProcess(req.params.id);
  if (!proc) return res.status(404).json({ error: 'Session not found' });
  res.json(proc);
});

router.get('/:id/log', (req, res) => {
  const tail = req.query.tail ? parseInt(req.query.tail) : 50;
  const log = processManager.getProcessLog(req.params.id, tail);
  if (!log) return res.status(404).json({ error: 'Session not found' });
  res.json(log);
});

router.post('/:id/input', (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });
    const result = processManager.sendInput(req.params.id, text);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', (req, res) => {
  try {
    const result = processManager.killProcess(req.params.id);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
