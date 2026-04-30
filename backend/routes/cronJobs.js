const router = require('express').Router();
const mongoose = require('mongoose');
const cronService = require('../cronService');

const CronJob = mongoose.model('CronJob');

router.get('/', async (req, res) => {
  try {
    const jobs = await cronService.listCronJobs();
    res.json(jobs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { name, cronExpression, actionType, actionPayload } = req.body;
    if (!name || !cronExpression || !actionType) {
      return res.status(400).json({ error: 'name, cronExpression, and actionType are required' });
    }
    const job = await cronService.createCronJob(name, cronExpression, actionType, actionPayload || {});
    res.status(201).json(job);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const job = await CronJob.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!job) return res.status(404).json({ error: 'Cron job not found' });
    res.json(job);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const job = await cronService.deleteCronJob(req.params.id);
    res.json({ message: 'Cron job deleted', job });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/pause', async (req, res) => {
  try {
    const job = await cronService.pauseCronJob(req.params.id);
    res.json({ message: 'Cron job paused', job });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/resume', async (req, res) => {
  try {
    const job = await cronService.resumeCronJob(req.params.id);
    res.json({ message: 'Cron job resumed', job });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id/logs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const logs = await cronService.getJobLogs(req.params.id, limit);
    res.json(logs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/logs/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 30;
    const logs = await cronService.getRecentLogs(limit);
    res.json(logs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
