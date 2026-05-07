const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Load all Mongoose models
require('./models');

const whatsappService = require('./whatsappService');
const cronService = require('./cronService');
const emailAgent = require('./emailAgentService');
const { setupMcpBridge, callMcpTool, isBridgeConnected, getBridgeTools, getBridgeStatus } = require('./mcpBridgeService');

// New Infrastructure Services
const redis = require('./services/redis');
const { initCassandra } = require('./services/cassandra');
const { setupCronJobs } = require('./services/queue');

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize Async Services
initCassandra().catch(err => console.error('Cassandra init error:', err));
setupCronJobs().catch(err => console.error('Queue cron setup error:', err));

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : 'http://localhost:3000'
}));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 500, standardHeaders: true, legacyHeaders: false }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ─── Routes ─────────────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({ status: 'Backend is running!', db: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected' });
});

app.use('/api/agent', require('./routes/agent'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/items', require('./routes/items'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/orchestrator', require('./routes/orchestrator'));
app.use('/api/planner', require('./routes/planner'));
app.use('/api/knowledge', require('./routes/knowledge'));
app.use('/api/escalations', require('./routes/escalations'));
app.use('/api/whatsapp', require('./routes/whatsapp'));
app.use('/api/github', require('./routes/github'));
app.use('/api/processes', require('./routes/processes'));
app.use('/api/coding', require('./routes/coding'));
app.use('/api', require('./routes/objects'));
app.use('/api/cron-jobs', require('./routes/cronJobs'));
app.use('/api/web-agent', require('./routes/webAgent'));
app.use('/api/glasses', require('./routes/glasses'));
app.use('/api/ugc', require('./routes/ugc'));
app.use('/api/ugc-video', require('./routes/ugcVideo'));
app.use('/api/ugc-product', require('./routes/ugcProduct'));
app.use('/api/email', require('./routes/email'));
app.use('/api/local-exec', require('./routes/localExec'));
app.use('/api/git-apps', require('./routes/gitApps'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/nego', require('./routes/nego'));
app.use('/api/pm2', require('./routes/pm2'));
app.use('/api/profile', require('./routes/profile'));

// Glasses OpenAI-compatible endpoint (special path, not under /api/glasses)
const glassesRoutes = require('./routes/glasses');
app.use('/', glassesRoutes);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ─── Error Handler ──────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(`[${req.method}] ${req.path}:`, err.message);
  res.status(err.status || 500).json({ error: 'Internal server error' });
});

// ─── MCP Bridge Status API ──────────────────────────────────────────────────
app.get('/api/mcp-bridge/status', (req, res) => {
  res.json({
    connected: isBridgeConnected(),
    bridges: getBridgeStatus(),
    tools: getBridgeTools(),
  });
});

app.post('/api/mcp-bridge/call', async (req, res) => {
  try {
    const { tool, params, agent } = req.body;
    if (!tool) return res.status(400).json({ error: 'tool is required' });
    const result = await callMcpTool(tool, params || {}, { agent });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Database & Start ───────────────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/usa_db')
  .then(() => console.log('MongoDB connected successfully!'))
  .catch(err => console.error('MongoDB connection error:', err));

const server = app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);

  // Setup MCP Bridge WebSocket
  setupMcpBridge(server);

  // Restore cron jobs from DB
  setTimeout(async () => {
    try { await cronService.restoreJobs(); }
    catch (err) { console.error('[Cron] Failed to restore jobs on startup:', err.message); }
  }, 1000);

  // Restore email agents
  setTimeout(async () => {
    try { await emailAgent.restoreActiveAgents(); }
    catch (err) { console.error('[EmailAgent] Failed to restore on startup:', err.message); }
  }, 1500);

  // WhatsApp disabled — NegoApp handles WhatsApp via bridge
  // setTimeout(() => { whatsappService.initializeWhatsApp(); }, 2000);
});

// ─── Graceful Shutdown ──────────────────────────────────────────────────────
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

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Global] Unhandled Rejection at:', promise, 'reason:', reason);
  if (reason instanceof Error) console.error(reason.stack);
});

process.on('uncaughtException', (err) => {
  console.error('[Global] Uncaught Exception:', err.message);
  console.error(err.stack);
});
