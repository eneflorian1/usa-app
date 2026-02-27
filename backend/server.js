const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const { processAgentMessage } = require('./agentChatService');
const { processPlannerMessage } = require('./plannerAgentService');
const { processOrchestratorMessage } = require('./orchestratorService');
const { processGlassesRequest, validateGlassesToken, getRecentMemories, getAllMemories, saveMemory } = require('./glassesGatewayService');
const { learnObject, approveBatch, dismissBatch } = require('./objectTrackingService');
const githubService = require('./githubService');
const cronService = require('./cronService');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const whatsappService = require('./whatsappService');

// Connect to MongoDB
mongoose.connect('mongodb://127.0.0.1:27017/usa_db')
  .then(() => console.log('MongoDB connected successfully!'))
  .catch(err => console.error('MongoDB connection error:', err));

// Simple Mongoose Model
const ItemSchema = new mongoose.Schema({
  name: String,
  createdAt: { type: Date, default: Date.now }
});
const Item = mongoose.model('Item', ItemSchema);

const SettingSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  value: String,
  updatedAt: { type: Date, default: Date.now }
});
const Setting = mongoose.model('Setting', SettingSchema);

const AgentConfigSchema = new mongoose.Schema({
  isActive: { type: Boolean, default: true },
  systemPrompt: { type: String, default: 'Ești o persoană reală care vorbește pe WhatsApp cu o cunoștință. Răspunde cât mai natural, scurt și la obiect, folosind un ton relaxat, specific mesajelor pe telefon (poți să scrii ocazional fără majusculă la început de propoziție, ca oamenii reali). Nu menționa sub nicio formă că ești o inteligență artificială, un asistent sau un program. Nu te prezenta și nu te oferi să ajuți ca un asistent. Poți folosi expresii uzuale și emoji-uri, dar nu exagera. Comportă-te de parcă vă cunoașteți deja foarte bine, dar nu inventa și nu folosi niciun nume pentru a te adresa persoanei cu care vorbești. Menține conversația fluidă și firească, ținând cont de mesajele ei. Răspunde în limba în care ești abordat.' },
  updatedAt: { type: Date, default: Date.now }
});
const AgentConfig = mongoose.model('AgentConfig', AgentConfigSchema);

const ConversationSchema = new mongoose.Schema({
  phoneNumber: { type: String, unique: true },
  messages: [{
    role: { type: String, enum: ['user', 'model'] },
    content: String,
    timestamp: { type: Date, default: Date.now }
  }],
  updatedAt: { type: Date, default: Date.now }
});
const Conversation = mongoose.model('Conversation', ConversationSchema);

const BookingSchema = new mongoose.Schema({
  guestName: { type: String, required: true },
  checkIn: { type: Date, required: true },
  checkOut: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now }
});
const Booking = mongoose.model('Booking', BookingSchema);

const AgentChatSchema = new mongoose.Schema({
  sessionId: { type: String, default: 'default' },
  agentType: { type: String, default: 'general' },
  userProfile: {
    name: String,
    phone: String,
    preferences: [String],
    notes: String
  },
  summary: { type: String, default: '' },
  messages: [{
    role: { type: String, enum: ['user', 'model'] },
    content: String,
    timestamp: { type: Date, default: Date.now }
  }],
  updatedAt: { type: Date, default: Date.now }
});
const AgentChat = mongoose.model('AgentChat', AgentChatSchema);

const KnowledgeEntrySchema = new mongoose.Schema({
  category: { type: String, required: true },
  key: { type: String, required: true },
  value: { type: String, required: true },
  tags: [String],
  availableTo: { type: String, default: 'all' },
  source: { type: String, default: 'manual' },
  updatedAt: { type: Date, default: Date.now }
});
KnowledgeEntrySchema.index({ key: 'text', value: 'text', category: 'text' });
const KnowledgeEntry = mongoose.model('KnowledgeEntry', KnowledgeEntrySchema);

