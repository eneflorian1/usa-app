const BaseAgent = require('./BaseAgent');
const { callGemini } = require('../geminiService');
const {
  client,
  setMemory,
  findDuplicateMemory,
  saveConversationSummary,
  isReady,
} = require('../services/cassandra');

const CATEGORIES = ['USER_PREFERENCE', 'FACT', 'PROJECT_UPDATE', 'CONTACT', 'GOAL', 'CONSTRAINT'];

class MemoryConsolidator extends BaseAgent {
  constructor() {
    super('MemoryConsolidator');
  }

  async run() {
    if (!isReady()) {
      return 'Cassandra not ready — skipping consolidation';
    }

    const convRes = await client.execute(
      'SELECT session_id, timestamp, role, content, intent FROM conversations LIMIT 200',
      [],
      { prepare: true }
    );
    const conversations = convRes.rows;
    if (conversations.length === 0) return 'No conversations to consolidate';

    const bySession = new Map();
    for (const c of conversations) {
      if (!bySession.has(c.session_id)) bySession.set(c.session_id, []);
      bySession.get(c.session_id).push(c);
    }

    let totalExtracted = 0;
    let totalDeduped = 0;
    let totalSaved = 0;

    for (const [sessionId, turns] of bySession) {
      turns.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      const textContext = turns.map(c => `[${c.role}]: ${c.content}`).join('\n');

      const systemInstruction = `Ești un Memory Consolidation Agent pentru un asistent AI personal avansat.
Analizezi conversații recente și extragi fapte durabile, preferințe, și actualizări de proiect.

Categorii permise: ${CATEGORIES.join(', ')}.
- USER_PREFERENCE: mod de lucru, stil, limbă, dietă, rutine ("prefers short replies", "likes dark mode")
- FACT: informații obiective persistente ("lives in Bucharest", "has a cat named Luna")
- PROJECT_UPDATE: schimbări în proiecte ("usa-app now uses Cassandra vectors")
- CONTACT: persoane și relații
- GOAL: obiective declarate de user
- CONSTRAINT: limitări, reguli, lucruri de evitat

IGNORĂ: întrebări efemere, small talk, stări temporare, task-uri curente (acelea sunt în planner).

Returnează DOAR JSON array valid:
[{"category":"...","key":"scurt-descriptor-kebab-case","value":"propoziție completă","confidence":0.0-1.0}]

Nu explica. Nu folosi markdown. Doar array-ul.`;

      const prompt = `Analizează aceste turnuri și extrage cunoștințele noi durabile:\n\n${textContext}`;

      let extracted = [];
      try {
        const raw = await callGemini(prompt, systemInstruction);
        const jsonStr = raw.replace(/```json|```/g, '').trim();
        extracted = JSON.parse(jsonStr);
        if (!Array.isArray(extracted)) extracted = [];
      } catch (err) {
        console.warn(`[MemoryConsolidator] Parse failed for session ${sessionId}: ${err.message}`);
        continue;
      }

      totalExtracted += extracted.length;

      for (const item of extracted) {
        if (!item.category || !item.key || !item.value) continue;
        if (!CATEGORIES.includes(item.category)) continue;

        const dup = await findDuplicateMemory(item.category, item.value);
        if (dup) {
          await setMemory(
            item.category,
            dup.key,
            dup.value,
            'inferred-reinforced',
            Math.min(1, (dup.confidence || 0.5) + 0.05)
          );
          totalDeduped++;
          continue;
        }

        await setMemory(
          item.category,
          item.key,
          item.value,
          'inferred',
          Math.max(0, Math.min(1, item.confidence || 0.7))
        );
        totalSaved++;
      }

      if (turns.length >= 8) {
        try {
          const summaryPrompt = `Rezumă în 2-3 propoziții concise conversația de mai jos, în limba originalului. Păstrează doar esența semnificativă.\n\n${textContext}`;
          const summary = await callGemini(summaryPrompt, 'Ești un rezumator concis.');
          const day = new Date().toISOString().split('T')[0];
          await saveConversationSummary(sessionId, day, summary.trim(), turns.length);
        } catch (err) {
          console.warn(`[MemoryConsolidator] Summary failed for ${sessionId}: ${err.message}`);
        }
      }
    }

    return `Consolidated ${totalSaved} new facts (+${totalDeduped} reinforced) from ${totalExtracted} candidates across ${bySession.size} sessions`;
  }
}

module.exports = MemoryConsolidator;
