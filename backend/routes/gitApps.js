const router = require('express').Router();
const mongoose = require('mongoose');
const gitAppsService = require('../gitAppsService');

const GitRepo = mongoose.model('GitRepo');
const GitRepoTask = mongoose.model('GitRepoTask');

router.get('/repos', async (req, res) => {
  try { const repos = await gitAppsService.list_repos(); res.json(repos); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/repos', async (req, res) => {
  try {
    const { name, description, isPrivate, localOnly, localPath } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (localOnly) {
      const repo = await GitRepo.create({
        name, description: description || '', isPrivate: isPrivate || false,
        localPath: localPath || '', status: localPath ? 'cloned' : 'remote_only', defaultBranch: 'main'
      });
      return res.json({ repo });
    }
    const result = await gitAppsService.create_repo(name, description || '', isPrivate || false);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/clone', async (req, res) => {
  try {
    const { cloneUrl, localPath, repoId } = req.body;
    if (!cloneUrl || !localPath) return res.status(400).json({ error: 'cloneUrl and localPath required' });
    const result = await gitAppsService.clone_repo(cloneUrl, localPath, repoId || null);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/repos/:id', async (req, res) => {
  try {
    const { alsoDeleteRemote } = req.query;
    const result = await gitAppsService.delete_repo(req.params.id, alsoDeleteRemote === 'true');
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/repos/:id/metadata', async (req, res) => {
  try { const result = await gitAppsService.repo_metadata(req.params.id); res.json(result); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/repos/:id/update', async (req, res) => {
  try { const result = await gitAppsService.update_repo(req.params.id); res.json(result); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/repos/:id/commit', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'commit message required' });
    const result = await gitAppsService.commit_changes(req.params.id, message);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/repos/:id/task', async (req, res) => {
  try {
    const { task } = req.body;
    if (!task) return res.status(400).json({ error: 'task is required' });
    const doc = await gitAppsService.run_task(req.params.id, task);
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/repos/:id/agent', async (req, res) => {
  try {
    const { task } = req.body;
    if (!task) return res.status(400).json({ error: 'task is required' });
    const doc = await gitAppsService.run_repo_agent(req.params.id, task);
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/repos/:id/update-code', async (req, res) => {
  try {
    const { task } = req.body;
    if (!task) return res.status(400).json({ error: 'task is required' });
    const doc = await gitAppsService.update_code_from_llm(req.params.id, task);
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/repos/:id/tasks', async (req, res) => {
  try {
    const tasks = await GitRepoTask.find({ repoId: req.params.id }).sort({ createdAt: -1 }).limit(50).lean();
    res.json(tasks);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/tasks/:taskId', async (req, res) => {
  try {
    const task = await GitRepoTask.findById(req.params.taskId).lean();
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/repos/:id', async (req, res) => {
  try {
    const allowed = ['name', 'description', 'localPath', 'language', 'defaultBranch'];
    const update = {};
    for (const key of allowed) { if (req.body[key] !== undefined) update[key] = req.body[key]; }
    update.updatedAt = new Date();
    const repo = await GitRepo.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!repo) return res.status(404).json({ error: 'Repo not found' });
    res.json(repo);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
