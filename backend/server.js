const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const { processAgentMessage } = require('./agentChatService');
const { processPlannerMessage } = require('./plannerAgentService');
const { processOrchestratorMessage } = require('./orchestratorService');

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

const PlannerTaskSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  dueDate: { type: Date, default: null },
  priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  completed: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const PlannerTask = mongoose.model('PlannerTask', PlannerTaskSchema);

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
    const tasks = await PlannerTask.find().sort({ completed: 1, priority: -1, dueDate: 1 });
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
    const result = await processOrchestratorMessage(message, sessionId || 'default');
    res.json(result);
  } catch (err) {
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

app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
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