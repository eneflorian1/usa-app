const router = require('express').Router();
const mongoose = require('mongoose');
const crypto = require('crypto');
const emailService = require('../emailService');
const { invalidateCache } = require('../configService');

const Setting = mongoose.model('Setting');

// Voice config
router.get('/voice/config', async (req, res) => {
  try {
    const setting = await Setting.findOne({ key: 'gemini_api_key' });
    if (!setting || !setting.value) return res.status(400).json({ error: 'Gemini API key not configured' });
    res.json({ apiKey: setting.value });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Gemini API Key
router.get('/gemini', async (req, res) => {
  try {
    const setting = await Setting.findOne({ key: 'gemini_api_key' });
    if (!setting || !setting.value) return res.json({ apiKey: null });
    const val = setting.value;
    const masked = val.length > 10 ? '...'.concat(val.slice(-10)) : val;
    res.json({ apiKey: masked });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/gemini', async (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey) return res.status(400).json({ error: 'API Key is required' });
    await Setting.findOneAndUpdate(
      { key: 'gemini_api_key' },
      { value: apiKey, updatedAt: Date.now() },
      { upsert: true, new: true }
    );
    invalidateCache('gemini_api_key');
    res.status(200).json({ message: 'API Key updated successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Anthropic API Key
router.get('/anthropic', async (req, res) => {
  try {
    const setting = await Setting.findOne({ key: 'anthropic_api_key' });
    if (!setting || !setting.value) return res.json({ apiKey: null });
    const val = setting.value;
    const masked = val.length > 10 ? '...'.concat(val.slice(-10)) : val;
    res.json({ apiKey: masked });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/anthropic', async (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey) return res.status(400).json({ error: 'API Key is required' });
    await Setting.findOneAndUpdate(
      { key: 'anthropic_api_key' },
      { value: apiKey, updatedAt: Date.now() },
      { upsert: true, new: true }
    );
    invalidateCache('anthropic_api_key');
    res.status(200).json({ message: 'Anthropic API Key updated successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// SearXNG URL
router.get('/searxng', async (req, res) => {
  try {
    const setting = await Setting.findOne({ key: 'searxng_url' });
    const PUBLIC_FALLBACK = 'https://searx.be';
    const url = (setting && setting.value && setting.value.trim()) || PUBLIC_FALLBACK;
    res.json({ url, isDefault: !setting || !setting.value });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/searxng', async (req, res) => {
  try {
    const { url } = req.body;
    await Setting.findOneAndUpdate(
      { key: 'searxng_url' },
      { value: url || '', updatedAt: Date.now() },
      { upsert: true, new: true }
    );
    invalidateCache('searxng_url');
    res.json({ message: 'SearXNG URL updated successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GitHub Token
router.get('/github-token', async (req, res) => {
  try {
    const setting = await Setting.findOne({ key: 'github_token' });
    if (!setting || !setting.value) return res.json({ token: null, hasToken: false });
    const val = setting.value;
    const masked = val.length > 10 ? val.slice(0, 4) + '...' + val.slice(-4) : val;
    res.json({ token: masked, hasToken: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/github-token', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token is required' });
    await Setting.findOneAndUpdate(
      { key: 'github_token' },
      { value: token, updatedAt: Date.now() },
      { upsert: true, new: true }
    );
    invalidateCache('github_token');
    res.json({ message: 'GitHub token saved successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Object Tracking
router.get('/object-tracking', async (req, res) => {
  try {
    const setting = await Setting.findOne({ key: 'object_tracking_enabled' });
    res.json({ enabled: setting && setting.value === 'true' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/object-tracking', async (req, res) => {
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

// Glasses Token
router.get('/glasses-token', async (req, res) => {
  try {
    const setting = await Setting.findOne({ key: 'glasses_gateway_token' });
    if (!setting || !setting.value) return res.json({ token: null });
    const val = setting.value;
    const masked = val.length > 8 ? val.slice(0, 4) + '...' + val.slice(-4) : val;
    res.json({ token: masked, hasToken: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/glasses-token/generate', async (req, res) => {
  try {
    const newToken = crypto.randomBytes(24).toString('hex');
    await Setting.findOneAndUpdate(
      { key: 'glasses_gateway_token' },
      { value: newToken, updatedAt: Date.now() },
      { upsert: true, new: true }
    );
    res.json({ token: newToken, message: 'New token generated. Update your glasses app Secrets.kt with this token.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// AgentMail API Key
router.get('/agentmail', async (req, res) => {
  try {
    const setting = await Setting.findOne({ key: 'agentmail_api_key' });
    if (!setting || !setting.value) return res.json({ apiKey: null });
    const val = setting.value;
    const masked = val.length > 10 ? '...'.concat(val.slice(-10)) : val;
    res.json({ apiKey: masked });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/agentmail', async (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey) return res.status(400).json({ error: 'API Key is required' });
    await Setting.findOneAndUpdate(
      { key: 'agentmail_api_key' },
      { value: apiKey, updatedAt: Date.now() },
      { upsert: true, new: true }
    );
    invalidateCache('agentmail_api_key');
    emailService.resetClient();
    res.json({ message: 'AgentMail API Key updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Wallet Settings
router.get('/wallet', async (req, res) => {
  try {
    const pkSetting = await Setting.findOne({ key: 'wallet_private_key' });
    const networkSetting = await Setting.findOne({ key: 'wallet_network' });
    res.json({
      configured: !!(pkSetting && pkSetting.value),
      network: networkSetting?.value || 'base-sepolia'
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/wallet', async (req, res) => {
  try {
    const { privateKey, network } = req.body;
    if (privateKey) {
      await Setting.findOneAndUpdate(
        { key: 'wallet_private_key' },
        { value: privateKey, updatedAt: Date.now() },
        { upsert: true, new: true }
      );
    }
    if (network) {
      await Setting.findOneAndUpdate(
        { key: 'wallet_network' },
        { value: network, updatedAt: Date.now() },
        { upsert: true, new: true }
      );
    }
    invalidateCache('wallet_private_key');
    invalidateCache('wallet_network');
    res.json({ message: 'Wallet settings saved' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
