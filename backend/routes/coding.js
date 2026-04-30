const router = require('express').Router();
const mongoose = require('mongoose');
const codingAgent = require('../codingAgentService');
const codingLoopService = require('../codingLoopService');

const CodingSession = mongoose.model('CodingSession');
const ProjectMemory = mongoose.model('ProjectMemory');

router.post('/task', async (req, res) => {
  try {
    const { task, targetFiles, workDir, autoApply } = req.body;
    if (!task) return res.status(400).json({ error: 'task description is required' });
    const result = await codingAgent.executeTask(task, { targetFiles, workDir, autoApply });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/analyze', async (req, res) => {
  try {
    const { files, workDir, question } = req.body;
    if (!files || !Array.isArray(files)) return res.status(400).json({ error: 'files array is required' });
    const result = await codingAgent.analyzeCode(files, workDir, question);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/review', async (req, res) => {
  try {
    const { owner, repo, pr } = req.body;
    if (!owner || !repo || !pr) return res.status(400).json({ error: 'owner, repo, and pr are required' });
    const result = await codingAgent.reviewPR(owner, repo, pr);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/task/:taskId', (req, res) => {
  const status = codingAgent.getTaskStatus(req.params.taskId);
  if (!status) return res.status(404).json({ error: 'Task not found' });
  res.json(status);
});

// Coding Loop
router.post('/start', async (req, res) => {
  try {
    const { task, projectPath, projectName } = req.body;
    if (!task || !projectPath) return res.status(400).json({ error: 'task and projectPath are required' });
    const session = await CodingSession.create({
      task, projectPath, projectName: projectName || projectPath.split(/[/\\]/).pop()
    });
    codingLoopService.runCodingLoop(task, projectPath, session._id.toString()).catch(err => {
      console.error('[CodingLoop] Fatal error:', err.message);
    });
    res.status(201).json(session);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/sessions', async (req, res) => {
  try {
    const sessions = await CodingSession.find().sort({ createdAt: -1 }).limit(20).select('-steps');
    res.json(sessions);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/sessions/:id', async (req, res) => {
  try {
    const session = await CodingSession.findById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Not found' });
    res.json(session);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// SSE stream
router.get('/sessions/:id/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let lastStepCount = 0;
  const interval = setInterval(async () => {
    try {
      const session = await CodingSession.findById(req.params.id);
      if (!session) { clearInterval(interval); res.end(); return; }
      if (session.steps.length > lastStepCount) {
        const newSteps = session.steps.slice(lastStepCount);
        for (const step of newSteps) res.write(`data: ${JSON.stringify(step)}\n\n`);
        lastStepCount = session.steps.length;
      }
      if (session.status !== 'running') {
        res.write(`data: ${JSON.stringify({ type: 'done', status: session.status, summary: session.summary })}\n\n`);
        clearInterval(interval);
        res.end();
      }
    } catch { clearInterval(interval); res.end(); }
  }, 2000);

  req.on('close', () => clearInterval(interval));
});

// Project Memory
router.get('/memory/:project', async (req, res) => {
  try {
    const mem = await ProjectMemory.findOne({ projectName: req.params.project });
    res.json(mem || {});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/memory/:project', async (req, res) => {
  try {
    const mem = await ProjectMemory.findOneAndUpdate(
      { projectName: req.params.project },
      { ...req.body, updatedAt: Date.now() },
      { new: true, upsert: true }
    );
    res.json(mem);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/projects', async (req, res) => {
  try {
    const memories = await ProjectMemory.find().select('projectName projectPath techStack updatedAt');
    res.json(memories);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