const EscalationSchema = new mongoose.Schema({
  reason: { type: String, required: true },
  context: String,
  chatHistory: [{ role: String, content: String }],
  sessionId: String,
  agentType: String,
  status: { type: String, enum: ['pending', 'handled'], default: 'pending' },
  priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
  createdAt: { type: Date, default: Date.now }
});
const Escalation = mongoose.model('Escalation', EscalationSchema);

const GlassesMemorySchema = new mongoose.Schema({
  category: { type: String, default: 'general' }, // observation, preference, fact, person, conversation
  content: { type: String, required: true },
  importance: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  source: { type: String, default: 'glasses' }, // glasses, manual, auto
  updatedAt: { type: Date, default: Date.now }
});
GlassesMemorySchema.index({ content: 'text', category: 'text' });
const GlassesMemory = mongoose.model('GlassesMemory', GlassesMemorySchema);

const PlannerTaskSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  dueDate: { type: Date, default: null },
  priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  completed: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const PlannerTask = mongoose.model('PlannerTask', PlannerTaskSchema);

const HouseObjectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  expectedLocation: { type: String, required: true },
  imageDescription: { type: String, default: '' },
  embedding: { type: [Number], default: [] },
  lastSeen: { type: Date, default: Date.now },
  lastSeenLocation: { type: String, default: '' },
  timesDisplaced: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
const HouseObject = mongoose.model('HouseObject', HouseObjectSchema);

const DisplacedObjectSchema = new mongoose.Schema({
  houseObjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'HouseObject' },
  objectName: { type: String, required: true },
  expectedLocation: { type: String, required: true },
  foundLocation: { type: String, required: true },
  status: { type: String, enum: ['pending', 'added_to_calendar', 'resolved'], default: 'pending' },
  detectedAt: { type: Date, default: Date.now }
});
const DisplacedObject = mongoose.model('DisplacedObject', DisplacedObjectSchema);

const CleanupBatchSchema = new mongoose.Schema({
  displacedObjects: [{ type: mongoose.Schema.Types.ObjectId, ref: 'DisplacedObject' }],
  status: { type: String, enum: ['pending', 'approved', 'dismissed'], default: 'pending' },
  notifiedAt: { type: Date, default: Date.now }
});
const CleanupBatch = mongoose.model('CleanupBatch', CleanupBatchSchema);

const CronJobSchema = new mongoose.Schema({
  name: { type: String, required: true },
  cronExpression: { type: String, required: true },
  actionType: { type: String, enum: ['notification', 'task', 'whatsapp', 'http'], required: true },
  actionPayload: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ['active', 'paused'], default: 'active' },
  lastRun: { type: Date, default: null },
  nextRun: { type: Date, default: null },
  runCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
const CronJob = mongoose.model('CronJob', CronJobSchema);

const CronJobLogSchema = new mongoose.Schema({
  cronJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'CronJob' },
  jobName: String,
  actionType: String,
  result: { type: String, enum: ['success', 'error'], default: 'success' },
  output: String,
  executedAt: { type: Date, default: Date.now }
});
const CronJobLog = mongoose.model('CronJobLog', CronJobLogSchema);

