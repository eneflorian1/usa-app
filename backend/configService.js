const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const cache = new Map();
const CACHE_TTL = 60000; // 1 minute

/**
 * Get a setting value by key, with in-memory cache.
 */
async function getApiKey(keyName) {
  const cached = cache.get(keyName);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.value;

  const Setting = mongoose.model('Setting');
  const setting = await Setting.findOne({ key: keyName });
  if (!setting || !setting.value) throw new Error(`${keyName} not configured`);

  cache.set(keyName, { value: setting.value, ts: Date.now() });
  return setting.value;
}

/**
 * Get a configured Gemini generative model.
 */
async function getGeminiModel(systemPrompt, modelName = 'gemini-2.5-flash') {
  const apiKey = await getApiKey('gemini_api_key');
  const genAI = new GoogleGenerativeAI(apiKey);
  const config = { model: modelName };
  if (systemPrompt) config.systemInstruction = systemPrompt;
  return genAI.getGenerativeModel(config);
}

/**
 * Invalidate cache for a specific key (e.g., after update).
 */
function invalidateCache(keyName) {
  if (keyName) cache.delete(keyName);
  else cache.clear();
}

module.exports = { getApiKey, getGeminiModel, invalidateCache };
