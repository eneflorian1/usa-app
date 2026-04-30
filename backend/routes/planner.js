const router = require('express').Router();
const mongoose = require('mongoose');
const { processPlannerMessage } = require('../plannerAgentService');

const PlannerTask = mongoose.model('PlannerTask');
const AgentChat = mongoose.model('AgentChat');

router.get('/tasks', async (req, res) => {
  try {
    let tasks = await PlannerTask.find({}).lean();
    const pMap = { high: 3, medium: 2, low: 1 };
    tasks.sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      const timeA = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const timeB = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      if (timeA !== timeB) return timeA - timeB;
      const pA = pMap[a.priority] || 0;
      const pB = pMap[b.priority] || 0;
      if (pA !== pB) return pB - pA;
      const curA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const curB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return curB - curA;
    });
    res.json(tasks);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/tasks', async (req, res) => {
  try {
    const { title, description, dueDate, priority } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const task = await PlannerTask.create({ title, description, dueDate, priority });
    res.status(201).json(task);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/tasks/:id', async (req, res) => {
  try {
    const task = await PlannerTask.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/tasks/:id', async (req, res) => {
  try {
    const task = await PlannerTask.findByIdAndDelete(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ message: 'Task deleted', task });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });
    const result = await processPlannerMessage(message, sessionId || 'planner-default');
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/chat/history', async (req, res) => {
  try {
    const sid = req.query.sessionId || 'planner-default';
    const chat = await AgentChat.findOne({ sessionId: sid });
    res.json(chat ? chat.messages : []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/chat/history', async (req, res) => {
  try {
    const sid = req.query.sessionId || 'planner-default';
    await AgentChat.deleteOne({ sessionId: sid });
    res.json({ message: 'Planner chat history cleared' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