// API Routes
app.get('/api/agent/config', async (req, res) => {
  try {
    let config = await AgentConfig.findOne();
    if (!config) {
      config = await AgentConfig.create({});
    }
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agent/config', async (req, res) => {
  try {
    const { isActive, systemPrompt } = req.body;
    let config = await AgentConfig.findOne();
    if (config) {
      config.isActive = isActive !== undefined ? isActive : config.isActive;
      config.systemPrompt = systemPrompt !== undefined ? systemPrompt : config.systemPrompt;
      config.updatedAt = Date.now();
      await config.save();
    } else {
      config = await AgentConfig.create({ isActive, systemPrompt });
    }
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agent/memory/clear', async (req, res) => {
  try {
    await Conversation.deleteMany({});
    res.json({ message: 'Agent memory cleared successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Voice mode — return API key for direct browser-to-Gemini WebSocket
app.get('/api/voice/config', async (req, res) => {
  try {
    const setting = await Setting.findOne({ key: 'gemini_api_key' });
    if (!setting || !setting.value) {
      return res.status(400).json({ error: 'Gemini API key not configured' });
    }
    res.json({ apiKey: setting.value });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/settings/gemini', async (req, res) => {
  try {
    const setting = await Setting.findOne({ key: 'gemini_api_key' });
    if (!setting || !setting.value) {
      return res.json({ apiKey: null });
    }
    // Only send the last 10 characters
    const val = setting.value;
    const masked = val.length > 10 ? '...'.concat(val.slice(-10)) : val;
    res.json({ apiKey: masked });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings/gemini', async (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey) return res.status(400).json({ error: 'API Key is required' });

    await Setting.findOneAndUpdate(
      { key: 'gemini_api_key' },
      { value: apiKey, updatedAt: Date.now() },
      { upsert: true, new: true }
    );
    res.status(200).json({ message: 'API Key updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get('/api/status', (req, res) => {
  res.json({ status: 'Backend is running!', db: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected' });
});

app.get('/api/items', async (req, res) => {
  try {
    const items = await Item.find().sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/items', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const newItem = new Item({ name });
    await newItem.save();
    res.status(201).json(newItem);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Booking Routes
app.get('/api/bookings', async (req, res) => {
  try {
    const bookings = await Booking.find().sort({ checkIn: 1 });
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/bookings/:year/:month', async (req, res) => {
  try {
    const { year, month } = req.params;
    const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
    const endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59);
    const bookings = await Booking.find({
      $or: [
        { checkIn: { $gte: startDate, $lte: endDate } },
        { checkOut: { $gte: startDate, $lte: endDate } },
        { checkIn: { $lte: startDate }, checkOut: { $gte: endDate } }
      ]
    }).sort({ checkIn: 1 });
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bookings', async (req, res) => {
  try {
    const { guestName, checkIn, checkOut } = req.body;
    if (!guestName || !checkIn || !checkOut) {
      return res.status(400).json({ error: 'guestName, checkIn, and checkOut are required' });
    }
    const ciDate = new Date(checkIn);
    const coDate = new Date(checkOut);
    // Validate check-in hour (12-24)
    const ciHour = ciDate.getHours();
    if (ciHour < 12) {
      return res.status(400).json({ error: 'Check-in must be between 12:00 and 24:00' });
    }
    // Validate check-out hour (8-11)
    const coHour = coDate.getHours();
    if (coHour < 8 || coHour > 11) {
      return res.status(400).json({ error: 'Check-out must be between 08:00 and 11:00' });
    }
    // Check overlap
    const overlap = await Booking.findOne({
      $or: [
        { checkIn: { $lt: coDate }, checkOut: { $gt: ciDate } }
      ]
    });
    if (overlap) {
      return res.status(409).json({ error: 'This time slot overlaps with an existing booking', existingBooking: overlap });
    }
    const booking = await Booking.create({ guestName, checkIn: ciDate, checkOut: coDate });
    res.status(201).json(booking);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/bookings/:id', async (req, res) => {
  try {
    const booking = await Booking.findByIdAndDelete(req.params.id);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    res.json({ message: 'Booking cancelled', booking });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Agent Chat Routes
app.post('/api/agent/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });
    const sid = sessionId || 'default';
    const result = await processAgentMessage(message, sid);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/agent/chat/history', async (req, res) => {
  try {
    const sid = req.query.sessionId || 'default';
    const chat = await AgentChat.findOne({ sessionId: sid });
    res.json(chat ? chat.messages : []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/agent/chat/history', async (req, res) => {
  try {
    const sid = req.query.sessionId || 'default';
    await AgentChat.deleteOne({ sessionId: sid });
    res.json({ message: 'Chat history cleared' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// Knowledge Base Routes
app.get('/api/knowledge', async (req, res) => {
  try {
    const entries = await KnowledgeEntry.find().sort({ category: 1, key: 1 });
    res.json(entries);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/knowledge/search', async (req, res) => {
  try {
    const { q, category } = req.query;
    const { searchKnowledge } = require('./knowledgeService');
    const entries = await searchKnowledge(q, category);
    res.json(entries);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/knowledge', async (req, res) => {
  try {
    const entry = await KnowledgeEntry.create(req.body);
    res.status(201).json(entry);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/knowledge/bulk', async (req, res) => {
  try {
    const { entries } = req.body;
    if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries must be an array' });
    const created = await KnowledgeEntry.insertMany(entries);
    res.status(201).json({ count: created.length, entries: created });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/knowledge/:id', async (req, res) => {
  try {
    const entry = await KnowledgeEntry.findByIdAndUpdate(req.params.id, { ...req.body, updatedAt: Date.now() }, { new: true });
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    res.json(entry);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/knowledge/:id', async (req, res) => {
  try {
    const entry = await KnowledgeEntry.findByIdAndDelete(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    res.json({ message: 'Entry deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Escalation Routes
app.get('/api/escalations', async (req, res) => {
  try {
    const escalations = await Escalation.find().sort({ createdAt: -1 });
    res.json(escalations);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/escalations/:id', async (req, res) => {
  try {
    const esc = await Escalation.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!esc) return res.status(404).json({ error: 'Escalation not found' });
    res.json(esc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Planner Task CRUD Routes
app.get('/api/planner/tasks', async (req, res) => {
  try {
    const tasks = await PlannerTask.find().sort({ completed: 1, createdAt: -1 });
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/planner/tasks', async (req, res) => {
  try {
    const { title, description, dueDate, priority } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const task = await PlannerTask.create({ title, description, dueDate, priority });
    res.status(201).json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/planner/tasks/:id', async (req, res) => {
  try {
    const task = await PlannerTask.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/planner/tasks/:id', async (req, res) => {
  try {
    const task = await PlannerTask.findByIdAndDelete(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ message: 'Task deleted', task });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Planner Chat Routes
app.post('/api/planner/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });
    const result = await processPlannerMessage(message, sessionId || 'planner-default');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/planner/chat/history', async (req, res) => {
  try {
    const sid = req.query.sessionId || 'planner-default';
    const chat = await AgentChat.findOne({ sessionId: sid });
    res.json(chat ? chat.messages : []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/planner/chat/history', async (req, res) => {
  try {
    const sid = req.query.sessionId || 'planner-default';
    await AgentChat.deleteOne({ sessionId: sid });
    res.json({ message: 'Planner chat history cleared' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Orchestrator Routes
app.post('/api/orchestrator/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });
    console.log('[Orchestrator Route] Processing:', message.substring(0, 50));
    const result = await processOrchestratorMessage(message, sessionId || 'orchestrator-default');
    res.json(result);
  } catch (err) {
    console.error('[Orchestrator Route] Error:', err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/orchestrator/chat/history', async (req, res) => {
  try {
    const sid = req.query.sessionId || 'orchestrator-default';
    const chat = await AgentChat.findOne({ sessionId: sid });
    res.json(chat ? chat.messages : []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/orchestrator/chat/history', async (req, res) => {
  try {
    const sid = req.query.sessionId || 'orchestrator-default';
    await AgentChat.deleteOne({ sessionId: sid });
    res.json({ message: 'Orchestrator chat history cleared' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// WhatsApp Routes
app.get('/api/whatsapp/status', (req, res) => {
  res.json({ status: whatsappService.getStatus() });
});

app.get('/api/whatsapp/qr', (req, res) => {
  const qr = whatsappService.getQR();
  res.json({ qr });
});

app.post('/api/whatsapp/connect', (req, res) => {
  whatsappService.initializeWhatsApp();
  res.json({ message: 'Initializing WhatsApp Client...' });
});

app.post('/api/whatsapp/logout', async (req, res) => {
  await whatsappService.logout();
  res.json({ message: 'Logged out successfully' });
});

app.get('/api/whatsapp/phoneNumber', (req, res) => {
  res.json({ phoneNumber: whatsappService.getPhoneNumber() });
});

// Get active WhatsApp chats (for contact lookup)
app.get('/api/whatsapp/chats', async (req, res) => {
  try {
    const chats = await whatsappService.getActiveChats();
    res.json(chats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send WhatsApp message by contact name
app.post('/api/whatsapp/send', async (req, res) => {
  try {
    const { to, message } = req.body;
    if (!to || !message) {
      return res.status(400).json({ error: 'to (contact name) and message are required' });
    }
    const result = await whatsappService.sendWhatsAppByName(to, message);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== GITHUB ROUTES =====================

// GitHub token settings
app.get('/api/settings/github-token', async (req, res) => {
  try {
    const setting = await Setting.findOne({ key: 'github_token' });
    if (!setting || !setting.value) {
      return res.json({ token: null, hasToken: false });
    }
    const val = setting.value;
    const masked = val.length > 10 ? val.slice(0, 4) + '...' + val.slice(-4) : val;
    res.json({ token: masked, hasToken: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings/github-token', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token is required' });
    await Setting.findOneAndUpdate(
      { key: 'github_token' },
      { value: token, updatedAt: Date.now() },
      { upsert: true, new: true }
    );
    res.json({ message: 'GitHub token saved successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GitHub API — Issues
app.get('/api/github/issues/:owner/:repo', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const issues = await githubService.listIssues(owner, repo, {
      state: req.query.state,
      label: req.query.label,
      limit: req.query.limit ? parseInt(req.query.limit) : undefined
    });
    res.json(issues);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/github/issues/:owner/:repo', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const { title, body, labels } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const issue = await githubService.createIssue(owner, repo, title, body, labels);
    res.status(201).json(issue);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/github/issues/:owner/:repo/:number/close', async (req, res) => {
  try {
    const { owner, repo, number } = req.params;
    const result = await githubService.closeIssue(owner, repo, parseInt(number));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GitHub API — Pull Requests
app.get('/api/github/prs/:owner/:repo', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const prs = await githubService.listPRs(owner, repo, {
      state: req.query.state,
      limit: req.query.limit ? parseInt(req.query.limit) : undefined
    });
    res.json(prs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/github/prs/:owner/:repo/:number', async (req, res) => {
  try {
    const { owner, repo, number } = req.params;
    const pr = await githubService.getPRStatus(owner, repo, parseInt(number));
    res.json(pr);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GitHub API — CI/Workflow Runs
app.get('/api/github/ci/:owner/:repo', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const runs = await githubService.listCIRuns(owner, repo, {
      limit: req.query.limit ? parseInt(req.query.limit) : undefined,
      branch: req.query.branch
    });
    res.json(runs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GitHub API — Repo Info
app.get('/api/github/repo/:owner/:repo', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const info = await githubService.getRepoInfo(owner, repo);
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== PROCESS MANAGER ROUTES =====================

const processManager = require('./processManagerService');
const codingAgent = require('./codingAgentService');
const ghIssues = require('./ghIssuesService');

// List all processes
app.get('/api/processes', (req, res) => {
  res.json(processManager.listProcesses());
});

// Spawn a new process
app.post('/api/processes', (req, res) => {
  try {
    const { command, cwd, timeout, label } = req.body;
    if (!command) return res.status(400).json({ error: 'command is required' });
    const result = processManager.spawnProcess(command, { cwd, timeout, label });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get process status
app.get('/api/processes/:id', (req, res) => {
  const proc = processManager.getProcess(req.params.id);
  if (!proc) return res.status(404).json({ error: 'Session not found' });
  res.json(proc);
});

// Get process log
app.get('/api/processes/:id/log', (req, res) => {
  const tail = req.query.tail ? parseInt(req.query.tail) : 50;
  const log = processManager.getProcessLog(req.params.id, tail);
  if (!log) return res.status(404).json({ error: 'Session not found' });
  res.json(log);
});

// Send input to process
app.post('/api/processes/:id/input', (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });
    const result = processManager.sendInput(req.params.id, text);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Kill process
app.delete('/api/processes/:id', (req, res) => {
  try {
    const result = processManager.killProcess(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== CODING AGENT ROUTES =====================

// Execute coding task
app.post('/api/coding/task', async (req, res) => {
  try {
    const { task, targetFiles, workDir, autoApply } = req.body;
    if (!task) return res.status(400).json({ error: 'task description is required' });
    const result = await codingAgent.executeTask(task, { targetFiles, workDir, autoApply });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Analyze code files
app.post('/api/coding/analyze', async (req, res) => {
  try {
    const { files, workDir, question } = req.body;
    if (!files || !Array.isArray(files)) return res.status(400).json({ error: 'files array is required' });
    const result = await codingAgent.analyzeCode(files, workDir, question);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Review PR
app.post('/api/coding/review', async (req, res) => {
  try {
    const { owner, repo, pr } = req.body;
    if (!owner || !repo || !pr) return res.status(400).json({ error: 'owner, repo, and pr are required' });
    const result = await codingAgent.reviewPR(owner, repo, pr);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get coding task status
app.get('/api/coding/task/:taskId', (req, res) => {
  const status = codingAgent.getTaskStatus(req.params.taskId);
  if (!status) return res.status(404).json({ error: 'Task not found' });
  res.json(status);
});

// ===================== GH-ISSUES AUTO-FIX ROUTES =====================

// Analyze issue (confidence check)
app.post('/api/github/analyze-issue/:owner/:repo/:number', async (req, res) => {
  try {
    const { owner, repo, number } = req.params;
    const result = await ghIssues.analyzeIssue(owner, repo, parseInt(number));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Auto-fix issue
app.post('/api/github/auto-fix/:owner/:repo/:number', async (req, res) => {
  try {
    const { owner, repo, number } = req.params;
    const { workDir, minConfidence } = req.body || {};
    const result = await ghIssues.autoFixIssue(owner, repo, parseInt(number), { workDir, minConfidence });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Batch fix issues
app.post('/api/github/batch-fix/:owner/:repo', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const { label, limit, workDir } = req.body || {};
    const result = await ghIssues.batchFixIssues(owner, repo, { label, limit, workDir });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== HOUSE OBJECT TRACKING ROUTES =====================

// Object tracking toggle
app.get('/api/settings/object-tracking', async (req, res) => {
  try {
    const setting = await Setting.findOne({ key: 'object_tracking_enabled' });
    res.json({ enabled: setting?.value === 'true' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/settings/object-tracking', async (req, res) => {
  try {
    const { enabled } = req.body;
    await Setting.findOneAndUpdate(
      { key: 'object_tracking_enabled' },
      { value: enabled ? 'true' : 'false', updatedAt: Date.now() },
      { upsert: true, new: true }
    );
    res.json({ enabled, message: `Object tracking ${enabled ? 'enabled' : 'disabled'}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// House Objects CRUD
app.get('/api/house-objects', async (req, res) => {
  try {
    const objects = await HouseObject.find().sort({ lastSeen: -1 });
    res.json(objects);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/house-objects', async (req, res) => {
  try {
    const { name, description, expectedLocation, imageDescription } = req.body;
    if (!name || !expectedLocation) {
      return res.status(400).json({ error: 'name and expectedLocation are required' });
    }
    const result = await learnObject(name, description || '', expectedLocation, imageDescription || '');
    res.status(201).json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/house-objects/:id', async (req, res) => {
  try {
    const obj = await HouseObject.findByIdAndUpdate(req.params.id, { ...req.body, lastSeen: Date.now() }, { new: true });
    if (!obj) return res.status(404).json({ error: 'Object not found' });
    res.json(obj);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/house-objects/:id', async (req, res) => {
  try {
    const obj = await HouseObject.findByIdAndDelete(req.params.id);
    if (!obj) return res.status(404).json({ error: 'Object not found' });
    // Also cleanup related displacements
    await DisplacedObject.deleteMany({ houseObjectId: req.params.id });
    res.json({ message: 'Object deleted', object: obj });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Displaced Objects
app.get('/api/displaced-objects', async (req, res) => {
  try {
    const status = req.query.status || 'pending';
    const displaced = await DisplacedObject.find({ status }).sort({ detectedAt: -1 });
    res.json(displaced);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/displaced-objects/:id/resolve', async (req, res) => {
  try {
    const d = await DisplacedObject.findByIdAndUpdate(req.params.id, { status: 'resolved' }, { new: true });
    if (!d) return res.status(404).json({ error: 'Not found' });
    res.json(d);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Cleanup Batches
app.get('/api/cleanup-batches', async (req, res) => {
  try {
    const batches = await CleanupBatch.find().populate('displacedObjects').sort({ notifiedAt: -1 });
    res.json(batches);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/cleanup-batches/pending', async (req, res) => {
  try {
    const batch = await CleanupBatch.findOne({ status: 'pending' }).populate('displacedObjects');
    res.json(batch);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/cleanup-batches/:id/approve', async (req, res) => {
  try {
    const result = await approveBatch(req.params.id);
    res.json({ message: `Created ${result.tasks.length} tasks`, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/cleanup-batches/:id/dismiss', async (req, res) => {
  try {
    const batch = await dismissBatch(req.params.id);
    res.json({ message: 'Batch dismissed', batch });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===================== CRON JOB ROUTES =====================

app.get('/api/cron-jobs', async (req, res) => {
  try {
    const jobs = await cronService.listCronJobs();
    res.json(jobs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/cron-jobs', async (req, res) => {
  try {
    const { name, cronExpression, actionType, actionPayload } = req.body;
    if (!name || !cronExpression || !actionType) {
      return res.status(400).json({ error: 'name, cronExpression, and actionType are required' });
    }
    const job = await cronService.createCronJob(name, cronExpression, actionType, actionPayload || {});
    res.status(201).json(job);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.patch('/api/cron-jobs/:id', async (req, res) => {
  try {
    const job = await CronJob.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!job) return res.status(404).json({ error: 'Cron job not found' });
    res.json(job);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/cron-jobs/:id', async (req, res) => {
  try {
    const job = await cronService.deleteCronJob(req.params.id);
    res.json({ message: 'Cron job deleted', job });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/cron-jobs/:id/pause', async (req, res) => {
  try {
    const job = await cronService.pauseCronJob(req.params.id);
    res.json({ message: 'Cron job paused', job });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/cron-jobs/:id/resume', async (req, res) => {
  try {
    const job = await cronService.resumeCronJob(req.params.id);
    res.json({ message: 'Cron job resumed', job });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/cron-jobs/:id/logs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const logs = await cronService.getJobLogs(req.params.id, limit);
    res.json(logs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/cron-jobs/logs/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 30;
    const logs = await cronService.getRecentLogs(limit);
    res.json(logs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===================== GLASSES GATEWAY ROUTES =====================

// OpenAI-compatible endpoint (drop-in replacement for OpenClaw)
app.post('/v1/chat/completions', async (req, res) => {
  try {
    // Validate Bearer token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }
    const token = authHeader.substring(7);
    const valid = await validateGlassesToken(token);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid gateway token' });
    }

    const { messages } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    const sessionKey = req.headers['x-openclaw-session-key'] || 'glasses-default';
    console.log(`[Glasses Gateway] Session: ${sessionKey}, Messages: ${messages.length}`);

    const result = await processGlassesRequest(messages, sessionKey);

    // Return in OpenAI format (same as what OpenClawBridge.kt expects)
    res.json({
      id: `glasses-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'glasses-gateway',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: result.content
        },
        finish_reason: 'stop'
      }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    });
  } catch (err) {
    console.error('[Glasses Gateway] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Glasses memories CRUD
app.get('/api/glasses/memories', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const memories = await getRecentMemories(limit);
    res.json(memories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/glasses/memories', async (req, res) => {
  try {
    await GlassesMemory.deleteMany({});
    res.json({ message: 'All glasses memories cleared' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/glasses/memories/:id', async (req, res) => {
  try {
    const mem = await GlassesMemory.findByIdAndDelete(req.params.id);
    if (!mem) return res.status(404).json({ error: 'Memory not found' });
    res.json({ message: 'Memory deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Glasses gateway token management
app.get('/api/settings/glasses-token', async (req, res) => {
  try {
    const setting = await Setting.findOne({ key: 'glasses_gateway_token' });
    if (!setting || !setting.value) {
      return res.json({ token: null });
    }
    const val = setting.value;
    const masked = val.length > 8 ? val.slice(0, 4) + '...' + val.slice(-4) : val;
    res.json({ token: masked, hasToken: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings/glasses-token/generate', async (req, res) => {
  try {
    const newToken = crypto.randomBytes(24).toString('hex');
    await Setting.findOneAndUpdate(
      { key: 'glasses_gateway_token' },
      { value: newToken, updatedAt: Date.now() },
      { upsert: true, new: true }
    );
    res.json({ token: newToken, message: 'New token generated. Update your glasses app Secrets.kt with this token.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Glasses memory sync endpoints
app.get('/api/glasses/memories/export', async (req, res) => {
  try {
    const memories = await getAllMemories();
    res.json(memories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/glasses/sync-from-vps', async (req, res) => {
  try {
    const { vpsUrl } = req.body;
    if (!vpsUrl) {
      return res.status(400).json({ error: 'vpsUrl is required (e.g. http://155.117.45.192:5000)' });
    }

    console.log(`[Glasses Sync] Fetching memories from ${vpsUrl}...`);
    const response = await fetch(`${vpsUrl}/api/glasses/memories/export`);
    if (!response.ok) {
      throw new Error(`VPS returned ${response.status}: ${response.statusText}`);
    }
    const vpsMemories = await response.json();

    if (!Array.isArray(vpsMemories) || vpsMemories.length === 0) {
      return res.json({ message: 'No memories on VPS to sync', synced: 0 });
    }

    let synced = 0;
    let skipped = 0;
    for (const mem of vpsMemories) {
      // Check if memory already exists (by content match)
      const existing = await GlassesMemory.findOne({ content: mem.content });
      if (!existing) {
        await GlassesMemory.create({
          category: mem.category || 'general',
          content: mem.content,
          importance: mem.importance || 'medium',
          source: mem.source || 'vps-sync',
          updatedAt: mem.updatedAt || new Date()
        });
        synced++;
      } else {
        skipped++;
      }
    }

    console.log(`[Glasses Sync] Done: ${synced} synced, ${skipped} skipped (duplicates)`);
    res.json({ message: `Synced ${synced} memories from VPS`, synced, skipped, total: vpsMemories.length });
  } catch (err) {
    console.error('[Glasses Sync] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
  // Restore cron jobs from DB
  setTimeout(async () => {
    try {
      await cronService.restoreJobs();
    } catch (err) {
      console.error('[Cron] Failed to restore jobs on startup:', err.message);
    }
  }, 1000);
  // Automatically initialize WhatsApp client on server start
  setTimeout(() => {
    whatsappService.initializeWhatsApp();
  }, 2000);
});

// Graceful Shutdown Handlers for PM2 restarts / Node stops
const gracefulShutdown = async (signal) => {
  console.log(`${signal} received. Shutting down gracefully...`);
  await whatsappService.destroyClient();
  mongoose.connection.close(false, () => {
    console.log('MongoDB connection closed.');
    process.exit(0);
  });
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));