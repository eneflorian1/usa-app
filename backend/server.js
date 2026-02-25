const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

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