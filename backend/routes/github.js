const router = require('express').Router();
const githubService = require('../githubService');
const ghIssues = require('../ghIssuesService');

// Issues
router.get('/issues/:owner/:repo', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const issues = await githubService.listIssues(owner, repo, {
      state: req.query.state, label: req.query.label,
      limit: req.query.limit ? parseInt(req.query.limit) : undefined
    });
    res.json(issues);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/issues/:owner/:repo', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const { title, body, labels } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const issue = await githubService.createIssue(owner, repo, title, body, labels);
    res.status(201).json(issue);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/issues/:owner/:repo/:number/close', async (req, res) => {
  try {
    const { owner, repo, number } = req.params;
    const result = await githubService.closeIssue(owner, repo, parseInt(number));
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Pull Requests
router.get('/prs/:owner/:repo', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const prs = await githubService.listPRs(owner, repo, {
      state: req.query.state, limit: req.query.limit ? parseInt(req.query.limit) : undefined
    });
    res.json(prs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/prs/:owner/:repo/:number', async (req, res) => {
  try {
    const { owner, repo, number } = req.params;
    const pr = await githubService.getPRStatus(owner, repo, parseInt(number));
    res.json(pr);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// CI
router.get('/ci/:owner/:repo', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const runs = await githubService.listCIRuns(owner, repo, {
      limit: req.query.limit ? parseInt(req.query.limit) : undefined, branch: req.query.branch
    });
    res.json(runs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Repo Info
router.get('/repo/:owner/:repo', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const info = await githubService.getRepoInfo(owner, repo);
    res.json(info);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Auto-fix
router.post('/analyze-issue/:owner/:repo/:number', async (req, res) => {
  try {
    const { owner, repo, number } = req.params;
    const result = await ghIssues.analyzeIssue(owner, repo, parseInt(number));
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/auto-fix/:owner/:repo/:number', async (req, res) => {
  try {
    const { owner, repo, number } = req.params;
    const { workDir, minConfidence } = req.body || {};
    const result = await ghIssues.autoFixIssue(owner, repo, parseInt(number), { workDir, minConfidence });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/batch-fix/:owner/:repo', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const { label, limit, workDir } = req.body || {};
    const result = await ghIssues.batchFixIssues(owner, repo, { label, limit, workDir });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
