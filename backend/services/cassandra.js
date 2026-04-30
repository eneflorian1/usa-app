const cassandra = require('cassandra-driver');

const KEYSPACE = process.env.CASSANDRA_KEYSPACE || 'usaapp';
const DATACENTER = process.env.CASSANDRA_DATACENTER || 'datacenter1';
const HOST = process.env.CASSANDRA_HOST || '127.0.0.1';

const EMBEDDING_DIMS = 768;
const DEDUP_THRESHOLD = 0.92;
const RECALL_MIN_SCORE = 0.55;

const bootClient = new cassandra.Client({
  contactPoints: [HOST],
  localDataCenter: DATACENTER,
});

const client = new cassandra.Client({
  contactPoints: [HOST],
  localDataCenter: DATACENTER,
  keyspace: KEYSPACE,
});

let ready = false;

async function ensureKeyspace() {
  await bootClient.connect();
  await bootClient.execute(
    `CREATE KEYSPACE IF NOT EXISTS ${KEYSPACE}
     WITH replication = { 'class': 'SimpleStrategy', 'replication_factor': 1 }`
  );
  await bootClient.shutdown();
}

async function ensureSchema() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS conversations (
       session_id text,
       timestamp timestamp,
       role text,
       content text,
       intent text,
       tools_used text,
       embedding list<float>,
       PRIMARY KEY (session_id, timestamp)
     ) WITH CLUSTERING ORDER BY (timestamp DESC)`,

    `CREATE TABLE IF NOT EXISTS memory (
       category text,
       key text,
       value text,
       confidence float,
       source text,
       recurrence int,
       embedding list<float>,
       updated_at timestamp,
       PRIMARY KEY (category, key)
     )`,

    `CREATE TABLE IF NOT EXISTS memory_index (
       shard int,
       key text,
       category text,
       value text,
       confidence float,
       embedding list<float>,
       updated_at timestamp,
       PRIMARY KEY (shard, updated_at, key)
     ) WITH CLUSTERING ORDER BY (updated_at DESC, key ASC)`,

    `CREATE TABLE IF NOT EXISTS agent_logs (
       date text,
       timestamp timestamp,
       agent text,
       action text,
       status text,
       message text,
       metadata text,
       PRIMARY KEY (date, timestamp, agent)
     ) WITH CLUSTERING ORDER BY (timestamp DESC, agent ASC)`,

    `CREATE TABLE IF NOT EXISTS conversation_summaries (
       session_id text,
       day text,
       summary text,
       turn_count int,
       embedding list<float>,
       updated_at timestamp,
       PRIMARY KEY (session_id, day)
     ) WITH CLUSTERING ORDER BY (day DESC)`,
  ];
  for (const stmt of stmts) {
    await client.execute(stmt);
  }
}

async function initCassandra() {
  try {
    await ensureKeyspace();
    await client.connect();
    await ensureSchema();
    ready = true;
    console.log('[Cassandra] Connected + schema ready');
  } catch (err) {
    console.error('[Cassandra] Init failed:', err.message);
    ready = false;
  }
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

let _embeddingServiceCached = null;
async function safeEmbed(text) {
  if (!text || typeof text !== 'string') return null;
  try {
    if (!_embeddingServiceCached) {
      _embeddingServiceCached = require('../embeddingService');
    }
    return await _embeddingServiceCached.generateEmbedding(text);
  } catch (err) {
    console.warn('[Cassandra] Embedding failed:', err.message);
    return null;
  }
}

async function saveConversation(sessionId, role, content, intent, tools = []) {
  if (!ready) return;
  const embedding = await safeEmbed(content);
  const query = `INSERT INTO conversations
    (session_id, timestamp, role, content, intent, tools_used, embedding)
    VALUES (?, toTimestamp(now()), ?, ?, ?, ?, ?)`;
  await client.execute(
    query,
    [sessionId, role, content, intent || 'unknown', JSON.stringify(tools), embedding],
    { prepare: true }
  );
}

function memoryShardFor(category) {
  const s = String(category || '').toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 8;
}

async function setMemory(category, key, value, source = 'conversation', confidence = 0.8) {
  if (!ready) return;
  const text = `[${category}] ${key}: ${value}`;
  const embedding = await safeEmbed(text);

  const existing = await client.execute(
    'SELECT recurrence, confidence FROM memory WHERE category = ? AND key = ?',
    [category, key],
    { prepare: true }
  );
  const prev = existing.rows[0];
  const recurrence = (prev?.recurrence || 0) + 1;
  const boostedConf = prev
    ? Math.min(1, Math.max(prev.confidence || 0, confidence) + 0.05)
    : confidence;

  await client.execute(
    `INSERT INTO memory
       (category, key, value, confidence, source, recurrence, embedding, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, toTimestamp(now()))`,
    [category, key, value, boostedConf, source, recurrence, embedding],
    { prepare: true }
  );

  await client.execute(
    `INSERT INTO memory_index
       (shard, key, category, value, confidence, embedding, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, toTimestamp(now()))`,
    [memoryShardFor(category), key, category, value, boostedConf, embedding],
    { prepare: true }
  );
}

async function loadAllMemoriesWithEmbeddings(limitPerShard = 500) {
  if (!ready) return [];
  const rows = [];
  for (let shard = 0; shard < 8; shard++) {
    const r = await client.execute(
      'SELECT shard, key, category, value, confidence, embedding, updated_at FROM memory_index WHERE shard = ? LIMIT ?',
      [shard, limitPerShard],
      { prepare: true }
    );
    rows.push(...r.rows);
  }
  return rows;
}

async function recallMemories(query, opts = {}) {
  if (!ready) return [];
  const { topK = 6, minScore = RECALL_MIN_SCORE, category = null } = opts;
  const qVec = await safeEmbed(query);
  if (!qVec) return [];

  const all = await loadAllMemoriesWithEmbeddings();
  const filtered = category
    ? all.filter(r => String(r.category).toLowerCase() === String(category).toLowerCase())
    : all;

  return filtered
    .filter(r => Array.isArray(r.embedding) && r.embedding.length === EMBEDDING_DIMS)
    .map(r => ({
      category: r.category,
      key: r.key,
      value: r.value,
      confidence: r.confidence,
      updatedAt: r.updated_at,
      score: cosineSimilarity(qVec, r.embedding),
    }))
    .filter(r => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

async function findDuplicateMemory(category, value, threshold = DEDUP_THRESHOLD) {
  if (!ready) return null;
  const vec = await safeEmbed(`[${category}] ${value}`);
  if (!vec) return null;
  const rows = await client.execute(
    'SELECT key, value, embedding, confidence FROM memory_index WHERE shard = ?',
    [memoryShardFor(category)],
    { prepare: true }
  );
  let best = null;
  for (const r of rows.rows) {
    if (!Array.isArray(r.embedding) || r.embedding.length !== EMBEDDING_DIMS) continue;
    const s = cosineSimilarity(vec, r.embedding);
    if (s >= threshold && (!best || s > best.score)) {
      best = { key: r.key, value: r.value, confidence: r.confidence, score: s };
    }
  }
  return best;
}

async function getRecentConversations(sessionId, limit = 20) {
  if (!ready) return [];
  if (sessionId) {
    const r = await client.execute(
      'SELECT session_id, timestamp, role, content, intent FROM conversations WHERE session_id = ? LIMIT ?',
      [sessionId, limit],
      { prepare: true }
    );
    return r.rows;
  }
  const r = await client.execute('SELECT * FROM conversations LIMIT ?', [limit], { prepare: true });
  return r.rows;
}

async function recallConversationTurns(query, opts = {}) {
  if (!ready) return [];
  const { topK = 4, minScore = 0.6, sessionId = null, maxScan = 300 } = opts;
  const qVec = await safeEmbed(query);
  if (!qVec) return [];

  const cql = sessionId
    ? 'SELECT session_id, timestamp, role, content, embedding FROM conversations WHERE session_id = ? LIMIT ?'
    : 'SELECT session_id, timestamp, role, content, embedding FROM conversations LIMIT ?';
  const params = sessionId ? [sessionId, maxScan] : [maxScan];
  const r = await client.execute(cql, params, { prepare: true });

  return r.rows
    .filter(x => Array.isArray(x.embedding) && x.embedding.length === EMBEDDING_DIMS)
    .map(x => ({
      sessionId: x.session_id,
      timestamp: x.timestamp,
      role: x.role,
      content: x.content,
      score: cosineSimilarity(qVec, x.embedding),
    }))
    .filter(x => x.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

async function buildContextBlock(sessionId, userQuery, opts = {}) {
  if (!ready) return '';
  const { memoryK = 6, turnK = 3, recentTurns = 6 } = opts;

  const [semanticMem, semanticTurns, recent] = await Promise.all([
    userQuery ? recallMemories(userQuery, { topK: memoryK }) : Promise.resolve([]),
    userQuery ? recallConversationTurns(userQuery, { topK: turnK, sessionId }) : Promise.resolve([]),
    getRecentConversations(sessionId, recentTurns),
  ]);

  let block = '';

  if (semanticMem.length > 0) {
    block += '\n[MEMORY_RELEVANT]\n';
    for (const m of semanticMem) {
      block += `  - [${m.category}] ${m.key}: ${m.value} (conf=${(m.confidence || 0).toFixed(2)}, sim=${m.score.toFixed(2)})\n`;
    }
    block += '[/MEMORY_RELEVANT]\n';
  }

  if (semanticTurns.length > 0) {
    block += '\n[PRIOR_TURNS_RELEVANT]\n';
    for (const t of semanticTurns) {
      const snippet = (t.content || '').replace(/\s+/g, ' ').slice(0, 220);
      block += `  - [${t.role}] ${snippet} (sim=${t.score.toFixed(2)})\n`;
    }
    block += '[/PRIOR_TURNS_RELEVANT]\n';
  }

  if (recent.length > 0) {
    block += '\n[RECENT_TURNS]\n';
    const ordered = [...recent].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    for (const t of ordered) {
      const snippet = (t.content || '').replace(/\s+/g, ' ').slice(0, 200);
      block += `  [${t.role}] ${snippet}\n`;
    }
    block += '[/RECENT_TURNS]\n';
  }

  return block;
}

async function logAgent(agent, action, status, message, metadata = {}) {
  if (!ready) return;
  const date = new Date().toISOString().split('T')[0];
  await client.execute(
    `INSERT INTO agent_logs (date, timestamp, agent, action, status, message, metadata)
     VALUES (?, toTimestamp(now()), ?, ?, ?, ?, ?)`,
    [date, agent, action, status, message, JSON.stringify(metadata)],
    { prepare: true }
  );
}

async function saveConversationSummary(sessionId, day, summary, turnCount) {
  if (!ready) return;
  const embedding = await safeEmbed(summary);
  await client.execute(
    `INSERT INTO conversation_summaries
       (session_id, day, summary, turn_count, embedding, updated_at)
     VALUES (?, ?, ?, ?, ?, toTimestamp(now()))`,
    [sessionId, day, summary, turnCount, embedding],
    { prepare: true }
  );
}

module.exports = {
  client,
  initCassandra,
  isReady: () => ready,
  EMBEDDING_DIMS,
  DEDUP_THRESHOLD,

  saveConversation,
  setMemory,
  getRecentConversations,
  recallMemories,
  recallConversationTurns,
  loadAllMemoriesWithEmbeddings,
  findDuplicateMemory,
  buildContextBlock,
  saveConversationSummary,
  logAgent,
};
